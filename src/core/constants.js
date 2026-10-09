/**
 * 领域常量（T02）
 *
 * 覆盖需求：REQ-F-001（三档难度）、REQ-F-028（计时上限）、REQ-F-035（撤销栈上限）、
 *           REQ-F-053（长按阈值）、REQ-F-041/059（存储键名）
 *
 * @typedef {'hidden'|'revealed'|'flagged'|'question'} CellStateName
 * @typedef {'ready'|'playing'|'won'|'lost'} GameStateName
 */

/** 格子状态（REQ-F-013 ~ 015） */
export const CellState = Object.freeze({
  HIDDEN: 'hidden',
  REVEALED: 'revealed',
  FLAGGED: 'flagged',
  QUESTION: 'question',
});

/** 游戏状态（REQ-F-002、022、024、025） */
export const GameState = Object.freeze({
  READY: 'ready',
  PLAYING: 'playing',
  WON: 'won',
  LOST: 'lost',
});

/** 标记循环顺序：hidden → flagged → question → hidden（REQ-F-013 ~ 015） */
export const FLAG_CYCLE = Object.freeze([
  CellState.HIDDEN,
  CellState.FLAGGED,
  CellState.QUESTION,
]);

/** 三档预设难度（REQ-F-001） */
export const DIFFICULTIES = Object.freeze({
  beginner: Object.freeze({ id: 'beginner', label: '初级', width: 9, height: 9, mines: 10 }),
  intermediate: Object.freeze({ id: 'intermediate', label: '中级', width: 16, height: 16, mines: 40 }),
  expert: Object.freeze({ id: 'expert', label: '高级', width: 30, height: 16, mines: 99 }),
});

/** 难度展示顺序 */
export const DIFFICULTY_ORDER = Object.freeze(['beginner', 'intermediate', 'expert']);

export const DEFAULT_DIFFICULTY = 'beginner';

/** 计时器显示上限（REQ-F-028） */
export const MAX_TIME = 999;

/** 撤销快照上限（REQ-F-035） */
export const UNDO_LIMIT = 100;

/** 触屏长按判定阈值，毫秒（REQ-F-053） */
export const LONG_PRESS_MS = 500;

/** 触屏移动取消长按的位移阈值，像素 */
export const LONG_PRESS_MOVE_TOLERANCE = 10;

/** 本地存储键名（REQ-F-041、REQ-F-059） */
export const STORAGE_KEYS = Object.freeze({
  bestTimes: 'minesweeper.bestTimes.v1',
  theme: 'minesweeper.theme.v1',
});

/** 主题枚举（REQ-F-057） */
export const Theme = Object.freeze({
  LIGHT: 'light',
  DARK: 'dark',
});

/**
 * 按 id 解析难度；非法 id 回退到默认难度（防御性设计，见 02-design §7）
 * @param {string} [id]
 */
export function resolveDifficulty(id) {
  return DIFFICULTIES[id] ?? DIFFICULTIES[DEFAULT_DIFFICULTY];
}

/** 是否终局状态（REQ-F-025） */
export function isTerminal(state) {
  return state === GameState.WON || state === GameState.LOST;
}
