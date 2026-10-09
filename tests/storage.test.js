/**
 * T12 验证：持久化适配层
 * 覆盖需求：REQ-F-041 ~ 045
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { createSafeStorage, createMemoryStorage, createBestTimesStore } from '../src/core/storage.js';
import { STORAGE_KEYS } from '../src/core/constants.js';

const KEY = STORAGE_KEYS.bestTimes;

/** 完全不合作的 Storage：任何访问都抛错（模拟隐私模式 / 配额满） */
function hostileStorage() {
  const boom = () => {
    throw new Error('SecurityError: storage blocked');
  };
  return { getItem: boom, setItem: boom, removeItem: boom };
}

test('T12 createMemoryStorage：读写删往返一致', () => {
  const s = createMemoryStorage();
  assert.equal(s.getItem('a'), null);
  s.setItem('a', '1');
  assert.equal(s.getItem('a'), '1');
  s.setItem('a', '2');
  assert.equal(s.getItem('a'), '2');
  s.removeItem('a');
  assert.equal(s.getItem('a'), null);
  assert.equal(s.length, 0);
});

test('T12 createSafeStorage：正常 Storage 不被降级', () => {
  const safe = createSafeStorage(createMemoryStorage());
  assert.equal(safe.degraded, false);
  assert.equal(safe.setItem('k', 'v'), true);
  assert.equal(safe.getItem('k'), 'v');
});

test('T12 createSafeStorage：raw 缺失时降级为内存存储且不抛错（REQ-F-045）', () => {
  for (const raw of [undefined, null, 42, 'nope', {}]) {
    const safe = createSafeStorage(raw);
    assert.equal(safe.degraded, true, `raw=${String(raw)} 应触发降级`);
    assert.equal(safe.setItem('k', 'v'), true);
    assert.equal(safe.getItem('k'), 'v', '降级后仍应可读回本进程内写入的值');
    assert.doesNotThrow(() => safe.removeItem('k'));
  }
});

test('T12 createSafeStorage：敌意 Storage 全程不抛异常（REQ-F-045）', () => {
  const safe = createSafeStorage(hostileStorage());
  assert.equal(safe.degraded, true);
  assert.doesNotThrow(() => safe.getItem(KEY));
  assert.equal(safe.getItem(KEY), null, '读取失败应返回 null 而非抛错');
  assert.equal(safe.setItem(KEY, 'x'), true);
  assert.equal(safe.getItem(KEY), 'x', '写入应落到内存兜底');
  assert.doesNotThrow(() => safe.removeItem(KEY));
  assert.equal(safe.getItem(KEY), null, '删除应作用在兜底存储上');
});

test('T12 createBestTimesStore：无记录时 get 返回 null（REQ-F-044）', () => {
  const store = createBestTimesStore(createSafeStorage(createMemoryStorage()));
  assert.equal(store.get('beginner'), null);
  assert.equal(store.get('expert'), null);
});

test('T12 createBestTimesStore：写入后可读回，且按难度隔离（REQ-F-041）', () => {
  const raw = createMemoryStorage();
  const store = createBestTimesStore(createSafeStorage(raw));

  assert.equal(store.update('beginner', 42), true);
  assert.equal(store.get('beginner'), 42);
  assert.equal(store.get('intermediate'), null, '难度之间必须隔离');
  assert.equal(raw.getItem(KEY), JSON.stringify({ beginner: 42 }), '应写入约定的键名与格式');
});

test('T12 createBestTimesStore：仅在更快时更新（REQ-F-042）', () => {
  const store = createBestTimesStore(createSafeStorage(createMemoryStorage()));
  assert.equal(store.update('beginner', 50), true);

  assert.equal(store.update('beginner', 80), false, '更慢的成绩不得覆盖');
  assert.equal(store.get('beginner'), 50);

  assert.equal(store.update('beginner', 50), false, '相同成绩不算刷新');
  assert.equal(store.get('beginner'), 50);

  assert.equal(store.update('beginner', 49), true, '更快才刷新');
  assert.equal(store.get('beginner'), 49);
  assert.equal(store.update('beginner', 0), true, '0 秒也是合法成绩');
  assert.equal(store.get('beginner'), 0);
});

test('T12 createBestTimesStore：拒绝非法用时值', () => {
  const store = createBestTimesStore(createSafeStorage(createMemoryStorage()));
  for (const bad of [-1, NaN, Infinity, '30', null, undefined, {}]) {
    assert.equal(store.update('beginner', bad), false, `${String(bad)} 不应被接受`);
  }
  assert.equal(store.get('beginner'), null);
});

test('T12 createBestTimesStore：损坏的 JSON 不抛异常且被清理（REQ-F-045）', () => {
  const raw = createMemoryStorage({ [KEY]: '{ 这不是 JSON' });
  const store = createBestTimesStore(createSafeStorage(raw));

  assert.doesNotThrow(() => store.get('beginner'));
  assert.equal(store.get('beginner'), null);
  assert.equal(raw.getItem(KEY), null, '损坏数据应被清除');

  assert.equal(store.update('beginner', 30), true, '清理后仍可正常写入');
  assert.equal(store.get('beginner'), 30);
});

test('T12 createBestTimesStore：JSON 合法但结构非法时按空数据兜底', () => {
  for (const payload of ['null', '"str"', '[1,2,3]', '123']) {
    const raw = createMemoryStorage({ [KEY]: payload });
    const store = createBestTimesStore(createSafeStorage(raw));
    assert.equal(store.get('beginner'), null, `payload=${payload} 应被当作无记录`);
    assert.equal(store.update('beginner', 12), true);
    assert.equal(store.get('beginner'), 12);
  }
});

test('T12 createBestTimesStore：非法字段值被忽略，不作为成绩返回', () => {
  const raw = createMemoryStorage({
    [KEY]: JSON.stringify({ beginner: 'fast', intermediate: -5, expert: null }),
  });
  const store = createBestTimesStore(createSafeStorage(raw));
  assert.equal(store.get('beginner'), null);
  assert.equal(store.get('intermediate'), null);
  assert.equal(store.get('expert'), null);
});

test('T12 createBestTimesStore：resetAll 清空全部成绩', () => {
  const store = createBestTimesStore(createSafeStorage(createMemoryStorage()));
  store.update('beginner', 20);
  store.update('expert', 300);
  store.resetAll();
  assert.equal(store.get('beginner'), null);
  assert.equal(store.get('expert'), null);
});

test('T12 createBestTimesStore：存储降级时成绩仍可在本局内使用（REQ-F-045）', () => {
  const store = createBestTimesStore(createSafeStorage(hostileStorage()));
  assert.equal(store.degraded, true);
  assert.doesNotThrow(() => store.update('beginner', 33));
  assert.equal(store.get('beginner'), 33, '降级后应退化为进程内存储');
});
