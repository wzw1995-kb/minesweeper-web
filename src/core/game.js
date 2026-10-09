/**
 * 游戏状态机（T09 ~ T12）—— 纯逻辑，零 DOM 依赖
 *
 * 覆盖需求：REQ-F-001 ~ 003、006、012、019、022 ~ 029、031 ~ 045、REQ-N-004、REQ-N-006
 *
 * 设计要点（见 spec/02-design.md §3、§4）：
 *   - 依赖全部注入：rng / now / storage，保证测试完全确定性（REQ-N-006）
 *   - 延迟布雷（ADR-07）：READY 状态下棋盘没有雷，首点时才布雷，天然满足 REQ-F-004
 *   - 计时基于时间戳差值而非累加计数，撤销不影响它（REQ-F-034）
 *   - 撤销采用全量快照栈，最多 UNDO_LIMIT 份（REQ-F-035）
 *   - dirty 是**粘性**的：一旦用过撤销/提示就永远为真，且不进快照（REQ-F-036、043）
 */
import {
  CellState,
  GameState,
  MAX_TIME,
  UNDO_LIMIT,
  DEFAULT_DIFFICULTY,
  resolveDifficulty,
  isTerminal,
} from './constants.js';
import {
  createEmptyBoard,
  placeMines,
  revealCell,
  toggleFlag as toggleFlagOnBoard,
  chordCell,
  isWin,
  applyWinReveal,
  cloneBoard,
  remainingMines as remainingMinesOnBoard,
  isValidIndex,
} from './board.js';
import { defaultRng, pickOne } from './rng.js';
import { createSafeStorage, createBestTimesStore } from './storage.js';

/**
 * @typedef {{ reason: string }} ChangeMeta
 * @typedef {{ onChange?: (game: Game, meta: ChangeMeta) => void }} Hooks
 */

export class Game {
  #difficulty;
  #rng;
  #now;
  #store;
  #hooks;

  #board;
  #state = GameState.READY;
  #startedAt = null;
  #frozenAt = null;
  #dirty = false;
  #undoStack = [];
  #recordUpdated = false;
  #explodedIndex = null;

  /**
   * @param {{
   *   difficultyId?: string,
   *   rng?: () => number,
   *   now?: () => number,
   *   storage?: unknown,
   *   hooks?: Hooks
   * }} [options]
   */
  constructor(options = {}) {
    const { difficultyId = DEFAULT_DIFFICULTY, rng = defaultRng, now = Date.now, storage, hooks = {} } = options;

    this.#difficulty = resolveDifficulty(difficultyId);
    this.#rng = rng;
    this.#now = now;
    this.#hooks = hooks;
    this.#store = createBestTimesStore(createSafeStorage(storage));
    this.#board = createEmptyBoard(this.#difficulty.width, this.#difficulty.height, this.#difficulty.mines);
  }

  // ───────────────────────── 只读状态 ─────────────────────────

  /** 当前难度定义 */
  get difficulty() {
    return this.#difficulty;
  }

  get difficultyId() {
    return this.#difficulty.id;
  }

  /** 当前棋盘（不可变；调用方不得就地修改） */
  get board() {
    return this.#board;
  }

  get state() {
    return this.#state;
  }

  get isOver() {
    return isTerminal(this.#state);
  }

  /** 是否处于 READY（已建盘、未布雷、未计时） */
  get isReady() {
    return this.#state === GameState.READY;
  }

  /**
   * 已用秒数（REQ-F-026 ~ 029）。
   * 基于时间戳差值计算，因此后台标签页节流不会丢秒。
   */
  get elapsed() {
    if (this.#frozenAt !== null) return this.#frozenAt;
    if (this.#startedAt === null) return 0;
    const delta = Math.floor((this.#now() - this.#startedAt) / 1000);
    return Math.min(Math.max(delta, 0), MAX_TIME);
  }

  /** 本局是否用过撤销或提示（粘性，REQ-F-036、043） */
  get dirty() {
    return this.#dirty;
  }

  /** 是否可以撤销（REQ-F-033） */
  get canUndo() {
    return !this.isOver && this.#undoStack.length > 0;
  }

  /** 当前撤销栈深度（测试/调试用） */
  get undoDepth() {
    return this.#undoStack.length;
  }

  /** 剩余雷数（REQ-F-017） */
  get remainingMines() {
    return remainingMinesOnBoard(this.#board);
  }

  /** 当前难度的最佳成绩，无记录为 null（REQ-F-044） */
  get bestTime() {
    return this.#store.get(this.#difficulty.id);
  }

  /** 本局是否刷新了最佳成绩（供 UI 提示） */
  get recordUpdated() {
    return this.#recordUpdated;
  }

  /** 存储是否已降级为内存（REQ-F-045，UI 可据此提示用户） */
  get storageDegraded() {
    return this.#store.degraded === true;
  }

  /**
   * 被踩中的雷的索引（仅 LOST 后非空），供 UI 高亮爆炸点（REQ-F-024）。
   * @returns {number|null}
   */
  get explodedIndex() {
    return this.#explodedIndex;
  }

  // ───────────────────────── 命令 ─────────────────────────

  /**
   * 开新局（REQ-F-002、REQ-F-003）：棋盘清空、计时归零、dirty 重置、撤销栈清空。
   * @param {string} [difficultyId] 省略则沿用当前难度
   */
  newGame(difficultyId) {
    if (difficultyId !== undefined) {
      this.#difficulty = resolveDifficulty(difficultyId);
    }
    this.#board = createEmptyBoard(this.#difficulty.width, this.#difficulty.height, this.#difficulty.mines);
    this.#state = GameState.READY;
    this.#startedAt = null;
    this.#frozenAt = null;
    this.#dirty = false;
    this.#undoStack = [];
    this.#recordUpdated = false;
    this.#explodedIndex = null;
    this.#notify('new-game');
  }

  /**
   * 翻开一格（REQ-F-007 ~ 012）。
   * @param {number} index
   * @returns {boolean} 是否产生了变化
   */
  reveal(index) {
    return this.#doReveal(index, 'reveal');
  }

  /**
   * 标记循环（REQ-F-013 ~ 016）。注意：插旗**不会**启动计时（REQ-F-027）。
   * @param {number} index
   * @returns {boolean}
   */
  toggleFlag(index) {
    if (this.isOver) return false;
    if (!isValidIndex(this.#board, index)) return false;

    const result = toggleFlagOnBoard(this.#board, index);
    if (!result.changed) return false; // REQ-F-016：已翻开格拒绝标记

    this.#pushSnapshot();
    this.#board = result.board;
    this.#notify('flag');
    return true;
  }

  /**
   * 和弦展开（REQ-F-018 ~ 021）。
   * @param {number} index
   * @returns {boolean}
   */
  chord(index) {
    if (this.isOver) return false;
    if (!this.#board.minesPlaced) return false;
    if (!isValidIndex(this.#board, index)) return false;

    const result = chordCell(this.#board, index);
    if (!result.changed && !result.hitMine) return false;

    this.#pushSnapshot();
    this.#board = result.board;

    if (result.hitMine) {
      this.#board = result.board;
      this.#explodedIndex = result.hitIndex;
      this.#finish(GameState.LOST);
      return true;
    }
    if (isWin(this.#board)) {
      this.#finish(GameState.WON);
      return true;
    }
    this.#notify('chord');
    return true;
  }

  /**
   * 撤销（REQ-F-031 ~ 036）。
   * 恢复棋盘与状态，但**不触碰**计时器与 dirty（不变量）。
   * @returns {boolean}
   */
  undo() {
    if (this.isOver) return false; // REQ-F-025：终局锁定
    if (this.#undoStack.length === 0) return false; // REQ-F-033

    const snapshot = this.#undoStack.pop();
    this.#board = snapshot.board;
    this.#state = snapshot.state;
    this.#dirty = true; // REQ-F-036
    this.#notify('undo');
    return true;
  }

  /**
   * 提示：随机翻开一个安全格（REQ-F-037 ~ 040）。
   * 先把 dirty 置位再翻开，确保"提示直接取胜"时成绩不会被误记（REQ-F-043）。
   * @returns {boolean}
   */
  hint() {
    if (this.isOver) return false;

    const candidates = [];
    for (let i = 0; i < this.#board.cells.length; i += 1) {
      const cell = this.#board.cells[i];
      if (cell.mine) continue;
      if (cell.state === CellState.HIDDEN || cell.state === CellState.QUESTION) candidates.push(i);
    }
    if (candidates.length === 0) return false; // REQ-F-039

    const index = pickOne(candidates, this.#rng);
    const wasDirty = this.#dirty;
    this.#dirty = true; // REQ-F-040

    const changed = this.#doReveal(index, 'hint');
    if (!changed) {
      this.#dirty = wasDirty; // 翻开未生效则回滚 dirty，避免"点了提示却什么都没发生还被判脏"
      return false;
    }
    return true;
  }

  // ───────────────────────── 内部实现 ─────────────────────────

  /**
   * 翻开的统一实现。先在一份"工作棋盘"上做纯计算，确认有变化后才提交并压栈。
   * @param {number} index
   * @param {string} reason 通知原因（'reveal' | 'hint'）
   * @returns {boolean}
   */
  #doReveal(index, reason) {
    if (this.isOver) return false; // REQ-F-025
    if (!isValidIndex(this.#board, index)) return false;

    // ADR-07 延迟布雷：首次翻开时才布雷，且保证首点安全（REQ-F-004）
    const working = this.#board.minesPlaced ? this.#board : placeMines(this.#board, index, this.#rng);
    const result = revealCell(working, index);

    if (!result.changed && !result.hitMine) return false;

    this.#pushSnapshot(); // REQ-F-031：快照保存的是**操作前**的状态

    if (result.hitMine) {
      this.#board = result.board;
      this.#explodedIndex = result.hitIndex;
      this.#finish(GameState.LOST); // REQ-F-012
      return true;
    }

    this.#board = result.board;

    if (this.#startedAt === null) {
      this.#startedAt = this.#now(); // REQ-F-027：首次成功翻开才开始计时
    }
    if (this.#state === GameState.READY) {
      this.#state = GameState.PLAYING; // REQ-F-007：首次成功翻开即进入进行中
    }

    if (isWin(this.#board)) {
      this.#finish(GameState.WON); // REQ-F-022
      return true;
    }

    this.#notify(reason);
    return true;
  }

  /** 终局结算：补旗/冻结计时/记录成绩（REQ-F-023、024、029、042、043） */
  #finish(state) {
    if (state === GameState.WON) {
      this.#board = applyWinReveal(this.#board); // REQ-F-023
    }

    // 冻结计时（REQ-F-029）——必须在改动 state 之前取当前读数
    this.#frozenAt = this.elapsed;
    this.#state = state;

    if (state === GameState.WON && !this.#dirty) {
      // REQ-F-042 / REQ-F-043：只有干净局才写成绩
      this.#recordUpdated = this.#store.update(this.#difficulty.id, this.#frozenAt);
    }

    this.#notify('end');
  }

  /** 压入快照并执行上限淘汰（REQ-F-035） */
  #pushSnapshot() {
    this.#undoStack.push({ board: cloneBoard(this.#board), state: this.#state });
    while (this.#undoStack.length > UNDO_LIMIT) {
      this.#undoStack.shift();
    }
  }

  #notify(reason) {
    if (typeof this.#hooks.onChange === 'function') {
      this.#hooks.onChange(this, { reason });
    }
  }
}

export { GameState, CellState };
