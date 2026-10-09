/**
 * 棋盘规则层（T03 ~ T08）—— 纯函数，零 DOM 依赖
 *
 * 覆盖需求：REQ-F-004 ~ 024、REQ-N-004
 *
 * 设计约定（见 spec/02-design.md §2.2）：
 *   - 索引：index = y * width + x，行优先
 *   - 所有导出函数都**返回新棋盘对象**，绝不就地修改入参
 *   - 非法入参（越界索引）一律返回"未改变"的结果，不抛异常
 *
 * @typedef {'hidden'|'revealed'|'flagged'|'question'} CellStateName
 * @typedef {{ mine: boolean, adjacent: number, state: CellStateName }} Cell
 * @typedef {{
 *   width: number, height: number, mineCount: number,
 *   minesPlaced: boolean, cells: Cell[]
 * }} Board
 * @typedef {{ board: Board, changed: boolean }} BoardResult
 * @typedef {{ board: Board, changed: boolean, hitMine: boolean, revealedCount: number, hitIndex: number|null }} RevealResult
 */
import { CellState } from './constants.js';
import { pickIndices } from './rng.js';

/** 8 邻域偏移（含斜向） */
const NEIGHBOR_DX = Object.freeze([-1, 0, 1, -1, 1, -1, 0, 1]);
const NEIGHBOR_DY = Object.freeze([-1, -1, -1, 0, 0, 1, 1, 1]);

// ─────────────────────────────────────────────────────────────
// T03 · 棋盘模型与布雷
// ─────────────────────────────────────────────────────────────

/**
 * 创建一张未布雷的空白棋盘（对应 READY 状态）。
 * 不变量：cells.length === width*height，且所有 mine=false、adjacent=0、state=hidden。
 * @param {number} width
 * @param {number} height
 * @param {number} mineCount
 * @returns {Board}
 */
export function createEmptyBoard(width, height, mineCount) {
  if (!Number.isInteger(width) || width <= 0) throw new RangeError(`width 非法：${width}`);
  if (!Number.isInteger(height) || height <= 0) throw new RangeError(`height 非法：${height}`);
  if (!Number.isInteger(mineCount) || mineCount < 0) throw new RangeError(`mineCount 非法：${mineCount}`);

  const total = width * height;
  const cells = new Array(total);
  for (let i = 0; i < total; i += 1) {
    cells[i] = { mine: false, adjacent: 0, state: CellState.HIDDEN };
  }
  return { width, height, mineCount, minesPlaced: false, cells };
}

/** 索引是否在当前棋盘范围内 */
export function isValidIndex(board, index) {
  return Number.isInteger(index) && index >= 0 && index < board.cells.length;
}

/** 索引 → 坐标 */
export function indexToXY(board, index) {
  const x = index % board.width;
  const y = (index - x) / board.width;
  return { x, y };
}

/** 坐标 → 索引 */
export function xyToIndex(board, x, y) {
  return y * board.width + x;
}

/**
 * 深拷贝棋盘（撤销快照与不可变更新共用）。
 * 手工循环构造新对象，不用 structuredClone（兼容性与性能，见 02-design §8）。
 * @param {Board} board
 * @returns {Board}
 */
export function cloneBoard(board) {
  const cells = new Array(board.cells.length);
  for (let i = 0; i < board.cells.length; i += 1) {
    const c = board.cells[i];
    cells[i] = { mine: c.mine, adjacent: c.adjacent, state: c.state };
  }
  return {
    width: board.width,
    height: board.height,
    mineCount: board.mineCount,
    minesPlaced: board.minesPlaced,
    cells,
  };
}

/**
 * 返回某格 8 邻域的索引数组（越界方向自动剔除）。
 * @param {Board} board
 * @param {number} index
 * @returns {number[]}
 */
export function neighborIndices(board, index) {
  const { width, height } = board;
  const x = index % width;
  const y = (index - x) / width;
  const out = [];
  for (let k = 0; k < 8; k += 1) {
    const nx = x + NEIGHBOR_DX[k];
    const ny = y + NEIGHBOR_DY[k];
    if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
    out.push(ny * width + nx);
  }
  return out;
}

/**
 * 就地计算全盘邻雷数。仅供 placeMines 内部与测试使用。
 * @param {Board} board 会被修改
 * @returns {Board} 同一个对象
 */
export function computeAdjacency(board) {
  const { width, height, cells } = board;
  const total = width * height;
  for (let i = 0; i < total; i += 1) {
    if (cells[i].mine) {
      cells[i].adjacent = 0;
      continue;
    }
    const x = i % width;
    const y = (i - x) / width;
    let count = 0;
    for (let k = 0; k < 8; k += 1) {
      const nx = x + NEIGHBOR_DX[k];
      const ny = y + NEIGHBOR_DY[k];
      if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
      if (cells[ny * width + nx].mine) count += 1;
    }
    cells[i].adjacent = count;
  }
  return board;
}

/**
 * 布雷，并保证首点安全（REQ-F-004 / REQ-F-005 / ADR-07 延迟布雷）。
 *
 * 1. 禁区 = { safeIndex } ∪ neighbors(safeIndex)
 * 2. 从禁区外的格子中不重复地随机取 mineCount 个置雷
 * 3. 若禁区外空间不足（退化情形），则仅保证 safeIndex 本身无雷
 *
 * @param {Board} board 通常来自 createEmptyBoard
 * @param {number} safeIndex 首点索引
 * @param {() => number} rng 随机源
 * @returns {Board} 新的已布雷棋盘
 */
export function placeMines(board, safeIndex, rng) {
  const next = cloneBoard(board);

  let forbidden;
  if (isValidIndex(board, safeIndex)) {
    forbidden = new Set([safeIndex, ...neighborIndices(board, safeIndex)]);
  } else {
    forbidden = new Set();
  }

  let pool = [];
  for (let i = 0; i < next.cells.length; i += 1) {
    if (!forbidden.has(i)) pool.push(i);
  }

  // REQ-F-005：首点安全区不可满足时退化为"仅首点无雷"
  if (pool.length < next.mineCount && isValidIndex(board, safeIndex)) {
    pool = [];
    for (let i = 0; i < next.cells.length; i += 1) {
      if (i !== safeIndex) pool.push(i);
    }
  }

  for (const i of pickIndices(pool, next.mineCount, rng)) {
    next.cells[i].mine = true;
  }

  next.minesPlaced = true;
  computeAdjacency(next);
  return next;
}

// ─────────────────────────────────────────────────────────────
// T04 · 邻雷计数
// ─────────────────────────────────────────────────────────────

/**
 * 某格的邻雷数。
 * @param {Board} board
 * @param {number} index
 * @returns {number}
 */
export function countAdjacentMines(board, index) {
  return isValidIndex(board, index) ? board.cells[index].adjacent : 0;
}

/**
 * 某格邻域中**已插旗**的格子数量（问号不计入）。和弦判定依赖此函数。
 * @param {Board} board
 * @param {number} index
 * @returns {number}
 */
export function countFlaggedNeighbors(board, index) {
  if (!isValidIndex(board, index)) return 0;
  let count = 0;
  for (const n of neighborIndices(board, index)) {
    if (board.cells[n].state === CellState.FLAGGED) count += 1;
  }
  return count;
}

/** 全盘旗标数量 */
export function countFlags(board) {
  let count = 0;
  for (const c of board.cells) if (c.state === CellState.FLAGGED) count += 1;
  return count;
}

/** 全盘已翻开数量 */
export function countRevealed(board) {
  let count = 0;
  for (const c of board.cells) if (c.state === CellState.REVEALED) count += 1;
  return count;
}

/** 全盘雷数量 */
export function countMines(board) {
  let count = 0;
  for (const c of board.cells) if (c.mine) count += 1;
  return count;
}

/**
 * 剩余雷数 = 雷总数 − 旗标数，允许为负（REQ-F-017）。
 * @param {Board} board
 * @returns {number}
 */
export function remainingMines(board) {
  return board.mineCount - countFlags(board);
}

// ─────────────────────────────────────────────────────────────
// T05 · 翻开与零展开
// ─────────────────────────────────────────────────────────────

const noopReveal = (board) => ({ board, changed: false, hitMine: false, revealedCount: 0, hitIndex: null });

/**
 * 翻开一格；若邻雷数为 0 则用显式栈做连锁展开。
 *
 * - flagged 格 → 忽略（REQ-F-010）
 * - 已翻开格 → 忽略
 * - 雷格 → hitMine: true，棋盘不变，由 Game 负责判负（REQ-F-012）
 * - question 格 → 翻开并清除标记（REQ-F-011）
 * - 展开过程不翻开 flagged 格（REQ-F-009）
 *
 * @param {Board} board
 * @param {number} index
 * @returns {RevealResult}
 */
export function revealCell(board, index) {
  if (!isValidIndex(board, index)) return noopReveal(board);
  // 防御：未布雷的棋盘上翻开会产生"整盘展开"的错误结果，必须由 placeMines 先行处理
  if (!board.minesPlaced) return noopReveal(board);

  const target = board.cells[index];
  if (target.state === CellState.REVEALED) return noopReveal(board);
  if (target.state === CellState.FLAGGED) return noopReveal(board);
  if (target.mine) return { board, changed: false, hitMine: true, revealedCount: 0, hitIndex: index };

  const next = cloneBoard(board);
  const stack = [index];
  let revealedCount = 0;

  while (stack.length > 0) {
    const i = stack.pop();
    const cell = next.cells[i];
    if (cell.state === CellState.REVEALED || cell.state === CellState.FLAGGED) continue;
    if (cell.mine) continue;
    cell.state = CellState.REVEALED;
    revealedCount += 1;
    if (cell.adjacent === 0) {
      for (const n of neighborIndices(next, i)) {
        const s = next.cells[n].state;
        if (s === CellState.HIDDEN || s === CellState.QUESTION) stack.push(n);
      }
    }
  }

  return { board: next, changed: revealedCount > 0, hitMine: false, revealedCount, hitIndex: null };
}

// ─────────────────────────────────────────────────────────────
// T06 · 标记循环
// ─────────────────────────────────────────────────────────────

/**
 * 标记状态机的单步转移（REQ-F-013 ~ 015）：
 * hidden → flagged → question → hidden；revealed 保持不变（REQ-F-016）。
 * @param {CellStateName} state
 * @returns {CellStateName}
 */
export function cycleState(state) {
  if (state === CellState.HIDDEN) return CellState.FLAGGED;
  if (state === CellState.FLAGGED) return CellState.QUESTION;
  if (state === CellState.QUESTION) return CellState.HIDDEN;
  return CellState.REVEALED;
}

/**
 * 对某格执行一次标记循环。
 * @param {Board} board
 * @param {number} index
 * @returns {BoardResult}
 */
export function toggleFlag(board, index) {
  if (!isValidIndex(board, index)) return { board, changed: false };
  const cell = board.cells[index];
  if (cell.state === CellState.REVEALED) return { board, changed: false };

  const next = cloneBoard(board);
  next.cells[index].state = cycleState(cell.state);
  return { board: next, changed: true };
}

// ─────────────────────────────────────────────────────────────
// T07 · 和弦展开
// ─────────────────────────────────────────────────────────────

/**
 * 和弦：对已翻开的数字格，若邻域旗标数等于该数字，则翻开其余未插旗邻域（REQ-F-018 ~ 020）。
 *
 * 命中雷时保留本次已成功翻开的格子，并返回 hitMine: true 交由 Game 判负（REQ-F-019）。
 *
 * @param {Board} board
 * @param {number} index
 * @returns {RevealResult}
 */
export function chordCell(board, index) {
  if (!isValidIndex(board, index)) return noopReveal(board);

  const cell = board.cells[index];
  if (cell.state !== CellState.REVEALED) return noopReveal(board);
  if (cell.adjacent === 0) return noopReveal(board);
  if (countFlaggedNeighbors(board, index) !== cell.adjacent) return noopReveal(board);

  let current = board;
  let changed = false;
  let revealedCount = 0;

  for (const n of neighborIndices(board, index)) {
    const s = current.cells[n].state;
    if (s !== CellState.HIDDEN && s !== CellState.QUESTION) continue;

    const result = revealCell(current, n);
    current = result.board;
    revealedCount += result.revealedCount;
    changed = changed || result.changed;

    if (result.hitMine) {
      return { board: current, changed, hitMine: true, revealedCount, hitIndex: result.hitIndex };
    }
  }

  return { board: current, changed, hitMine: false, revealedCount, hitIndex: null };
}

// ─────────────────────────────────────────────────────────────
// T08 · 胜负判定与终局揭示
// ─────────────────────────────────────────────────────────────

/**
 * 是否胜利：所有非雷格均已翻开（REQ-F-022）。旗标不必正确。
 * @param {Board} board
 * @returns {boolean}
 */
export function isWin(board) {
  if (!board.minesPlaced) return false;
  const total = board.width * board.height;
  return countRevealed(board) === total - board.mineCount;
}

/**
 * 胜利结算：把所有尚未插旗的雷格补上旗标（REQ-F-023）。
 * @param {Board} board
 * @returns {Board}
 */
export function applyWinReveal(board) {
  const next = cloneBoard(board);
  for (const cell of next.cells) {
    if (cell.mine && cell.state !== CellState.FLAGGED) cell.state = CellState.FLAGGED;
  }
  return next;
}

/**
 * 失败结算所需的展示信息（REQ-F-024）：
 *   - mines：应被亮出的雷（尚未插旗的雷）
 *   - wrongFlags：插错的旗（位于非雷格上的旗）
 * @param {Board} board
 * @returns {{ mines: number[], wrongFlags: number[] }}
 */
export function collectLossInfo(board) {
  const mines = [];
  const wrongFlags = [];
  for (let i = 0; i < board.cells.length; i += 1) {
    const cell = board.cells[i];
    if (cell.mine && cell.state !== CellState.FLAGGED) mines.push(i);
    else if (!cell.mine && cell.state === CellState.FLAGGED) wrongFlags.push(i);
  }
  return { mines, wrongFlags };
}

/**
 * 用于测试与调试的紧凑文本视图（"." 未翻开，数字为邻雷数，F 旗标，? 问号）。
 * @param {Board} board
 * @returns {string}
 */
export function boardToText(board) {
  const rows = [];
  for (let y = 0; y < board.height; y += 1) {
    let line = '';
    for (let x = 0; x < board.width; x += 1) {
      const cell = board.cells[xyToIndex(board, x, y)];
      if (cell.state === CellState.FLAGGED) line += 'F';
      else if (cell.state === CellState.QUESTION) line += '?';
      else if (cell.state === CellState.REVEALED) line += cell.adjacent === 0 ? ' ' : String(cell.adjacent);
      else line += '.';
    }
    rows.push(line);
  }
  return rows.join('\n');
}

/**
 * 从 ASCII 布局构造固定棋盘，供测试使用。
 * 字符约定：`*` 雷，`.` 普通格。布雷后自动计算邻雷数。
 * @param {string} layout 多行字符串
 * @returns {Board}
 */
export function boardFromLayout(layout) {
  const rows = layout.trim().split('\n').map((r) => r.trim());
  const height = rows.length;
  const width = rows[0].length;
  for (const row of rows) {
    if (row.length !== width) throw new Error('布局各行宽度必须一致');
  }
  const board = createEmptyBoard(width, height, 0);
  let mines = 0;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (rows[y][x] === '*') {
        board.cells[xyToIndex(board, x, y)].mine = true;
        mines += 1;
      }
    }
  }
  board.mineCount = mines;
  board.minesPlaced = true;
  computeAdjacency(board);
  return board;
}
