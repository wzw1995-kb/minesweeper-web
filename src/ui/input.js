/**
 * 输入解析（T13）—— **纯函数，零 DOM 依赖**
 *
 * 覆盖需求：REQ-F-021、046 ~ 049、056
 *
 * 这是本项目在"零依赖、无浏览器自动化"约束下仍然能自动测试 UI 输入逻辑的关键设计
 * （ADR-08）：所有"事件特征 → 动作意图"的判定都集中在这里，DOM 绑定层只做转发。
 * 判定表见 spec/02-design.md §6.2。
 */
import { CellState } from '../core/constants.js';

/** 动作意图 */
export const Action = Object.freeze({
  REVEAL: 'reveal',
  FLAG: 'flag',
  CHORD: 'chord',
  NONE: 'none',
});

/** 全局快捷键 → 动作 */
export const GlobalAction = Object.freeze({
  UNDO: 'undo',
  HINT: 'hint',
  NEW_GAME: 'new-game',
});

/** 方向键 → 坐标增量（注意 y 轴向下为正） */
export const ARROW_DELTAS = Object.freeze({
  ArrowLeft: [-1, 0],
  ArrowRight: [1, 0],
  ArrowUp: [0, -1],
  ArrowDown: [0, 1],
});

/** 渲染场景标识 */
const CTX_LEFT = 0;
const CTX_RIGHT = 2;

const isRevealed = (cellState) => cellState === CellState.REVEALED;

/**
 * 解析鼠标/指针事件应产生的动作。
 *
 * @param {{
 *   type?: 'click'|'dblclick'|'contextmenu'|'pointerdown',
 *   button?: number,
 *   buttons?: number,
 *   cellState: string,
 *   flagMode?: boolean
 * }} input
 * @returns {string} Action 之一
 */
export function resolveMouseAction(input) {
  const {
    type = 'click',
    button = CTX_LEFT,
    buttons = 0,
    cellState,
    flagMode = false,
  } = input ?? {};

  if (typeof cellState !== 'string') return Action.NONE;
  const revealed = isRevealed(cellState);

  // 双击：只在已翻开的数字格上和弦（REQ-F-021）
  if (type === 'dblclick') {
    return revealed ? Action.CHORD : Action.NONE;
  }

  // 右键：已翻开格不做任何事；其余格进入标记循环（REQ-F-013 ~ 015）
  if (type === 'contextmenu' || (type === 'click' && button === CTX_RIGHT)) {
    return revealed ? Action.NONE : Action.FLAG;
  }

  // 左右键同按：已翻开格触发和弦（REQ-F-021）
  if ((buttons & 3) === 3) {
    return revealed ? Action.CHORD : Action.NONE;
  }

  if (type === 'pointerdown') return Action.NONE;

  if (button !== CTX_LEFT) return Action.NONE;

  // 左键：旗标模式下改为标记；已翻开格在旗标模式下无法标记（REQ-F-016），改走和弦，
  // 这同时给触屏用户提供了一条"单击即和弦"的路径。
  if (flagMode) {
    return revealed ? Action.CHORD : Action.FLAG;
  }
  return Action.REVEAL;
}

/**
 * 解析焦点格的键盘动作（REQ-F-047、048）。
 *
 * @param {{ key: string, cellState: string }} input
 * @returns {string} Action 之一
 */
export function resolveKeyAction(input) {
  const { key, cellState } = input ?? {};
  if (typeof key !== 'string' || typeof cellState !== 'string') return Action.NONE;
  const revealed = isRevealed(cellState);

  if (key === 'Enter' || key === ' ' || key === 'Spacebar') {
    return revealed ? Action.CHORD : Action.REVEAL;
  }
  if (key === 'f' || key === 'F') {
    return revealed ? Action.NONE : Action.FLAG;
  }
  return Action.NONE;
}

/**
 * 解析全局快捷键（REQ-F-049）。大小写均可。
 * @param {string} key
 * @returns {string|null} GlobalAction 之一或 null
 */
export function resolveGlobalKey(key) {
  if (typeof key !== 'string') return null;
  switch (key.toLowerCase()) {
    case 'u':
      return GlobalAction.UNDO;
    case 'h':
      return GlobalAction.HINT;
    case 'r':
      return GlobalAction.NEW_GAME;
    default:
      return null;
  }
}

/**
 * 计算方向键移动后的坐标，**边界处停止且不环绕**（REQ-F-046）。
 *
 * @param {string} key
 * @param {number} x 当前列
 * @param {number} y 当前行
 * @param {number} width
 * @param {number} height
 * @returns {{ x: number, y: number }|null} 非方向键返回 null
 */
export function moveCursor(key, x, y, width, height) {
  const delta = ARROW_DELTAS[key];
  if (!delta) return null;
  if (!Number.isInteger(x) || !Number.isInteger(y) || width <= 0 || height <= 0) return null;

  const nextX = Math.min(Math.max(x + delta[0], 0), width - 1);
  const nextY = Math.min(Math.max(y + delta[1], 0), height - 1);
  return { x: nextX, y: nextY };
}

/**
 * 判断键盘事件的目标是否是可编辑控件——是则应让浏览器保留默认行为（REQ-F-049 的例外）。
 * @param {{ tagName?: string, isContentEditable?: boolean }} target
 * @returns {boolean}
 */
export function isEditableTarget(target) {
  if (!target) return false;
  if (target.isContentEditable === true) return true;
  const tag = typeof target.tagName === 'string' ? target.tagName.toUpperCase() : '';
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
}
