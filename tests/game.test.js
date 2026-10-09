/**
 * T09 ~ T12 验证：游戏状态机、计时、撤销、提示、成绩接入
 *
 * 覆盖需求：REQ-F-001 ~ 003、006、012、019、022 ~ 029、031 ~ 045、REQ-N-006
 * 用例分组与任务对应：
 *   §T09 状态机与计时器　§T10 撤销栈　§T11 提示　§T12 成绩接入
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { Game } from '../src/core/game.js';
import {
  GameState,
  CellState,
  DIFFICULTIES,
  DIFFICULTY_ORDER,
  UNDO_LIMIT,
  STORAGE_KEYS,
  resolveDifficulty,
} from '../src/core/constants.js';
import { createMemoryStorage, createSafeStorage, createBestTimesStore } from '../src/core/storage.js';
import { createEmptyBoard, placeMines, neighborIndices, countMines, cloneBoard, xyToIndex } from '../src/core/board.js';
import { mulberry32 } from '../src/core/rng.js';

const BEST_KEY = STORAGE_KEYS.bestTimes;

// ───────────────────────── 测试基础设施 ─────────────────────────

/** 可控时钟（REQ-N-006） */
function createClock(startMs = 1_700_000_000_000) {
  let current = startMs;
  return {
    now: () => current,
    advanceSeconds(s) {
      current += s * 1000;
    },
    advanceMs(ms) {
      current += ms;
    },
  };
}

/**
 * 构造一局游戏并推进到"已布雷"状态。
 *
 * 关键技巧：Game 与镜像棋盘使用**同一个种子**的独立 rng 实例，
 * Game 内部布雷消耗的随机数序列与镜像完全一致，因此镜像可以精确复原雷的位置，
 * 让"强制胜利 / 强制失败"这类测试得以确定性地进行。
 */
function setupGame({ difficultyId = 'beginner', seed = 7, safeIndex = 0, storage, clock } = {}) {
  const clk = clock ?? createClock();
  const game = new Game({ difficultyId, rng: mulberry32(seed), now: clk.now, storage });
  const diff = resolveDifficulty(difficultyId);

  game.reveal(safeIndex);

  const mirror = placeMines(createEmptyBoard(diff.width, diff.height, diff.mines), safeIndex, mulberry32(seed));
  return { game, clock: clk, layout: mirror, diff };
}

const mineIndices = (board) => board.cells.map((c, i) => (c.mine ? i : -1)).filter((i) => i >= 0);
const safeIndices = (board) => board.cells.map((c, i) => (c.mine ? -1 : i)).filter((i) => i >= 0);

/** 翻开所有非雷格 → 必定胜利（REQ-F-022） */
function forceWin(game, layout) {
  for (const i of safeIndices(layout)) game.reveal(i);
}

// ═════════════════════════════════════════════════════════════
// T09 · 状态机与计时器
// ═════════════════════════════════════════════════════════════

test('T09 新局：READY 状态、计时 0、未布雷、不可撤销（REQ-F-002、026）', () => {
  const game = new Game({ now: createClock().now });

  assert.equal(game.state, GameState.READY);
  assert.equal(game.isReady, true);
  assert.equal(game.isOver, false);
  assert.equal(game.elapsed, 0);
  assert.equal(game.dirty, false);
  assert.equal(game.canUndo, false);
  assert.equal(game.undoDepth, 0);
  assert.equal(game.board.minesPlaced, false, 'READY 状态不得布雷（ADR-07 / REQ-F-006）');
  assert.equal(countMines(game.board), 0);
});

test('T09 三档难度的棋盘尺寸与雷数符合规格（REQ-F-001）', () => {
  for (const id of DIFFICULTY_ORDER) {
    const game = new Game({ difficultyId: id, now: createClock().now });
    const diff = DIFFICULTIES[id];
    assert.equal(game.difficultyId, id);
    assert.equal(game.board.width, diff.width);
    assert.equal(game.board.height, diff.height);
    assert.equal(game.board.mineCount, diff.mines);
    assert.equal(game.remainingMines, diff.mines, '未插旗时剩余雷数 = 雷总数');
  }
});

test('T09 非法难度 id 回退到默认难度（防御性设计）', () => {
  const game = new Game({ difficultyId: 'impossible', now: createClock().now });
  assert.equal(game.difficultyId, 'beginner');
});

test('T09 首次翻开：布雷、进入 PLAYING、首点安全（REQ-F-004、007）', () => {
  const { game, layout, diff } = setupGame({ difficultyId: 'expert', seed: 99, safeIndex: 200 });

  assert.equal(game.state, GameState.PLAYING);
  assert.equal(game.board.minesPlaced, true);
  assert.equal(countMines(game.board), diff.mines);
  assert.equal(game.board.cells[200].mine, false, '首点必须是安全的');
  for (const n of neighborIndices(game.board, 200)) {
    assert.equal(game.board.cells[n].mine, false, '首点邻域必须安全');
  }
  // 镜像与真实棋盘必须完全一致，否则后续测试的前提不成立
  assert.deepEqual(mineIndices(game.board), mineIndices(layout));
});

test('T09 计时：插旗不启动计时，首次翻开才启动（REQ-F-027）', () => {
  const clock = createClock();
  const game = new Game({ now: clock.now });

  game.toggleFlag(0);
  game.toggleFlag(1);
  clock.advanceSeconds(10);
  assert.equal(game.elapsed, 0, '仅插旗不得启动计时');
  assert.equal(game.state, GameState.READY);

  game.reveal(40);
  clock.advanceSeconds(3);
  assert.equal(game.elapsed, 3, '首次翻开后开始计时');
});

test('T09 计时：秒级步进与 999 上限（REQ-F-028）', () => {
  const clock = createClock();
  const game = new Game({ now: clock.now });
  game.reveal(0);

  clock.advanceMs(999);
  assert.equal(game.elapsed, 0, '不足 1 秒不进位');
  clock.advanceMs(1);
  assert.equal(game.elapsed, 1);

  clock.advanceSeconds(1200);
  assert.equal(game.elapsed, 999, '超过 999 秒应被钳制');
});

test('T09 计时：游戏结束时冻结读数（REQ-F-029）', () => {
  const { game, clock, layout } = setupGame({ seed: 5 });
  clock.advanceSeconds(7);
  assert.equal(game.elapsed, 7);

  forceWin(game, layout);
  assert.equal(game.state, GameState.WON);

  const frozen = game.elapsed;
  clock.advanceSeconds(100);
  assert.equal(game.elapsed, frozen, '终局后计时必须冻结');
});

test('T09 失败：踩雷立即判负并冻结计时（REQ-F-012、024、029）', () => {
  const { game, clock, layout } = setupGame({ seed: 11 });
  clock.advanceSeconds(4);

  const mine = mineIndices(layout)[0];
  assert.equal(game.reveal(mine), true);
  assert.equal(game.state, GameState.LOST);
  assert.equal(game.elapsed, 4);

  clock.advanceSeconds(50);
  assert.equal(game.elapsed, 4, '失败后计时冻结');
});

test('T09 胜利：所有非雷格翻开即胜，且自动补旗（REQ-F-022、023）', () => {
  const { game, layout, diff } = setupGame({ seed: 3 });
  assert.equal(game.state, GameState.PLAYING);

  forceWin(game, layout);

  assert.equal(game.state, GameState.WON);
  assert.equal(game.remainingMines, 0, '所有雷都应被自动补旗');
  const flags = game.board.cells.filter((c) => c.state === CellState.FLAGGED).length;
  assert.equal(flags, diff.mines);
});

test('T09 终局锁定：所有游戏命令失效（REQ-F-025）', () => {
  const { game, layout } = setupGame({ seed: 13 });
  forceWin(game, layout);
  assert.equal(game.state, GameState.WON);

  const before = cloneBoard(game.board);
  const safe = safeIndices(layout)[0];
  const mine = mineIndices(layout)[0];

  assert.equal(game.reveal(safe), false);
  assert.equal(game.reveal(mine), false);
  assert.equal(game.toggleFlag(safe), false);
  assert.equal(game.toggleFlag(mine), false);
  assert.equal(game.chord(safe), false);
  assert.equal(game.undo(), false);
  assert.equal(game.hint(), false);

  assert.deepEqual(game.board, before, '终局后棋盘必须完全不动');
  assert.equal(game.state, GameState.WON);
});

test('T09 终局锁定：失败后同样锁定（REQ-F-025）', () => {
  const { game, layout } = setupGame({ seed: 17 });
  game.reveal(mineIndices(layout)[0]);
  assert.equal(game.state, GameState.LOST);

  assert.equal(game.undo(), false);
  assert.equal(game.hint(), false);
  assert.equal(game.toggleFlag(safeIndices(layout)[0]), false);
});

test('T09 和弦：命中雷判负，未命中则推进局面（REQ-F-019、021）', () => {
  const { game, layout } = setupGame({ seed: 23 });

  // 找到一个已翻开的数字格，其邻域含雷
  const numberCell = safeIndices(layout).find(
    (i) => game.board.cells[i].state === CellState.REVEALED && game.board.cells[i].adjacent > 0,
  );
  if (numberCell === undefined) return; // 该种子未产生数字格，跳过

  const mineNeighbor = neighborIndices(game.board, numberCell).find((n) => layout.cells[n].mine);
  assert.ok(mineNeighbor !== undefined, '数字格邻域内必然有雷');

  game.toggleFlag(mineNeighbor); // 正确插旗 → 旗标数 == 数字
  const before = game.board.cells[numberCell].adjacent;
  const revealedBefore = game.board.cells.filter((c) => c.state === CellState.REVEALED).length;
  game.chord(numberCell);
  const revealedAfter = game.board.cells.filter((c) => c.state === CellState.REVEALED).length;

  assert.ok(revealedAfter > revealedBefore, `和弦应至少再翻开一格（adjacent=${before}）`);
  assert.equal(game.state, GameState.PLAYING, '旗标正确时和弦不应判负');
});

test('T09 和弦：旗标数不匹配时是空操作', () => {
  const { game } = setupGame({ seed: 29 });
  const numberCell = safeIndices(game.board).find(
    (i) => game.board.cells[i].state === CellState.REVEALED && game.board.cells[i].adjacent > 0,
  );
  if (numberCell === undefined) return;

  const before = cloneBoard(game.board);
  assert.equal(game.chord(numberCell), false, '无旗标时和弦应被忽略');
  assert.deepEqual(game.board, before);
});

test('T09 和弦：READY 状态下不生效（尚未布雷）', () => {
  const game = new Game({ now: createClock().now });
  assert.equal(game.chord(0), false);
});

test('T09 newGame：切换难度后尺寸/计时/dirty/撤销栈全部重置（REQ-F-003）', () => {
  const clock = createClock();
  const { game } = setupGame({ seed: 31, clock });

  clock.advanceSeconds(12);
  game.undo();
  assert.equal(game.dirty, true);

  game.newGame('expert');

  assert.equal(game.difficultyId, 'expert');
  assert.equal(game.board.width, 30);
  assert.equal(game.board.height, 16);
  assert.equal(game.board.mineCount, 99);
  assert.equal(game.board.minesPlaced, false);
  assert.equal(game.state, GameState.READY);
  assert.equal(game.elapsed, 0, '新局计时归零');
  assert.equal(game.dirty, false, '新局 dirty 重置');
  assert.equal(game.undoDepth, 0, '新局撤销栈清空');
  assert.equal(game.canUndo, false);
});

test('T09 newGame：不传难度时沿用当前难度（REQ-F-003）', () => {
  const game = new Game({ difficultyId: 'intermediate', now: createClock().now });
  game.reveal(0);
  game.newGame();
  assert.equal(game.difficultyId, 'intermediate');
  assert.equal(game.state, GameState.READY);
});

test('T09 hooks.onChange：各类操作都会通知 UI', () => {
  const reasons = [];
  const game = new Game({ now: createClock().now, hooks: { onChange: (_g, meta) => reasons.push(meta.reason) } });

  game.toggleFlag(0);
  game.reveal(40);
  game.undo();
  game.hint();
  game.newGame();

  assert.ok(reasons.includes('flag'));
  assert.ok(reasons.includes('reveal'));
  assert.ok(reasons.includes('undo'));
  assert.ok(reasons.includes('hint'));
  assert.ok(reasons.includes('new-game'));
});

test('T09 越界索引：所有命令都安全忽略', () => {
  const { game } = setupGame({ seed: 37 });
  for (const bad of [-1, 9999, 1.5, NaN, undefined, null]) {
    assert.equal(game.reveal(bad), false, `reveal(${bad})`);
    assert.equal(game.toggleFlag(bad), false, `toggleFlag(${bad})`);
    assert.equal(game.chord(bad), false, `chord(${bad})`);
  }
});

// ═════════════════════════════════════════════════════════════
// T10 · 撤销栈
// ═════════════════════════════════════════════════════════════

test('T10 撤销：精确复原上一次操作前的棋盘与状态（REQ-F-032）', () => {
  const { game, layout } = setupGame({ seed: 41 });
  const safe = safeIndices(layout).find((i) => game.board.cells[i].state !== CellState.REVEALED);
  const before = cloneBoard(game.board);

  game.reveal(safe);
  assert.notDeepEqual(game.board, before);
  assert.equal(game.undo(), true);
  assert.deepEqual(game.board, before, '撤销后棋盘必须逐格复原');
});

test('T10 撤销：可一路退回 READY，且棋盘重新变为未布雷', () => {
  const { game } = setupGame({ seed: 43 });
  assert.equal(game.state, GameState.PLAYING);

  assert.equal(game.undo(), true);
  assert.equal(game.state, GameState.READY, '状态也要回退');
  assert.equal(game.board.minesPlaced, false, '应回到未布雷状态');
  assert.equal(countMines(game.board), 0);
  assert.equal(game.canUndo, false);
});

test('T10 撤销：连续多步操作后逐步精确回退（REQ-F-032）', () => {
  const { game, layout } = setupGame({ seed: 47 });

  // 必须动态选取**当前仍是 hidden** 的格子：首点的连锁展开可能已翻开任意格，
  // 而 REQ-F-010 / REQ-F-016 会（正确地）拒绝在已翻开格上操作。
  const pickHidden = () => safeIndices(layout).find((i) => game.board.cells[i].state === CellState.HIDDEN);
  // 邻雷数 > 0 的 hidden 格翻开时不会连锁，恰好推进一格，便于逐步比对中间态
  const pickHiddenNumber = () =>
    safeIndices(layout).find(
      (i) => game.board.cells[i].state === CellState.HIDDEN && game.board.cells[i].adjacent > 0,
    );

  const states = [cloneBoard(game.board)];
  let flagTarget = null;

  const actions = [
    () => {
      const i = pickHidden();
      assert.ok(i !== undefined, '需要至少一个 hidden 格');
      return game.toggleFlag(i);
    },
    () => {
      const i = pickHiddenNumber();
      assert.ok(i !== undefined, '需要至少一个未翻开的数字格');
      return game.reveal(i);
    },
    () => {
      flagTarget = pickHidden();
      assert.ok(flagTarget !== undefined, '需要至少一个 hidden 格');
      return game.toggleFlag(flagTarget);
    },
    () => game.toggleFlag(flagTarget), // flagged → question
  ];

  for (const act of actions) {
    assert.equal(act(), true, '操作应成功');
    assert.equal(game.isOver, false, '本用例不应意外结束对局');
    states.push(cloneBoard(game.board));
  }

  for (let step = actions.length - 1; step >= 0; step -= 1) {
    assert.equal(game.undo(), true);
    assert.deepEqual(game.board, states[step], `第 ${step} 步的中间态应被精确复原`);
  }
});

test('T10 撤销：空栈时无操作且 canUndo 为假（REQ-F-033）', () => {
  const game = new Game({ now: createClock().now });
  assert.equal(game.canUndo, false);
  assert.equal(game.undo(), false);
  assert.equal(game.canUndo, false);
  assert.equal(game.state, GameState.READY);
});

test('T10 撤销：计时器不回退也不暂停（REQ-F-034）——本项目关键验收点', () => {
  const { game, clock, layout } = setupGame({ seed: 53 });
  const safe = safeIndices(layout).find((i) => game.board.cells[i].state !== CellState.REVEALED);

  clock.advanceSeconds(5);
  assert.equal(game.elapsed, 5);

  game.reveal(safe);
  clock.advanceSeconds(3); // 现在 8 秒
  assert.equal(game.elapsed, 8);

  assert.equal(game.undo(), true);
  assert.equal(game.elapsed, 8, '撤销后计时读数不得回退');

  clock.advanceSeconds(2);
  assert.equal(game.elapsed, 10, '撤销后计时继续走，不得暂停');
});

test('T10 撤销：即便退回 READY，计时也不归零', () => {
  const { game, clock } = setupGame({ seed: 59 });
  clock.advanceSeconds(9);
  game.undo();

  assert.equal(game.state, GameState.READY);
  assert.equal(game.elapsed, 9, '退回 READY 也必须保留已用时间（REQ-F-034）');
});

test('T10 撤销：dirty 一旦置位便不可逆，新局才复位（REQ-F-036）', () => {
  const { game, layout } = setupGame({ seed: 61 });
  assert.equal(game.dirty, false);

  const safe = safeIndices(layout).find((i) => game.board.cells[i].state !== CellState.REVEALED);
  game.reveal(safe);
  assert.equal(game.undo(), true);
  assert.equal(game.dirty, true);

  game.newGame();
  assert.equal(game.dirty, false, '新局应复位 dirty');
});

test('T10 撤销栈上限：最多保留 UNDO_LIMIT 份快照（REQ-F-035）', () => {
  const game = new Game({ now: createClock().now });
  const cell = 40;
  const total = UNDO_LIMIT + 20;

  for (let i = 0; i < total; i += 1) {
    assert.equal(game.toggleFlag(cell), true, `第 ${i} 次标记应成功`);
  }
  assert.equal(game.undoDepth, UNDO_LIMIT, `栈深度应被限制在 ${UNDO_LIMIT}`);

  let popped = 0;
  while (game.undo()) popped += 1;
  assert.equal(popped, UNDO_LIMIT, '应恰好能撤销 UNDO_LIMIT 次');
  assert.equal(game.canUndo, false);
});

test('T10 撤销：未产生变化的操作不占用快照', () => {
  const { game } = setupGame({ seed: 67 });
  const depth = game.undoDepth;
  const revealed = game.board.cells.findIndex((c) => c.state === CellState.REVEALED);

  assert.equal(game.reveal(revealed), false, '重复翻开已翻开格应无效');
  assert.equal(game.toggleFlag(revealed), false, '已翻开格不可标记（REQ-F-016）');
  assert.equal(game.chord(revealed), false);
  assert.equal(game.undoDepth, depth, '无效操作不得污染撤销栈');
});

test('T10 撤销：撤回开局后再次首点，安全保证依然成立（REQ-F-004 与撤销的交互）', () => {
  const { game, clock } = setupGame({ seed: 71, safeIndex: 0 });
  game.undo();
  assert.equal(game.state, GameState.READY);

  clock.advanceSeconds(2);
  const again = 480 - 480; // 使用角落位置再次首点
  assert.equal(game.reveal(again), true);

  assert.equal(game.board.cells[again].mine, false, '撤销后的首点仍必须安全');
  for (const n of neighborIndices(game.board, again)) {
    assert.equal(game.board.cells[n].mine, false);
  }
  assert.equal(game.board.mineCount, DIFFICULTIES.beginner.mines, '雷数不受撤销影响');
});

// ═════════════════════════════════════════════════════════════
// T11 · 提示（REQ-F-037 ~ 040）
// ═════════════════════════════════════════════════════════════

test('T11 提示：总是翻开安全格且确实推进局面（REQ-F-037）', () => {
  const { game, layout } = setupGame({ seed: 73 });

  for (let round = 0; round < 5; round += 1) {
    const before = game.board.cells.filter((c) => c.state === CellState.REVEALED).length;
    if (game.isOver) break;
    const ok = game.hint();
    if (!ok) break;
    const after = game.board.cells.filter((c) => c.state === CellState.REVEALED).length;
    assert.ok(after > before, '提示必须至少翻开一格');
    assert.equal(game.state, GameState.PLAYING, '提示绝不能踩雷');
  }

  // 所有已翻开的格子都不是雷
  for (let i = 0; i < game.board.cells.length; i += 1) {
    if (game.board.cells[i].state === CellState.REVEALED) {
      assert.equal(layout.cells[i].mine, false, '已翻开的格不得是雷');
    }
  }
});

test('T11 提示：在 READY 状态使用等同于首点，且保证首点安全（REQ-F-038）', () => {
  const seed = 77;
  const diff = DIFFICULTIES.expert;
  const game = new Game({ difficultyId: 'expert', rng: mulberry32(seed), now: createClock().now });
  assert.equal(game.state, GameState.READY);

  // 镜像 rng 复原 hint 的行为：先消耗 1 个随机数选格（READY 下 480 格全部是候选），再布雷
  const mirrorRng = mulberry32(seed);
  const total = diff.width * diff.height;
  const hinted = Math.floor(mirrorRng() * total);
  const expected = placeMines(createEmptyBoard(diff.width, diff.height, diff.mines), hinted, mirrorRng);

  assert.equal(game.hint(), true);
  assert.equal(game.state, GameState.PLAYING);
  assert.equal(game.board.minesPlaced, true);
  assert.equal(countMines(game.board), diff.mines);
  assert.deepEqual(mineIndices(game.board), mineIndices(expected), '提示选中的首点格应与镜像一致');

  // REQ-F-038：只有首点格本身享有"邻域无雷"的保证。
  // 连锁展开出的边界数字格**邻域里必然有雷**，因此不能对所有已翻开格做此断言。
  assert.equal(game.board.cells[hinted].mine, false, '提示选中的格不得是雷');
  for (const n of neighborIndices(game.board, hinted)) {
    assert.equal(game.board.cells[n].mine, false, '首点邻域必须安全');
  }

  // 对全部已翻开格施加较弱的保证：它们本身都不是雷
  for (let i = 0; i < game.board.cells.length; i += 1) {
    if (game.board.cells[i].state === CellState.REVEALED) {
      assert.equal(game.board.cells[i].mine, false, '已翻开的格不得是雷');
    }
  }
});

test('T11 提示：置位 dirty（REQ-F-040）', () => {
  const { game } = setupGame({ seed: 79 });
  assert.equal(game.dirty, false);
  game.hint();
  assert.equal(game.dirty, true);
});

test('T11 提示：可被撤销（撤销后回到提示前的棋盘，但 dirty 保持）', () => {
  const { game } = setupGame({ seed: 83 });
  const before = cloneBoard(game.board);

  assert.equal(game.hint(), true);
  assert.notDeepEqual(game.board, before);

  assert.equal(game.undo(), true);
  assert.deepEqual(game.board, before, '撤销应回退掉提示的效果');
  assert.equal(game.dirty, true, 'dirty 是粘性的（REQ-F-036）');
});

test('T11 提示：没有候选格时被忽略（REQ-F-039）', () => {
  const { game, layout } = setupGame({ seed: 89 });

  // 留一个非雷格既不翻开也不插旗 → 它不是候选（已插旗），其余全部翻开
  const heldOut = safeIndices(layout).find((i) => game.board.cells[i].state !== CellState.REVEALED);
  assert.ok(heldOut !== undefined);

  assert.equal(game.toggleFlag(heldOut), true, '先把该格插旗，使其退出候选集');
  for (const i of safeIndices(layout)) {
    if (i !== heldOut) game.reveal(i);
  }

  assert.equal(game.state, GameState.PLAYING, '还有一个非雷格没翻开，因此尚未胜利');
  assert.equal(game.hint(), false, '无候选格时提示应被忽略');
});

test('T11 提示：绝不改动用户已插的旗（REQ-F-037 说明）', () => {
  const { game, layout } = setupGame({ seed: 97 });
  const nonMine = safeIndices(layout).find((i) => game.board.cells[i].state !== CellState.REVEALED);
  game.toggleFlag(nonMine);

  for (let i = 0; i < 5 && !game.isOver; i += 1) game.hint();

  assert.equal(
    game.board.cells[nonMine].state,
    CellState.FLAGGED,
    '提示不得翻开或清除用户的旗标',
  );
});

// ═════════════════════════════════════════════════════════════
// T12 · 成绩接入（REQ-F-042、043）
// ═════════════════════════════════════════════════════════════

test('T12 无记录时 bestTime 为 null（REQ-F-044）', () => {
  const game = new Game({ now: createClock().now, storage: createMemoryStorage() });
  assert.equal(game.bestTime, null);
});

test('T12 干净局胜利：写入最佳成绩（REQ-F-041、042）', () => {
  const raw = createMemoryStorage();
  const { game, clock, layout } = setupGame({ seed: 101, storage: raw });

  clock.advanceSeconds(37);
  forceWin(game, layout);

  assert.equal(game.state, GameState.WON);
  assert.equal(game.elapsed, 37);
  assert.equal(game.bestTime, 37);
  assert.equal(game.recordUpdated, true);
  assert.equal(raw.getItem(BEST_KEY), JSON.stringify({ beginner: 37 }));
});

test('T12 用过撤销的局：胜利也不写入成绩（REQ-F-043）', () => {
  const raw = createMemoryStorage();
  const { game, clock, layout } = setupGame({ seed: 103, storage: raw });

  const safe = safeIndices(layout).find((i) => game.board.cells[i].state !== CellState.REVEALED);
  game.reveal(safe);
  game.undo();
  assert.equal(game.dirty, true);

  clock.advanceSeconds(10);
  forceWin(game, layout);

  assert.equal(game.state, GameState.WON);
  assert.equal(game.recordUpdated, false);
  assert.equal(game.bestTime, null, 'dirty 局不得产生成绩');
  assert.equal(raw.getItem(BEST_KEY), null, 'dirty 局不得写入存储');
});

test('T12 用过提示的局：胜利也不写入成绩（REQ-F-043）', () => {
  const raw = createMemoryStorage();
  const { game, clock, layout } = setupGame({ seed: 107, storage: raw });

  game.hint();
  assert.equal(game.dirty, true);

  clock.advanceSeconds(10);
  forceWin(game, layout);

  assert.equal(game.state, GameState.WON);
  assert.equal(game.recordUpdated, false);
  assert.equal(game.bestTime, null);
});

test('T12 提示直接取胜时也不会误记成绩（dirty 先于结算置位）', () => {
  const raw = createMemoryStorage();
  const { game, layout } = setupGame({ seed: 109, storage: raw });

  // 先翻开除一格外的所有非雷格，最后用提示补上那一格 —— 提示可能直接结束本局
  const safeList = safeIndices(layout);
  const last = safeList[safeList.length - 1];
  for (const i of safeList) {
    if (i !== last) game.reveal(i);
  }
  if (game.isOver) return; // 极端情况下已被连锁展开取胜，跳过

  const before = game.bestTime;
  game.hint();
  if (game.state === GameState.WON) {
    assert.equal(game.recordUpdated, false, '靠提示取胜不得记入成绩');
    assert.equal(game.bestTime, before);
  }
});

test('T12 成绩只在更快时刷新（REQ-F-042）', () => {
  const raw = createMemoryStorage();

  // 第一局：37 秒
  const first = setupGame({ seed: 113, storage: raw });
  first.clock.advanceSeconds(37);
  forceWin(first.game, first.layout);
  assert.equal(first.game.bestTime, 37);

  // 第二局：更慢（90 秒）→ 不覆盖
  const slowerClock = createClock();
  const second = setupGame({ seed: 113, storage: raw, clock: slowerClock });
  slowerClock.advanceSeconds(90);
  forceWin(second.game, second.layout);
  assert.equal(second.game.recordUpdated, false);
  assert.equal(second.game.bestTime, 37, '更慢的成绩不得覆盖');

  // 第三局：更快（12 秒）→ 刷新
  const fastClock = createClock();
  const third = setupGame({ seed: 113, storage: raw, clock: fastClock });
  fastClock.advanceSeconds(12);
  forceWin(third.game, third.layout);
  assert.equal(third.game.recordUpdated, true);
  assert.equal(third.game.bestTime, 12);
  assert.equal(JSON.parse(raw.getItem(BEST_KEY)).beginner, 12);
});

test('T12 各难度成绩互相隔离（REQ-F-044）', () => {
  const raw = createMemoryStorage();
  const store = createBestTimesStore(createSafeStorage(raw));

  const game = new Game({ difficultyId: 'beginner', now: createClock().now, storage: raw });
  assert.equal(game.bestTime, null);

  store.update('expert', 250);
  game.newGame('expert');
  assert.equal(game.bestTime, 250);

  game.newGame('intermediate');
  assert.equal(game.bestTime, null, '中级尚无记录');
});

test('T12 存储不可用时游戏仍可正常进行（REQ-F-045）', () => {
  const hostile = {
    getItem() {
      throw new Error('blocked');
    },
    setItem() {
      throw new Error('blocked');
    },
    removeItem() {
      throw new Error('blocked');
    },
  };

  const clock = createClock();
  const { game, layout } = setupGame({ seed: 127, storage: hostile, clock });

  assert.equal(game.storageDegraded, true);

  clock.advanceSeconds(20);
  assert.doesNotThrow(() => forceWin(game, layout));

  assert.equal(game.state, GameState.WON);
  assert.equal(game.bestTime, 20, '降级后成绩仍应在本次会话内可见');
});
