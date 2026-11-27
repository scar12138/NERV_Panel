'use strict';

// One persistent Windows PowerShell process. Importing this module never starts
// it: the host owns start()/stop(). Commands are serialized and bounded.
const { spawn } = require('child_process');
const path = require('path');
const SCRIPT = path.join(__dirname, 'ps', 'audio-session.ps1');
const TIMEOUT = 10000;
let child = null;
let stopped = true;
let sequence = 0;
let buffer = '';
let active = null;
let queue = [];
let restartAt = 0;
let lastError = null;
const icons = new Map();
const failure = (error) => ({ ok: false, error });

function dispose(error) {
  const p = child;
  child = null;
  buffer = '';
  restartAt = Date.now() + 1000;
  if (p) {
    p.removeAllListeners('error');
    p.on('error', () => {});
    try { p.kill(); } catch (_) { /* Already terminated. */ }
  }
  if (active) { clearTimeout(active.timer); active.resolve(failure(error)); active = null; }
  for (const task of queue) { clearTimeout(task.timer); task.resolve(failure(error)); }
  queue = [];
}

function launch() {
  if (child || stopped || process.platform !== 'win32') return;
  const p = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', SCRIPT], {
    windowsHide: true, stdio: ['pipe', 'pipe', 'pipe']
  });
  child = p;
  p.stdout.setEncoding('utf8');
  p.stderr.setEncoding('utf8');
  p.stderr.on('data', (data) => { lastError = String(data).slice(0, 2000); });
  p.stdin.on('error', () => { if (child === p) dispose('BRIDGE_EXITED'); });
  p.stdout.on('data', (data) => {
    if (child !== p) return;
    buffer += data;
    if (buffer.length > 16 * 1024 * 1024) { dispose('BAD_OUTPUT'); return; }
    let index;
    while ((index = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, index).trim();
      buffer = buffer.slice(index + 1);
      let response;
      try { response = JSON.parse(line); } catch (_) { continue; }
      if (!active || response.requestId !== active.request.requestId) continue;
      const task = active;
      active = null;
      clearTimeout(task.timer);
      const result = response.result;
      if (!result || typeof result.ok !== 'boolean') task.resolve(failure('BAD_OUTPUT'));
      else {
        if (result.icons && typeof result.icons === 'object') {
          for (const [hash, b64] of Object.entries(result.icons)) {
            if (!/^[a-f0-9]{64}$/.test(hash) || typeof b64 !== 'string' || b64.length > 180000) continue;
            const image = Buffer.from(b64, 'base64');
            if (image.length < 8 || image.readUInt32BE(0) !== 0x89504e47) continue;
            icons.delete(hash);
            icons.set(hash, { buffer: image, mime: 'image/png' });
            while (icons.size > 64) icons.delete(icons.keys().next().value);
          }
        }
        delete result.icons; // Never expose process paths or image payloads in JSON.
        task.resolve(result);
      }
      pump();
    }
  });
  p.on('error', () => { if (child === p) dispose('SPAWN_FAILED'); });
  p.on('exit', () => { if (child === p) dispose('BRIDGE_EXITED'); });
}

function pump() {
  if (active || !queue.length || !child) return;
  active = queue.shift();
  // The timer starts at enqueue time, so a slow command cannot leave later
  // HTTP requests waiting for queue.length * TIMEOUT.
  clearTimeout(active.timer);
  active.timer = setTimeout(() => dispose('TIMEOUT'), Math.max(1, active.deadline - Date.now()));
  try { child.stdin.write(JSON.stringify(active.request) + '\n'); }
  catch (_) { dispose('BRIDGE_EXITED'); }
}

function request(operation, args = {}) {
  if (stopped) return Promise.resolve(failure('AUDIO_STOPPED'));
  if (process.platform !== 'win32') return Promise.resolve(failure('WINDOWS_REQUIRED'));
  if (!child && Date.now() < restartAt) return Promise.resolve(failure('BRIDGE_RESTARTING'));
  if (queue.length >= 24) return Promise.resolve(failure('BUSY'));
  try { launch(); } catch (_) { dispose('SPAWN_FAILED'); return Promise.resolve(failure('SPAWN_FAILED')); }
  return new Promise((resolve) => {
    const task = { request: { ...args, operation, requestId: 'r' + (++sequence) }, resolve, deadline: Date.now() + TIMEOUT };
    task.timer = setTimeout(() => {
      const index = queue.indexOf(task);
      if (index >= 0) { queue.splice(index, 1); resolve(failure('TIMEOUT')); }
    }, TIMEOUT);
    queue.push(task);
    pump();
  });
}

function start() { stopped = false; }
function stop() { stopped = true; dispose('AUDIO_STOPPED'); icons.clear(); lastError = null; }
function sessions() { return request('snapshot'); }
function validBody(body, field) {
  return body && typeof body === 'object' && !Array.isArray(body) &&
    Object.keys(body).length === 2 && Object.keys(body).every((key) => key === 'id' || key === field) &&
    typeof body.id === 'string' && /^(master|session):[a-f0-9]{64}$/.test(body.id);
}
function volume(body) {
  if (!validBody(body, 'volume') || typeof body.volume !== 'number' || !Number.isFinite(body.volume) || body.volume < 0 || body.volume > 100) {
    return Promise.resolve(failure('INVALID_VOLUME'));
  }
  return request('volume', { id: body.id, volume: body.volume });
}
function mute(body) {
  if (!validBody(body, 'muted') || typeof body.muted !== 'boolean') return Promise.resolve(failure('INVALID_MUTE'));
  return request('mute', { id: body.id, muted: body.muted });
}
function devices() { return request('devices'); }
function device(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).length !== 2 ||
      !Object.keys(body).every((key) => key === 'id' || key === 'flow') ||
      typeof body.id !== 'string' || body.id.length !== 71 || !/^device:[a-f0-9]{64}$/.test(body.id) ||
      !['output', 'input'].includes(body.flow)) return Promise.resolve(failure('INVALID_DEVICE'));
  return request('device', { id: body.id, flow: body.flow });
}
function icon(hash) { return typeof hash === 'string' && /^[a-f0-9]{64}$/.test(hash) ? icons.get(hash) || null : null; }
function diagnostics() { return { running: Boolean(child), stopped, lastError }; }
module.exports = { start, stop, sessions, volume, mute, devices, device, icon, diagnostics };
