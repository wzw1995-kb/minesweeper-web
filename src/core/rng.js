/**
 * 可注入的确定性随机源（T02）
 *
 * 覆盖需求：REQ-N-006（随机源可注入，保证测试确定性）
 *
 * 生产环境使用 Math.random；测试注入 mulberry32(seed) 以获得可复现序列。
 */

/**
 * mulberry32：32 位种子伪随机数生成器，返回 [0, 1) 区间的浮点数。
 * 同一 seed 必定产生同一序列。
 * @param {number} seed
 * @returns {() => number}
 */
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function next() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * 返回 `[0, n)` 内的整数。对边界做钳制，避免 rng() 返回 1 时越界。
 * @param {() => number} rng
 * @param {number} n 上界（不含），必须为正整数
 */
export function randomInt(rng, n) {
  if (!Number.isInteger(n) || n <= 0) {
    throw new RangeError(`randomInt 需要正整数上界，收到 ${n}`);
  }
  const value = Math.floor(rng() * n);
  return value >= n ? n - 1 : value < 0 ? 0 : value;
}

/**
 * 部分 Fisher-Yates 洗牌：从 pool 中不重复地取出 min(k, pool.length) 个元素。
 * 复杂度 O(k)，不修改入参，且结果分布均匀。
 * @template T
 * @param {readonly T[]} pool
 * @param {number} k
 * @param {() => number} rng
 * @returns {T[]}
 */
export function pickIndices(pool, k, rng) {
  const arr = pool.slice();
  const n = Math.min(Math.max(k, 0), arr.length);
  for (let i = 0; i < n; i += 1) {
    const j = i + randomInt(rng, arr.length - i);
    const tmp = arr[i];
    arr[i] = arr[j];
    arr[j] = tmp;
  }
  return arr.slice(0, n);
}

/**
 * 从非空数组中随机取一个元素。
 * @template T
 * @param {readonly T[]} values
 * @param {() => number} rng
 * @returns {T}
 */
export function pickOne(values, rng) {
  return values[randomInt(rng, values.length)];
}

/** 默认随机源（生产环境） */
export const defaultRng = Math.random;
