# 02 — 设计规格

> 版本：v1.0　｜　上游：`01-requirements.md`　｜　下游：`03-tasks.md`
>
> 本文档描述**如何实现**上游需求。每条设计小节都标注它服务的 `REQ-*`。

---

## 1. 架构总览

三层，依赖方向自下而上，禁止反向依赖（REQ-N-004）。

```
┌─────────────────────────────────────────────────────────────┐
│ 表现层  index.html + src/styles/** + src/ui/render.js        │
│         DOM 构建、样式、ARIA 语义                            │
├─────────────────────────────────────────────────────────────┤
│ 交互层  src/ui/controller.js（事件绑定、长按/和弦手势）        │
│         src/ui/input.js  ★纯函数：事件特征 → 动作意图          │
│         src/ui/theme.js  src/ui/main.js（装配入口）           │
├─────────────────────────────────────────────────────────────┤
│ 领域层  src/core/board.js   棋盘规则（纯函数）                 │
│         src/core/game.js    状态机 + 计时 + 撤销 + 提示        │
│         src/core/storage.js 成绩持久化（注入 Storage 适配器）  │
│         src/core/rng.js  src/core/constants.js                │
│         src/core/format.js                                   │
└─────────────────────────────────────────────────────────────┘
        ▲ 领域层零 DOM 依赖 → 可在 Node 中直接 import 并单测
```

**关键设计取舍**

| 取舍 | 选择 | 理由 |
| --- | --- | --- |
| 棋盘可变 vs 不可变 | `board.js` 的函数**返回新棋盘**（结构共享不必要，直接克隆） | 撤销需要快照，不可变风格天然适配；30×16=480 格克隆成本可忽略 |
| 撤销实现 | **全量快照栈**（最多 100 份） | 实现最简单、正确性最易保证；480 格 × 100 份 ≈ 数万个对象，内存可接受 |
| 布雷时机 | **延迟布雷**（ADR-07） | 首点安全无需"挪雷"后处理，且 *ready* 状态天然不泄露雷信息（REQ-F-006） |
| 计时实现 | 记录 `startedAt` 时间戳，**读取时按需计算**，而非累加计数 | 标签页后台节流不会丢秒；撤销只需不动 `startedAt` 即可满足 REQ-F-034 |
| 单元格元素 | `<button type="button" role="gridcell">` | 天然可聚焦、可点击、可被读屏识别；`role` 显式声明以符合网格语义（REQ-F-051） |
| 事件映射 | 抽成 `input.js` 纯函数（ADR-08） | 在零依赖、无 DOM 的约束下仍能自动测试输入判定 |

---

## 2. 数据模型

### 2.1 常量（`src/core/constants.js`）

```js
export const CellState = {
  HIDDEN:   'hidden',
  REVEALED: 'revealed',
  FLAGGED:  'flagged',
  QUESTION: 'question',
};

export const GameState = {
  READY:   'ready',    // 已建盘、未布雷、未计时   (REQ-F-002/006/026)
  PLAYING: 'playing',  // 已布雷、计时中
  WON:     'won',      // 终局，棋盘锁定           (REQ-F-023/025)
  LOST:    'lost',     // 终局，棋盘锁定           (REQ-F-024/025)
};

export const DIFFICULTIES = {
  beginner:     { id:'beginner',     label:'初级', width:9,  height:9,  mines:10 },
  intermediate: { id:'intermediate', label:'中级', width:16, height:16, mines:40 },
  expert:       { id:'expert',       label:'高级', width:30, height:16, mines:99 },
};
export const DIFFICULTY_ORDER = ['beginner','intermediate','expert'];

export const MAX_TIME   = 999;   // REQ-F-028
export const UNDO_LIMIT = 100;   // REQ-F-035
export const LONG_PRESS_MS = 500; // REQ-F-053

export const STORAGE_KEYS = {
  bestTimes: 'minesweeper.bestTimes.v1', // REQ-F-041
  theme:     'minesweeper.theme.v1',     // REQ-F-059
};
```

### 2.2 棋盘（`board.js`）

索引约定：`index = y * width + x`，`x ∈ [0, width)`，`y ∈ [0, height)`。

```js
/** @typedef {'hidden'|'revealed'|'flagged'|'question'} CellState */
/** @typedef {{ mine: boolean, adjacent: number, state: CellState }} Cell */
/** @typedef {{
 *    width: number, height: number, mineCount: number,
 *    minesPlaced: boolean,      // false ⇒ ready 状态，cells 中 mine 全为 false
 *    cells: Cell[]              // 长度 = width * height，行优先
 * }} Board */
```

**不变量**
1. `cells.length === width * height`
2. `minesPlaced === false` 时，所有 `cell.mine === false` 且 `cell.adjacent === 0`
3. `minesPlaced === true` 时，`cells.filter(c => c.mine).length === mineCount`
4. `adjacent` 只在布雷时一次性算好；此后任何操作都不再改变它
5. `state === 'revealed'` 的格子其 `mine` 必为 `false`（踩雷时不翻开该格，只标记终局）

### 2.3 游戏（`game.js`）

```js
class Game {
  // 只读状态
  difficulty        // DIFFICULTIES 中的条目
  board             // Board
  state             // GameState
  elapsed           // getter：秒数（见 §4.3）
  dirty             // boolean，本局是否用过撤销/提示
  canUndo           // getter：撤销栈非空且非终局
  bestTime          // 当前难度的最佳成绩或 null

  // 命令（全部无返回值，通过 hooks 通知 UI）
  constructor({ difficultyId, rng, storage, now, hooks })
  newGame(difficultyId?)   // REQ-F-002/003
  reveal(index)            // REQ-F-007~012
  toggleFlag(index)        // REQ-F-013~017
  chord(index)             // REQ-F-018~021
  undo()                   // REQ-F-032~036
  hint()                   // REQ-F-037~040
}
```

**依赖注入**（REQ-N-006）
- `rng: () => number`　默认 `Math.random`；测试注入 `mulberry32(seed)`
- `now: () => number`　默认 `Date.now`；测试注入可控时钟
- `storage`　实现 `getItem/setItem` 的适配器；测试注入内存实现，浏览器传 `window.localStorage`（或其降级包装）

**通知机制**：`hooks = { onChange(game, meta) }`，`meta = { reason }`，取值 `'new-game' | 'reveal' | 'flag' | 'chord' | 'undo' | 'hint' | 'end' | 'tick'`。UI 订阅 `onChange` 重绘。用最简单的一次性回调，不引入事件总线。

---

## 3. 核心算法

### 3.1 邻域计算

```js
function neighborIndices(board, index) -> number[]
```
按 `(x, y)` 取 `dx, dy ∈ {-1,0,1}` 且不同时为 0，剔除越界。为性能预计算 8 个偏移量。

### 3.2 布雷与首点安全（REQ-F-004/005）

```
placeMines(board, safeIndex, rng):
  1. 计算禁区 = { safeIndex } ∪ neighbors(safeIndex)          # 最多 9 格
  2. candidates = 所有不在禁区的格子索引
  3. 若 candidates.length < mineCount:
       禁区 = { safeIndex }                                    # 退化：仅首点安全
       candidates = 所有 != safeIndex 的格子
  4. 部分洗牌（Fisher-Yates 只跑前 mineCount 步）取 candidates 前 mineCount 个置雷
  5. 对每个格子计算 adjacent
  6. 返回新棋盘，minesPlaced = true
```

- **为什么用部分洗牌**：`O(mineCount)` 而非对全部格子排序，且天然均匀。
- 边界情形 `candidates.length < mineCount` 在 9×9/10 雷下不会发生（72 ≥ 10），但保留分支以防未来加入自定义难度。

### 3.3 翻开与零展开（REQ-F-007 ~ 011）

用**显式栈的迭代式 flood fill**（不用递归，避免 480 格深度风险）：

```
revealCell(board, index):
  若 cell.state ∈ {flagged}            → 不改变            # REQ-F-010
  若 cell.state === revealed           → 不改变
  若 cell.mine                         → 返回 { hitMine: true }   # REQ-F-012
  栈 = [index]; 已翻开计数 = 0
  while 栈非空:
    i = 栈.pop()
    c = cells[i]
    若 c.state === revealed 或 c.state === flagged: continue   # REQ-F-009
    c.state = revealed; 已翻开计数++
    若 c.adjacent === 0:
        对每个 n ∈ neighbors(i): 若 cells[n].state ∈ {hidden, question} 且非 revealed: 栈.push(n)
  返回 { board, revealedCount, hitMine: false }
```

注意：`question` 格会被展开翻开并清除标记（REQ-F-011）。

### 3.4 标记循环（REQ-F-013 ~ 016）

```
toggleFlag(board, index):
  revealed → 不改变                         # REQ-F-016
  hidden   → flagged
  flagged  → question
  question → hidden
```

### 3.5 和弦（REQ-F-018 ~ 020）

```
chordCell(board, index):
  若 cell.state !== revealed 或 cell.adjacent === 0 → 不改变    # REQ-F-020
  旗标数 = neighbors(index) 中 state === flagged 的数量
  若 旗标数 !== cell.adjacent → 不改变                          # REQ-F-020
  对每个 n ∈ neighbors(index)，若 cells[n].state ∈ {hidden, question}：
      执行 revealCell(board, n)（复用 §3.3，可能触发连锁展开）
  若其中任一格踩雷 → hitMine = true                             # REQ-F-019
```
实现上一次性在**同一份棋盘副本**上依次 `revealCell`，最后统一判定胜负。

### 3.6 胜负判定（REQ-F-022 ~ 024）

```
isWin(board) = cells.filter(c => c.state === revealed).length === width*height - mineCount
```
- 胜利：标记 `state = WON`，把所有 `mine && state !== flagged` 的格子置为 `flagged`（REQ-F-023）。
- 失败：标记 `state = LOST`（REQ-F-024 的视觉呈现——未标记的雷亮出、错误旗标打叉——由渲染层根据 `board` 推导，不需要额外的棋盘字段）：
  - 渲染规则：`cell.mine && cell.state !== 'flagged'` → 加 `is-mine` 类显示地雷；
  - `!cell.mine && cell.state === 'flagged'` → 加 `is-wrong` 类显示叉号。

### 3.7 提示（REQ-F-037 ~ 039）

```
hint():
  候选 = 所有 index 满足 (非雷 且 state !== revealed)
        —— ready 状态下：所有格子都是候选（此时 cells 里没有雷）
  若 候选为空 → 忽略                       # REQ-F-039
  选中 = 候选[floor(rng() * 候选.length)]
  执行 reveal(选中)                        # 若在 ready 状态则成为首点，触发 §3.2 安全布雷
  dirty = true                            # REQ-F-040
```
> 注意顺序：`reveal()` 内部会 push 撤销快照，因此撤销可以撤销掉一次提示（但它不能把 dirty 改回 false，因为 dirty 是粘性的）。

---

## 4. 状态机

### 4.1 状态转移

```
              newGame()
    ┌──────────────────────────────┐
    ▼                              │
 ┌───────┐  reveal(非雷)/hint/    ┌─────────┐
 │ READY │  chord 首次触发布雷 ──▶ │ PLAYING │
 └───────┘                        └────┬────┘
    ▲                                  │
    │ undo() 回退到未布雷的快照          ├── reveal(雷) / chord(雷) ──▶ ┌──────┐
    └──────────────────────────────────┤                              │ LOST │
                                       └── 所有非雷格已翻开 ────────▶ ┌─────┐
                                                                     │ WON │
                                                                     └─────┘
   WON / LOST ──(任何游戏操作被忽略)──▶ 保持终局，仅 newGame() 可离开
```

- `READY` 的判定条件即 `board.minesPlaced === false`（单一真相来源，避免状态字段与棋盘不一致）。
- 终局锁定（REQ-F-025）在 `Game` 的每个命令入口做守卫：`if (this.#isOver()) return;`。

### 4.2 撤销栈

```js
snapshot = { board: cloneBoard(board), state }
```
- 在 `reveal` / `toggleFlag` / `chord` / `hint` 的**效果生效前** `push`。
- `undo()`：`pop` → 恢复 `board` 与 `state`；**不触碰 `startedAt` / `elapsed` / `dirty`**（REQ-F-034、REQ-F-036）。
- 长度超过 `UNDO_LIMIT` 时 `shift()` 丢弃最旧（REQ-F-035）。
- 快照中**不包含** `dirty`，保证 dirty 只能由"使用辅助"置位、永不被撤销还原。

### 4.3 计时

```js
get elapsed() {
  if (this.#frozenAt !== null) return this.#frozenAt;       // 终局冻结  REQ-F-029
  if (this.#startedAt === null) return 0;                   // ready       REQ-F-026
  return Math.min(Math.floor((this.#now() - this.#startedAt) / 1000), MAX_TIME);
}
```
- `startedAt` 在**首次成功翻开**后设置（且只设置一次）→ 满足 REQ-F-027。用 `toggleFlag` 不会启动计时。
- 结束（WON/LOST）时执行 `#frozenAt = this.elapsed` → 满足 REQ-F-029。
- 撤销回到 `READY` 时 `startedAt` 保持不变（REQ-F-034），下一次翻开不会重置它。

UI 侧以 `setInterval(..., 250)` 轮询 `game.elapsed` 并重绘计时区（250ms 保证秒跳变足够跟手，且开销极低）。

---

## 5. 持久化设计（REQ-F-041 ~ 045）

### 5.1 Storage 适配器（`src/core/storage.js`）

```js
export function createSafeStorage(raw) // raw: Storage-like | undefined | null
```
返回一个永远不抛异常的 `{ getItem(k), setItem(k, v), removeItem(k) }`：
- `raw` 为 `null/undefined`、或 `setItem` 抛出（配额、隐私模式）→ 降级到内部 `Map` 内存实现；
- `getItem` 时先尝试 `JSON.parse`，失败则返回 `null` 并清掉损坏的键（REQ-F-045）。

### 5.2 成绩仓库

```js
createBestTimesStore(storage) -> {
  get(difficultyId): number | null
  update(difficultyId, seconds): boolean   // true 表示刷新了记录
  resetAll(): void
}
```
存储格式（单个 JSON blob）：
```json
{ "beginner": 42, "intermediate": null, "expert": null }
```
- `update` 仅在 `seconds` 为有限非负整数、且小于既有值（或既有值非数字）时写入（REQ-F-042）。
- 是否调用 `update` 完全由 `Game` 决定：`state === WON && !dirty`（REQ-F-043）。

---

## 6. UI 设计

### 6.1 DOM 结构（REQ-F-030、REQ-F-051）

```html
<div class="app">
  <header class="hud">
    <div class="hud__group">
      <select id="difficulty" aria-label="难度"></select>
      <button id="new-game" class="hud__face" aria-label="重新开始">🙂</button>
    </div>
    <div class="hud__stats" role="status" aria-live="polite">
      <span class="stat stat--mines"><span class="stat__icon">🚩</span><span id="mine-count">010</span></span>
      <span class="stat stat--time"><span class="stat__icon">⏱</span><span id="timer">000</span></span>
      <span class="stat stat--best">最佳 <span id="best-time">--</span></span>
    </div>
    <div class="hud__tools">
      <button id="undo"    aria-label="撤销 (U)">↶</button>
      <button id="hint"    aria-label="提示 (H)">💡</button>
      <button id="theme"   aria-label="切换主题">🌙</button>
      <button id="flag-mode" aria-pressed="false">🚩 旗标模式</button>
    </div>
  </header>

  <div id="board" class="board" role="grid" aria-label="扫雷棋盘">
    <!-- 每局重建：<div class="board__row" role="row"> 内是若干 <button role="gridcell"> -->
  </div>

  <p id="message" class="message" role="status" aria-live="polite"></p>
</div>
```

**单元格**：`<button type="button" class="cell" role="gridcell" data-index="123" tabindex="-1" aria-label="第 3 行第 5 列，未翻开">`
- 视觉状态通过类名驱动：`is-revealed`、`is-flagged`、`is-question`、`is-mine`、`is-wrong`、`is-cursor`，以及数字类 `n1`…`n8`。
- **不使用 emoji 作为格子内容**，内容由 CSS `::after` + `data-*` 或文本节点渲染，便于测试与主题配色。

**重建策略**：`render.js` 导出
- `mountBoard(rootEl, board)`：**仅在开新局/切换难度时**重建 DOM（480 个 button 的创建一次性完成）
- `syncBoard(cache, board, game)`：每次状态变化只更新受影响格子的 `class` 与 `aria-label`（轻量，满足 REQ-N-003）
- `syncHud(hudEls, game, flagMode)`：更新计数、计时、最佳、按钮禁用态

### 6.2 输入映射（`src/ui/input.js`，纯函数）

```js
export const Action = { REVEAL:'reveal', FLAG:'flag', CHORD:'chord', NONE:'none' };

// 鼠标：buttons 是 MouseEvent.buttons 位掩码（1=左, 2=右, 4=中）
export function resolveMouseAction({ button, buttons, cellState, flagMode })
// 键盘：作用于当前焦点格
export function resolveKeyAction({ key, cellState })
// 全局快捷键
export function resolveGlobalKey(key) // 'undo' | 'hint' | 'new-game' | null
```

判定表（§9 测试用例的来源）：

| 输入 | 格子状态 | 动作 |
| --- | --- | --- |
| 左键单击，`flagMode=false` | 任意 | `reveal` |
| 左键单击，`flagMode=true` | 非 revealed | `flag` |
| 左键单击，`flagMode=true` | revealed | `chord`（见下方说明） |
| 右键单击 | `revealed` | `none` |
| 右键单击 | 其他 | `flag` |
| `buttons & 3 === 3`（左右同按） | `revealed` | `chord` |
| 双击 | `revealed` | `chord` |
| `Enter` / `Space` | `revealed` | `chord` |
| `Enter` / `Space` | 其他 | `reveal` |
| `F` / `f` | `revealed` | `none` |
| `F` / `f` | 其他 | `flag` |

> **关于"旗标模式下单击已翻开格"**：该格无法被标记（REQ-F-016），因此映射为 `chord` 而非 `reveal`——`reveal` 在已翻开格上是空操作，等于让用户白点一次。映射为和弦同时给触屏用户提供了一条"单击即和弦"的路径，无需依赖双击或长按。

### 6.3 事件绑定（`controller.js`）

| 事件 | 处理 |
| --- | --- |
| `click`（左键） | `resolveMouseAction` → 分发；若本次 click 由长按抑制则跳过 |
| `contextmenu` | `preventDefault()`；`resolveMouseAction` → 分发（REQ-F-054） |
| `dblclick` | `chord`（REQ-F-021） |
| `pointerdown` | 记录 `pointerId`、起始坐标；触屏时启动 500ms 长按定时器 |
| `pointerup` / `pointercancel` / `pointermove`（位移 > 10px） | 取消长按定时器 |
| 长按触发 | 执行 `flag`，并设置 `suppressClickOnce = true`（REQ-F-053） |
| `keydown`（棋盘内） | 方向键移动 roving focus；`Enter/Space/F` → `resolveKeyAction` |
| `keydown`（document） | `resolveGlobalKey` → undo / hint / new-game；若焦点在 `input`/`select` 则忽略 |

**和弦手势（左右同按）**：`pointerdown` 时把 `buttons` 位掩码写入状态；当 `buttons & 3 === 3` 直接触发 `chord` 并置 `suppressClickOnce`，避免随后的 `click` 再次翻开。

### 6.4 roving tabindex（REQ-F-051）

- `controller` 持有 `cursorIndex`（默认 0）。
- 移动后：旧格 `tabindex="-1"`，新格 `tabindex="0"` 并 `focus()`；新格加 `is-cursor` 类。
- 方向键移动按 `x ± 1` / `y ± 1` 计算并做边界钳制（不环绕，REQ-F-046）。
- 开新局时 `cursorIndex` 重置为 0。

### 6.5 主题（REQ-F-057 ~ 060）

- `theme.css` 定义 CSS 变量：`:root[data-theme="light"] { --bg, --panel, --cell-hidden, --cell-revealed, --text, --n1..--n8, ... }` 与 `:root[data-theme="dark"] { ... }`。
- `theme.js`：`resolveInitialTheme(stored, prefersDark)` → `'light' | 'dark'`；`applyTheme(doc, theme)` 写 `data-theme`；点击切换按钮时写入 `localStorage[STORAGE_KEYS.theme]`（REQ-F-058/059）。
- 数字配色（`--n1`…`--n8`）在两套主题下分别指定，均需满足 4.5:1 对比度（REQ-F-060，验收项 AC-19）。

### 6.6 响应式（REQ-F-055）

棋盘尺寸由 `--cell-size` 决定，取三个上界的最小值：

```css
.board {
  --board-border: 2px;
  --cell-size: min(
    34px,
    calc((100vw  - 2rem - 2 * var(--board-border)) / var(--cols, 9)),
    calc((100dvh - 13rem) / var(--rows, 9))
  );
}
```

- `2rem` 是 `.app` 的左右内边距；**`2 * var(--board-border)` 必须一并扣除**。
  `box-sizing: border-box` 下 `max-width: 100%` 钳制的是棋盘的**边框盒**，
  漏掉这 4px 会让 `overflow: hidden` 静默裁掉最后一列的右边缘 —— 这是实现阶段真实踩到的坑。
- `100dvh - 13rem` 为状态栏与提示文案预留高度，避免纵向溢出。
- 用 `min()` 而非 `clamp()`：单元格尺寸**没有**"最小可读尺寸"的下限，因为 30 列的高级棋盘
  在 375px 手机上物理上只能放下约 11px/格。这是 REQ-F-055"不横向滚动"优先于"格子够大"的必然结果，
  取舍说明见 `04-acceptance-checklist.md` 的 AC-18。
- `body { overflow-x: hidden }` 仅作为兜底；真正保证不溢出的是上面的公式。

`tools/browser-e2e.html` 的 AC-18 除了断言 `scrollWidth <= innerWidth`，还断言
**"一行单元格总宽 == 棋盘内容宽度"** —— 因为公式偏大时 `max-width` 会把棋盘钳窄、
`overflow: hidden` 静默裁切，而 `scrollWidth` 与棋盘宽度**都不会**报警，只有这条等式能抓到。

---

## 7. 错误处理与边界

| 场景 | 处理 |
| --- | --- |
| `localStorage` 不可用 / 配额满 | `createSafeStorage` 降级为内存 Map，不抛异常（REQ-F-045） |
| `localStorage` 中 JSON 损坏 | `JSON.parse` 失败 → 返回 `null` 并清除该键 |
| 成绩值非法（负数 / NaN / 字符串） | `update` 拒绝写入；`get` 返回 `null` |
| 点击越界索引 | `Game` 命令入口做 `index` 范围校验后直接返回 |
| 终局后的一切游戏操作 | 命令入口守卫直接返回（REQ-F-025） |
| 撤销栈空 | `undo()` 直接返回；UI 上按钮为 `disabled`（REQ-F-033） |
| 无可用提示格 | `hint()` 直接返回（REQ-F-039） |
| 快速连点导致计时跳动 | 计时基于时间戳差值而非累加，天然幂等 |

---

## 8. 性能设计（REQ-N-003）

- 布雷 + 邻域计算一次性完成：`O(width*height)`，480 格约 4k 次操作，远低于 1ms。
- 展开使用显式栈，每个格子最多入栈一次。
- 快照克隆用**手工循环**构造新 cell 对象（不用 `structuredClone`，Safari 15 及更早不支持，且手工循环更快）。
- HUD 更新只在值时写入（比较旧值），避免每 250ms 触发无谓的 DOM 写入。

---

## 9. 可测试性设计（REQ-N-004、REQ-N-007、ADR-08/09）

| 模块 | 测试手段 | 覆盖的需求 |
| --- | --- | --- |
| `rng.js` | 同种子两次序列相同 | REQ-N-006 |
| `board.js` | 纯函数直接断言；用固定种子的 `rng` 使布雷可复现 | REQ-F-004~024 |
| `game.js` | 注入 `FakeClock`（可手动推进）与内存 storage | REQ-F-002~045 |
| `storage.js` | 注入会抛错的假 Storage，验证降级 | REQ-F-041~045 |
| `input.js` | 纯函数，直接构造事件特征对象断言动作 | REQ-F-046~056 |
| `ui/theme.js` | `resolveInitialTheme` / `nextTheme` 为纯函数，真值表在 `tests/render.test.js` 中断言 | REQ-F-057~059 |
| `ui/render.js` 的纯函数 | `cellClasses` / `cellContent` / `cellAriaLabel` / `phaseMessage` 在 `tests/render.test.js` 中断言（最易出错的文案与语义集中在此） | REQ-F-024、050、052 |
| `ui/render.js` / `controller.js` 的 DOM 部分 | 由 `tools/browser-e2e.html` 在真实浏览器中驱动（ADR-10）；若环境无法启动浏览器，则由 `04-acceptance-checklist.md` 人工覆盖 | REQ-F-030、046~060 |

> **关于浏览器端到端套件**：`tools/browser-e2e.html` 不修改任何生产代码 —— 它 fetch 真实
> `index.html` 的 head/body 注入自身，再动态 `import` 真实的 `src/ui/main.js`，用真实 DOM 事件黑盒驱动。
> 确定性来自**在 import 之前**接管 `Math.random` 与 `Date.now`：
> `rng.js` 在模块求值时捕获 `defaultRng = Math.random`，`game.js` 在构造时捕获 `now = Date.now`，
> 因此接管时机必须在两者之前，否则镜像重放的雷布局会静默失配。
> 套件内有一条 `SANITY` 用例专门守卫这个前提。

---

## 10. 变更记录

| 版本 | 变更 |
| --- | --- |
| v1.0 | 初版：架构、数据模型、算法、状态机、持久化、UI 与可测试性设计 |
