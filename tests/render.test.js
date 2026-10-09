/**
 * T14 / T17 验证：渲染层与主题层的**纯函数部分**
 * 覆盖需求：REQ-F-024、044、050、052、057 ~ 059
 *
 * 说明：涉及真实 DOM 操作的函数（mountBoard / syncBoard / syncHud）按 ADR-05 由
 * spec/04-acceptance-checklist.md 人工验收；此处只覆盖不依赖 DOM 的纯函数，
 * 它们承载了 aria-label、类名与文案等最易出错的逻辑。
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { cellClasses, cellContent, cellAriaLabel, phaseEmoji, phaseMessage } from '../src/ui/render.js';
import { resolveInitialTheme, nextTheme, createThemeController } from '../src/ui/theme.js';
import { CellState, GameState, Theme, STORAGE_KEYS } from '../src/core/constants.js';
import { createMemoryStorage } from '../src/core/storage.js';

/** 构造一个只含必要字段的假棋盘 */
function fakeBoard(width, height, cells) {
  return { width, height, cells };
}
const cell = (over = {}) => ({ mine: false, adjacent: 0, state: CellState.HIDDEN, ...over });

// ═════════════════════════════════════════════════════════════
// cellClasses
// ═════════════════════════════════════════════════════════════

test('T14 cellClasses：未翻开 / 已翻开 / 旗标 / 问号', () => {
  assert.equal(cellClasses(cell()), 'cell');
  assert.equal(cellClasses(cell({ state: CellState.REVEALED })), 'cell is-revealed');
  assert.equal(cellClasses(cell({ state: CellState.REVEALED, adjacent: 3 })), 'cell is-revealed n3');
  assert.equal(cellClasses(cell({ state: CellState.REVEALED, adjacent: 0 })), 'cell is-revealed', '空白格不加数字类');
  assert.equal(cellClasses(cell({ state: CellState.FLAGGED })), 'cell is-flagged');
  assert.equal(cellClasses(cell({ state: CellState.QUESTION })), 'cell is-question');
});

test('T14 cellClasses：失败时揭示雷与错误旗标（REQ-F-024）', () => {
  const mine = cell({ mine: true });
  const correctFlag = cell({ mine: true, state: CellState.FLAGGED });
  const wrongFlag = cell({ mine: false, state: CellState.FLAGGED });
  const safe = cell();

  const opts = { isLost: true };
  assert.match(cellClasses(mine, opts), /is-mine/, '未标记的雷应亮出');
  assert.doesNotMatch(cellClasses(correctFlag, opts), /is-mine|is-wrong/, '标对的旗不应被改动');
  assert.match(cellClasses(wrongFlag, opts), /is-wrong/, '错误旗标应打叉');
  assert.doesNotMatch(cellClasses(safe, opts), /is-mine|is-wrong/);
});

test('T14 cellClasses：爆炸点单独高亮且优先于 is-mine', () => {
  const mine = cell({ mine: true });
  const classes = cellClasses(mine, { isLost: true, isExploded: true });
  assert.match(classes, /is-exploded/);
  assert.doesNotMatch(classes, /is-mine/, '爆炸点不应同时带普通雷样式');
});

test('T14 cellClasses：未失败时不泄露任何雷信息（REQ-F-006）', () => {
  const mine = cell({ mine: true });
  assert.equal(cellClasses(mine), 'cell', '进行中绝不能让雷格带特殊类名');
});

// ═════════════════════════════════════════════════════════════
// cellContent
// ═════════════════════════════════════════════════════════════

test('T14 cellContent：各状态的内容', () => {
  assert.equal(cellContent(cell()), '');
  assert.equal(cellContent(cell({ state: CellState.REVEALED, adjacent: 0 })), '');
  assert.equal(cellContent(cell({ state: CellState.REVEALED, adjacent: 5 })), '5');
  assert.equal(cellContent(cell({ state: CellState.FLAGGED })), '🚩');
  assert.equal(cellContent(cell({ state: CellState.QUESTION })), '?');
});

test('T14 cellContent：失败揭示（REQ-F-024）', () => {
  assert.equal(cellContent(cell({ mine: true }), { isLost: true }), '💣');
  assert.equal(cellContent(cell({ mine: true }), { isLost: true, isExploded: true }), '💥');
  assert.equal(
    cellContent(cell({ mine: true, state: CellState.FLAGGED }), { isLost: true }),
    '🚩',
    '标对的旗保持旗帜',
  );
  assert.equal(
    cellContent(cell({ mine: false, state: CellState.FLAGGED }), { isLost: true }),
    '✕',
    '错误旗标显示叉号',
  );
  assert.equal(cellContent(cell({ mine: true })), '', '未失败时不显示雷');
});

test('T14 cellContent：胜利后雷格已被 core 补成旗标，因此显示旗帜', () => {
  // applyWinReveal 会把雷格置为 FLAGGED，这里模拟其结果
  assert.equal(cellContent(cell({ mine: true, state: CellState.FLAGGED })), '🚩');
});

// ═════════════════════════════════════════════════════════════
// cellAriaLabel（REQ-F-050）
// ═════════════════════════════════════════════════════════════

test('T14 cellAriaLabel：格式为「第 N 行第 M 列，状态」且行列均从 1 开始', () => {
  const board = fakeBoard(9, 9, []);
  assert.equal(cellAriaLabel(cell(), 0, board), '第 1 行第 1 列，未翻开');
  assert.equal(cellAriaLabel(cell(), 1, board), '第 1 行第 2 列，未翻开');
  assert.equal(cellAriaLabel(cell(), 9, board), '第 2 行第 1 列，未翻开');
  assert.equal(cellAriaLabel(cell(), 40, board), '第 5 行第 5 列，未翻开');
  assert.equal(cellAriaLabel(cell(), 80, board), '第 9 行第 9 列，未翻开');
});

test('T14 cellAriaLabel：专家棋盘（宽 30）的行列换算正确', () => {
  const board = fakeBoard(30, 16, []);
  assert.equal(cellAriaLabel(cell(), 0, board), '第 1 行第 1 列，未翻开');
  assert.equal(cellAriaLabel(cell(), 29, board), '第 1 行第 30 列，未翻开');
  assert.equal(cellAriaLabel(cell(), 30, board), '第 2 行第 1 列，未翻开');
  assert.equal(cellAriaLabel(cell(), 479, board), '第 16 行第 30 列，未翻开');
});

test('T14 cellAriaLabel：各状态描述', () => {
  const board = fakeBoard(9, 9, []);
  assert.equal(cellAriaLabel(cell({ state: CellState.REVEALED, adjacent: 3 }), 0, board), '第 1 行第 1 列，已翻开，数字 3');
  assert.equal(cellAriaLabel(cell({ state: CellState.REVEALED, adjacent: 0 }), 0, board), '第 1 行第 1 列，已翻开，空白');
  assert.equal(cellAriaLabel(cell({ state: CellState.FLAGGED }), 0, board), '第 1 行第 1 列，已插旗');
  assert.equal(cellAriaLabel(cell({ state: CellState.QUESTION }), 0, board), '第 1 行第 1 列，问号');
});

test('T14 cellAriaLabel：失败后描述雷与错误旗标', () => {
  const board = fakeBoard(9, 9, []);
  assert.equal(cellAriaLabel(cell({ mine: true }), 0, board, { isLost: true }), '第 1 行第 1 列，地雷');
  assert.equal(
    cellAriaLabel(cell({ mine: true }), 0, board, { isLost: true, isExploded: true }),
    '第 1 行第 1 列，地雷，爆炸点',
  );
  assert.equal(
    cellAriaLabel(cell({ state: CellState.FLAGGED }), 0, board, { isLost: true }),
    '第 1 行第 1 列，已插旗，标记错误',
  );
});

test('T14 cellAriaLabel：进行中的雷格仍描述为「未翻开」（REQ-F-006）', () => {
  const board = fakeBoard(9, 9, []);
  assert.equal(cellAriaLabel(cell({ mine: true }), 0, board), '第 1 行第 1 列，未翻开');
});

// ═════════════════════════════════════════════════════════════
// phaseEmoji / phaseMessage
// ═════════════════════════════════════════════════════════════

const fakeGame = (over = {}) => ({
  state: GameState.PLAYING,
  elapsed: 0,
  remainingMines: 10,
  dirty: false,
  recordUpdated: false,
  ...over,
});

test('T14 phaseEmoji：三种表情对应三种局面', () => {
  assert.equal(phaseEmoji(fakeGame({ state: GameState.READY })), '🙂');
  assert.equal(phaseEmoji(fakeGame({ state: GameState.PLAYING })), '🙂');
  assert.equal(phaseEmoji(fakeGame({ state: GameState.WON })), '😎');
  assert.equal(phaseEmoji(fakeGame({ state: GameState.LOST })), '😵');
});

test('T14 phaseMessage：READY 提示首点安全', () => {
  const text = phaseMessage(fakeGame({ state: GameState.READY }));
  assert.match(text, /首点/);
});

test('T14 phaseMessage：PLAYING 显示剩余雷数，旗标模式有专门提示', () => {
  assert.match(phaseMessage(fakeGame({ remainingMines: 7 })), /7/);
  assert.match(phaseMessage(fakeGame(), true), /旗标模式/);
});

test('T14 phaseMessage：胜利文案包含用时，并按情况附带新纪录 / 无效成绩说明（REQ-F-043、044）', () => {
  const plain = phaseMessage(fakeGame({ state: GameState.WON, elapsed: 42 }));
  assert.match(plain, /42/);
  assert.doesNotMatch(plain, /新纪录/);

  const record = phaseMessage(fakeGame({ state: GameState.WON, elapsed: 42, recordUpdated: true }));
  assert.match(record, /新纪录/);

  const dirty = phaseMessage(fakeGame({ state: GameState.WON, elapsed: 42, dirty: true }));
  assert.match(dirty, /不计入最佳成绩/, '用过辅助的局必须明确告知不计成绩');
});

test('T14 phaseMessage：失败文案给出重开指引', () => {
  assert.match(phaseMessage(fakeGame({ state: GameState.LOST })), /重新开始|R 键/);
});

// ═════════════════════════════════════════════════════════════
// 主题（REQ-F-057 ~ 059）
// ═════════════════════════════════════════════════════════════

test('T17 resolveInitialTheme：有存储值时以存储值为准', () => {
  assert.equal(resolveInitialTheme(Theme.DARK, false), Theme.DARK);
  assert.equal(resolveInitialTheme(Theme.LIGHT, true), Theme.LIGHT);
  assert.equal(resolveInitialTheme('dark', false), 'dark');
});

test('T17 resolveInitialTheme：无存储值时跟随系统偏好（REQ-F-058）', () => {
  assert.equal(resolveInitialTheme(null, true), Theme.DARK);
  assert.equal(resolveInitialTheme(null, false), Theme.LIGHT);
  assert.equal(resolveInitialTheme(undefined, true), Theme.DARK);
  assert.equal(resolveInitialTheme('', true), Theme.DARK, '空串视为无存储值');
  assert.equal(resolveInitialTheme('rainbow', false), Theme.LIGHT, '非法值视为无存储值');
  assert.equal(resolveInitialTheme('rainbow', true), Theme.DARK);
});

test('T17 nextTheme：来回切换', () => {
  assert.equal(nextTheme(Theme.LIGHT), Theme.DARK);
  assert.equal(nextTheme(Theme.DARK), Theme.LIGHT);
  assert.equal(nextTheme('anything-else'), Theme.DARK);
});

test('T17 createThemeController：init 应用初始主题但不写存储', () => {
  const rootEl = { attrs: {}, setAttribute(n, v) { this.attrs[n] = v; } };
  const storage = createMemoryStorage();
  const ctrl = createThemeController({ rootEl, storage, prefersDark: true });

  assert.equal(ctrl.theme, Theme.DARK);
  ctrl.init();
  assert.equal(rootEl.attrs['data-theme'], Theme.DARK);
  assert.equal(storage.getItem(STORAGE_KEYS.theme), null, 'init 不应写入存储');
});

test('T17 createThemeController：toggle 切换并持久化（REQ-F-059）', () => {
  const rootEl = { attrs: {}, setAttribute(n, v) { this.attrs[n] = v; } };
  const storage = createMemoryStorage();
  const buttonEl = { textContent: '', setAttribute() {} };
  const ctrl = createThemeController({ rootEl, storage, prefersDark: false, buttonEl });

  ctrl.init();
  assert.equal(rootEl.attrs['data-theme'], Theme.LIGHT);

  assert.equal(ctrl.toggle(), Theme.DARK);
  assert.equal(rootEl.attrs['data-theme'], Theme.DARK);
  assert.equal(storage.getItem(STORAGE_KEYS.theme), Theme.DARK, '切换结果应被持久化');

  assert.equal(ctrl.toggle(), Theme.LIGHT);
  assert.equal(storage.getItem(STORAGE_KEYS.theme), Theme.LIGHT);
});

test('T17 createThemeController：再次创建时沿用已持久化的主题（REQ-F-059）', () => {
  const storage = createMemoryStorage({ [STORAGE_KEYS.theme]: Theme.DARK });
  const rootEl = { attrs: {}, setAttribute(n, v) { this.attrs[n] = v; } };
  const ctrl = createThemeController({ rootEl, storage, prefersDark: false });

  ctrl.init();
  assert.equal(ctrl.theme, Theme.DARK, '存储值应覆盖系统偏好');
  assert.equal(rootEl.attrs['data-theme'], Theme.DARK);
});

test('T17 createThemeController：按钮文案与 aria-label 随主题更新', () => {
  const rootEl = { setAttribute() {} };
  const storage = createMemoryStorage();
  const attrs = {};
  const buttonEl = {
    textContent: '',
    setAttribute(n, v) {
      attrs[n] = v;
    },
  };
  const ctrl = createThemeController({ rootEl, storage, buttonEl });

  ctrl.init();
  assert.equal(buttonEl.textContent, '🌙');
  assert.match(attrs['aria-label'], /深色/);

  ctrl.toggle();
  assert.equal(buttonEl.textContent, '☀️');
  assert.match(attrs['aria-label'], /浅色/);
});

test('T17 applyTheme 的健壮性：传入非法元素不抛异常', () => {
  const rootEl = { setAttribute() {} };
  assert.doesNotThrow(() => createThemeController({ rootEl, storage: createMemoryStorage() }).init());
});
