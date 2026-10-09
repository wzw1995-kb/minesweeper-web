/**
 * 应用装配（T18）
 *
 * 覆盖需求：REQ-F-002、030
 *
 * 这里是把各层接起来的唯一地方：core 的 Game + ui 的 render/controller/theme。
 * 它也是唯一允许直接访问 window / document 的模块。
 */
import { Game } from '../core/game.js';
import { DIFFICULTIES, DIFFICULTY_ORDER, DEFAULT_DIFFICULTY, GameState } from '../core/constants.js';
import { createSafeStorage } from '../core/storage.js';
import { collectHud, renderAll, syncHud } from './render.js';
import { attachController } from './controller.js';
import { createThemeController } from './theme.js';
import { GlobalAction } from './input.js';

/** 计时器轮询间隔：250ms 足以让秒跳变跟手，开销可忽略 */
const TICK_MS = 250;

/** 访问 localStorage 本身就可能抛错（隐私模式），必须包起来 */
function readLocalStorage() {
  try {
    return window.localStorage ?? undefined;
  } catch {
    return undefined;
  }
}

function prefersDark() {
  try {
    return window.matchMedia?.('(prefers-color-scheme: dark)').matches === true;
  } catch {
    return false;
  }
}

function bootstrap() {
  const doc = document;
  const hud = collectHud(doc);

  // ── 难度下拉（REQ-F-001）──
  for (const id of DIFFICULTY_ORDER) {
    const diff = DIFFICULTIES[id];
    const option = doc.createElement('option');
    option.value = id;
    option.textContent = `${diff.label}　${diff.width}×${diff.height}　${diff.mines} 雷`;
    hud.difficulty.appendChild(option);
  }

  const rawStorage = readLocalStorage();
  const themeStorage = createSafeStorage(rawStorage);

  /** 交互层持有的瞬时状态 */
  let flagMode = false;
  let cursorIndex = 0;
  let boardCache = null;
  let controller = null;

  const game = new Game({
    difficultyId: DEFAULT_DIFFICULTY,
    storage: rawStorage,
    hooks: {
      onChange: (_game, meta) => {
        if (meta.reason === 'new-game' && controller) controller.reset();
        draw();
      },
    },
  });

  /** 唯一的重绘入口 */
  function draw() {
    boardCache = renderAll({ cache: boardCache, hud, game, cursorIndex, flagMode });
    if (hud.storageWarning) hud.storageWarning.hidden = !game.storageDegraded;
  }

  // ── 主题（REQ-F-057 ~ 059）──
  const theme = createThemeController({
    rootEl: doc.documentElement,
    storage: themeStorage,
    prefersDark: prefersDark(),
    buttonEl: hud.theme,
  });
  theme.init();

  // ── 棋盘交互（REQ-F-021、046 ~ 049、053、054、056）──
  controller = attachController({
    boardEl: hud.board,
    doc,
    getGame: () => game,
    isFlagMode: () => flagMode,
    onCursorChanged: (index) => {
      cursorIndex = index;
      draw();
    },
    onGlobalAction: (action) => {
      if (action === GlobalAction.UNDO) game.undo();
      else if (action === GlobalAction.HINT) game.hint();
      else if (action === GlobalAction.NEW_GAME) game.newGame();
    },
  });

  // ── 状态栏按钮（REQ-F-030）──
  hud.face.addEventListener('click', () => game.newGame());
  hud.undo.addEventListener('click', () => game.undo());
  hud.hint.addEventListener('click', () => game.hint());
  hud.difficulty.addEventListener('change', () => game.newGame(hud.difficulty.value));
  hud.theme.addEventListener('click', () => theme.toggle());
  hud.flagMode.addEventListener('click', () => {
    flagMode = !flagMode;
    draw();
  });

  // ── 计时轮询（REQ-F-027、029）──
  // 计时读数由 Game 按时间戳差值计算，这里只负责把变化刷到界面；
  // syncHud 内部做了值比较，因此不会产生无谓的 DOM 写入（REQ-N-003）。
  setInterval(() => {
    if (game.state === GameState.WON || game.state === GameState.LOST) return;
    syncHud(hud, game, flagMode);
  }, TICK_MS);

  draw();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', bootstrap, { once: true });
} else {
  bootstrap();
}
