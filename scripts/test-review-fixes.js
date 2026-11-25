'use strict';

// Regression checks use isolated clocks/child processes; never launch or control applications.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { EventEmitter } = require('events');
const root = path.resolve(__dirname, '..');
const app = fs.readFileSync(path.join(root, 'public/js/app.js'), 'utf8');

function functions(names) {
  return names.map((name) => {
    const match = app.match(new RegExp('  function ' + name + '\\([^]*?\\n  \\}'));
    assert.ok(match, 'function found: ' + name);
    return match[0];
  }).join('\n');
}

function clock() {
  let now = 100000, id = 0;
  const timers = new Map();
  function add(fn, delay, repeat) {
    const key = ++id;
    timers.set(key, { fn, at: now + delay, delay, repeat });
    return key;
  }
  return {
    now: () => now,
    setTimeout: (fn, ms) => add(fn, ms, false),
    setInterval: (fn, ms) => add(fn, ms, true),
    clearTimeout: (key) => timers.delete(key),
    clearInterval: (key) => timers.delete(key),
    timers,
    advance(ms) {
      const end = now + ms;
      while (true) {
        const next = [...timers].filter(([, t]) => t.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
        if (!next) break;
        const [key, timer] = next;
        now = timer.at;
        if (timer.repeat) timer.at += timer.delay;
        else timers.delete(key);
        timer.fn();
      }
      now = end;
    }
  };
}

function bridge(file) {
  const time = clock(), processes = [];
  const context = {
    ...time, Date: { now: time.now }, module: { exports: {} },
    __dirname: path.join(root, 'server'),
    require(name) {
      if (name === 'path') return path;
      if (name === './logger') return { warn() {} };
      assert.equal(name, 'child_process');
      return { spawn(...args) {
        const p = new EventEmitter();
        p.args = args;
        p.stdout = new EventEmitter(); p.stdout.setEncoding = () => {};
        p.stderr = new EventEmitter(); p.stderr.setEncoding = () => {};
        p.kill = () => { p.killed = true; };
        processes.push(p);
        return p;
      } };
    }
  };
  vm.runInNewContext(fs.readFileSync(path.join(root, 'server', file), 'utf8'), context);
  return { time, processes, api: context.module.exports };
}

test('Chinese and Unicode application initials survive punctuation stripping', () => {
  const c = vm.createContext({}); vm.runInContext(functions(['hexGlyph']), c);
  for (const [name, glyph] of [['网易云音乐', '网'], ['微信', '微'], ['  ★ Visual Studio', 'V'], [' Éditeur', 'É'], ['', 'N']]) {
    assert.equal(c.hexGlyph(name), glyph);
  }
});

test('freshness tracks 1–60 second intervals and restarts active HTTP polling', () => {
  const c = vm.createContext({
    STALE_MS: 6000, REFRESH_SEC: 1, conn: { lastMsgAt: 1000, pollTimer: 1 },
    Date: { now: () => 9000 }, num: (x) => typeof x === 'number' ? x : null,
    stops: 0, starts: 0
  });
  vm.runInContext('function stopPolling(){stops++} function startPolling(){starts++}', c);
  vm.runInContext(functions(['staleMs', 'connFresh', 'applyRefreshInterval']), c);
  assert.equal(c.connFresh(), false);
  c.applyRefreshInterval(10);
  assert.equal(c.connFresh(), true);
  assert.equal(c.stops, 1); assert.equal(c.starts, 1);
  c.applyRefreshInterval(60); assert.equal(c.staleMs(), 180000);
  c.applyRefreshInterval(0); assert.equal(c.REFRESH_SEC, 60);
});

test('media spawn error retries once, even if a late exit follows', () => {
  const { api, time, processes } = bridge('media.js');
  api.start();
  processes[0].emit('error', new Error('ENOENT'));
  processes[0].emit('exit', -1);
  assert.equal(time.timers.size, 1);
  time.advance(1000);
  assert.equal(processes.length, 2);
  api.stop(); time.advance(60000);
  assert.equal(processes.length, 2);
});

test('media control passes the expected session and cancels its timeout on completion', async () => {
  const { api, time, processes } = bridge('media.js');
  const result = api.control('play', 'cloudmusic.exe');
  assert.ok(processes[0].args[1].includes('-ExpectedApp'));
  processes[0].stdout.emit('data', '{"ok":true}\n');
  processes[0].emit('exit', 0);
  assert.equal((await result).ok, true);
  assert.equal(time.timers.size, 0);
});

test('network data expires, requires a new baseline, and a stalled watcher restarts', () => {
  const { api, time, processes } = bridge('netwatch.js');
  api.start();
  function sample(rx) {
    processes.at(-1).stdout.emit('data', JSON.stringify({ ts: time.now(), adapters: [{ n: 'Ethernet', rx, tx: 0 }] }) + '\n');
  }
  sample(0); time.advance(1000); sample(1048576);
  assert.equal(api.current().down, 1);
  time.advance(7000);
  assert.equal(api.current().down, null); assert.equal(api.ready(), false);
  sample(2097152); assert.equal(api.current().down, null);
  time.advance(1000); sample(3145728); assert.equal(api.current().down, 1);
  time.advance(19000);
  assert.equal(processes[0].killed, true);
  assert.equal(processes.length, 2);
  api.stop(); assert.equal(time.timers.size, 0);
});

const flush = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };
function launchPoll(fetch) {
  const time = clock();
  const c = vm.createContext({
    ...time, fetch, AbortController, lbPlaying: true, launchGeneration: 1,
    launchAbort: null, launchDeadline: 0, launchPollTimer: 0,
    $: () => null, toast() {}, loadMedia() {}, window: { setTimeout: time.setTimeout },
    plays: [], mediaControl(action, app) { c.plays.push({ action, app }); }
  });
  vm.runInContext(functions(['clearLaunchBusy', 'pollSessionThenPlay']), c);
  c.launchDeadline = time.setTimeout(() => c.clearLaunchBusy(), 22000);
  c.pollSessionThenPlay(12);
  return { c, time };
}

test('unrelated media sessions never receive automatic play', async () => {
  const { c, time } = launchPoll(async () => ({ ok: true, json: async () => ({ media: { available: true, app: 'browser.exe' } }) }));
  for (let i = 0; i < 12; i++) { time.advance(1500); await flush(); }
  assert.equal(c.plays.length, 0); assert.equal(c.lbPlaying, false);
});

test('matching media session plays once and clears launch state', async () => {
  const { c, time } = launchPoll(async () => ({ ok: true, json: async () => ({ media: { available: true, app: 'cloudmusic.exe' } }) }));
  time.advance(1500); await flush();
  assert.equal(c.plays.length, 1); assert.equal(c.plays[0].app, 'cloudmusic.exe');
  assert.equal(c.lbPlaying, false);
  time.advance(30000); assert.equal(c.plays.length, 1);
});

test('hung media requests are serial, aborted, and bounded by the launch deadline', async () => {
  let active = 0, maxActive = 0, calls = 0;
  const { c, time } = launchPoll((url, { signal }) => new Promise((resolve, reject) => {
    calls++; active++; maxActive = Math.max(maxActive, active);
    signal.addEventListener('abort', () => { active--; reject(new Error('aborted')); }, { once: true });
  }));
  for (let i = 0; i < 30; i++) { time.advance(1000); await flush(); }
  assert.equal(maxActive, 1); assert.equal(active, 0);
  assert.equal(c.lbPlaying, false); assert.ok(calls <= 6);
});
