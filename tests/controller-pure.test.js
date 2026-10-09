/**
 * T15 补充验证：控制器里的事件目标解析（纯函数部分）
 *
 * 覆盖需求：REQ-F-021、053（事件落到哪一格是这些需求的判定前提）
 *
 * `attachController` 整体依赖 DOM，无法在 Node 中执行；但它内部有两处
 * 只依赖窄接口的解析逻辑 —— `target.closest` 与 `el.dataset.index` ——
 * 这两处正是"事件落错格子"这类 bug 的常见来源，因此单独导出并覆盖。
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { closestCell, indexOfCell } from '../src/ui/controller.js';

// ───────────────────────── 辅助 ─────────────────────────

/** 造一个"在棋盘内 / 不在棋盘内"可控的假棋盘容器 */
function fakeBoard({ contained = true, hasContains = true } = {}) {
  const boardEl = {};
  if (hasContains) boardEl.contains = () => contained;
  return boardEl;
}

/** 造一个 closest 只认 '.cell' 的假事件目标 */
function fakeTarget(cell) {
  return {
    closest(selector) {
      return selector === '.cell' ? cell : null;
    },
  };
}

// ═════════════════════════════════════════════════════════
// indexOfCell
// ═════════════════════════════════════════════════════════

test('indexOfCell：合法索引串被正确解析', () => {
  assert.equal(indexOfCell({ dataset: { index: '0' } }), 0);
  assert.equal(indexOfCell({ dataset: { index: '7' } }), 7);
  assert.equal(indexOfCell({ dataset: { index: '479' } }), 479);
});

test('indexOfCell：缺失或非法输入一律返回 -1', () => {
  for (const bad of [null, undefined, {}, { dataset: {} }, { dataset: { index: undefined } }]) {
    assert.equal(indexOfCell(bad), -1, `${JSON.stringify(bad)} 应返回 -1`);
  }
});

test('indexOfCell：空串不得被当成索引 0', () => {
  // 这是使用正则而非 Number() 的原因：Number('') === 0 且是整数，
  // 若不拦下来，一个空的 data-index="" 会静默变成"第 0 格"。
  assert.equal(indexOfCell({ dataset: { index: '' } }), -1);
});

test('indexOfCell：非十进制整数串一律拒绝', () => {
  for (const raw of ['abc', '3.5', '-1', '1e3', ' 5', '5 ', '0x10', '+1', 'NaN', 'Infinity', '一']) {
    assert.equal(indexOfCell({ dataset: { index: raw } }), -1, `"${raw}" 应被拒绝`);
  }
});

test('indexOfCell：超出安全整数范围被拒绝', () => {
  assert.equal(indexOfCell({ dataset: { index: '9007199254740993' } }), -1);
});

// ═════════════════════════════════════════════════════════
// closestCell
// ═════════════════════════════════════════════════════════

test('closestCell：目标没有 closest 方法时返回 null', () => {
  const boardEl = fakeBoard();
  for (const target of [null, undefined, {}, { closest: 'not-a-function' }, 0, 'str']) {
    assert.equal(closestCell(boardEl, target), null, `${String(target)} 应返回 null`);
  }
});

test('closestCell：目标不在任何格子里时返回 null', () => {
  assert.equal(closestCell(fakeBoard(), fakeTarget(null)), null);
});

test('closestCell：命中格子且该格子在棋盘内时返回它', () => {
  const cell = { dataset: { index: '12' } };
  assert.equal(closestCell(fakeBoard({ contained: true }), fakeTarget(cell)), cell);
});

test('closestCell：命中的格子不在棋盘内时返回 null', () => {
  // 例如事件来自棋盘之外、但恰好挂在某个带 .cell 类的元素上
  const cell = { dataset: { index: '12' } };
  assert.equal(closestCell(fakeBoard({ contained: false }), fakeTarget(cell)), null);
});

test('closestCell：棋盘容器没有 contains 方法时不抛异常，退化为直接采用结果', () => {
  const cell = { dataset: { index: '3' } };
  assert.doesNotThrow(() => closestCell(fakeBoard({ hasContains: false }), fakeTarget(cell)));
  assert.equal(closestCell(fakeBoard({ hasContains: false }), fakeTarget(cell)), cell);
});

test('closestCell：只按 .cell 选择器查找', () => {
  const seen = [];
  const target = {
    closest(selector) {
      seen.push(selector);
      return null;
    },
  };
  closestCell(fakeBoard(), target);
  assert.deepEqual(seen, ['.cell']);
});

test('closestCell 与 indexOfCell 串联：能从事件目标一路拿到索引', () => {
  const cell = { dataset: { index: '40' } };
  assert.equal(indexOfCell(closestCell(fakeBoard(), fakeTarget(cell))), 40);
});

test('closestCell 与 indexOfCell 串联：非法 data-index 最终得到 -1 而不是误落子', () => {
  const cell = { dataset: { index: '' } };
  assert.equal(indexOfCell(closestCell(fakeBoard(), fakeTarget(cell))), -1);
});
