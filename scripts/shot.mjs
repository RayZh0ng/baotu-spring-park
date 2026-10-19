#!/usr/bin/env node
/**
 * 无头 Chrome 截图 / 自检脚本（CDP）
 * ------------------------------------------------------------
 * 用法：
 *   node scripts/shot.mjs --url "http://127.0.0.1:5174/?weather=snow" --out /tmp/qa/snow.png
 * 参数：
 *   --url       页面地址（必填）
 *   --out       输出 png 路径（默认 /tmp/qa/shot-<时间>.png）
 *   --width     视口宽（默认 1600）
 *   --height    视口高（默认 900）
 *   --wait      就绪后额外等待毫秒（默认 2200）
 *   --timeout   等待就绪超时毫秒（默认 45000）
 *   --eval      就绪后执行的页面 JS（可多次，按顺序执行）
 *   --mobile    移动端视口模拟（390x844, dpr2）
 *   --quiet     只输出结果
 *
 * 会打印浏览器 console 的 error/warning 与页面异常；便于排查。
 */
import { spawn } from 'node:child_process';
import { writeFileSync, mkdirSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { dirname } from 'node:path';

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

const argv = process.argv.slice(2);
const args = { evals: [], mobile: false, quiet: false };
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a === '--mobile') args.mobile = true;
  else if (a === '--quiet') args.quiet = true;
  else if (a === '--eval') args.evals.push(argv[++i]);
  else if (a === '--advance') args.advance = Number(argv[++i] || 1);
  else if (a.startsWith('--')) {
    const key = a.slice(2);
    args[key] = argv[++i];
  }
}

if (!args.url) {
  console.error('usage: node scripts/shot.mjs --url URL [--out file.png] [--eval "js"]');
  process.exit(2);
}

const width = Number(args.width || (args.mobile ? 390 : 1280));
const height = Number(args.height || (args.mobile ? 844 : 720));
const waitMs = Number(args.wait ?? 2200);
const timeoutMs = Number(args.timeout ?? 75000);
const out = args.out || `/tmp/qa/shot-${Date.now()}.png`;
mkdirSync(dirname(out), { recursive: true });

/* ------------------------------------------------------------------ *
 * 全局截图信号量：整机最多 2 个 headless Chrome 同时运行，避免互相拖垮
 * ------------------------------------------------------------------ */
const LOCK_ROOT = '/tmp/dsh-shot-locks';
const MAX_CONCURRENT_SHOTS = 2;
const sleepMs = (ms) => new Promise((r) => setTimeout(r, ms));

function pidAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function acquireShotSlot() {
  const start = Date.now();
  for (let attempt = 0; attempt < 600; attempt++) {
    mkdirSync(LOCK_ROOT, { recursive: true });
    for (let i = 0; i < MAX_CONCURRENT_SHOTS; i++) {
      const dir = `${LOCK_ROOT}/slot-${i}`;
      try {
        mkdirSync(dir);
        writeFileSync(`${dir}/pid`, String(process.pid));
        return i;
      } catch {
        // slot 被占用：若持有者已死则清理
        try {
          const holder = Number(readFileSync(`${dir}/pid`, 'utf8').trim());
          if (!Number.isFinite(holder) || !pidAlive(holder)) {
            rmSync(dir, { recursive: true, force: true });
          }
        } catch {
          /* ignore */
        }
      }
    }
    if (!args.quiet && attempt === 0) {
      console.log('… 等待空闲截图槽位（整机最多 2 个并发）');
    }
    await sleepMs(400);
  }
  throw new Error(`等待截图槽位超时（${Math.round((Date.now() - start) / 1000)}s）`);
}

const shotSlot = await acquireShotSlot();

const port = 9400 + Math.floor(Math.random() * 500);
const userDataDir = `/tmp/dsh-shot-${process.pid}-${port}`;
const log = (msg) => {
  if (!args.quiet) console.log(msg);
};

const chromeArgs = [
  '--headless=new',
  '--no-sandbox',
  '--disable-gpu-sandbox',
  '--use-angle=swiftshader',
  '--enable-unsafe-swiftshader',
  '--hide-scrollbars',
  '--mute-audio',
  '--no-first-run',
  '--no-default-browser-check',
  '--disable-extensions',
  '--disable-background-networking',
  '--disable-sync',
  '--disable-features=Translate,MediaRouter,CalculateNativeWinOcclusion',
  '--disable-background-timer-throttling',
  '--disable-backgrounding-occluded-windows',
  '--disable-renderer-backgrounding',
  '--disable-ipc-flooding-protection',
  '--disable-dev-shm-usage',
  '--renderer-process-limit=2',
  '--force-device-scale-factor=1',
  `--window-size=${width},${height}`,
  `--user-data-dir=${userDataDir}`,
  `--remote-debugging-port=${port}`,
  'about:blank',
];

const chrome = spawn(CHROME, chromeArgs, { stdio: 'ignore', detached: true });

// 全局看门狗：无论卡在哪里，最多 150s 后清理退出，避免留下僵尸 Chrome 拖垮机器
const watchdog = setTimeout(() => {
  console.error('✗ shot 超时（150s），强制清理');
  cleanup(3);
}, 150000);
watchdog.unref?.();
let ws = null;
let msgId = 0;
const pending = new Map();
const consoleLogs = [];
const pageErrors = [];
let exited = false;

function cleanup(code) {
  if (exited) return;
  exited = true;
  clearTimeout(watchdog);
  try {
    ws?.close();
  } catch {
    /* ignore */
  }
  try {
    process.kill(-chrome.pid, 'SIGKILL');
  } catch {
    /* ignore */
  }
  chrome.kill('SIGKILL');
  try {
    rmSync(`${LOCK_ROOT}/slot-${shotSlot}`, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
  setTimeout(() => {
    try {
      rmSync(userDataDir, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
    process.exit(code);
  }, 120);
}

function send(method, params = {}) {
  return new Promise((resolve, reject) => {
    const id = ++msgId;
    pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params }));
  });
}

async function evaluate(expression, awaitPromise = false) {
  const res = await send('Runtime.evaluate', {
    expression,
    awaitPromise,
    returnByValue: true,
    allowUnsafeEvalBlockedByCSP: true,
  });
  if (res.exceptionDetails) {
    throw new Error(
      res.exceptionDetails.exception?.description || res.exceptionDetails.text || 'evaluate failed'
    );
  }
  return res.result?.value;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  /* 1. 等待 devtools 端口 */
  const base = `http://127.0.0.1:${port}`;
  let version = null;
  for (let i = 0; i < 100; i++) {
    try {
      const res = await fetch(`${base}/json/version`);
      if (res.ok) {
        version = await res.json();
        break;
      }
    } catch {
      /* not ready */
    }
    await sleep(100);
  }
  if (!version) throw new Error('Chrome DevTools 未就绪');

  /* 2. 创建页面 */
  const targetRes = await fetch(`${base}/json/new?${encodeURIComponent(args.url)}`, {
    method: 'PUT',
  });
  const target = await targetRes.json();
  ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    ws.onopen = resolve;
    ws.onerror = (e) => reject(new Error('WebSocket error'));
  });
  ws.onmessage = (event) => {
    const msg = JSON.parse(event.data);
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.error) reject(new Error(msg.error.message || 'CDP error'));
      else resolve(msg.result);
      return;
    }
    if (msg.method === 'Runtime.consoleAPICalled') {
      const { type, args: cargs } = msg.params;
      const text = cargs
        .map((c) => (c.value !== undefined ? String(c.value) : c.description || c.type))
        .join(' ');
      if (type === 'error' || type === 'warning') consoleLogs.push({ type, text });
    } else if (msg.method === 'Runtime.exceptionThrown') {
      const d = msg.params.exceptionDetails;
      pageErrors.push(d.exception?.description || d.text || 'unknown exception');
    } else if (msg.method === 'Log.entryAdded') {
      const { level, text } = msg.params.entry;
      if (level === 'error' || level === 'warning') consoleLogs.push({ type: level, text });
    }
  };

  await send('Runtime.enable');
  await send('Log.enable');
  await send('Page.enable');
  await send('Emulation.setDeviceMetricsOverride', {
    width,
    height,
    deviceScaleFactor: args.mobile ? 2 : 1,
    mobile: Boolean(args.mobile),
  });
  if (args.mobile) {
    await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
  }

  /* 3. 等待应用就绪 */
  const start = Date.now();
  let isReady = false;
  while (Date.now() - start < timeoutMs) {
    try {
      const v = await evaluate('Boolean(window.__PARK_READY__)');
      if (v) {
        isReady = true;
        break;
      }
    } catch {
      /* page not loaded yet */
    }
    await sleep(200);
  }
  if (!isReady) {
    console.error(`✗ 页面在 ${timeoutMs}ms 内未就绪（__PARK_READY__ 仍未 true）`);
    printLogs();
    cleanup(1);
    return;
  }

  log(`✓ 页面就绪 ${Date.now() - start}ms`);

  /* 4. 快进模拟（确定性，绕开 headless 低帧率） */
  if (args.advance) {
    try {
      const stats = await evaluate(`window.__park.step(${args.advance})`, true);
      log(`  advance ${args.advance}s → ${JSON.stringify(stats)}`);
    } catch (e) {
      console.error(`✗ advance 失败: ${e.message}`);
    }
  }

  /* 5. 执行自定义 JS */
  for (const code of args.evals) {
    try {
      const result = await evaluate(code, true);
      if (result !== undefined) log(`  eval → ${JSON.stringify(result).slice(0, 400)}`);
    } catch (e) {
      console.error(`✗ eval 失败: ${e.message}\n  code: ${code}`);
    }
  }

  /* 6. 等待渲染稳定 */
  await sleep(waitMs);

  /* 7. 截图 */
  const shot = await send('Page.captureScreenshot', {
    format: 'png',
    captureBeyondViewport: false,
  });
  writeFileSync(out, Buffer.from(shot.data, 'base64'));
  log(`✓ 截图已保存: ${out} (${width}x${height})`);

  /* 8. 状态摘要 */
  try {
    const stats = await evaluate(
      'window.__park ? JSON.stringify({ stats: window.__park.getStats(), weather: window.__park.weather.currentId, mode: window.__park.player.mode }) : null'
    );
    if (stats) log(`  state: ${stats}`);
  } catch {
    /* ignore */
  }

  printLogs();
  cleanup(0);
}

function printLogs() {
  const errors = consoleLogs.filter((l) => l.type === 'error');
  if (pageErrors.length) {
    console.error(`✗ 页面异常 ${pageErrors.length} 条：`);
    for (const e of pageErrors.slice(0, 12)) console.error(`  - ${String(e).split('\n')[0]}`);
  }
  if (errors.length) {
    console.error(`✗ console.error ${errors.length} 条：`);
    for (const e of errors.slice(0, 12)) console.error(`  - ${e.text.slice(0, 300)}`);
  }
  const warnings = consoleLogs.filter((l) => l.type === 'warning');
  if (warnings.length && !args.quiet) {
    console.log(`⚠ console.warn ${warnings.length} 条：`);
    for (const w of warnings.slice(0, 8)) console.log(`  - ${w.text.slice(0, 240)}`);
  }
  if (!pageErrors.length && !errors.length) log('✓ 无 console error / 页面异常');
}

main().catch((err) => {
  console.error('✗ shot 失败:', err.message);
  cleanup(1);
});
