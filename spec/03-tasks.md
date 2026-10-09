# 03 — 任务分解与执行计划

> 版本：v1.0　｜　上游：`01-requirements.md`、`02-design.md`　｜　下游：`04-acceptance-checklist.md`
>
> 任务按**依赖关系**拓扑排序编号。**每个任务只有在其全部前置任务完成后才能开始**；每个任务完成后必须执行该任务的"验证"步骤并记录结果。

---

## 1. 依赖图

```
T01 项目脚手架与静态服务器
 │
 └─▶ T02 常量 + 可注入随机源
      │
      ├─▶ T03 棋盘模型 + 布雷（首点安全）
      │    │
      │    ├─▶ T04 邻雷计数
      │    │    │
      │    │    ├─▶ T05 翻开 + 零展开
      │    │    │    │
      │    │    │    ├─▶ T07 和弦展开 ──┐
      │    │    │    │                 │
      │    │    │    └─▶ T08 胜负判定 ◀─┘
      │    │    │         │
      │    │    └─▶ T06 标记循环
      │    │              │
      │    │              └──────┐
      │    │                     │
      │    └─────────────────────┴─▶ T09 游戏状态机 + 计时
      │                              │
      │                              ├─▶ T10 撤销栈
      │                              ├─▶ T11 提示
      │                              └─▶ T12 最佳成绩持久化
      │
      └─▶ T13 输入动作解析（纯函数）
                    │
                    ▼
              T14 UI 渲染层（DOM）◀── T09
                    │
                    ├─▶ T15 控制器：鼠标/触控/键盘事件绑定
                    │    │
                    │    ├─▶ T16 无障碍语义 + roving tabindex
                    │    └─▶ T18 页面装配（index.html + 样式接入）
                    └─▶ T17 主题与响应式样式
                                        │
                                        ▼
                                  T19 自动化验证全套（质量门禁）
                                        │
                                        ▼
                                  T20 人工验收 + 文档收尾
```

**关键路径**：`T01 → T02 → T03 → T04 → T05 → T07 → T08 → T09 → T14 → T15 → T18 → T19 → T20`
（T10/T11/T12/T16/T17 可与相邻任务并行）

---

## 2. 追溯矩阵（需求 → 任务）

| 需求 | 覆盖任务 | 需求 | 覆盖任务 |
| --- | --- | --- | --- |
| REQ-F-001 | T02, T09, T14 | REQ-F-031 | T10 |
| REQ-F-002 | T09, T18 | REQ-F-032 | T10, T15 |
| REQ-F-003 | T09, T15 | REQ-F-033 | T10, T14 |
| REQ-F-004 | T03 | REQ-F-034 | T09, T10 |
| REQ-F-005 | T03 | REQ-F-035 | T10 |
| REQ-F-006 | T03, T09, T14 | REQ-F-036 | T10 |
| REQ-F-007 | T05, T14 | REQ-F-037 | T11 |
| REQ-F-008 | T04, T05 | REQ-F-038 | T09, T11 |
| REQ-F-009 | T05 | REQ-F-039 | T11 |
| REQ-F-010 | T05 | REQ-F-040 | T11 |
| REQ-F-011 | T05 | REQ-F-041 | T12 |
| REQ-F-012 | T05, T08 | REQ-F-042 | T12 |
| REQ-F-013 | T06 | REQ-F-043 | T12 |
| REQ-F-014 | T06 | REQ-F-044 | T12, T14 |
| REQ-F-015 | T06 | REQ-F-045 | T12 |
| REQ-F-016 | T06 | REQ-F-046 | T13, T16 |
| REQ-F-017 | T14 | REQ-F-047 | T13, T16 |
| REQ-F-018 | T07 | REQ-F-048 | T13, T16 |
| REQ-F-019 | T07, T08 | REQ-F-049 | T13, T15 |
| REQ-F-020 | T07 | REQ-F-050 | T14, T16 |
| REQ-F-021 | T13, T15 | REQ-F-051 | T16 |
| REQ-F-022 | T08 | REQ-F-052 | T14, T16 |
| REQ-F-023 | T08, T14 | REQ-F-053 | T15 |
| REQ-F-024 | T08, T14 | REQ-F-054 | T15 |
| REQ-F-025 | T09 | REQ-F-055 | T17 |
| REQ-F-026 | T09, T14 | REQ-F-056 | T13, T15 |
| REQ-F-027 | T09 | REQ-F-057 | T17 |
| REQ-F-028 | T09, T14 | REQ-F-058 | T17 |
| REQ-F-029 | T09 | REQ-F-059 | T17 |
| REQ-F-030 | T14, T18 | REQ-F-060 | T17 |
| REQ-N-001 | T01, T19 | REQ-N-005 | T19 |
| REQ-N-002 | T19 | REQ-N-006 | T02, T09 |
| REQ-N-003 | T14, T19 | REQ-N-007 | T03~T13 |
| REQ-N-004 | T01, T19 | | |

> 每个 `REQ-F-*` / `REQ-N-*` 均至少被一个任务覆盖；每个任务均至少关联一条需求。**无孤儿需求，无无主任务。**

---

## 3. 任务详情

每个任务的**完成定义（DoD）**统一包含：
1. 产出文件已写入且 `node --check` 通过；
2. 该任务声明的"验证"命令全部通过；
3. 该任务覆盖的需求条目在测试中有对应断言（或明确标注由人工验收覆盖）。

---

### T01　项目脚手架与静态服务器

- **依赖**：无
- **覆盖需求**：REQ-N-001、REQ-N-004
- **产出**：
  - `package.json`（`"type": "module"`，`dependencies` 为空，脚本 `test` / `serve`）
  - `tools/serve.js`（基于 `node:http` + `node:fs` 的零依赖静态服务器，含 MIME 映射、目录穿越防护、**默认端口 8123**，支持 `--port`）
  - 目录骨架 `src/core`、`src/ui`、`src/styles`、`tests`、`spec`
- **验证**：`node --check tools/serve.js`；启动服务器后 `GET /` 与 `GET /spec/00-overview.md` 返回 200。
- **DoD**：`npm ls --prod` 输出为空依赖树。

### T02　常量与可注入随机源

- **依赖**：T01
- **覆盖需求**：REQ-F-001、REQ-N-006
- **产出**：`src/core/constants.js`（§2.1 全部常量）、`src/core/rng.js`（`mulberry32(seed)`、`shufflePrefix(arr, k, rng)`）、`src/core/format.js`（`pad3(n)` 三位零填充与上限截断）
- **验证**：`node --test tests/rng.test.js` —— 同种子序列一致、不同种子不同、`shufflePrefix` 不重复且长度为 k、`pad3` 边界（0/7/42/999/1000）。
- **DoD**：`node -e "import('./src/core/rng.js').then(m=>console.log(m.mulberry32(1)()))"` 输出确定值。

### T03　棋盘模型与布雷（首点安全）

- **依赖**：T02
- **覆盖需求**：REQ-F-004、REQ-F-005、REQ-F-006
- **产出**：`src/core/board.js` 中的 `createEmptyBoard`、`neighborIndices`、`indexToXY` / `xyToIndex`、`cloneBoard`、`placeMines`
- **验证**：`node --test tests/board.test.js`（本任务部分）
  - `createEmptyBoard` 满足不变量 1、2
  - `placeMines` 后雷数精确等于 `mineCount`，满足不变量 3
  - **首位安全**：对每个难度、对**每一个可能的首点索引**、用多个种子，断言首点及其邻域无雷
  - 退化分支：构造 3×3 / 8 雷的棋盘，首点安全区不可满足，断言仅首点无雷
  - 边界与角落首点（index 0、右上、左下、右下）全部覆盖
- **DoD**：上述全绿。

### T04　邻雷计数

- **依赖**：T03
- **覆盖需求**：REQ-F-008（数据来源）
- **产出**：`board.js` 中的 `computeAdjacency`、`countAdjacentMines`、`countFlaggedNeighbors`
- **验证**：`tests/board.test.js` —— 手工构造小型固定棋盘（如 3×3 全雷除中心）断言每个格子的 `adjacent`；`countFlaggedNeighbors` 只计 `flagged` 不计 `question`。
- **DoD**：全绿。

### T05　翻开与零展开

- **依赖**：T04
- **覆盖需求**：REQ-F-007 ~ 012
- **产出**：`board.js` 中的 `revealCell`（显式栈 flood fill，返回 `{ board, revealedCount, hitMine }`）
- **验证**：`tests/board.test.js`
  - 翻开数字格只翻开 1 格；翻开 0 格触发连锁，断言展开集合与手工推导一致
  - `flagged` 格不被展开、不被翻开（REQ-F-009/010）
  - `question` 格被翻开且标记清除（REQ-F-011）
  - 翻雷返回 `hitMine: true`（REQ-F-012）
- **DoD**：全绿。

### T06　标记循环

- **依赖**：T03
- **覆盖需求**：REQ-F-013 ~ 016
- **产出**：`board.js` 中的 `toggleFlag`、`cycleState`
- **验证**：`tests/board.test.js` —— hidden→flagged→question→hidden 完整循环；对 `revealed` 格调用返回未改变（REQ-F-016）。
- **DoD**：全绿。

### T07　和弦展开

- **依赖**：T05、T06
- **覆盖需求**：REQ-F-018 ~ 020
- **产出**：`board.js` 中的 `chordCell`
- **验证**：`tests/board.test.js`
  - 旗标数 == 数字 → 其余邻域被翻开；旗标数 != 数字 → 棋盘不变
  - 错误旗标导致踩雷 → `hitMine: true`
  - 邻雷数为 0 的已翻开格调用和弦 → 不改变
- **DoD**：全绿。

### T08　胜负判定与终局揭示

- **依赖**：T05、T07
- **覆盖需求**：REQ-F-022、REQ-F-023、REQ-F-024
- **产出**：`board.js` 中的 `isWin`、`applyWinReveal`（未标记的雷补旗）、`collectLossInfo`（雷位置集合、错误旗标索引集合）
- **验证**：`tests/board.test.js` —— 构造"仅差一格即胜"的棋盘验证 `isWin` 翻转；`applyWinReveal` 后旗标数等于雷数；`collectLossInfo` 正确区分"未标记的雷"与"旗标下的非雷"。
- **DoD**：全绿。

### T09　游戏状态机与计时器

- **依赖**：T08（以及 T04/T06 提供的能力）
- **覆盖需求**：REQ-F-001~003、006、012、019、022~029、038、REQ-N-006
- **产出**：`src/core/game.js`（`Game` 类，构造注入 `rng`/`now`/`storage`/`hooks`，命令入口守卫，`elapsed` getter，`frozenAt` 冻结）
- **验证**：`tests/game.test.js`
  - 新局为 READY、计时 0、`minesPlaced=false`
  - 首点后转 PLAYING 且雷数正确、首点安全
  - `toggleFlag` 不启动计时
  - FakeClock 推进 5s → elapsed=5；推进 1200s → elapsed 截断为 999
  - 胜利/失败后 `elapsed` 冻结不变
  - 终局后 `reveal/toggleFlag/chord/undo/hint` 全部无效（REQ-F-025）
  - 切难度开新局后计时归零、dirty 重置
- **DoD**：全绿。

### T10　撤销栈

- **依赖**：T09
- **覆盖需求**：REQ-F-031 ~ 036
- **产出**：`game.js` 中的快照 push/pop、`undo()`、`canUndo`、`UNDO_LIMIT` 淘汰
- **验证**：`tests/game.test.js`
  - 翻开→撤销 → 棋盘与状态完全复原（逐格深比较）
  - 连续 3 步操作 → 连续 3 次撤销复现每一步中间态
  - 空栈 `undo()` 无副作用；`canUndo === false`
  - 推进时钟后再撤销，`elapsed` 不回退（REQ-F-034）
  - 撤销后 `dirty === true` 且再次 `newGame` 后复位（REQ-F-036）
  - 连续 120 次操作后撤销栈长度 == 100（REQ-F-035）
  - 撤回 READY 快照后，棋盘回到 `minesPlaced=false`，且再次首点仍然安全
- **DoD**：全绿。

### T11　提示

- **依赖**：T09
- **覆盖需求**：REQ-F-037 ~ 040
- **产出**：`game.js` 中的 `hint()`
- **验证**：`tests/game.test.js`
  - 提示后恰好翻开至少 1 格，且被翻开的格不是雷
  - READY 状态下提示 → 成为首点且首点安全（REQ-F-038）
  - `dirty` 被置为 true（REQ-F-040）
  - 构造"仅剩雷格未翻开"的棋盘 → `hint()` 无操作（REQ-F-039）
  - 提示可被撤销（撤销后回到提示前状态）
- **DoD**：全绿。

### T12　最佳成绩持久化

- **依赖**：T09
- **覆盖需求**：REQ-F-041 ~ 045
- **产出**：`src/core/storage.js`（`createSafeStorage`、`createBestTimesStore`）；`game.js` 中接入 `bestTime` 与"胜利且非 dirty 时更新"
- **验证**：`tests/storage.test.js` + `tests/game.test.js`
  - 内存适配器下读写往返一致
  - 抛异常的 Storage → 自动降级且不抛错（REQ-F-045）
  - 损坏 JSON → `get` 返回 null 且不抛错
  - 更快的成绩才更新、更慢的不覆盖（REQ-F-042）
  - dirty 局胜利 → 不写入（REQ-F-043）
  - 干净局胜利 → 写入且 `bestTime` 反映新值
- **DoD**：全绿。

### T13　输入动作解析（纯函数）

- **依赖**：T02
- **覆盖需求**：REQ-F-021、046 ~ 049、056
- **产出**：`src/ui/input.js`（`Action`、`resolveMouseAction`、`resolveKeyAction`、`resolveGlobalKey`，**不引用 DOM**）
- **验证**：`tests/input.test.js` —— 覆盖 `02-design.md` §6.2 判定表的**每一行**，含 `flagMode` 两种取值、`buttons` 位掩码、方向键边界、全局键大小写。
- **DoD**：全绿；`Select-String` 确认该文件不含 `document`/`window`。

### T14　UI 渲染层

- **依赖**：T09、T13
- **覆盖需求**：REQ-F-007、017、023、024、026、028、030、044、050、052
- **产出**：`src/ui/render.js`（`mountBoard`、`syncBoard`、`syncHud`、`cellAriaLabel`、`formatTime`）
- **验证**：`node --check src/ui/render.js`；`cellAriaLabel` 为纯函数，其文案规则在 `tests/input.test.js` 或独立断言中覆盖；其余由 AC-11、AC-16 人工验收。
- **DoD**：文件通过语法检查，且**不含任何游戏规则判定**（规则一律委托 `game`）。

### T15　控制器：鼠标 / 触控 / 键盘事件绑定

- **依赖**：T14
- **覆盖需求**：REQ-F-021、032、049、053、054、056
- **产出**：`src/ui/controller.js`（`attachController({ root, game, hooks })`，含长按 500ms、`suppressClickOnce`、左右同按和弦、全局快捷键）
- **验证**：`node --check`；交互行为由 AC-08、AC-12、AC-17、AC-18 人工验收。
- **DoD**：语法通过；长按、`contextmenu` 阻止、dblclick 和弦三条路径均有实现。

### T16　无障碍语义与 roving tabindex

- **依赖**：T15
- **覆盖需求**：REQ-F-046 ~ 052
- **产出**：`controller.js` 中的焦点管理（`moveCursor`）、`render.js` 中 `role`/`tabindex`/`aria-label` 的写入
- **验证**：`node --check`；AC-15、AC-16 人工验收（键盘走查 + 读屏语义检查）。
- **DoD**：任何时刻棋盘内 `tabindex="0"` 的格子数恰为 1。

### T17　主题与响应式样式

- **依赖**：T14
- **覆盖需求**：REQ-F-055、057 ~ 060
- **产出**：`src/styles/main.css`（布局、单元格、HUD、动画）、`src/styles/theme.css`（CSS 变量、深浅两套配色）、`src/ui/theme.js`（纯函数 `resolveInitialTheme(stored, prefersDark)` + `applyTheme(docEl, theme)` 接收元素参数，不在模块顶层触碰 DOM）
- **验证**：`node --check src/ui/theme.js`；`node --test tests/render.test.js`（`resolveInitialTheme` 真值表、`nextTheme` 往返、主题控制器持久化）；视觉与对比度由 AC-18、AC-19 人工验收。
- **DoD**：无横向滚动条（AC-18）；两套主题均定义 `--n1`…`--n8`。

### T18　页面装配

- **依赖**：T15、T16、T17
- **覆盖需求**：REQ-F-002、030
- **产出**：`index.html`（§6.1 DOM 结构 + `<script type="module" src="./src/ui/main.js">`）、`src/ui/main.js`（装配 `createSafeStorage(localStorage)` → `Game` → `render` → `controller` → 计时轮询）
- **验证**：`node --check src/ui/main.js`；启动服务器后用 `Invoke-WebRequest` 断言 `index.html`、`main.js`、`main.css`、`theme.css` 均返回 200 且 `Content-Type` 正确。
- **DoD**：`index.html` 中的 id 与 `render.js` 期望的 id 完全一致（逐项核对）。

### T19　自动化验证全套（质量门禁）

- **依赖**：T18
- **覆盖需求**：REQ-N-001 ~ 007
- **产出**：`tests/` 全部测试通过；`tools/verify.mjs`（一次性跑完：全文件语法检查 → 全测试 → 零依赖断言 → core 层无 DOM 引用断言 → 静态资源可达性）
- **验证**：`node tools/verify.mjs` 输出全绿报告。
- **DoD**：`npm test` 与 `node tools/verify.mjs` 均以退出码 0 结束。

### T20　人工验收与文档收尾

- **依赖**：T19
- **覆盖需求**：全部
- **产出**：`spec/04-acceptance-checklist.md` 已在 T18 前完成编写；`README.md`（运行方式、测试方式、目录说明、验收指引）；`spec/03-tasks.md` 的"执行记录"章节填入每个任务的验证结果
- **验证**：`README.md` 中的每条命令实际可执行且结果与描述一致。
- **DoD**：AC-01 ~ AC-20 全部由需求方在浏览器中确认通过。

---

## 4. 执行记录

> 全部 20 个任务已执行完毕。下表记录每个任务的实际验证命令与结果。
> 最终门禁：`node tools/verify.mjs` → **68/68 项通过**；`npm test` → **168/168 通过**。

| 任务 | 状态 | 验证命令 | 结果 |
| --- | --- | --- | --- |
| T01 项目脚手架与静态服务器 | ✅ 完成 | `node --check tools/serve.js`；`startServer` + `fetch` 冒烟 | 通过：`/`、`/spec/00-overview.md`、`/package.json`、`/tools/serve.js` 均 200；`/../../Windows/win.ini` 被拒；`npm ls --prod` 空依赖树 |
| T02 常量 + 随机源 + 格式化 | ✅ 完成 | `node --test tests/rng.test.js` | 通过：12 个用例（同种子可复现、`pickIndices` 不重复、`formatTime` 999 钳制、难度表符合规格） |
| T03 棋盘模型与布雷 | ✅ 完成 | `tests/board.test.js` §T03 | 通过：**全难度 × 全索引 × 2 种子穷举**首点及其邻域无雷；退化分支（3×3/8 雷）验证 |
| T04 邻雷计数 | ✅ 完成 | `tests/board.test.js` §T04 | 通过：手工核算每格邻雷数；问号不计入旗标数 |
| T05 翻开与零展开 | ✅ 完成 | `tests/board.test.js` §T05 | 通过：零展开集合精确匹配（5×5 展开 23 格）；旗标保护；问号清除；踩雷不改棋盘 |
| T06 标记循环 | ✅ 完成 | `tests/board.test.js` §T06 | 通过：hidden→flagged→question→hidden；已翻开格拒绝标记 |
| T07 和弦展开 | ✅ 完成 | `tests/board.test.js` §T07 | 通过：旗标数匹配才展开；错误旗标导致 `hitMine`；邻雷数 0 无反应 |
| T08 胜负判定与终局揭示 | ✅ 完成 | `tests/board.test.js` §T08 | 通过：`isWin`、`applyWinReveal` 补旗、`collectLossInfo` 区分未标记雷与错误旗标 |
| T09 状态机与计时器 | ✅ 完成 | `tests/game.test.js` §T09 | 通过：READY/PLAYING/WON/LOST 迁移；插旗不启动计时；999 钳制；终局冻结并锁定全部命令 |
| T10 撤销栈 | ✅ 完成 | `tests/game.test.js` §T10 | 通过：逐步精确复原中间态；**计时器不回退不暂停**；dirty 粘性；栈深上限 100；无效操作不污染栈 |
| T11 提示 | ✅ 完成 | `tests/game.test.js` §T11 | 通过：绝不踩雷、不改动用户旗标；READY 下等价首点且邻域安全（镜像 rng 精确对齐）；无候选时忽略 |
| T12 最佳成绩 | ✅ 完成 | `tests/storage.test.js` + `tests/game.test.js` §T12 | 通过：损坏 JSON 与敌意 Storage 均降级不抛错；仅更快时更新；dirty 局不写入；各难度隔离 |
| T13 输入动作解析 | ✅ 完成 | `tests/input.test.js` | 通过：设计文档 §6.2 判定表**逐行覆盖**；方向键边界不环绕；快捷键大小写 |
| T14 UI 渲染层 | ✅ 完成 | `node --check`；`tests/render.test.js` | 通过：类名/内容/aria-label/文案的纯函数全覆盖；DOM 部分由 AC-11、AC-16 人工覆盖 |
| T15 控制器事件绑定 | ✅ 完成 | `node --check src/ui/controller.js`；`tests/controller-pure.test.js` | 通过：长按 500ms、`suppressClickOnce`、`contextmenu` 阻止、左右同按与 dblclick 和弦均已实现；`closestCell` / `indexOfCell` 的 13 个用例覆盖事件目标解析 |
| T16 无障碍语义与 roving tabindex | ✅ 完成 | `node --check`；verify 门禁的 id 契约检查 | 通过：`role=grid/row/gridcell`、`tabindex` 唯一性由 AC-15/AC-16 人工验收 |
| T17 主题与响应式样式 | ✅ 完成 | `node --check src/ui/theme.js`；`tests/render.test.js` | 通过：初始主题真值表、切换持久化；两套主题各定义 `--n1`…`--n8` |
| T18 页面装配 | ✅ 完成 | verify 门禁第 6 项 | 通过：index.html 与全部 src 资源 HTTP 200；12 个必需元素 id 全部存在；无外部链接 |
| T19 自动化质量门禁 | ✅ 完成 | `node tools/verify.mjs` | 通过：**68/68**（语法 17 + 测试 1 + 零依赖 3 + 分层契约 20 + 离线 1 + 静态资源与样式契约 20 + 模块图解析 3 + 内联脚本 2 + 套件契约 1）；第 7 阶段"真实浏览器端到端"因环境限制跳过 |
| T20 文档收尾 | ✅ 完成 | 逐条执行 README 中的命令 | 通过：`npm run serve`、`npm test`、`npm run verify` 结果与文档描述一致 |
| T21 真实浏览器端到端套件（**可选交付物**） | ✅ 已实现并接入门禁第 7 阶段 | `node tools/verify.mjs` | 套件完整（含 `SANITY` 前提守卫），找到浏览器时自动执行、找不到时明确跳过。**本会话环境无法执行**（沙箱拒绝 Chromium 的 mojo 命名管道）。需求方已决定不依赖它 |
| T22 人工验收（AC-01 ~ AC-20） | 📋 已移交需求方 | 按 `04-acceptance-checklist.md` 逐条走查 | 由需求方自行执行；不通过的条目反馈后，回到本表定位覆盖该需求的任务修复 |

> **关于 T21 的定位**：需求方于第 4 轮明确选择"不再投入自动化，由本人按 `spec/04` 人工验收"。
> 因此 `tools/browser-e2e.html` 与门禁第 7 阶段**降级为可选交付物** —— 它已写好、
> 已接入、能找到浏览器时就能给出 AC-01 ~ AC-20 的逐项结论，但**不再是完成目标的前置条件**。
>
> 在受限沙箱中曾运行过两次该套件，但当时的脚手架存在"随机源接管时机错误"这一致命缺陷
> （见 4.1 第 8 条），其结果**不可信、已作废**。修复后的套件在本环境中无法执行，
> 因此**至今没有任何一轮可信的浏览器端到端结果**。人工验收路径不受此影响。

### 4.1 执行中发现并修复的缺陷

| # | 类型 | 问题 | 处理 |
| --- | --- | --- | --- |
| 1 | **实现缺陷** | `Game.#doReveal` 忘了把状态从 `READY` 迁移到 `PLAYING`，导致首次翻开后 `state` 仍为 `ready` | 补上状态迁移；由 `tests/game.test.js` §T09 捕获 |
| 2 | 测试缺陷 | `collectLossInfo` 的不变量算式把错误旗标也算进了"标对的旗" | 修正断言为 `未标记雷数 + 标对的旗数 = 雷总数` |
| 3 | 测试缺陷 | 把"首点邻域无雷"错误地套用到**所有**连锁展开的格子上（边界数字格邻域必然有雷） | 改用镜像 rng 精确定位首点格后再断言 |
| 4 | 门禁缺陷 | 用 `fetch` 测目录穿越，而 `fetch` 会在发出前把 `/../` 规范化掉，等于没测 | 改用 `node:http` 发送原始请求行，并断言未泄漏 ROOT 之外的文件内容 |
| 5 | **交互缺陷** | 触屏长按后 Android 会再补发一次 `contextmenu`，导致一次长按把格子标记两次（🚩 → ?） | 长按触发时同时置 `suppressContextMenu`，并在下一次 `pointerdown` 时复位；由 AC-17 人工验收 |
| 6 | 交互缺陷 | iOS 长按会弹出系统 callout 并可能选中文本 | 补 `-webkit-touch-callout: none`（`user-select: none` 已有） |
| 7 | **交互缺陷** | `suppressClick` 只在 `click` 处理中被清除。若左右键和弦（在 `pointerdown` 触发）之后那次 `click` 因指针在棋盘外松开等原因没有送达，残留标记会**吞掉用户下一次正常的左键点击** | 在 `onPointerDown` 开头一并复位 `suppressClick` 与 `suppressContextMenu`；由浏览器 E2E 的 AC-17 守卫 |
| 8 | 脚手架缺陷 | `tools/browser-e2e.html` 在 `import` 应用模块**之后**才覆盖 `Math.random`，而 `rng.js` 在模块求值时就已捕获 `defaultRng`，导致应用仍用原生随机数、镜像布局静默失配 | 把随机源/时钟接管移到所有 import 之前，并新增 `SANITY` 用例守卫该前提 |
| 9 | 脚手架缺陷 | E2E 页面只注入了 `index.html` 的 body，`<head>` 里的样式表被丢弃；且克隆的 `<link href="./src/...">` 在 `/tools/` 下解析成 `/tools/src/...` → 404 | 一并注入样式表并把 href 相对 `/index.html` 解析；AC-18/AC-19 因此才测到真实样式 |
| 10 | 脚手架缺陷 | AC-11 在**首点之前**取 `isPlainHidden` 的第一个格来插旗，而那就是索引 0；随后用 `cellAt(0)` 触发首点时该格已被插旗，按 REQ-F-010 被正确忽略，计时永远不启动 | 插旗目标改为避开索引 0，并补断言确认旗标确实插上，避免前提不成立时误判 |
| 11 | **样式缺陷** | `--cell-size` 只扣除了 `.app` 的 32px 内边距，**未扣除棋盘自身的 4px 边框**。`border-box` 下 `max-width:100%` 钳的是边框盒，于是 `overflow:hidden` 把最后一列右边缘裁掉 4px | 引入 `--board-border` 并在公式中扣除；AC-18 补上"一行单元格总宽 == 棋盘内容宽度"的断言（原来的 `boardWidth <= vw` 在该缺陷下**恒真**，测不出来） |
| 12 | **交互缺陷** | 触屏竞态：浏览器若在 500ms 长按定时器**之前**先派发 `contextmenu`，则会先标记一次（🚩），定时器到点后再标记一次（→ ?） | `onContextMenu` 中检测到 `state.longPress` 非空即说明本次是触屏手势，取消定时器并置位 `suppressClick`；两种先后顺序都已处理 |
| 13 | 门禁缺陷 | 新增的"CSS 类都有样式定义"检查用 `includes('.is-exploded')` 做子串匹配，把类名临时改成 `is-exploded-TEMP-SELFTEST` 后**依然通过** | 改为按类名边界匹配 `\.name(?![\w-])`；自检确认改坏后确实失败并报出类名（见 ADR-11） |
| 14 | 配色余量不足 | 浅色主题 `--n2: #0f7a35` 对 `--cell-revealed` 的对比度仅约 4.51:1，贴着 4.5:1 阈值 | 调整为 `#0b6b2e`（约 5.5:1），其余 7 个数字两套主题实测均 > 5:1 |
| 15 | **解析缺陷（潜在）** | `indexOfCell` 用 `Number(el.dataset.index)` 解析，而 `Number('') === 0` 且是整数 —— 一个空的 `data-index=""` 会被**静默解析成"第 0 格"** | 改为只接受 `/^\d+$/` 的十进制正整数串；当前 `mountBoard` 不会产生空值，属潜在缺陷，由 `tests/controller-pure.test.js` 守卫 |
| 16 | 门禁缺陷 | 新增的"CSS 变量可解析"检查把名字正则写成 `[a-z0-9-]+`，**对任何含大写字母的变量名完全失明**（CSS 自定义属性名大小写敏感、允许大写）。自检时用 `--cell-border-revealedX` 破坏，检查**没有失败** | 改为 `[A-Za-z0-9-]+`；复检确认能报出 `--cell-border-revealedX`。这是 ADR-11 第二次抓到"检查本身失效" |
| 17 | **产品缺陷（需求方实测暴露）** | 以 `file://` 双击打开时应用**完全空白且没有任何提示**：ES Module 被同源策略拒绝执行（origin 为 `null`），HTML/CSS 照常渲染，用户只看到空的下拉框与空棋盘，无从判断是代码坏了、路径错了还是打开方式不对 | 依据新增的 **REQ-N-008**：在 `index.html` 加一段**传统脚本**（非 module，故 `file://` 下仍能执行）做启动兜底 —— 检测到 `file://` 立即给出说明与命令；再用 1.5 秒看门狗兜住一切"模块没跑起来"的情形（脚本报错 / 资源 404 / JS 被禁用），并补 `<noscript>` |
| 18 | 门禁缺口（由第 17 条暴露） | 门禁只验证"磁盘上的文件按磁盘路径可获取"，**并未验证浏览器按相对说明符能否解析整个模块图**。一条 import 断掉就会让整页空白，而门禁全绿 | 新增"ES Module 图可从 index.html 完整解析"检查（递归解析相对说明符 + 校验 MIME），以及 `index.html` 内联脚本的语法检查（内联脚本不在 `src/` 下，第 1 阶段的 `node --check` 扫不到） |
| 19 | 可用性缺口 | `serve.js` 遇到 `EADDRINUSE` 只回一句"启动失败"，用户不知道是"服务器已经在跑"还是"端口被别人占了" | 先请求 `/` 判断是否本应用已在运行并直接给出地址；被其它程序占用时自动顺延最多 10 个端口并**明确告知**换了哪个端口。三个场景实测通过 |
| 20 | **可用性缺口（需求方提出）** | 用户期望"双击 `index.html` 即可玩"，但 ES Module 在 `file://` 下会被同源策略拒绝，页面全空 | 这是浏览器安全策略，代码无法绕过（见 ADR-12）。改为提供等价入口：`start.cmd`（Windows 双击启动服务器 + 自动开浏览器）与 `serve.js --open`；`start.cmd` 有意保持纯 ASCII，因为 cmd.exe 按 OEM 代码页解码 `.cmd` 文件，非 ASCII 会乱码 |

### 4.2 执行中的需求精化（详见 `01-requirements.md` 变更记录）

| 版本 | 精化内容 | 触发原因 |
| --- | --- | --- |
| v1.0.1 | `REQ-F-037`：提示候选排除已插旗格 | 原表述与 `REQ-F-010` 冲突，会在"用户误标旗"的局面下让提示静默失效 |
| v1.0.2 | `REQ-F-052`：计时器移出 `aria-live` 区域 | 原表述会导致读屏每秒播报一次时间 |
| — | `AC-18`：明确高级难度在窄屏必然缩小到约 11px/格 | "不横向滚动"与"格子 ≥18px"在 30 列 × 375px 下不可兼得 |

---

### 4.3 门禁自检记录（ADR-11）

门禁里的静态检查**必须被证明能失败**才允许计入。全部检查均已通过破坏性自检：

**第 1 批（逐条注入）**

| 检查 | 自检手法 | 实际结果 |
| --- | --- | --- |
| `index.html 提供全部必需元素 id` | 把 `id="timer"` 临时改成 `id="timer-TEMP-SELFTEST"` | ✅ `✘ (timer)` |
| `浏览器端到端套件引用的 N 个 id 都存在` | 把 `id="hint"` 临时改名 | ✅ `✘ (hint)`（同时正确带出 id 契约检查的失败） |
| `CSS 花括号配平` | 在 `theme.css` 末尾多加一个 `}` | ✅ `✘ ({ ×45 / } ×46)` |
| `CSS 变量全部可解析` | 把 `var(--cell-border-revealed)` 改成 `var(--cell-border-revealedX)` | ✅ 见 4.1 第 16 条：**首次自检未失败**，暴露了正则只认小写字母的盲区，修正后复检通过 |
| `深色主题定义了 --n1 ~ --n8` | 把深色块里的 `--n7` 改名 | ✅ `✘ (--n7)` |
| `ES Module 图可从 index.html 完整解析` | 把 `render.js` 里 `from '../core/format.js'` 改成 `formatX.js` | ✅ `✘ (/src/core/formatX.js → HTTP 404)` |
| `index.html 内联脚本语法正确` | 把内联脚本里的 `=== 'file:'` 改成 `=== ;` | ✅ `✘ index.html 内联脚本语法正确` |
| `render.js 写入的 N 个 CSS 类都有样式定义` | 把 `.cell.is-exploded` 临时改名 | ✅ 见 4.1 第 13 条：**首次自检该检查未失败**，暴露了子串匹配缺陷，修正后复检通过 |
| `目录穿越被拒绝` | 见 4.1 第 4 条：原用 `fetch` 测不出，改用原始请求行 | ✅ 已能真实触发 |
| `语法 node --check` | 由 `node --check` 自身保证 | ✅ |

**第 2 批（一次性注入 4 类缺陷，核对归因是否精确）**

| 注入的缺陷 | 期望失败的检查 | 实际输出 |
| --- | --- | --- |
| `package.json` 加入 `left-pad` 依赖 | 零依赖断言 | ✅ `✘ dependencies 为空 (left-pad)` |
| `src/core/format.js` 顶层加 `document.title` | 分层契约（两条） | ✅ `✘ 纯逻辑 … 无 DOM 引用（发现 "document"（第 5 行附近））` + `✘ 可被 Node 直接 import` |
| `index.html` 加入 `https://example.com/evil.css` | 离线断言 | ✅ `✘ 无外部资源引用 index.html` |
| `index.html` 的 main.css 改成 `__missing__.css` | 静态资源可达性 | ✅ `✘ 引用可达 /src/styles/__missing__.css (HTTP 404)` |

同时正确级联出 `✘ 单元测试全部通过`（format.js 抛错）。自检后工作区已全部还原，
`node tools/verify.mjs` 回到 **59/59 通过**。

> **结论**：门禁的 59 项检查中，所有"存在性 / 名字匹配 / 扫描型"检查均已证明**不是恒真**。
> 这是本项目能够声称"零依赖前提下仍有可信自动化验证"的前提条件。
>
> **仍无法自检的部分**：第 7 阶段（真实浏览器端到端）。它的失败路径需要一个可运行的浏览器，
> 而本会话的受限沙箱拒绝 Chromium 的 mojo 命名管道。因此该阶段的结论**至今为空**，
> 由 T21 状态如实标注。

## 5. 变更记录

| 版本 | 变更 |
| --- | --- |
| v1.0 | 初版：20 个任务、依赖图、追溯矩阵、逐任务验证方式与 DoD |
