/**
 * 主题解析与应用（T17）—— 纯函数 + 接收元素参数的副作用函数
 *
 * 覆盖需求：REQ-F-057 ~ 059
 *
 * 注意：本模块**不在顶层触碰 DOM**，因此仍可被 Node 直接导入并单测纯函数部分（REQ-N-004）。
 */
import { Theme, STORAGE_KEYS } from '../core/constants.js';

/**
 * 决定初始主题（REQ-F-058）：有存储值就用存储值，否则跟随系统偏好。
 * @param {string|null|undefined} stored
 * @param {boolean} prefersDark
 * @returns {'light'|'dark'}
 */
export function resolveInitialTheme(stored, prefersDark) {
  if (stored === Theme.LIGHT || stored === Theme.DARK) return stored;
  return prefersDark ? Theme.DARK : Theme.LIGHT;
}

/**
 * 切换到另一套主题。
 * @param {string} theme
 * @returns {'light'|'dark'}
 */
export function nextTheme(theme) {
  return theme === Theme.DARK ? Theme.LIGHT : Theme.DARK;
}

/**
 * 把主题写到 DOM（REQ-F-057）。
 * @param {{ setAttribute(name: string, value: string): void }} rootEl 通常是 document.documentElement
 * @param {string} theme
 */
export function applyTheme(rootEl, theme) {
  if (!rootEl || typeof rootEl.setAttribute !== 'function') return;
  rootEl.setAttribute('data-theme', theme);
}

/**
 * 创建主题控制器：负责读取初始值、持久化选择、更新 DOM 与按钮文案。
 *
 * @param {{
 *   rootEl: { setAttribute(n: string, v: string): void },
 *   storage: { getItem(k: string): string|null, setItem(k: string, v: string): boolean },
 *   prefersDark?: boolean,
 *   buttonEl?: { textContent: string, setAttribute(n: string, v: string): void } | null
 * }} options
 */
export function createThemeController({ rootEl, storage, prefersDark = false, buttonEl = null }) {
  let theme = resolveInitialTheme(storage.getItem(STORAGE_KEYS.theme), prefersDark);

  const paint = () => {
    applyTheme(rootEl, theme);
    if (buttonEl) {
      buttonEl.textContent = theme === Theme.DARK ? '☀️' : '🌙';
      buttonEl.setAttribute('aria-label', theme === Theme.DARK ? '切换到浅色主题' : '切换到深色主题');
    }
  };

  return {
    get theme() {
      return theme;
    },
    /** 应用初始主题（不写入存储） */
    init() {
      paint();
      return theme;
    },
    /** 切换并持久化（REQ-F-059） */
    toggle() {
      theme = nextTheme(theme);
      storage.setItem(STORAGE_KEYS.theme, theme);
      paint();
      return theme;
    },
  };
}
