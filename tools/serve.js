#!/usr/bin/env node
/**
 * 零依赖静态文件服务器（T01）
 *
 * 覆盖需求：REQ-N-001（不得引入第三方运行时依赖）
 *
 * 用法：
 *   node tools/serve.js            # 监听 127.0.0.1:8123
 *   node tools/serve.js --port 9000
 *   node tools/serve.js --host 0.0.0.0 --port 9000
 */
import http from 'node:http';
import { spawn } from 'node:child_process';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

/** 项目根目录：本文件位于 <root>/tools/serve.js */
export const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));

export const DEFAULT_PORT = 8123;
export const DEFAULT_HOST = '127.0.0.1';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
};

/**
 * 把 URL 路径解析为磁盘绝对路径，并阻止目录穿越。
 * @param {string} urlPath
 * @returns {string|null} 越界时返回 null
 */
export function safeResolve(urlPath) {
  let decoded;
  try {
    decoded = decodeURIComponent(urlPath.split('?')[0].split('#')[0]);
  } catch {
    return null;
  }
  if (decoded.includes('\0')) return null;

  const rel = normalize(decoded).replace(/^([/\\]|\.\.[/\\])+/, '');
  const abs = resolve(join(ROOT, rel));
  if (abs !== ROOT && !abs.startsWith(ROOT + sep)) return null;
  return abs;
}

export function contentTypeFor(filePath) {
  return MIME[extname(filePath).toLowerCase()] ?? 'application/octet-stream';
}

async function resolveFile(abs) {
  try {
    const info = await stat(abs);
    if (info.isDirectory()) {
      const index = join(abs, 'index.html');
      const indexInfo = await stat(index);
      if (indexInfo.isFile()) return { file: index, info: indexInfo };
      return null;
    }
    return { file: abs, info };
  } catch {
    return null;
  }
}

export function createServer() {
  return http.createServer(async (req, res) => {
    const method = req.method ?? 'GET';
    if (method !== 'GET' && method !== 'HEAD') {
      res.writeHead(405, { 'Content-Type': 'text/plain; charset=utf-8', Allow: 'GET, HEAD' });
      res.end('405 Method Not Allowed');
      return;
    }

    const abs = safeResolve(req.url ?? '/');
    const found = abs === null ? null : await resolveFile(abs);

    if (!found) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('404 Not Found');
      return;
    }

    const headers = {
      'Content-Type': contentTypeFor(found.file),
      'Content-Length': String(found.info.size),
      'Cache-Control': 'no-cache',
      'X-Content-Type-Options': 'nosniff',
    };
    res.writeHead(200, headers);
    if (method === 'HEAD') {
      res.end();
      return;
    }
    createReadStream(found.file).pipe(res);
  });
}

export function startServer({ port = DEFAULT_PORT, host = DEFAULT_HOST } = {}) {
  const server = createServer();
  return new Promise((resolvePromise, rejectPromise) => {
    server.once('error', rejectPromise);
    server.listen(port, host, () => {
      server.removeListener('error', rejectPromise);
      resolvePromise(server);
    });
  });
}

/**
 * 用系统默认浏览器打开 URL（零依赖，走各平台自带的打开命令）。
 *
 * 存在意义：本应用无法通过双击 index.html 运行（ES Module 在 file:// 下会被
 * 同源策略拒绝），因此需要给用户一个"双击即可玩"的等价入口。
 *
 * @returns {boolean} 是否成功派发了打开命令
 */
export function openInBrowser(url) {
  try {
    let command;
    let args;
    if (process.platform === 'win32') {
      // 第一个空参数是窗口标题，必须占位，否则 URL 会被 start 当成标题
      command = 'cmd';
      args = ['/c', 'start', '', url];
    } else if (process.platform === 'darwin') {
      command = 'open';
      args = [url];
    } else {
      command = 'xdg-open';
      args = [url];
    }
    // stdio: 'ignore' + detached + unref：不占用本进程、不捕获输出
    spawn(command, args, { detached: true, stdio: 'ignore' }).unref();
    return true;
  } catch {
    return false;
  }
}

function parseArgs(argv) {
  const out = { port: DEFAULT_PORT, host: DEFAULT_HOST, explicitPort: false, open: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--port' || arg === '-p') {
      out.port = Number(argv[i + 1]);
      out.explicitPort = true;
    } else if (arg === '--host' || arg === '-h') {
      out.host = argv[i + 1];
    } else if (arg === '--open' || arg === '-o') {
      out.open = true;
    } else if (/^\d+$/.test(arg)) {
      out.port = Number(arg);
      out.explicitPort = true;
    }
  }
  return out;
}

/**
 * 探测某端口上是否已经跑着**本应用**。
 * 目的：把"端口被占用"这种无用的报错，变成"服务器已经在跑了，直接打开这个地址"的有用提示。
 * @returns {Promise<boolean>}
 */
async function probeIsOurApp(port, host) {
  try {
    const res = await fetch(`http://${host}:${port}/`, { signal: AbortSignal.timeout(1500) });
    if (!res.ok) return false;
    const text = await res.text();
    return text.includes('id="board"') && text.includes('扫雷');
  } catch {
    return false; // 端口上不是 HTTP 服务，或连不上
  }
}

async function main() {
  const { port, host, explicitPort, open } = parseArgs(process.argv.slice(2));
  const shown = host === '0.0.0.0' ? '127.0.0.1' : host;

  const announce = (actualPort, note) => {
    if (note) console.log(note);
    const url = `http://${shown}:${actualPort}/`;
    console.log(`扫雷静态服务器已启动： ${url}`);
    console.log(`服务根目录： ${ROOT}`);
    console.log('按 Ctrl+C 停止。');
    if (open) {
      if (openInBrowser(url)) console.log('已尝试用默认浏览器打开。');
      else console.log(`未能自动打开浏览器，请手动访问上面的地址。`);
    }
  };

  try {
    await startServer({ port, host });
    announce(port);
    return;
  } catch (error) {
    if (error.code !== 'EADDRINUSE') {
      console.error('启动失败：', error.message);
      process.exitCode = 1;
      return;
    }
  }

  // 端口被占用。先判断是不是本应用已经在运行 —— 这是最常见的情形。
  if (await probeIsOurApp(port, shown)) {
    const url = `http://${shown}:${port}/`;
    console.log(`端口 ${port} 上已经有一个扫雷服务在运行了，不需要再启动一个。`);
    console.log(`直接打开： ${url}`);
    if (open) {
      if (openInBrowser(url)) console.log('已尝试用默认浏览器打开。');
      else console.log('未能自动打开浏览器，请手动访问上面的地址。');
    }
    return;
  }

  // 是被别的程序占用 → 顺延找空闲端口，并明确告知换到了哪个端口（绝不静默换端口）
  const tried = [];
  for (let candidate = port + 1; candidate <= port + 10; candidate += 1) {
    tried.push(candidate);
    try {
      await startServer({ port: candidate, host });
      announce(
        candidate,
        `端口 ${port} 已被其它程序占用${explicitPort ? '（这正是你指定的端口）' : ''}，已自动改用 ${candidate}。`,
      );
      return;
    } catch (error) {
      if (error.code !== 'EADDRINUSE') {
        console.error('启动失败：', error.message);
        process.exitCode = 1;
        return;
      }
    }
  }

  console.error(`端口 ${port} 及其后 10 个端口（${tried.join(', ')}）都被占用，无法启动。`);
  console.error('请指定一个空闲端口，例如： npm run serve -- --port 9000');
  process.exitCode = 1;
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  await main();
}
