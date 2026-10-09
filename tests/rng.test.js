/**
 * T02 验证：可注入随机源与格式化
 * 覆盖需求：REQ-N-006、REQ-F-028、REQ-F-017、REQ-F-044
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { mulberry32, randomInt, pickIndices, pickOne } from '../src/core/rng.js';
import { formatTime, formatMineCount, formatBestTime } from '../src/core/format.js';
import { DIFFICULTIES, DIFFICULTY_ORDER, resolveDifficulty, isTerminal, GameState } from '../src/core/constants.js';

test('mulberry32：同种子产生完全相同的序列', () => {
  const a = mulberry32(20240929);
  const b = mulberry32(20240929);
  const seqA = Array.from({ length: 50 }, () => a());
  const seqB = Array.from({ length: 50 }, () => b());
  assert.deepEqual(seqA, seqB);
});

test('mulberry32：不同种子产生不同序列，且值域为 [0,1)', () => {
  const a = mulberry32(1);
  const b = mulberry32(2);
  const seqA = Array.from({ length: 50 }, () => a());
  const seqB = Array.from({ length: 50 }, () => b());
  assert.notDeepEqual(seqA, seqB);
  for (const v of [...seqA, ...seqB]) {
    assert.ok(v >= 0 && v < 1, `越界值 ${v}`);
  }
});

test('randomInt：结果落在 [0, n) 内，含 rng 返回极端值的情形', () => {
  const alwaysZero = () => 0;
  const almostOne = () => 0.9999999999;
  const exactlyOne = () => 1; // 理论不该发生，但必须不越界
  assert.equal(randomInt(alwaysZero, 10), 0);
  assert.equal(randomInt(almostOne, 10), 9);
  assert.equal(randomInt(exactlyOne, 10), 9, 'rng 返回 1 时必须钳制到 n-1');
  assert.throws(() => randomInt(alwaysZero, 0), RangeError);
  assert.throws(() => randomInt(alwaysZero, -3), RangeError);
});

test('pickIndices：取出的元素不重复、数量正确、不修改入参', () => {
  const pool = Array.from({ length: 81 }, (_, i) => i);
  const snapshot = pool.slice();
  const picked = pickIndices(pool, 10, mulberry32(7));
  assert.equal(picked.length, 10);
  assert.equal(new Set(picked).size, 10, '不应有重复元素');
  assert.deepEqual(pool, snapshot, '不应修改入参');
  for (const v of picked) assert.ok(pool.includes(v));
});

test('pickIndices：k 超过池大小时截断为池大小', () => {
  const pool = [1, 2, 3];
  assert.equal(pickIndices(pool, 99, mulberry32(1)).length, 3);
  assert.equal(pickIndices(pool, 0, mulberry32(1)).length, 0);
  assert.equal(pickIndices([], 5, mulberry32(1)).length, 0);
});

test('pickOne：永远从给定数组中取值', () => {
  const values = [11, 22, 33];
  for (let seed = 0; seed < 20; seed += 1) {
    assert.ok(values.includes(pickOne(values, mulberry32(seed))));
  }
});

test('formatTime：3 位零填充并钳制在 [0, 999]', () => {
  assert.equal(formatTime(0), '000');
  assert.equal(formatTime(7), '007');
  assert.equal(formatTime(42), '042');
  assert.equal(formatTime(999), '999');
  assert.equal(formatTime(1000), '999', '超过 999 秒应保持在 999（REQ-F-028）');
  assert.equal(formatTime(12.9), '012', '小数应截断');
  assert.equal(formatTime(-5), '000');
  assert.equal(formatTime(NaN), '000');
  assert.equal(formatTime(Infinity), '000');
});

test('formatMineCount：非负 3 位、负数带符号 2 位（REQ-F-017）', () => {
  assert.equal(formatMineCount(10), '010');
  assert.equal(formatMineCount(0), '000');
  assert.equal(formatMineCount(99), '099');
  assert.equal(formatMineCount(-1), '-01', '过度插旗时应显示负值');
  assert.equal(formatMineCount(-12), '-12');
  assert.equal(formatMineCount(-200), '-99', '负向钳制在 -99');
  assert.equal(formatMineCount(5000), '999');
});

test('formatBestTime：无记录显示 --（REQ-F-044）', () => {
  assert.equal(formatBestTime(null), '--');
  assert.equal(formatBestTime(undefined), '--');
  assert.equal(formatBestTime(NaN), '--');
  assert.equal(formatBestTime(-1), '--');
  assert.equal(formatBestTime(37), '37');
  assert.equal(formatBestTime(37.9), '37');
});

test('难度表符合 REQ-F-001 的规格', () => {
  assert.deepEqual(DIFFICULTY_ORDER, ['beginner', 'intermediate', 'expert']);
  assert.deepEqual(
    DIFFICULTIES.beginner,
    { id: 'beginner', label: '初级', width: 9, height: 9, mines: 10 },
  );
  assert.deepEqual(
    DIFFICULTIES.intermediate,
    { id: 'intermediate', label: '中级', width: 16, height: 16, mines: 40 },
  );
  assert.deepEqual(
    DIFFICULTIES.expert,
    { id: 'expert', label: '高级', width: 30, height: 16, mines: 99 },
  );
});

test('resolveDifficulty：非法 id 回退到默认难度', () => {
  assert.equal(resolveDifficulty('expert').id, 'expert');
  assert.equal(resolveDifficulty('nope').id, 'beginner');
  assert.equal(resolveDifficulty(undefined).id, 'beginner');
});

test('isTerminal：仅 won/lost 为终局（REQ-F-025）', () => {
  assert.equal(isTerminal(GameState.WON), true);
  assert.equal(isTerminal(GameState.LOST), true);
  assert.equal(isTerminal(GameState.READY), false);
  assert.equal(isTerminal(GameState.PLAYING), false);
});
