/**
 * T13 验证：输入动作解析（纯函数）
 * 覆盖需求：REQ-F-021、046 ~ 049、056
 *
 * 本文件逐行覆盖 spec/02-design.md §6.2 的输入判定表。
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  Action,
  GlobalAction,
  resolveMouseAction,
  resolveKeyAction,
  resolveGlobalKey,
  moveCursor,
  isEditableTarget,
} from '../src/ui/input.js';
import { CellState } from '../src/core/constants.js';

const HIDDEN = CellState.HIDDEN;
const REVEALED = CellState.REVEALED;
const FLAGGED = CellState.FLAGGED;
const QUESTION = CellState.QUESTION;
const ALL_STATES = [HIDDEN, REVEALED, FLAGGED, QUESTION];
const NON_REVEALED = [HIDDEN, FLAGGED, QUESTION];

// ═════════════════════════════════════════════════════════════
// 左键单击
// ═════════════════════════════════════════════════════════════

test('T13 左键单击（非旗标模式）：无论格子状态都是翻开', () => {
  for (const cellState of ALL_STATES) {
    assert.equal(
      resolveMouseAction({ type: 'click', button: 0, cellState, flagMode: false }),
      Action.REVEAL,
      `状态 ${cellState} 下左键应为翻开`,
    );
  }
});

test('T13 左键单击（旗标模式）：未翻开格插旗，已翻开格走和弦（REQ-F-056）', () => {
  for (const cellState of NON_REVEALED) {
    assert.equal(
      resolveMouseAction({ type: 'click', button: 0, cellState, flagMode: true }),
      Action.FLAG,
      `旗标模式下 ${cellState} 应插旗`,
    );
  }
  // 已翻开格无法标记（REQ-F-016），因此改走和弦，为触屏用户提供单击和弦路径
  assert.equal(
    resolveMouseAction({ type: 'click', button: 0, cellState: REVEALED, flagMode: true }),
    Action.CHORD,
  );
});

test('T13 左键单击：flagMode 缺省为 false', () => {
  assert.equal(resolveMouseAction({ type: 'click', button: 0, cellState: HIDDEN }), Action.REVEAL);
});

// ═════════════════════════════════════════════════════════════
// 右键
// ═════════════════════════════════════════════════════════════

test('T13 右键：未翻开格插旗，已翻开格无动作（REQ-F-013）', () => {
  for (const cellState of NON_REVEALED) {
    assert.equal(
      resolveMouseAction({ type: 'contextmenu', cellState }),
      Action.FLAG,
      `右键 ${cellState} 应插旗`,
    );
  }
  assert.equal(resolveMouseAction({ type: 'contextmenu', cellState: REVEALED }), Action.NONE);
});

test('T13 右键单击（click 事件带 button=2）与 contextmenu 一致', () => {
  assert.equal(resolveMouseAction({ type: 'click', button: 2, cellState: HIDDEN }), Action.FLAG);
  assert.equal(resolveMouseAction({ type: 'click', button: 2, cellState: REVEALED }), Action.NONE);
});

test('T13 右键不受旗标模式影响（右键始终是标记语义）', () => {
  assert.equal(resolveMouseAction({ type: 'contextmenu', cellState: HIDDEN, flagMode: true }), Action.FLAG);
  assert.equal(resolveMouseAction({ type: 'contextmenu', cellState: REVEALED, flagMode: true }), Action.NONE);
});

// ═════════════════════════════════════════════════════════════
// 和弦的三种触发（REQ-F-021）
// ═════════════════════════════════════════════════════════════

test('T13 和弦触发一：左右键同按（buttons 位掩码 3）', () => {
  assert.equal(
    resolveMouseAction({ type: 'pointerdown', button: 0, buttons: 3, cellState: REVEALED }),
    Action.CHORD,
  );
  assert.equal(
    resolveMouseAction({ type: 'pointerdown', button: 2, buttons: 3, cellState: REVEALED }),
    Action.CHORD,
  );
  // 未翻开的格子不响应和弦
  for (const cellState of NON_REVEALED) {
    assert.equal(
      resolveMouseAction({ type: 'pointerdown', buttons: 3, cellState }),
      Action.NONE,
      `${cellState} 不应触发和弦`,
    );
  }
});

test('T13 和弦触发一：只按单一键不触发和弦', () => {
  assert.equal(resolveMouseAction({ type: 'pointerdown', buttons: 1, cellState: REVEALED }), Action.NONE);
  assert.equal(resolveMouseAction({ type: 'pointerdown', buttons: 2, cellState: REVEALED }), Action.NONE);
});

test('T13 和弦触发二：双击已翻开的数字格', () => {
  assert.equal(resolveMouseAction({ type: 'dblclick', cellState: REVEALED }), Action.CHORD);
  for (const cellState of NON_REVEALED) {
    assert.equal(resolveMouseAction({ type: 'dblclick', cellState }), Action.NONE);
  }
});

test('T13 和弦触发三：Enter / Space 作用于已翻开格（REQ-F-047）', () => {
  for (const key of ['Enter', ' ', 'Spacebar']) {
    assert.equal(resolveKeyAction({ key, cellState: REVEALED }), Action.CHORD, `${key} 应触发和弦`);
  }
});

// ═════════════════════════════════════════════════════════════
// 键盘动作（REQ-F-047、048）
// ═════════════════════════════════════════════════════════════

test('T13 Enter / Space 作用于未翻开格是翻开（REQ-F-047）', () => {
  for (const key of ['Enter', ' ', 'Spacebar']) {
    for (const cellState of NON_REVEALED) {
      assert.equal(resolveKeyAction({ key, cellState }), Action.REVEAL);
    }
  }
});

test('T13 F 键：未翻开格标记，已翻开格无动作（REQ-F-048）', () => {
  for (const cellState of NON_REVEALED) {
    assert.equal(resolveKeyAction({ key: 'f', cellState }), Action.FLAG, '小写 f');
    assert.equal(resolveKeyAction({ key: 'F', cellState }), Action.FLAG, '大写 F');
  }
  assert.equal(resolveKeyAction({ key: 'f', cellState: REVEALED }), Action.NONE);
  assert.equal(resolveKeyAction({ key: 'F', cellState: REVEALED }), Action.NONE);
});

test('T13 键盘：无关键位返回 NONE', () => {
  for (const key of ['a', 'Escape', 'Tab', 'ArrowUp', 'Shift']) {
    assert.equal(resolveKeyAction({ key, cellState: HIDDEN }), Action.NONE, `${key} 不应产生动作`);
  }
});

// ═════════════════════════════════════════════════════════════
// 全局快捷键（REQ-F-049）
// ═════════════════════════════════════════════════════════════

test('T13 全局快捷键：U / H / R，大小写均可', () => {
  assert.equal(resolveGlobalKey('u'), GlobalAction.UNDO);
  assert.equal(resolveGlobalKey('U'), GlobalAction.UNDO);
  assert.equal(resolveGlobalKey('h'), GlobalAction.HINT);
  assert.equal(resolveGlobalKey('H'), GlobalAction.HINT);
  assert.equal(resolveGlobalKey('r'), GlobalAction.NEW_GAME);
  assert.equal(resolveGlobalKey('R'), GlobalAction.NEW_GAME);
});

test('T13 全局快捷键：其他按键返回 null', () => {
  for (const key of ['f', 'Enter', 'ArrowLeft', 'q', '']) {
    assert.equal(resolveGlobalKey(key), null);
  }
  assert.equal(resolveGlobalKey(undefined), null);
  assert.equal(resolveGlobalKey(42), null);
});

// ═════════════════════════════════════════════════════════════
// 焦点移动（REQ-F-046）
// ═════════════════════════════════════════════════════════════

test('T13 moveCursor：四个方向的正确增量（y 轴向下为正）', () => {
  assert.deepEqual(moveCursor('ArrowRight', 3, 3, 9, 9), { x: 4, y: 3 });
  assert.deepEqual(moveCursor('ArrowLeft', 3, 3, 9, 9), { x: 2, y: 3 });
  assert.deepEqual(moveCursor('ArrowDown', 3, 3, 9, 9), { x: 3, y: 4 });
  assert.deepEqual(moveCursor('ArrowUp', 3, 3, 9, 9), { x: 3, y: 2 });
});

test('T13 moveCursor：边界处停止且不环绕（REQ-F-046）', () => {
  // 最右列继续右移 → 停在原地，不跳到下一行
  assert.deepEqual(moveCursor('ArrowRight', 8, 3, 9, 9), { x: 8, y: 3 });
  // 最左列继续左移 → 停在原地，不跳到上一行
  assert.deepEqual(moveCursor('ArrowLeft', 0, 3, 9, 9), { x: 0, y: 3 });
  // 最底行 / 最顶行
  assert.deepEqual(moveCursor('ArrowDown', 3, 8, 9, 9), { x: 3, y: 8 });
  assert.deepEqual(moveCursor('ArrowUp', 3, 0, 9, 9), { x: 3, y: 0 });
  // 四个角
  assert.deepEqual(moveCursor('ArrowRight', 0, 0, 1, 1), { x: 0, y: 0 });
  assert.deepEqual(moveCursor('ArrowLeft', 0, 0, 1, 1), { x: 0, y: 0 });
});

test('T13 moveCursor：非方向键返回 null，非法坐标返回 null', () => {
  assert.equal(moveCursor('Enter', 1, 1, 9, 9), null);
  assert.equal(moveCursor('f', 1, 1, 9, 9), null);
  assert.equal(moveCursor('ArrowRight', 1.5, 1, 9, 9), null);
  assert.equal(moveCursor('ArrowRight', 1, 1, 0, 9), null);
});

test('T13 moveCursor：专家棋盘整行移动不越界', () => {
  const width = 30;
  const height = 16;
  let x = 0;
  let y = 0;
  for (let step = 0; step < 100; step += 1) {
    ({ x, y } = moveCursor('ArrowRight', x, y, width, height));
    assert.ok(x >= 0 && x < width && y >= 0 && y < height);
  }
  assert.deepEqual({ x, y }, { x: width - 1, y: 0 }, '一直右移应停在最右列');
});

// ═════════════════════════════════════════════════════════════
// 可编辑目标判定（全局快捷键的例外）
// ═════════════════════════════════════════════════════════════

test('T13 isEditableTarget：输入控件与 contenteditable 应保留默认行为', () => {
  assert.equal(isEditableTarget({ tagName: 'INPUT' }), true);
  assert.equal(isEditableTarget({ tagName: 'input' }), true);
  assert.equal(isEditableTarget({ tagName: 'TEXTAREA' }), true);
  assert.equal(isEditableTarget({ tagName: 'SELECT' }), true);
  assert.equal(isEditableTarget({ tagName: 'DIV', isContentEditable: true }), true);

  assert.equal(isEditableTarget({ tagName: 'BUTTON' }), false);
  assert.equal(isEditableTarget({ tagName: 'DIV' }), false);
  assert.equal(isEditableTarget(null), false);
  assert.equal(isEditableTarget(undefined), false);
});

// ═════════════════════════════════════════════════════════════
// 健壮性：畸形输入不得抛异常
// ═════════════════════════════════════════════════════════════

test('T13 畸形输入：返回 NONE 而不是抛异常', () => {
  assert.equal(resolveMouseAction(), Action.NONE);
  assert.equal(resolveMouseAction({}), Action.NONE);
  assert.equal(resolveMouseAction({ cellState: 123 }), Action.NONE);
  assert.equal(resolveKeyAction(), Action.NONE);
  assert.equal(resolveKeyAction({ key: 'Enter' }), Action.NONE);
  assert.equal(resolveKeyAction({ cellState: HIDDEN }), Action.NONE);
});
