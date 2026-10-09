/**
 * 数值格式化（T02）
 *
 * 覆盖需求：REQ-F-028（计时 3 位零填充、超时钳制）、REQ-F-017（剩余雷数可显示负值）
 */
import { MAX_TIME } from './constants.js';

/** 剩余雷数的显示下限（经典扫雷为 -99） */
export const MIN_MINE_DISPLAY = -99;
/** 剩余雷数的显示上限 */
export const MAX_MINE_DISPLAY = 999;

/**
 * 计时器显示值：3 位零填充，钳制在 [0, MAX_TIME]（REQ-F-028）。
 * @param {number} seconds
 * @returns {string}
 */
export function formatTime(seconds) {
  const value = Number.isFinite(seconds) ? Math.trunc(seconds) : 0;
  const clamped = Math.min(Math.max(value, 0), MAX_TIME);
  return String(clamped).padStart(3, '0');
}

/**
 * 剩余雷数显示值：非负时 3 位零填充；为负时保留符号并 2 位零填充（如 -01）。
 * 例：10 → "010"，-1 → "-01"，-12 → "-12"。
 * @param {number} count
 * @returns {string}
 */
export function formatMineCount(count) {
  const value = Number.isFinite(count) ? Math.trunc(count) : 0;
  if (value < 0) {
    const abs = Math.min(Math.abs(value), Math.abs(MIN_MINE_DISPLAY));
    return `-${String(abs).padStart(2, '0')}`;
  }
  return String(Math.min(value, MAX_MINE_DISPLAY)).padStart(3, '0');
}

/**
 * 最佳成绩显示值：无记录时返回 "--"（REQ-F-044）。
 * @param {number|null|undefined} seconds
 * @returns {string}
 */
export function formatBestTime(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) return '--';
  return String(Math.trunc(seconds));
}
