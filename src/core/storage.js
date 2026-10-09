/**
 * 持久化适配层（T12）—— 纯逻辑，零 DOM 依赖
 *
 * 覆盖需求：REQ-F-041 ~ 045
 *
 * 设计要点（见 spec/02-design.md §5）：
 *   - createSafeStorage：把任意 Storage-like 包装成**永不抛异常**的适配器；
 *     不可用时自动降级为内存实现（REQ-F-045）。
 *   - createBestTimesStore：单 JSON blob 存各难度最佳成绩。
 */
import { STORAGE_KEYS } from './constants.js';

/**
 * 内存 Storage 实现（降级目标，也供测试直接使用）。
 * @param {Record<string, string>} [initial]
 */
export function createMemoryStorage(initial = {}) {
  const map = new Map(Object.entries(initial).map(([k, v]) => [k, String(v)]));
  return {
    getItem(key) {
      const value = map.get(String(key));
      return value === undefined ? null : value;
    },
    setItem(key, value) {
      map.set(String(key), String(value));
      return true;
    },
    removeItem(key) {
      map.delete(String(key));
      return true;
    },
    clear() {
      map.clear();
      return true;
    },
    key(index) {
      return [...map.keys()][index] ?? null;
    },
    get length() {
      return map.size;
    },
    /** 测试辅助：直接查看内部条目 */
    _dump() {
      return Object.fromEntries(map);
    },
  };
}

function isStorageLike(candidate) {
  return (
    candidate !== null &&
    candidate !== undefined &&
    typeof candidate.getItem === 'function' &&
    typeof candidate.setItem === 'function'
  );
}

/**
 * 把 raw 包装成永不抛异常的存储适配器；不可用时降级为内存实现（REQ-F-045）。
 *
 * @param {unknown} raw 通常是 window.localStorage，也可能是 undefined / 敌意对象
 * @returns {{ getItem(k:string): string|null, setItem(k:string,v:string): boolean,
 *             removeItem(k:string): boolean, readonly degraded: boolean }}
 */
export function createSafeStorage(raw) {
  const fallback = createMemoryStorage();
  let useFallback = !isStorageLike(raw);

  if (!useFallback) {
    // 隐私模式 / 配额已满时，探测写入会直接抛错
    try {
      const probe = '__minesweeper_probe__';
      raw.setItem(probe, '1');
      if (typeof raw.removeItem === 'function') raw.removeItem(probe);
    } catch {
      useFallback = true;
    }
  }

  return {
    /** 是否已降级为内存存储 */
    get degraded() {
      return useFallback;
    },
    getItem(key) {
      if (useFallback) return fallback.getItem(key);
      try {
        return raw.getItem(key);
      } catch {
        return null;
      }
    },
    setItem(key, value) {
      if (useFallback) return fallback.setItem(key, value);
      try {
        raw.setItem(key, value);
        return true;
      } catch {
        // 运行期写入失败（配额等）→ 永久降级，保证本局成绩仍然可见
        useFallback = true;
        return fallback.setItem(key, value);
      }
    },
    removeItem(key) {
      if (useFallback) return fallback.removeItem(key);
      try {
        if (typeof raw.removeItem === 'function') raw.removeItem(key);
        return true;
      } catch {
        useFallback = true;
        return fallback.removeItem(key);
      }
    },
  };
}

/** 合法的用时值：有限非负整数 */
function isValidTime(value) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

/**
 * 最佳成绩仓库（REQ-F-041 ~ 044）。
 * @param {ReturnType<typeof createSafeStorage>} storage
 */
export function createBestTimesStore(storage) {
  const readAll = () => {
    const raw = storage.getItem(STORAGE_KEYS.bestTimes);
    if (raw === null || raw === undefined || raw === '') return {};
    try {
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
      return parsed;
    } catch {
      // REQ-F-045：数据损坏 → 清掉该键并以空数据继续，绝不抛异常
      storage.removeItem(STORAGE_KEYS.bestTimes);
      return {};
    }
  };

  const writeAll = (data) => {
    try {
      return storage.setItem(STORAGE_KEYS.bestTimes, JSON.stringify(data)) !== false;
    } catch {
      return false;
    }
  };

  return {
    /** 底层存储是否已降级为内存（REQ-F-045） */
    get degraded() {
      return storage.degraded === true;
    },

    /**
     * 读取某难度的最佳用时；无记录或数据非法时返回 null（REQ-F-044）。
     * @param {string} difficultyId
     * @returns {number|null}
     */
    get(difficultyId) {
      const value = readAll()[difficultyId];
      return isValidTime(value) ? Math.trunc(value) : null;
    },

    /**
     * 仅当更快时更新记录（REQ-F-042：严格小于）。
     * @param {string} difficultyId
     * @param {number} seconds
     * @returns {boolean} 是否刷新了记录
     */
    update(difficultyId, seconds) {
      if (typeof difficultyId !== 'string' || difficultyId === '') return false;
      if (!isValidTime(seconds)) return false;

      const data = readAll();
      const current = data[difficultyId];
      const next = Math.trunc(seconds);

      if (isValidTime(current) && next >= Math.trunc(current)) return false;

      data[difficultyId] = next;
      writeAll(data);
      return true;
    },

    /** 清空全部成绩 */
    resetAll() {
      return writeAll({});
    },

    /** 原始数据快照（调试/测试用） */
    snapshot() {
      return readAll();
    },
  };
}
