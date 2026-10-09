/**
 * DOM 渲染层（T14、T16）—— 只在函数体内触碰 DOM，模块顶层零副作用
 *
 * 覆盖需求：REQ-F-007、017、023、024、026、028、030、044、050、052
 *
 * 设计要点（见 spec/02-design.md §6.1）：
 *   - mountBoard：**仅在开新局/切难度时**重建 DOM（480 个 button 一次性建好）
 *   - syncBoard：每次状态变化只更新"签名变化"的格子（REQ-N-003 性能要求）
 *   - 本模块不做任何游戏规则判定，规则一律委托 core（分层契约）
 */
import { CellState, GameState } from '../core/constants.js';
import { formatTime, formatMineCount, formatBestTime } from '../core/format.js';

/** 格子应带的 CSS 类（纯函数） */
export function cellClasses(cell, { isLost = false, isExploded = false } = {}) {
  const classes = ['cell'];

  if (cell.state === CellState.REVEALED) {
    classes.push('is-revealed');
    if (cell.adjacent > 0) classes.push(`n${cell.adjacent}`);
  } else if (cell.state === CellState.FLAGGED) {
    classes.push('is-flagged');
  } else if (cell.state === CellState.QUESTION) {
    classes.push('is-question');
  }

  if (isLost) {
    if (isExploded) classes.push('is-exploded');
    else if (cell.mine && cell.state !== CellState.FLAGGED) classes.push('is-mine');
    if (!cell.mine && cell.state === CellState.FLAGGED) classes.push('is-wrong');
  }

  return classes.join(' ');
}

/** 格子显示的文本内容（纯函数） */
export function cellContent(cell, { isLost = false, isExploded = false } = {}) {
  if (cell.state === CellState.REVEALED) {
    return cell.adjacent > 0 ? String(cell.adjacent) : '';
  }
  if (cell.state === CellState.FLAGGED) {
    return isLost && !cell.mine ? '✕' : '🚩';
  }
  if (cell.state === CellState.QUESTION) return '?';
  if (isLost && cell.mine) return isExploded ? '💥' : '💣';
  return '';
}

/**
 * 格子的 aria-label（纯函数，REQ-F-050）。
 * 格式：`第 {行} 行第 {列} 列，{状态描述}`
 */
export function cellAriaLabel(cell, index, board, { isLost = false, isExploded = false } = {}) {
  const x = index % board.width;
  const y = (index - x) / board.width;

  let description;
  if (cell.state === CellState.REVEALED) {
    description = cell.adjacent > 0 ? `已翻开，数字 ${cell.adjacent}` : '已翻开，空白';
  } else if (cell.state === CellState.FLAGGED) {
    description = isLost && !cell.mine ? '已插旗，标记错误' : '已插旗';
  } else if (cell.state === CellState.QUESTION) {
    description = '问号';
  } else if (isLost && cell.mine) {
    description = isExploded ? '地雷，爆炸点' : '地雷';
  } else {
    description = '未翻开';
  }

  return `第 ${y + 1} 行第 ${x + 1} 列，${description}`;
}

/** 笑脸按钮的表情（纯函数） */
export function phaseEmoji(game) {
  if (game.state === GameState.WON) return '😎';
  if (game.state === GameState.LOST) return '😵';
  return '🙂';
}

/** 状态栏提示文案（纯函数） */
export function phaseMessage(game, flagMode = false) {
  switch (game.state) {
    case GameState.WON: {
      const parts = [`🎉 胜利！用时 ${game.elapsed} 秒。`];
      if (game.recordUpdated) parts.push('新纪录！');
      if (game.dirty) parts.push('（本局使用过撤销或提示，不计入最佳成绩）');
      return parts.join(' ');
    }
    case GameState.LOST:
      return '💥 踩到雷了 —— 按「重新开始」或 R 键再来一局。';
    case GameState.READY:
      return '点击任意格子开始 —— 首点必定安全。';
    default:
      return flagMode ? '旗标模式已开启：单击即插旗。' : `进行中 · 剩余 ${game.remainingMines} 雷`;
  }
}

/**
 * 建盘：创建全部格子 DOM，返回更新用缓存。
 * 仅在开新局或切换难度时调用。
 *
 * @param {HTMLElement} boardEl 棋盘容器（role="grid"）
 * @param {import('../core/board.js').Board} board
 */
export function mountBoard(boardEl, board) {
  const doc = boardEl.ownerDocument;
  boardEl.replaceChildren();
  boardEl.style.setProperty('--cols', String(board.width));
  boardEl.style.setProperty('--rows', String(board.height));

  const cells = new Array(board.cells.length);

  for (let y = 0; y < board.height; y += 1) {
    const rowEl = doc.createElement('div');
    rowEl.className = 'board__row';
    rowEl.setAttribute('role', 'row');

    for (let x = 0; x < board.width; x += 1) {
      const index = y * board.width + x;
      const cellEl = doc.createElement('button');
      cellEl.type = 'button';
      cellEl.className = 'cell';
      cellEl.setAttribute('role', 'gridcell');
      cellEl.dataset.index = String(index);
      cellEl.dataset.x = String(x);
      cellEl.dataset.y = String(y);
      cellEl.tabIndex = -1;
      cellEl.setAttribute('aria-label', '');
      rowEl.appendChild(cellEl);
      cells[index] = cellEl;
    }

    boardEl.appendChild(rowEl);
  }

  return {
    boardEl,
    cells,
    width: board.width,
    height: board.height,
    signatures: new Array(board.cells.length).fill(''),
  };
}

/**
 * 增量同步棋盘。尺寸与缓存不一致时返回 false，调用方应改用 mountBoard 重建。
 *
 * @param {ReturnType<typeof mountBoard>} cache
 * @param {import('../core/game.js').Game} game
 * @param {number} cursorIndex roving tabindex 的当前焦点格
 * @returns {boolean} 是否同步成功
 */
export function syncBoard(cache, game, cursorIndex = 0) {
  const board = game.board;
  if (cache.width !== board.width || cache.height !== board.height) return false;

  const isLost = game.state === GameState.LOST;
  const exploded = game.explodedIndex;

  for (let i = 0; i < board.cells.length; i += 1) {
    const cell = board.cells[i];
    const isExploded = isLost && exploded === i;
    const isCursor = i === cursorIndex;

    const classes = cellClasses(cell, { isLost, isExploded }) + (isCursor ? ' is-cursor' : '');
    const content = cellContent(cell, { isLost, isExploded });
    const label = cellAriaLabel(cell, i, board, { isLost, isExploded });
    const signature = `${classes}|${content}|${label}`;

    if (cache.signatures[i] === signature) continue;

    const el = cache.cells[i];
    el.className = classes;
    if (el.textContent !== content) el.textContent = content;
    el.setAttribute('aria-label', label);
    el.tabIndex = isCursor ? 0 : -1;
    cache.signatures[i] = signature;
  }

  return true;
}

/** 收集状态栏元素引用 */
export function collectHud(rootEl) {
  const pick = (id) => rootEl.querySelector(`#${id}`);
  return {
    board: pick('board'),
    mineCount: pick('mine-count'),
    timer: pick('timer'),
    best: pick('best-time'),
    face: pick('new-game'),
    undo: pick('undo'),
    hint: pick('hint'),
    theme: pick('theme'),
    flagMode: pick('flag-mode'),
    difficulty: pick('difficulty'),
    message: pick('message'),
    storageWarning: pick('storage-warning'),
  };
}

function setText(el, text) {
  if (el && el.textContent !== text) el.textContent = text;
}

function setDisabled(el, disabled) {
  if (el && el.disabled !== disabled) el.disabled = disabled;
}

/**
 * 同步状态栏（REQ-F-017、026、028、030、044、052）。
 *
 * @param {ReturnType<typeof collectHud>} hud
 * @param {import('../core/game.js').Game} game
 * @param {boolean} flagMode
 */
export function syncHud(hud, game, flagMode = false) {
  setText(hud.mineCount, formatMineCount(game.remainingMines));
  setText(hud.timer, formatTime(game.elapsed));
  setText(hud.best, formatBestTime(game.bestTime));
  setText(hud.face, phaseEmoji(game));

  setDisabled(hud.undo, !game.canUndo);
  setDisabled(hud.hint, game.isOver);

  if (hud.flagMode) {
    hud.flagMode.setAttribute('aria-pressed', String(flagMode));
    if (typeof hud.flagMode.classList?.toggle === 'function') {
      hud.flagMode.classList.toggle('is-active', flagMode);
    }
  }

  if (hud.difficulty && hud.difficulty.value !== game.difficultyId) {
    hud.difficulty.value = game.difficultyId;
  }

  setText(hud.message, phaseMessage(game, flagMode));
}

/**
 * 一次性完整渲染（建盘 + 同步 + HUD）。
 *
 * @param {{ cache: ReturnType<typeof mountBoard>|null, hud: ReturnType<typeof collectHud>, game: import('../core/game.js').Game, cursorIndex: number, flagMode: boolean }} ctx
 * @returns {ReturnType<typeof mountBoard>} 最新的缓存
 */
export function renderAll(ctx) {
  const { hud, game, cursorIndex, flagMode } = ctx;
  let { cache } = ctx;

  if (!cache || !syncBoard(cache, game, cursorIndex)) {
    cache = mountBoard(hud.board, game.board);
    syncBoard(cache, game, cursorIndex);
  }
  syncHud(hud, game, flagMode);
  return cache;
}
