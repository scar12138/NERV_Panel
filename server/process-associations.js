'use strict';

// Manual associations are evidence for display only. No close code consumes them.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const gameProcs = require('./game-procs');
const { ROOT_DIR } = require('./config');
const SELECTION_TTL_MS = 60000;
function validName(name) {
  return typeof name === 'string' && name.length <= 260 && /^[^\\/:*?"<>|\x00-\x1f]+\.exe$/i.test(name);
}
function summary(record) {
  return record ? { name: record.name, pathReadable: Boolean(record.path), mode: record.path ? 'path' : 'name' } : null;
}
function associationState(record, snapshot) {
  if (!record || !snapshot || !snapshot.available) return null;
  const found = snapshot.processes.some((p) => p.pid > 4 && (record.path
    ? gameProcs.normalized(p.path) === record.path || (!p.path && String(p.name || '').toLowerCase() === record.name.toLowerCase())
    : String(p.name || '').toLowerCase() === record.name.toLowerCase()));
  return found ? { running: true, canClose: false, closeReason: '手动关联仅用于运行状态，不能据此安全关闭进程' } : null;
}
function createAssociations({ root = ROOT_DIR, tracker = gameProcs, scan = () => require('./apps').scanApps(), now = Date.now, io = fs } = {}) {
  const file = path.join(root, 'process-associations.json');
  let chain = Promise.resolve();
  const selections = new Map();
  function read() {
    try {
      const raw = JSON.parse(io.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
      if (!raw || raw.version !== 1 || !raw.associations || typeof raw.associations !== 'object' || Array.isArray(raw.associations)) throw Error('Invalid process association config');
      const result = Object.create(null);
      for (const [id, value] of Object.entries(raw.associations)) {
        if (!value || !validName(value.name) || !(value.path === null || gameProcs.normalized(value.path) && /\.exe$/i.test(value.path))) throw Error('Invalid process association record');
        result[id] = { name: value.name, path: value.path ? gameProcs.normalized(value.path) : null };
      }
      return result;
    } catch (err) {
      if (err.code === 'ENOENT') return Object.create(null);
      throw err; // Never overwrite a corrupt/unreadable file with an empty map.
    }
  }
  function current() { return read(); }
  async function write(records) {
    await io.promises.mkdir(root, { recursive: true });
    const temp = file + '.' + crypto.randomBytes(12).toString('hex') + '.tmp';
    let handle;
    try {
      handle = await io.promises.open(temp, 'wx', 0o600);
      await handle.writeFile(JSON.stringify({ version: 1, associations: records }, null, 2) + '\n', 'utf8');
      await handle.sync();
      await handle.close(); handle = null;
      await io.promises.rename(temp, file);
    } finally {
      if (handle) await handle.close().catch(() => {});
      await io.promises.unlink(temp).catch(() => {});
    }
  }
  async function list() {
    tracker.invalidate();
    const snap = await tracker.snapshot();
    if (!snap.available) return { ok: false, error: 'PROCESS_QUERY_FAILED', message: '无法读取实际运行进程，请稍后重试' };
    const at = now();
    for (const [key, value] of selections) if (value.expiresAt <= at) selections.delete(key);
    while (selections.size >= 20) selections.delete(selections.keys().next().value);
    const snapshotId = crypto.randomBytes(18).toString('hex');
    const expiresAt = at + SELECTION_TTL_MS;
    const rows = new Map();
    const processes = snap.processes.filter((p) => p.pid > 4 && validName(p.name)).map((p) => {
      const selectionId = crypto.randomBytes(18).toString('hex');
      const executable = gameProcs.normalized(p.path);
      const row = { pid: p.pid, name: p.name, path: executable && /\.exe$/i.test(executable) ? executable : null, created: p.created || null };
      rows.set(selectionId, row);
      return { selectionId, pid: row.pid, name: row.name, path: row.path, pathReadable: Boolean(row.path) };
    }).sort((a, b) => a.name.localeCompare(b.name) || a.pid - b.pid);
    selections.set(snapshotId, { expiresAt, rows });
    return { ok: true, snapshotId, expiresAt, processes };
  }
  function update(body) {
    // Capture scalar values before entering the shared read/modify/write queue.
    const request = body && typeof body === 'object' && !Array.isArray(body) ? { ...body } : {};
    const job = chain.then(async () => {
      const { action, id, snapshotId, selectionId } = request;
      if (!['bind', 'unbind'].includes(action) || typeof id !== 'string' || !id || id.length > 512 || Object.keys(request).some((k) => !['action', 'id', 'snapshotId', 'selectionId', 'token'].includes(k))) return { ok: false, error: 'ASSOCIATION_INVALID', message: '关联请求格式不正确' };
      if (!(await scan()).some((item) => item.id === id)) return { ok: false, error: 'ID_NOT_ALLOWED', message: '这个项目不在可启动列表里' };
      let record = null;
      if (action === 'bind') {
        const picked = selections.get(snapshotId);
        const row = picked && picked.expiresAt > now() && picked.rows.get(selectionId);
        if (!row) return { ok: false, error: 'PROCESS_SELECTION_STALE', message: '进程列表已过期，请刷新并重新选择' };
        tracker.invalidate();
        const fresh = await tracker.snapshot();
        if (!fresh.available) return { ok: false, error: 'PROCESS_QUERY_FAILED', message: '无法复核实际运行进程，请稍后重试' };
        const alive = fresh.processes.some((p) => p.pid === row.pid && String(p.name || '').toLowerCase() === row.name.toLowerCase() && (p.created || null) === row.created && (row.path ? gameProcs.normalized(p.path) === row.path : !p.path));
        if (!alive) return { ok: false, error: 'PROCESS_SELECTION_STALE', message: '进程已退出或身份变化，请刷新并重新选择' };
        record = { name: row.name, path: row.path };
      }
      const records = read();
      if (record) records[id] = record; else delete records[id];
      await write(records);
      return { ok: true, id, processAssociation: summary(record) };
    });
    chain = job.catch(() => {});
    return job;
  }
  return { list, update, current };
}
const associations = createAssociations();
module.exports = { ...associations, createAssociations, associationState, summary };
