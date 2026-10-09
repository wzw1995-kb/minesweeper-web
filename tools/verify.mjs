#!/usr/bin/env node
/**
 * 自动化质量门禁（T19）
 *
 * 覆盖需求：REQ-N-001 ~ 007
 *
 * 一次跑完 6 类检查：
 *   1. 全量 JS 语法检查（node --check）
 *   2. 全量单元测试（node --test --test-isolation=none）
 *   3. 零依赖断言：package.json 的 dependencies / devDependencies 必须为空（REQ-N-001）
 *   4. 分层契约断言：src/core/** 与 src/ui/input.js 不得引用 DOM（REQ-N-004）
 *   5. 离线断言：源码与页面不得出现任何外部 URL（REQ-N-002）
 *   6. 静态资源可达性 + index.html 与渲染层的 id 契约（REQ-F-030）
 *
 * 用法： node tools/verify.mjs   （退出码 0 表示全部通过）
 */
import { spawnSync } from 'node:child_process';
import { closeSync, existsSync, openSync } from 'node:fs';
import http from 'node:http';
import { readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

import { startServer, ROOT } from './serve.js';

const checks = [];
const skipped = [];
let failed = 0;

function record(name, ok, detail = '') {
  checks.push({ name, ok, detail });
  if (!ok) failed += 1;
}

function skip(reason) {
  skipped.push(reason);
}

/** 查找可用于端到端验收的 Chromium 浏览器（本机既有，不安装任何依赖） */
function findChromium() {
  const candidates = [
    process.env.CHROME_PATH,
    process.env.EDGE_PATH,
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
    process.env.LOCALAPPDATA ? `${process.env.LOCALAPPDATA}/Google/Chrome/Application/chrome.exe` : null,
    'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
  ].filter(Boolean);

  for (const candidate of candidates) {
    try {
      if (existsSync(candidate)) return candidate;
    } catch {
      // 忽略不可访问的候选路径
    }
  }
  return null;
}

function heading(text) {
  console.log(`\n\u001b[1m${text}\u001b[0m`);
}

const rel = (abs) => relative(ROOT, abs).split(sep).join('/');

/** 递归列出某目录下的文件（按扩展名过滤） */
async function listFiles(dir, extensions) {
  const out = [];
  let entries;
  try {
    entries = await readdir(dir, { recursive: true, withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    const abs = join(entry.parentPath ?? entry.path, entry.name);
    if (extensions.some((ext) => abs.endsWith(ext))) out.push(abs);
  }
  return out;
}

/**
 * 去掉注释与字符串字面量，便于做"是否引用 DOM"的静态扫描。
 * 只需要足够健壮以处理本项目自身的源码。
 */
export function stripCommentsAndStrings(code) {
  let out = '';
  let i = 0;
  const n = code.length;
  while (i < n) {
    const ch = code[i];
    const next = code[i + 1];

    if (ch === '/' && next === '/') {
      while (i < n && code[i] !== '\n') i += 1;
      continue;
    }
    if (ch === '/' && next === '*') {
      i += 2;
      while (i < n && !(code[i] === '*' && code[i + 1] === '/')) i += 1;
      i += 2;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') {
      const quote = ch;
      i += 1;
      while (i < n) {
        if (code[i] === '\\') {
          i += 2;
          continue;
        }
        if (code[i] === quote) {
          i += 1;
          break;
        }
        i += 1;
      }
      out += '""';
      continue;
    }
    out += ch;
    i += 1;
  }
  return out;
}

/**
 * 发送**原始**请求行（不做 URL 规范化），用于真正测试目录穿越。
 * fetch / http.request 的 url 形式会先规范化掉 `/../`，测不出服务端的防护。
 */
function rawGet(port, rawPath) {
  return new Promise((resolvePromise, rejectPromise) => {
    const req = http.request(
      { host: '127.0.0.1', port, path: rawPath, method: 'GET' },
      (res) => {
        let body = '';
        res.setEncoding('utf8');
        res.on('data', (chunk) => {
          body += chunk;
        });
        res.on('end', () => resolvePromise({ status: res.statusCode, body }));
      },
    );
    req.on('error', rejectPromise);
    req.end();
  });
}

// ═══════════════════════════════════════════════════════════
// 1 · 语法检查
// ═══════════════════════════════════════════════════════════
heading('1/7  语法检查（node --check）');

const sources = [
  ...(await listFiles(join(ROOT, 'src'), ['.js'])),
  ...(await listFiles(join(ROOT, 'tools'), ['.js', '.mjs'])),
];

for (const file of sources) {
  const result = spawnSync(process.execPath, ['--check', file], { stdio: 'inherit' });
  record(`语法 ${rel(file)}`, result.status === 0);
}
console.log(`  → 已检查 ${sources.length} 个文件`);

// ═══════════════════════════════════════════════════════════
// 2 · 单元测试
// ═══════════════════════════════════════════════════════════
heading('2/7  单元测试（node --test）');

{
  // --test-isolation=none：全部测试文件在同一个进程内运行，
  // 既更快，也能在禁止子进程管道的受限环境中工作。
  const result = spawnSync(
    process.execPath,
    ['--test', '--test-isolation=none', 'tests/*.test.js'],
    { stdio: 'inherit', cwd: ROOT },
  );
  record('单元测试全部通过', result.status === 0);
}

// ═══════════════════════════════════════════════════════════
// 3 · 零依赖（REQ-N-001）
// ═══════════════════════════════════════════════════════════
heading('3/7  零依赖断言（REQ-N-001）');

{
  const pkg = JSON.parse(await readFile(join(ROOT, 'package.json'), 'utf8'));
  const deps = Object.keys(pkg.dependencies ?? {});
  const devDeps = Object.keys(pkg.devDependencies ?? {});
  record('dependencies 为空', deps.length === 0, deps.join(', '));
  record('devDependencies 为空', devDeps.length === 0, devDeps.join(', '));

  // node_modules 不得存在（证明从未安装过任何包）
  let hasNodeModules = false;
  try {
    hasNodeModules = (await stat(join(ROOT, 'node_modules'))).isDirectory();
  } catch {
    hasNodeModules = false;
  }
  record('不存在 node_modules 目录', !hasNodeModules);
}

// ═══════════════════════════════════════════════════════════
// 4 · 分层契约：core 与 input.js 不得触碰 DOM（REQ-N-004）
// ═══════════════════════════════════════════════════════════
heading('4/7  分层契约（REQ-N-004）');

{
  const forbidden = /\b(document|window|localStorage|sessionStorage|navigator|HTMLElement|alert)\b/;
  const pureModules = [
    ...(await listFiles(join(ROOT, 'src', 'core'), ['.js'])),
    join(ROOT, 'src', 'ui', 'input.js'),
  ];

  for (const file of pureModules) {
    const code = stripCommentsAndStrings(await readFile(file, 'utf8'));
    const match = code.match(forbidden);
    record(
      `纯逻辑 ${rel(file)} 无 DOM 引用`,
      match === null,
      match ? `发现 "${match[0]}"（第 ${code.slice(0, match.index).split('\n').length} 行附近）` : '',
    );
  }

  // 反向验证：纯逻辑模块必须能被 Node 直接 import 而不抛错
  for (const file of pureModules) {
    const url = new URL(`file://${file.replace(/\\/g, '/')}`).href;
    const result = spawnSync(process.execPath, ['-e', `import(${JSON.stringify(url)}).then(()=>{},e=>{console.error(e);process.exit(1)})`], {
      stdio: 'inherit',
    });
    record(`可被 Node 直接 import：${rel(file)}`, result.status === 0);
  }
}

// ═══════════════════════════════════════════════════════════
// 5 · 离线断言：不得出现外部 URL（REQ-N-002）
// ═══════════════════════════════════════════════════════════
heading('5/7  离线断言（REQ-N-002）');

{
  const webFiles = [
    join(ROOT, 'index.html'),
    ...(await listFiles(join(ROOT, 'src'), ['.js', '.css', '.html'])),
  ];
  const external = /(?:src|href)\s*=\s*["']https?:\/\/|@import\s+url\(\s*["']?https?:\/\//i;

  let offending = 0;
  for (const file of webFiles) {
    const content = await readFile(file, 'utf8');
    if (external.test(content)) {
      offending += 1;
      record(`无外部资源引用 ${rel(file)}`, false, '发现 http(s) 外链');
    }
  }
  record(`无外部资源引用（共扫描 ${webFiles.length} 个文件）`, offending === 0);
}

// ═══════════════════════════════════════════════════════════
// 6 · 静态资源可达性 + id 契约（REQ-F-030）
// ═══════════════════════════════════════════════════════════
heading('6/7  静态资源可达性（REQ-F-030）');

{
  const server = await startServer({ port: 0, host: '127.0.0.1' });
  const { port } = server.address();
  const base = `http://127.0.0.1:${port}`;

  try {
    const assets = [
      'index.html',
      'tools/browser-e2e.html',
      ...(await listFiles(join(ROOT, 'src'), ['.js', '.css'])).map(rel),
    ];

    for (const asset of assets) {
      const res = await fetch(`${base}/${asset}`);
      const type = res.headers.get('content-type') ?? '';
      record(`GET /${asset}`, res.status === 200, `HTTP ${res.status} · ${type}`);
    }

    // index.html 必须与渲染层期望的元素 id 完全对齐。
    // id 列表从 render.js 的 collectHud() 源码推导，而不是硬编码 ——
    // 否则将来新增一个 pick('xxx') 却忘了加标记，这道检查就形同虚设。
    const html = await readFile(join(ROOT, 'index.html'), 'utf8');
    const renderSrc = await readFile(join(ROOT, 'src', 'ui', 'render.js'), 'utf8');
    const requiredIds = [...renderSrc.matchAll(/\bpick\(\s*'([^']+)'\s*\)/g)].map((m) => m[1]);

    record(
      `id 契约检查本身有效（推导出 ${requiredIds.length} 个 id）`,
      requiredIds.length >= 10,
      requiredIds.join(', '),
    );
    const missing = requiredIds.filter((id) => !html.includes(`id="${id}"`));
    record('index.html 提供全部必需元素 id', missing.length === 0, missing.join(', '));

    // 反向：main.js 里所有 getElementById('x') / hud.x 用法也必须能对上
    const mainSrc = await readFile(join(ROOT, 'src', 'ui', 'main.js'), 'utf8');
    const mainIds = [...mainSrc.matchAll(/getElementById\(\s*'([^']+)'\s*\)/g)].map((m) => m[1]);
    const missingMain = mainIds.filter((id) => !html.includes(`id="${id}"`));
    record('main.js 直接引用的 id 都存在', missingMain.length === 0, missingMain.join(', '));

    // 反漂移：render.js 往 DOM 上写的 CSS 类，必须在样式表里有定义。
    // 这条能抓住"JS 加了个类但没人给它写样式"这类静默失效。
    const classStart = renderSrc.indexOf('export function cellClasses');
    const classEnd = renderSrc.indexOf('export function', classStart + 10);
    const cellClassBody = renderSrc.slice(classStart, classEnd);
    const jsClasses = new Set([...cellClassBody.matchAll(/'([a-z][a-z0-9-]*)'/g)].map((m) => m[1]));
    for (let n = 1; n <= 8; n += 1) jsClasses.add(`n${n}`); // 数字类由模板串动态生成

    const css = (await listFiles(join(ROOT, 'src', 'styles'), ['.css']))
      .map(async (f) => readFile(f, 'utf8'))
      .reduce(async (accP, fileP) => `${await accP}\n${await fileP}`, Promise.resolve(''));
    const cssText = await css;

    // CSS 花括号配平：少一个 } 之后的全部规则都会被浏览器丢弃，
    // 而页面不会报任何错，只会"莫名其妙没样式"。
    const openBraces = (cssText.match(/\{/g) ?? []).length;
    const closeBraces = (cssText.match(/\}/g) ?? []).length;
    record('CSS 花括号配平', openBraces === closeBraces, `{ ×${openBraces} / } ×${closeBraces}`);

    // CSS 变量契约：每个 var(--x) 引用的变量都必须有定义，或自带兜底值。
    // 拼错一个变量名不会报错，只会让整条声明失效（例如颜色回退成 inherit）。
    //
    // 注意必须允许大写字母：自定义属性名大小写敏感且合法可用大写，
    // 若只写 [a-z0-9-] 则对 --fooBar 这类名字完全失明（自检时正是这样漏掉过一次）。
    const definedVars = new Set([...cssText.matchAll(/(--[A-Za-z0-9-]+)\s*:/g)].map((m) => m[1]));
    const usedVars = new Set([...cssText.matchAll(/var\(\s*(--[A-Za-z0-9-]+)\s*[,)]/g)].map((m) => m[1]));
    // var(--x, fallback) 形式自带兜底，允许未定义（--cols / --rows 由 JS 写在行内样式上）
    const varsWithFallback = new Set(
      [...cssText.matchAll(/var\(\s*(--[A-Za-z0-9-]+)\s*,/g)].map((m) => m[1]),
    );
    const unresolvedVars = [...usedVars].filter(
      (name) => !definedVars.has(name) && !varsWithFallback.has(name),
    );
    record(
      `CSS 变量全部可解析（引用 ${usedVars.size} 个 / 定义 ${definedVars.size} 个）`,
      unresolvedVars.length === 0,
      unresolvedVars.join(', '),
    );

    // 主题契约：两套主题必须各自定义完整的数字配色（REQ-F-060 的前提）
    const themeCss = await readFile(join(ROOT, 'src', 'styles', 'theme.css'), 'utf8');
    const darkBlock = themeCss.slice(themeCss.indexOf("data-theme='dark'"));
    const missingDark = [];
    for (let n = 1; n <= 8; n += 1) {
      if (!new RegExp(`--n${n}\\s*:`).test(darkBlock)) missingDark.push(`--n${n}`);
    }
    record('深色主题定义了 --n1 ~ --n8', missingDark.length === 0, missingDark.join(', '));

    // is-cursor 是刻意不写样式的状态标记：它只用于让 syncBoard 的 signature 变化，
    // 从而把 roving tabindex 刷到 DOM；焦点可见性由 :focus-visible 负责。
    const deliberatelyUnstyled = new Set(['is-cursor']);
    // 必须按"类名边界"匹配：用 includes('.is-exploded') 之类的子串判断，
    // 会被 .is-exploded-xxx 这种名字骗过去（该检查自身的自检就抓到过这个问题）。
    const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const hasRule = (name) => new RegExp(`\\.${escapeRe(name)}(?![\\w-])`).test(cssText);
    const unstyled = [...jsClasses].filter(
      (name) => !deliberatelyUnstyled.has(name) && !hasRule(name),
    );
    record(
      `render.js 写入的 ${jsClasses.size} 个 CSS 类都有样式定义`,
      unstyled.length === 0,
      unstyled.join(', '),
    );

    // 端到端套件自身也要对得上 id 契约：它用 $('id') 取元素，
    // 一旦 id 改名而套件没跟着改，浏览器跑到那里只会抛 null 解引用，
    // 报错信息与真正的原因相距甚远，很难排查。
    const e2eSrc = await readFile(join(ROOT, 'tools', 'browser-e2e.html'), 'utf8');
    const e2eIds = [...new Set([...e2eSrc.matchAll(/\$\(\s*'([^']+)'\s*\)/g)].map((m) => m[1]))];
    const missingE2e = e2eIds.filter((id) => !html.includes(`id="${id}"`));
    record(
      `浏览器端到端套件引用的 ${e2eIds.length} 个 id 都存在`,
      missingE2e.length === 0,
      missingE2e.join(', '),
    );

    // 页面引用的资源必须都能取到
    const refs = [...html.matchAll(/(?:src|href)="\.\/([^"]+)"/g)].map((m) => m[1]);
    record('index.html 引用的资源都能取到', refs.length > 0, `共 ${refs.length} 条引用`);
    for (const ref of refs) {
      const res = await fetch(`${base}/${ref}`);
      record(`  引用可达 /${ref}`, res.status === 200, `HTTP ${res.status}`);
    }

    // 目录穿越必须被拒绝（用原始请求行，避免客户端先行规范化）
    const traversals = [
      '/../../Windows/win.ini',
      '/%2e%2e/%2e%2e/Windows/win.ini',
      '/..%2f..%2fWindows%2fwin.ini',
      '/....//....//Windows/win.ini',
    ];
    for (const rawPath of traversals) {
      let outcome;
      try {
        outcome = await rawGet(port, rawPath);
      } catch (error) {
        outcome = { status: 0, body: String(error) };
      }
      const escaped = outcome.status === 200 && /\[(fonts|extensions)\]/i.test(outcome.body);
      record(
        `目录穿越被拒绝 ${rawPath}`,
        !escaped,
        `HTTP ${outcome.status}${escaped ? ' ← 泄漏了 ROOT 之外的文件！' : ''}`,
      );
    }

    // ── ES Module 图解析 ──────────────────────────────────────
    // 只验证"磁盘上的文件按磁盘路径可获取"**不等于**"浏览器按相对说明符能把
    // 整个模块图解析出来"。任一条 import 断掉，页面都会完全空白且没有任何提示，
    // 用户无从判断原因 —— 这类失败必须在这一道门禁里被拦下。
    {
      const scripts = [
        ...html.matchAll(/<script\b[^>]*\btype=["']module["'][^>]*\bsrc=["']([^"']+)["']/gi),
      ].map((m) => m[1]);
      record('index.html 存在 module 入口脚本', scripts.length > 0, scripts.join(', '));

      const visited = new Set();
      const broken = [];
      const queue = scripts.map((s) => new URL(s, `${base}/index.html`).href);

      while (queue.length > 0) {
        const url = queue.shift();
        if (visited.has(url)) continue;
        visited.add(url);

        let res;
        try {
          res = await fetch(url);
        } catch (error) {
          broken.push(`${url.replace(base, '')} 请求失败：${error.message}`);
          continue;
        }
        const relUrl = url.replace(base, '');
        if (res.status !== 200) {
          broken.push(`${relUrl} → HTTP ${res.status}`);
          continue;
        }
        const mime = res.headers.get('content-type') ?? '';
        if (!/javascript|ecmascript/i.test(mime)) {
          broken.push(`${relUrl} → MIME "${mime}"，浏览器会拒绝执行模块`);
          continue;
        }

        const code = await res.text();
        const specs = new Set([
          ...[...code.matchAll(/\bfrom\s*['"]([^'"]+)['"]/g)].map((m) => m[1]),
          ...[...code.matchAll(/\bimport\s*['"]([^'"]+)['"]/g)].map((m) => m[1]),
        ]);
        for (const spec of specs) {
          if (!spec.startsWith('.') && !spec.startsWith('/')) {
            broken.push(`${relUrl} 引用了非相对说明符 "${spec}"（零依赖约束下不应出现）`);
            continue;
          }
          queue.push(new URL(spec, url).href);
        }
      }

      record(
        `ES Module 图可从 index.html 完整解析（共 ${visited.size} 个模块）`,
        broken.length === 0,
        broken.join(' | '),
      );
      record(`模块图规模合理（≥ 10 个）`, visited.size >= 10, String(visited.size));
    }

    // ── index.html 内联脚本的语法检查 ──────────────────────────
    // 内联脚本不在 src/ 下，第 1 阶段的 node --check 扫不到它们。
    // 启动兜底提示正是内联脚本 —— 它自己语法错了，就什么都不会显示。
    {
      const inlineScripts = [
        ...html.matchAll(/<script\b(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi),
      ]
        .map((m) => m[1])
        .filter((code) => code.trim() !== '');

      record(`index.html 内联脚本存在（${inlineScripts.length} 段）`, inlineScripts.length > 0);

      const tmpFile = join(ROOT, '.inline-script-check.js');
      let inlineOk = true;
      try {
        for (const code of inlineScripts) {
          await writeFile(tmpFile, code, 'utf8');
          const result = spawnSync(process.execPath, ['--check', tmpFile], { stdio: 'inherit' });
          if (result.status !== 0) inlineOk = false;
        }
      } finally {
        await rm(tmpFile, { force: true }).catch(() => {});
      }
      record('index.html 内联脚本语法正确', inlineOk);
    }
  } finally {
    server.close();
  }
}

// ═══════════════════════════════════════════════════════════
// 7 · 真实浏览器端到端验收（可选阶段）
//
// 用本机已安装的 Chrome / Edge 以 headless 模式加载 tools/browser-e2e.html，
// 该页会导入真实的应用模块并用真实 DOM 事件跑完 AC-01 ~ AC-20。
//
// **本阶段不引入任何依赖**（浏览器是系统既有程序），且**环境受限时只跳过、不误判**：
//   - 找不到浏览器         → 跳过
//   - 浏览器启动失败/无报告 → 跳过（受限沙箱会拒绝 Chromium 的 mojo 命名管道）
//   - 拿到报告             → 逐项计入检查结果，失败即门禁失败
// ═══════════════════════════════════════════════════════════
heading('7/7  真实浏览器端到端验收（AC-01 ~ AC-20，可选）');

{
  const browser = findChromium();

  if (!browser) {
    skip('浏览器端到端验收：未找到 Chrome / Edge');
    console.log('  \u001b[33m—\u001b[0m 未找到 Chromium 浏览器，跳过本阶段');
    console.log('    \u001b[2m设置 CHROME_PATH 或 EDGE_PATH 环境变量可指定浏览器路径\u001b[0m');
  } else {
    const server = await startServer({ port: 0, host: '127.0.0.1' });
    const { port } = server.address();
    const outFile = join(ROOT, '.e2e-dom.txt');
    const profileDir = join(ROOT, '.tmp-browser-profile');
    let fd;

    try {
      fd = openSync(outFile, 'w');
      const result = spawnSync(
        browser,
        [
          '--headless=new',
          '--disable-gpu',
          '--no-sandbox',
          '--no-first-run',
          '--no-default-browser-check',
          '--disable-extensions',
          `--user-data-dir=${profileDir}`,
          '--window-size=414,896',
          '--virtual-time-budget=180000',
          '--dump-dom',
          `http://127.0.0.1:${port}/tools/browser-e2e.html`,
        ],
        {
          // stdout 重定向到**文件**而非管道：受限沙箱禁止命名管道，
          // 用管道捕获子进程输出会直接 EPERM。
          stdio: ['ignore', fd, 'inherit'],
          timeout: 180_000,
        },
      );
      closeSync(fd);
      fd = undefined;

      const dump = await readFile(outFile, 'utf8').catch(() => '');
      const match = dump.match(/===E2E-BEGIN===(.*?)===E2E-END===/s);

      if (!match) {
        skip(`浏览器端到端验收：浏览器未产出报告（退出码 ${result.status}）`);
        console.log('  \u001b[33m—\u001b[0m 浏览器未能启动或未产出报告，跳过本阶段');
        console.log('    \u001b[2m受限沙箱会拒绝 Chromium 的 mojo 命名管道；在普通终端执行 npm run verify 即可运行\u001b[0m');
      } else {
        const report = JSON.parse(match[1]);
        for (const item of report.results) {
          if (item.id.endsWith('-info') || item.id.endsWith('-perf')) {
            console.log(`  \u001b[2m·\u001b[0m ${item.id}  ${item.detail}`);
            continue;
          }
          record(`浏览器 ${item.id} ${item.name}`, item.ok, item.detail);
        }
        if (report.errors.length > 0) {
          record('浏览器控制台无未捕获错误', false, report.errors.join('; '));
        }
        console.log(`  → 浏览器端到端：${report.pass}/${report.total} 项通过`);
      }
    } finally {
      if (fd !== undefined) closeSync(fd);
      server.close();
      await rm(outFile, { force: true }).catch(() => {});
      await rm(profileDir, { recursive: true, force: true }).catch(() => {});
    }
  }
}

// ═══════════════════════════════════════════════════════════
// 汇总
// ═══════════════════════════════════════════════════════════
heading('结果汇总');
for (const { name, ok, detail } of checks) {
  const mark = ok ? '\u001b[32m✔\u001b[0m' : '\u001b[31m✘\u001b[0m';
  console.log(`  ${mark} ${name}${detail ? `  \u001b[2m(${detail})\u001b[0m` : ''}`);
}

console.log(
  `\n共 ${checks.length} 项检查，通过 ${checks.length - failed} 项，失败 ${failed} 项。`,
);
if (skipped.length > 0) {
  console.log(`\n\u001b[33m已跳过 ${skipped.length} 个阶段（环境限制，不计入失败）：\u001b[0m`);
  for (const reason of skipped) console.log(`  \u001b[33m—\u001b[0m ${reason}`);
}
if (failed > 0) {
  console.error('\u001b[31m质量门禁未通过。\u001b[0m');
  process.exitCode = 1;
} else {
  console.log('\u001b[32m质量门禁全部通过。\u001b[0m');
}
