/**
 * 交互控制器（T15、T16）—— 鼠标 / 触控 / 键盘的事件绑定
 *
 * 覆盖需求：REQ-F-021、032、046 ~ 049、053、054、056
 *
 * 职责边界：本模块只负责"把 DOM 事件翻译成 core 的命令调用"与 roving tabindex 焦点管理，
 * 判定逻辑全部由 src/ui/input.js（可单测）与 src/core/game.js 承担。
 */
import { Action, resolveMouseAction, resolveKeyAction, resolveGlobalKey, moveCursor, isEditableTarget } from './input.js';
import { LONG_PRESS_MS, LONG_PRESS_MOVE_TOLERANCE } from '../core/constants.js';

/**
 * 从事件目标向上找到所属的格子元素。
 *
 * 导出以便单测：它只依赖 `target.closest` 与 `boardEl.contains`，
 * 传假对象即可完整覆盖，无需真实 DOM（ADR-08 同样的思路）。
 *
 * @param {{ contains?: (el: unknown) => boolean }} boardEl
 * @param {unknown} target
 */
export function closestCell(boardEl, target) {
  if (!target || typeof target.closest !== 'function') return null;
  const el = target.closest('.cell');
  if (!el) return null;
  if (typeof boardEl.contains === 'function' && !boardEl.contains(el)) return null;
  return el;
}

/**
 * 读取格子元素上的索引。任何非「纯十进制正整数串」的值一律返回 -1，调用方据此忽略事件。
 *
 * 用正则而非 `Number()` 是有意的：`Number('')` 是 0 且 `Number.isInteger(0)` 为真，
 * 一个空的 `data-index=""` 会被静默解析成"第 0 格"——那会变成一次意料之外的落子。
 *
 * 导出以便单测。
 *
 * @param {{ dataset?: { index?: string } }|null} el
 * @returns {number}
 */
export function indexOfCell(el) {
  if (!el) return -1;
  const raw = el.dataset?.index;
  if (typeof raw !== 'string' || !/^\d+$/.test(raw)) return -1;
  const index = Number(raw);
  return Number.isSafeInteger(index) ? index : -1;
}

/**
 * 绑定全部交互。
 *
 * @param {{
 *   boardEl: HTMLElement,
 *   doc?: Document,
 *   getGame: () => import('../core/game.js').Game,
 *   isFlagMode?: () => boolean,
 *   onCursorChanged?: (index: number) => void,
 *   onGlobalAction?: (action: string) => void
 * }} options
 */
export function attachController(options) {
  const {
    boardEl,
    doc = boardEl.ownerDocument,
    getGame,
    isFlagMode = () => false,
    onCursorChanged = () => {},
    onGlobalAction = () => {},
  } = options;

  const state = {
    cursor: 0,
    /** 长按/和弦触发后需吞掉紧随其后的 click，避免重复动作（REQ-F-053） */
    suppressClick: false,
    /**
     * 长按触发后还需吞掉浏览器随后补发的 contextmenu。
     * 否则 Android 上一次长按会"标记两次"（🚩 → ?），因为系统在长按后会再派发一次 contextmenu。
     */
    suppressContextMenu: false,
    longPress: null,
  };

  const notifyCursor = () => onCursorChanged(state.cursor);

  function setCursor(index, { focus = false } = {}) {
    const game = getGame();
    if (!Number.isInteger(index) || index < 0 || index >= game.board.cells.length) return;
    if (state.cursor === index && !focus) return;

    state.cursor = index;
    if (focus) {
      const el = boardEl.querySelector(`.cell[data-index="${index}"]`);
      if (el && typeof el.focus === 'function') el.focus();
    }
    notifyCursor();
  }

  function applyAction(action, index) {
    if (action === Action.NONE) return;
    const game = getGame();
    if (action === Action.REVEAL) game.reveal(index);
    else if (action === Action.FLAG) game.toggleFlag(index);
    else if (action === Action.CHORD) game.chord(index);
  }

  /** 读取某格当前的 CellState，供 input.js 的判定使用 */
  function cellStateAt(index) {
    const game = getGame();
    return game.board.cells[index]?.state;
  }

  // ───────────────────────── 指针 / 鼠标 ─────────────────────────

  function cancelLongPress() {
    if (state.longPress !== null) {
      clearTimeout(state.longPress.timer);
      state.longPress = null;
    }
  }

  function startLongPress(ev, index) {
    cancelLongPress();
    const timer = setTimeout(() => {
      state.longPress = null;
      state.suppressClick = true; // REQ-F-053：阻止长按后衍生的 click 再翻开
      state.suppressContextMenu = true; // 同时吞掉系统补发的 contextmenu
      applyAction(Action.FLAG, index);
    }, LONG_PRESS_MS);

    state.longPress = { pointerId: ev.pointerId, x: ev.clientX, y: ev.clientY, timer };
  }

  const onPointerDown = (ev) => {
    // 新的手势开始，上一轮遗留的抑制标记就此作废。
    // 尤其是 suppressClick：它正常应由随后的 click 清除，但若那次 click 因为
    // 指针在棋盘外松开等原因没有送达，残留的标记会吞掉用户下一次正常的左键点击。
    state.suppressContextMenu = false;
    state.suppressClick = false;

    const index = indexOfCell(closestCell(boardEl, ev.target));
    if (index < 0) return;
    setCursor(index);

    // 左右键同按 → 和弦（REQ-F-021）。必须在这里判定：click 事件里 buttons 已经归零。
    const action = resolveMouseAction({
      type: 'pointerdown',
      button: ev.button,
      buttons: ev.buttons,
      cellState: cellStateAt(index),
      flagMode: isFlagMode(),
    });
    if (action === Action.CHORD) {
      state.suppressClick = true;
      applyAction(Action.CHORD, index);
      return;
    }

    if (ev.pointerType === 'touch') startLongPress(ev, index);
  };

  const onPointerMove = (ev) => {
    const lp = state.longPress;
    if (!lp || lp.pointerId !== ev.pointerId) return;
    const dx = Math.abs(ev.clientX - lp.x);
    const dy = Math.abs(ev.clientY - lp.y);
    if (dx > LONG_PRESS_MOVE_TOLERANCE || dy > LONG_PRESS_MOVE_TOLERANCE) cancelLongPress();
  };

  const onPointerEnd = (ev) => {
    if (state.longPress && state.longPress.pointerId === ev.pointerId) cancelLongPress();
  };

  const onClick = (ev) => {
    if (state.suppressClick) {
      state.suppressClick = false;
      return;
    }
    const index = indexOfCell(closestCell(boardEl, ev.target));
    if (index < 0) return;

    const action = resolveMouseAction({
      type: 'click',
      button: ev.button,
      buttons: ev.buttons,
      cellState: cellStateAt(index),
      flagMode: isFlagMode(),
    });
    applyAction(action, index);
  };

  const onDoubleClick = (ev) => {
    const index = indexOfCell(closestCell(boardEl, ev.target));
    if (index < 0) return;
    applyAction(
      resolveMouseAction({
        type: 'dblclick',
        cellState: cellStateAt(index),
        flagMode: isFlagMode(),
      }),
      index,
    );
  };

  const onContextMenu = (ev) => {
    ev.preventDefault(); // REQ-F-054：阻止长按弹出菜单

    // 触屏竞态：浏览器可能在我们 500ms 的长按定时器之前就先派发 contextmenu。
    // 此时本次手势已经"用掉"了，必须取消定时器，否则 500ms 后还会再标记一次（🚩 → ?）。
    // longPress 非空即说明当前有待决的触屏长按，这是区分触屏与鼠标 contextmenu 的可靠信号。
    if (state.longPress !== null) {
      cancelLongPress();
      state.suppressClick = true;
    }

    // 反向情形：我们的定时器先触发（已执行 FLAG 并置位 suppressContextMenu），
    // 浏览器随后补发的 contextmenu 必须被吞掉，不能再标记一次。
    if (state.suppressContextMenu) {
      state.suppressContextMenu = false;
      return;
    }

    const index = indexOfCell(closestCell(boardEl, ev.target));
    if (index < 0) return;
    applyAction(
      resolveMouseAction({
        type: 'contextmenu',
        cellState: cellStateAt(index),
        flagMode: isFlagMode(),
      }),
      index,
    );
  };

  // ───────────────────────── 键盘 ─────────────────────────

  const onKeyDown = (ev) => {
    if (isEditableTarget(ev.target)) return; // 让输入控件保留默认行为

    const game = getGame();
    const el = closestCell(boardEl, ev.target);

    if (el) {
      const index = indexOfCell(el);
      const x = index % game.board.width;
      const y = (index - x) / game.board.width;

      // 方向键：边界处停止，不环绕（REQ-F-046）
      const moved = moveCursor(ev.key, x, y, game.board.width, game.board.height);
      if (moved) {
        ev.preventDefault();
        setCursor(moved.y * game.board.width + moved.x, { focus: true });
        return;
      }

      // Enter / Space / F（REQ-F-047、048）
      const action = resolveKeyAction({ key: ev.key, cellState: cellStateAt(index) });
      if (action !== Action.NONE) {
        ev.preventDefault();
        applyAction(action, index);
        return;
      }
    }

    // 全局快捷键（REQ-F-049）
    const globalAction = resolveGlobalKey(ev.key);
    if (globalAction) {
      ev.preventDefault();
      onGlobalAction(globalAction);
    }
  };

  boardEl.addEventListener('pointerdown', onPointerDown);
  boardEl.addEventListener('pointermove', onPointerMove);
  boardEl.addEventListener('pointerup', onPointerEnd);
  boardEl.addEventListener('pointercancel', onPointerEnd);
  boardEl.addEventListener('pointerleave', onPointerEnd);
  boardEl.addEventListener('click', onClick);
  boardEl.addEventListener('dblclick', onDoubleClick);
  boardEl.addEventListener('contextmenu', onContextMenu);
  doc.addEventListener('keydown', onKeyDown);

  return {
    getCursor: () => state.cursor,
    setCursor,
    /** 开新局后把焦点重置到左上角（REQ-F-051） */
    reset() {
      cancelLongPress();
      state.suppressClick = false;
      state.suppressContextMenu = false;
      state.cursor = 0;
      notifyCursor();
    },
    destroy() {
      cancelLongPress();
      boardEl.removeEventListener('pointerdown', onPointerDown);
      boardEl.removeEventListener('pointermove', onPointerMove);
      boardEl.removeEventListener('pointerup', onPointerEnd);
      boardEl.removeEventListener('pointercancel', onPointerEnd);
      boardEl.removeEventListener('pointerleave', onPointerEnd);
      boardEl.removeEventListener('click', onClick);
      boardEl.removeEventListener('dblclick', onDoubleClick);
      boardEl.removeEventListener('contextmenu', onContextMenu);
      doc.removeEventListener('keydown', onKeyDown);
    },
  };
}
