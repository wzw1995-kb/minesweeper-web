/**
 * T03 ~ T08 验证：棋盘规则层
 *
 * 覆盖需求：REQ-F-004 ~ 024、REQ-N-004
 * 用例分组与任务对应：
 *   §T03 棋盘模型与布雷（首点安全）    §T04 邻雷计数
 *   §T05 翻开与零展开                  §T06 标记循环
 *   §T07 和弦展开                      §T08 胜负判定与终局揭示
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createEmptyBoard,
  cloneBoard,
  neighborIndices,
  xyToIndex,
  indexToXY,
  placeMines,
  countMines,
  countFlags,
  countRevealed,
  countAdjacentMines,
  countFlaggedNeighbors,
  remainingMines,
  revealCell,
  cycleState,
  toggleFlag,
  chordCell,
  isWin,
  applyWinReveal,
  collectLossInfo,
  boardToText,
  boardFromLayout,
} from '../src/core/board.js';
import { CellState, DIFFICULTIES, DIFFICULTY_ORDER } from '../src/core/constants.js';
import { mulberry32 } from '../src/core/rng.js';

const ALL_DIFFICULTIES = DIFFICULTY_ORDER.map((id) => DIFFICULTIES[id]);
const XY = (board, x, y) => xyToIndex(board, x, y);
const stateAt = (board, x, y) => board.cells[xyToIndex(board, x, y)].state;

/** 5×5，雷在 (0,0) 与 (4,4)：翻开中心会连锁展开全部 23 个非雷格 */
const SPARSE_5X5 = `
  *....
  .....
  .....
  .....
  ....*
`;

// ═════════════════════════════════════════════════════════════
// T03 · 棋盘模型与布雷（REQ-F-004、005、006）
// ═════════════════════════════════════════════════════════════

test('T03 createEmptyBoard：满足不变量 1 与 2，且不暴露任何雷（REQ-F-006）', () => {
  for (const diff of ALL_DIFFICULTIES) {
    const board = createEmptyBoard(diff.width, diff.height, diff.mines);
    assert.equal(board.cells.length, diff.width * diff.height);
    assert.equal(board.minesPlaced, false, 'READY 状态 minesPlaced 必须为 false');
    assert.equal(board.mineCount, diff.mines);
    assert.equal(countMines(board), 0, 'READY 状态下不得有任何雷（REQ-F-006）');
    for (const cell of board.cells) {
      assert.equal(cell.mine, false);
      assert.equal(cell.adjacent, 0);
      assert.equal(cell.state, CellState.HIDDEN);
    }
  }
});

test('T03 createEmptyBoard：非法尺寸抛出 RangeError', () => {
  assert.throws(() => createEmptyBoard(0, 9, 10), RangeError);
  assert.throws(() => createEmptyBoard(9, -1, 10), RangeError);
  assert.throws(() => createEmptyBoard(9, 9, -1), RangeError);
  assert.throws(() => createEmptyBoard(9.5, 9, 10), RangeError);
});

test('T03 neighborIndices：角、边、中心的邻域数量与内容正确', () => {
  const board = createEmptyBoard(5, 5, 0);

  assert.deepEqual(neighborIndices(board, XY(board, 0, 0)).sort((a, b) => a - b), [1, 5, 6], '左上角 3 邻域');
  assert.deepEqual(neighborIndices(board, XY(board, 4, 4)).sort((a, b) => a - b), [18, 19, 23], '右下角 3 邻域');
  assert.deepEqual(
    neighborIndices(board, XY(board, 2, 0)).sort((a, b) => a - b),
    [1, 3, 6, 7, 8],
    '上边（非角）5 邻域',
  );
  assert.deepEqual(
    neighborIndices(board, XY(board, 0, 2)).sort((a, b) => a - b),
    [5, 6, 11, 15, 16],
    '左边（非角）5 邻域',
  );
  assert.equal(neighborIndices(board, XY(board, 2, 2)).length, 8, '中心 8 邻域');
});

test('T03 indexToXY / xyToIndex：互为逆运算', () => {
  const board = createEmptyBoard(30, 16, 99);
  for (let i = 0; i < board.cells.length; i += 1) {
    const { x, y } = indexToXY(board, i);
    assert.equal(xyToIndex(board, x, y), i);
  }
});

test('T03 placeMines：雷数精确、邻雷数已算好、不修改入参', () => {
  for (const diff of ALL_DIFFICULTIES) {
    const empty = createEmptyBoard(diff.width, diff.height, diff.mines);
    const placed = placeMines(empty, 0, mulberry32(42));
    assert.equal(countMines(placed), diff.mines, `${diff.id} 雷数应精确等于 ${diff.mines}`);
    assert.equal(placed.minesPlaced, true);
    assert.equal(countMines(empty), 0, '原棋盘不得被修改（不可变约定）');
    for (const cell of placed.cells) {
      assert.ok(cell.adjacent >= 0 && cell.adjacent <= 8, `邻雷数越界：${cell.adjacent}`);
    }
  }
});

test('T03 placeMines：首点及其整个邻域必定无雷（REQ-F-004）——全索引全难度穷举', () => {
  for (const diff of ALL_DIFFICULTIES) {
    const empty = createEmptyBoard(diff.width, diff.height, diff.mines);
    for (let safe = 0; safe < empty.cells.length; safe += 1) {
      for (const seed of [1, 12345]) {
        const placed = placeMines(empty, safe, mulberry32(seed));
        assert.equal(placed.cells[safe].mine, false, `${diff.id} 首点 ${safe} 不应是雷（seed=${seed}）`);
        for (const n of neighborIndices(placed, safe)) {
          assert.equal(
            placed.cells[n].mine,
            false,
            `${diff.id} 首点 ${safe} 的邻域 ${n} 不应是雷（seed=${seed}）`,
          );
        }
        assert.equal(countMines(placed), diff.mines, '首点安全不得影响总雷数');
      }
    }
  }
});

test('T03 placeMines：四个角落与四条边作为首点同样安全（REQ-F-004）', () => {
  const diff = DIFFICULTIES.expert;
  const empty = createEmptyBoard(diff.width, diff.height, diff.mines);
  const corners = [
    XY(empty, 0, 0),
    XY(empty, diff.width - 1, 0),
    XY(empty, 0, diff.height - 1),
    XY(empty, diff.width - 1, diff.height - 1),
  ];
  const edges = [XY(empty, 0, 7), XY(empty, diff.width - 1, 8), XY(empty, 15, 0), XY(empty, 14, diff.height - 1)];

  for (const safe of [...corners, ...edges]) {
    const placed = placeMines(empty, safe, mulberry32(safe + 7));
    assert.equal(placed.cells[safe].mine, false);
    for (const n of neighborIndices(placed, safe)) {
      assert.equal(placed.cells[n].mine, false);
    }
  }
});

test('T03 placeMines：首点安全区不可满足时退化为仅首点无雷（REQ-F-005）', () => {
  // 3×3 / 8 雷：中心的安全区覆盖全部 9 格，必须退化
  const board = createEmptyBoard(3, 3, 8);
  const center = XY(board, 1, 1);
  const placed = placeMines(board, center, mulberry32(9));

  assert.equal(placed.cells[center].mine, false, '退化后首点仍必须安全');
  assert.equal(countMines(placed), 8, '退化后雷数不得减少');
  // 此时除中心外全部是雷
  for (let i = 0; i < placed.cells.length; i += 1) {
    if (i === center) continue;
    assert.equal(placed.cells[i].mine, true);
  }
});

test('T03 placeMines：同种子结果可复现（REQ-N-006）', () => {
  const board = createEmptyBoard(9, 9, 10);
  const a = placeMines(board, 40, mulberry32(2024));
  const b = placeMines(board, 40, mulberry32(2024));
  assert.deepEqual(a.cells, b.cells);
});

test('T03 cloneBoard：深拷贝，改动副本不影响原棋盘', () => {
  const board = placeMines(createEmptyBoard(9, 9, 10), 0, mulberry32(3));
  const copy = cloneBoard(board);
  assert.deepEqual(copy, board);
  copy.cells[0].state = CellState.FLAGGED;
  copy.cells[5].mine = true;
  assert.notEqual(board.cells[0].state, CellState.FLAGGED);
  assert.equal(board.cells[5].mine, copy.cells[5].mine === board.cells[5].mine || true);
  assert.notDeepEqual(copy.cells, board.cells);
});

// ═════════════════════════════════════════════════════════════
// T04 · 邻雷计数（REQ-F-008 的数据来源）
// ═════════════════════════════════════════════════════════════

test('T04 computeAdjacency：3×3 除中心外全是雷 → 中心邻雷数为 8', () => {
  const board = boardFromLayout(`
    ***
    *.*
    ***
  `);
  assert.equal(countAdjacentMines(board, XY(board, 1, 1)), 8);
  assert.equal(countMines(board), 8);
});

test('T04 computeAdjacency：手工核算每个格子的邻雷数', () => {
  const board = boardFromLayout(`
    *..
    ...
    ..*
  `);
  assert.equal(countAdjacentMines(board, XY(board, 0, 0)), 0, '雷格自身邻雷数定义为 0');
  assert.equal(countAdjacentMines(board, XY(board, 1, 0)), 1);
  assert.equal(countAdjacentMines(board, XY(board, 0, 1)), 1);
  assert.equal(countAdjacentMines(board, XY(board, 1, 1)), 2, '中心同时邻接两雷');
  assert.equal(countAdjacentMines(board, XY(board, 2, 1)), 1);
  assert.equal(countAdjacentMines(board, XY(board, 1, 2)), 1);
  assert.equal(countAdjacentMines(board, XY(board, 2, 2)), 0);
  assert.equal(countAdjacentMines(board, XY(board, 0, 2)), 0);
});

test('T04 countFlaggedNeighbors：只计旗标，不计问号', () => {
  let board = boardFromLayout(`
    ...
    ...
    ...
  `);
  const center = XY(board, 1, 1);
  assert.equal(countFlaggedNeighbors(board, center), 0);

  board = toggleFlag(board, XY(board, 0, 0)).board; // → flagged
  board = toggleFlag(board, XY(board, 1, 0)).board; // → flagged
  board = toggleFlag(board, XY(board, 2, 0)).board; // → flagged
  board = toggleFlag(board, XY(board, 2, 0)).board; // → question
  assert.equal(countFlaggedNeighbors(board, center), 2, '问号不得计入旗标数');
  assert.equal(countFlags(board), 2);
});

test('T04 remainingMines：雷总数 − 旗标数，允许为负（REQ-F-017）', () => {
  let board = boardFromLayout(`
    *..
    ...
    ...
  `);
  assert.equal(remainingMines(board), 1);
  board = toggleFlag(board, XY(board, 2, 2)).board;
  assert.equal(remainingMines(board), 0);
  board = toggleFlag(board, XY(board, 2, 1)).board;
  assert.equal(remainingMines(board), -1, '过度插旗时剩余雷数应为负');
  board = toggleFlag(board, XY(board, 1, 2)).board;
  assert.equal(remainingMines(board), -2);
});

test('T04 countRevealed / countFlags：全盘统计正确', () => {
  const board = boardFromLayout(SPARSE_5X5);
  assert.equal(countRevealed(board), 0);
  assert.equal(countFlags(board), 0);
  assert.equal(countMines(board), 2);
});

// ═════════════════════════════════════════════════════════════
// T05 · 翻开与零展开（REQ-F-007 ~ 012）
// ═════════════════════════════════════════════════════════════

test('T05 revealCell：翻开数字格只翻开 1 格（REQ-F-007）', () => {
  const board = boardFromLayout(SPARSE_5X5);
  const result = revealCell(board, XY(board, 1, 0));
  assert.equal(result.hitMine, false);
  assert.equal(result.changed, true);
  assert.equal(result.revealedCount, 1);
  assert.equal(countRevealed(result.board), 1);
  assert.equal(stateAt(result.board, 1, 0), CellState.REVEALED);
  assert.equal(countRevealed(board), 0, '原棋盘不得被修改');
});

test('T05 revealCell：邻雷数为 0 时连锁展开全部可达格（REQ-F-008）', () => {
  const board = boardFromLayout(SPARSE_5X5);
  const result = revealCell(board, XY(board, 2, 2));
  assert.equal(result.hitMine, false);
  assert.equal(result.revealedCount, 23, '5×5 共 25 格减 2 雷 = 23 格应全部展开');
  assert.equal(countRevealed(result.board), 23);
  assert.equal(remainingMines(result.board), 2);
  // 雷格本身绝不被翻开
  assert.equal(stateAt(result.board, 0, 0), CellState.HIDDEN);
  assert.equal(stateAt(result.board, 4, 4), CellState.HIDDEN);
});

test('T05 revealCell：展开过程不翻开 flagged 格（REQ-F-009）', () => {
  let board = boardFromLayout(SPARSE_5X5);
  board = toggleFlag(board, XY(board, 1, 1)).board; // 数字格，处于展开路径上
  const result = revealCell(board, XY(board, 2, 2));

  assert.equal(stateAt(result.board, 1, 1), CellState.FLAGGED, '旗标格必须保持原样');
  assert.equal(result.revealedCount, 22, '被旗标挡住的 1 格不应被翻开');
});

test('T05 revealCell：展开也不会翻开雷格上的旗标', () => {
  let board = boardFromLayout(SPARSE_5X5);
  board = toggleFlag(board, XY(board, 0, 0)).board; // 在雷上插旗
  const result = revealCell(board, XY(board, 2, 2));
  assert.equal(stateAt(result.board, 0, 0), CellState.FLAGGED);
  assert.equal(countRevealed(result.board), 23);
});

test('T05 revealCell：点击 flagged 格被忽略（REQ-F-010）', () => {
  let board = boardFromLayout(SPARSE_5X5);
  board = toggleFlag(board, XY(board, 2, 2)).board;
  const result = revealCell(board, XY(board, 2, 2));
  assert.equal(result.changed, false);
  assert.equal(result.hitMine, false);
  assert.equal(result.board, board, '应原样返回同一棋盘对象');
  assert.equal(stateAt(result.board, 2, 2), CellState.FLAGGED);
});

test('T05 revealCell：问号格被正常翻开且标记清除（REQ-F-011）', () => {
  let board = boardFromLayout(SPARSE_5X5);
  const target = XY(board, 1, 0); // 数字格
  board = toggleFlag(board, target).board; // → flagged
  board = toggleFlag(board, target).board; // → question
  assert.equal(board.cells[target].state, CellState.QUESTION);

  const result = revealCell(board, target);
  assert.equal(result.changed, true);
  assert.equal(result.revealedCount, 1);
  assert.equal(result.board.cells[target].state, CellState.REVEALED, '问号标记应被清除');
});

test('T05 revealCell：踩雷返回 hitMine 且棋盘不变（REQ-F-012）', () => {
  const board = boardFromLayout(SPARSE_5X5);
  const result = revealCell(board, XY(board, 0, 0));
  assert.equal(result.hitMine, true);
  assert.equal(result.changed, false);
  assert.equal(result.revealedCount, 0);
  assert.equal(result.board, board, '踩雷不得改变棋盘');
});

test('T05 revealCell：重复翻开同一格无副作用，越界索引被忽略', () => {
  const board = boardFromLayout(SPARSE_5X5);
  const once = revealCell(board, XY(board, 1, 0)).board;
  const twice = revealCell(once, XY(board, 1, 0));
  assert.equal(twice.changed, false);
  assert.equal(twice.board, once);

  for (const bad of [-1, 999, 1.5, NaN, undefined]) {
    const r = revealCell(board, bad);
    assert.equal(r.changed, false, `越界索引 ${bad} 应被忽略`);
    assert.equal(r.board, board);
  }
});

test('T05 revealCell：对未布雷的 READY 棋盘不做整盘展开（防御性守卫）', () => {
  const empty = createEmptyBoard(9, 9, 10);
  const result = revealCell(empty, 0);
  assert.equal(result.changed, false);
  assert.equal(result.board, empty);
});

// ═════════════════════════════════════════════════════════════
// T06 · 标记循环（REQ-F-013 ~ 016）
// ═════════════════════════════════════════════════════════════

test('T06 cycleState：hidden → flagged → question → hidden', () => {
  assert.equal(cycleState(CellState.HIDDEN), CellState.FLAGGED);
  assert.equal(cycleState(CellState.FLAGGED), CellState.QUESTION);
  assert.equal(cycleState(CellState.QUESTION), CellState.HIDDEN);
  assert.equal(cycleState(CellState.REVEALED), CellState.REVEALED);
});

test('T06 toggleFlag：在真实棋盘上走完整循环（REQ-F-013 ~ 015）', () => {
  const board = boardFromLayout(SPARSE_5X5);
  const target = XY(board, 3, 3);

  const s1 = toggleFlag(board, target);
  assert.equal(s1.changed, true);
  assert.equal(s1.board.cells[target].state, CellState.FLAGGED);

  const s2 = toggleFlag(s1.board, target);
  assert.equal(s2.board.cells[target].state, CellState.QUESTION);

  const s3 = toggleFlag(s2.board, target);
  assert.equal(s3.board.cells[target].state, CellState.HIDDEN);

  assert.equal(board.cells[target].state, CellState.HIDDEN, '原棋盘不得被修改');
});

test('T06 toggleFlag：已翻开的格子拒绝标记（REQ-F-016）', () => {
  const board = boardFromLayout(SPARSE_5X5);
  const revealed = revealCell(board, XY(board, 1, 0)).board;
  const result = toggleFlag(revealed, XY(board, 1, 0));
  assert.equal(result.changed, false);
  assert.equal(result.board, revealed);
  assert.equal(result.board.cells[XY(board, 1, 0)].state, CellState.REVEALED);
});

test('T06 toggleFlag：越界索引被忽略', () => {
  const board = boardFromLayout(SPARSE_5X5);
  for (const bad of [-1, 25, 100, NaN]) {
    const r = toggleFlag(board, bad);
    assert.equal(r.changed, false);
    assert.equal(r.board, board);
  }
});

// ═════════════════════════════════════════════════════════════
// T07 · 和弦展开（REQ-F-018 ~ 020）
// ═════════════════════════════════════════════════════════════

test('T07 chordCell：旗标数等于数字时翻开其余邻域（REQ-F-018）', () => {
  let b = boardFromLayout(`
    *..
    ...
    ...
  `);
  b = revealCell(b, XY(b, 1, 0)).board; // 邻雷数 1，只翻开自己
  assert.equal(countRevealed(b), 1);

  b = toggleFlag(b, XY(b, 0, 0)).board; // 旗标数 1 == 数字 1
  assert.equal(countFlaggedNeighbors(b, XY(b, 1, 0)), 1);

  const result = chordCell(b, XY(b, 1, 0));
  assert.equal(result.hitMine, false);
  assert.equal(result.changed, true);
  // (1,0) 的邻域中未插旗的格子全部被翻开
  assert.equal(stateAt(result.board, 2, 0), CellState.REVEALED);
  assert.equal(stateAt(result.board, 0, 1), CellState.REVEALED);
  assert.equal(stateAt(result.board, 1, 1), CellState.REVEALED);
  assert.equal(stateAt(result.board, 2, 1), CellState.REVEALED);
  assert.equal(stateAt(result.board, 0, 0), CellState.FLAGGED, '旗标格保持不动');
});

test('T07 chordCell：旗标数不等于数字时不做任何事（REQ-F-020）', () => {
  let board = boardFromLayout(`
    *..
    ...
    ...
  `);
  board = revealCell(board, XY(board, 1, 0)).board;
  const before = cloneBoard(board);

  const noFlag = chordCell(board, XY(board, 1, 0));
  assert.equal(noFlag.changed, false);
  assert.deepEqual(noFlag.board, before, '旗标数 0 ≠ 数字 1，棋盘必须完全不变');

  // 用问号（不计入旗标数）再试一次
  let withQuestion = toggleFlag(board, XY(board, 0, 0)).board; // flagged
  withQuestion = toggleFlag(withQuestion, XY(withQuestion, 0, 0)).board; // question
  const q = chordCell(withQuestion, XY(withQuestion, 1, 0));
  assert.equal(q.changed, false, '问号不计入旗标数，不应触发和弦');
});

test('T07 chordCell：错误旗标导致踩雷时返回 hitMine（REQ-F-019）', () => {
  let board = boardFromLayout(`
    *..
    ...
    ...
  `);
  board = revealCell(board, XY(board, 1, 1)).board; // (1,1) 邻雷数 1
  board = toggleFlag(board, XY(board, 2, 2)).board; // 在非雷格上插旗（错误旗标）
  assert.equal(countFlaggedNeighbors(board, XY(board, 1, 1)), 1);

  const result = chordCell(board, XY(board, 1, 1));
  assert.equal(result.hitMine, true, '和弦应翻开真实的地雷');
});

test('T07 chordCell：对邻雷数为 0 的已翻开格无反应', () => {
  let board = boardFromLayout(SPARSE_5X5);
  board = revealCell(board, XY(board, 2, 2)).board; // 整盘展开
  const zeroCell = XY(board, 3, 2);
  assert.equal(board.cells[zeroCell].adjacent, 0);

  const result = chordCell(board, zeroCell);
  assert.equal(result.changed, false);
  assert.equal(result.hitMine, false);
});

test('T07 chordCell：对未翻开的格子无反应', () => {
  const board = boardFromLayout(SPARSE_5X5);
  const result = chordCell(board, XY(board, 1, 0));
  assert.equal(result.changed, false);
  assert.equal(result.hitMine, false);
  assert.equal(result.board, board);
});

test('T07 chordCell：越界索引被忽略', () => {
  const board = boardFromLayout(SPARSE_5X5);
  for (const bad of [-1, 25, NaN]) {
    assert.equal(chordCell(board, bad).changed, false);
  }
});

// ═════════════════════════════════════════════════════════════
// T08 · 胜负判定与终局揭示（REQ-F-022 ~ 024）
// ═════════════════════════════════════════════════════════════

test('T08 isWin：翻开所有非雷格即胜利（REQ-F-022）', () => {
  const board = boardFromLayout(SPARSE_5X5);
  assert.equal(isWin(board), false);

  const partial = revealCell(board, XY(board, 1, 0)).board;
  assert.equal(isWin(partial), false, '只翻开 1 格不算胜利');

  const won = revealCell(board, XY(board, 2, 2)).board;
  assert.equal(countRevealed(won), 23);
  assert.equal(isWin(won), true, '23 个非雷格全部翻开即胜利');
});

test('T08 isWin：旗标正确与否不影响胜利判定', () => {
  let board = boardFromLayout(SPARSE_5X5);
  board = revealCell(board, XY(board, 2, 2)).board; // 已全翻开
  board = toggleFlag(board, XY(board, 0, 0)).board;
  board = toggleFlag(board, XY(board, 0, 0)).board;
  assert.equal(isWin(board), true);
});

test('T08 isWin：READY 棋盘（未布雷）不算胜利', () => {
  assert.equal(isWin(createEmptyBoard(9, 9, 10)), false);
});

test('T08 applyWinReveal：给所有未插旗的雷补旗（REQ-F-023）', () => {
  let board = boardFromLayout(SPARSE_5X5);
  board = revealCell(board, XY(board, 2, 2)).board;
  board = toggleFlag(board, XY(board, 0, 0)).board; // 手动标了 1 个雷
  assert.equal(countFlags(board), 1);

  const swept = applyWinReveal(board);
  assert.equal(countFlags(swept), 2, '两个雷都应显示为旗标');
  assert.equal(remainingMines(swept), 0);
  assert.equal(stateAt(swept, 4, 4), CellState.FLAGGED);
  assert.equal(countFlags(board), 1, '原棋盘不得被修改');
});

test('T08 applyWinReveal：问号标记的雷也会被补成旗标', () => {
  let board = boardFromLayout(SPARSE_5X5);
  board = revealCell(board, XY(board, 2, 2)).board;
  board = toggleFlag(board, XY(board, 0, 0)).board; // flagged
  board = toggleFlag(board, XY(board, 0, 0)).board; // question
  const swept = applyWinReveal(board);
  assert.equal(stateAt(swept, 0, 0), CellState.FLAGGED);
  assert.equal(countFlags(swept), 2);
});

test('T08 collectLossInfo：区分"未标记的雷"与"错误旗标"（REQ-F-024）', () => {
  let board = boardFromLayout(`
    *..
    ...
    ..*
  `);
  board = toggleFlag(board, XY(board, 0, 0)).board; // 正确的旗
  board = toggleFlag(board, XY(board, 2, 0)).board; // 错误的旗（非雷格）

  const info = collectLossInfo(board);
  assert.deepEqual(info.mines, [XY(board, 2, 2)], '只应列出尚未插旗的雷');
  assert.deepEqual(info.wrongFlags, [XY(board, 2, 0)], '只应列出位于非雷格上的旗');

  // 不变量：未标记的雷 + 标对的旗 = 雷总数
  const flagsOnMines = countFlags(board) - info.wrongFlags.length;
  assert.equal(info.mines.length + flagsOnMines, countMines(board));
});

test('T08 collectLossInfo：全部雷都已插旗时列表为空', () => {
  let board = boardFromLayout(`
    *..
    ...
    ..*
  `);
  board = toggleFlag(board, XY(board, 0, 0)).board;
  board = toggleFlag(board, XY(board, 2, 2)).board;
  const info = collectLossInfo(board);
  assert.deepEqual(info.mines, []);
  assert.deepEqual(info.wrongFlags, []);
});

// ═════════════════════════════════════════════════════════════
// 辅助：boardToText / boardFromLayout 自身正确性
// ═════════════════════════════════════════════════════════════

test('辅助：boardFromLayout 与 boardToText 往返一致', () => {
  const board = boardFromLayout(`
    *..
    ...
    ..*
  `);
  assert.equal(board.width, 3);
  assert.equal(board.height, 3);
  assert.equal(board.mineCount, 2);
  assert.equal(boardToText(board), '...\n...\n...');

  const revealed = revealCell(board, XY(board, 1, 1)).board;
  assert.equal(boardToText(revealed), '...\n.2.\n...');
});
