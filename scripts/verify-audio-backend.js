'use strict';

// Real Windows acceptance: no playback/skip/seek commands and no intentional
// volume or mute changes. Write current values, then restore in finally.
const assert = require('node:assert/strict');
const audio = require('../server/audio');
const media = require('../server/media');
const { spawn } = require('node:child_process');
const path = require('node:path');

const report = { startedAt: new Date().toISOString(), checks: [], limitations: [] };
function check(name, fn) {
  fn();
  report.checks.push(name);
}
function rowFrom(snapshot, id) {
  return snapshot.master && snapshot.master.id === id ? snapshot.master : snapshot.sessions.find(row => row.id === id);
}
function sameValues(actual, expected) {
  assert.ok(actual, 'Session disappeared during verification');
  assert.equal(actual.muted, expected.muted);
  assert.ok(Math.abs(actual.volume - expected.volume) <= 0.02, `Volume changed: ${expected.volume} -> ${actual.volume}`);
}
function rawMediaSnapshot() {
  return new Promise((resolve, reject) => {
    const p = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', path.join(__dirname, '../server/ps/media-session.ps1'), '-Mode', 'snapshot'], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '', errors = '';
    const timer = setTimeout(() => { p.kill(); reject(new Error('SMTC snapshot timeout')); }, 15000);
    p.stdout.setEncoding('utf8');
    p.stderr.setEncoding('utf8');
    p.stdout.on('data', chunk => { output += chunk; });
    p.stderr.on('data', chunk => { errors += chunk; });
    p.on('error', error => { clearTimeout(timer); reject(error); });
    p.on('close', code => {
      clearTimeout(timer);
      if (code !== 0) return reject(new Error(`SMTC exit ${code}: ${errors}`));
      try { resolve(JSON.parse(output.trim().replace(/^\uFEFF/, ''))); } catch (error) { reject(error); }
    });
  });
}
async function main() {
  assert.equal(process.platform, 'win32', 'Acceptance requires real Windows Core Audio');
  check('import is side-effect free', () => assert.deepEqual(audio.diagnostics(), { running: false, stopped: true, lastError: null }));
  check('stopped reads fail explicitly', () => {});
  assert.equal((await audio.sessions()).error, 'AUDIO_STOPPED');
  audio.start();
  media.start();
  try {
    const initial = await audio.sessions();
    check('real default render endpoint and sessions enumerate', () => { assert.equal(initial.ok, true); assert.equal(initial.available, true); assert.ok(initial.master); assert.ok(Array.isArray(initial.sessions)); });
    const rows = [initial.master, ...initial.sessions];
    report.initial = initial;
    check('opaque IDs are unique and all readings have valid types', () => {
      assert.equal(new Set(rows.map(row => row.id)).size, rows.length);
      for (const row of rows) {
        assert.match(row.id, /^(master|session):[a-f0-9]{64}$/);
        assert.ok(Number.isFinite(row.volume) && row.volume >= 0 && row.volume <= 100);
        assert.equal(typeof row.muted, 'boolean');
        assert.equal(typeof row.active, 'boolean');
        if (row.iconHash) { const image = audio.icon(row.iconHash); assert.ok(image); assert.equal(image.mime, 'image/png'); assert.equal(image.buffer.readUInt32BE(0), 0x89504e47); }
      }
      assert.equal('icons' in initial, false);
    });
    const systemSounds = initial.sessions.filter(row => row.isSystemSounds);
    check('system sounds identified separately from application processes', () => {
      for (const row of systemSounds) { assert.equal(row.pid, 0); assert.equal(row.name, 'System Sounds'); }
    });
    if (!systemSounds.length) report.limitations.push('No System Sounds session exposed by this default endpoint.');
    for (const original of rows) {
      try {
        const volume = await audio.volume({ id: original.id, volume: original.volume });
        check(`write existing volume: ${original.name} ${original.id}`, () => { assert.equal(volume.ok, true); sameValues(rowFrom(volume, original.id), original); });
        const mute = await audio.mute({ id: original.id, muted: original.muted });
        check(`write existing mute: ${original.name} ${original.id}`, () => { assert.equal(mute.ok, true); sameValues(rowFrom(mute, original.id), original); });
      } finally {
        // Always attempt both restores, including on assertion or bridge failures.
        const restoreVolume = await audio.volume({ id: original.id, volume: original.volume });
        const restoreMute = await audio.mute({ id: original.id, muted: original.muted });
        assert.equal(restoreVolume.ok, true, `Volume restore failed: ${original.id}`);
        assert.equal(restoreMute.ok, true, `Mute restore failed: ${original.id}`);
      }
    }
    for (const kind of ['master', 'session']) {
      const id = `${kind}:${'0'.repeat(64)}`;
      assert.equal((await audio.volume({ id, volume: 0 })).error, 'SESSION_NOT_FOUND');
      assert.equal((await audio.mute({ id, muted: true })).error, 'SESSION_NOT_FOUND');
      report.checks.push(`unknown ${kind} IDs fail without fallback`);
    }
    const validId = initial.master.id;
    for (const body of [null, [], {}, { id: validId }, { id: validId, volume: -1 }, { id: validId, volume: 101 }, { id: validId, volume: NaN }, { id: validId, volume: Infinity }, { id: validId, volume: '2' }, { id: 'bad', volume: 2 }, { id: validId, volume: 2, extra: true }]) assert.equal((await audio.volume(body)).error, 'INVALID_VOLUME');
    report.checks.push('11 malformed volume bodies rejected');
    for (const body of [null, [], {}, { id: validId }, { id: validId, muted: 1 }, { id: validId, muted: 'false' }, { id: 'bad', muted: false }, { id: validId, muted: false, extra: true }]) assert.equal((await audio.mute(body)).error, 'INVALID_MUTE');
    report.checks.push('8 malformed mute bodies rejected');
    const concurrent = await Promise.all(Array.from({ length: 6 }, () => audio.sessions()));
    check('six concurrent reads serialize successfully', () => concurrent.forEach(snapshot => assert.equal(snapshot.ok, true)));
    const final = await audio.sessions();
    check('all original values preserved after writes and invalid requests', () => rows.forEach(original => sameValues(rowFrom(final, original.id), original)));
    report.final = final;
    report.diagnostics = audio.diagnostics();
    check('persistent bridge reports no stderr', () => assert.equal(report.diagnostics.lastError, null));
    const raw = await rawMediaSnapshot();
    check('real SMTC manager snapshot and media properties succeed', () => { assert.equal(raw.ok, true); assert.equal(typeof raw.available, 'boolean'); assert.equal(raw.propsError, undefined); assert.equal(raw.playbackError, undefined); });
    report.mediaRaw = { ...raw };
    delete report.mediaRaw.thumbnail;
    const current = media.current();
    report.media = current;
    check('direct media module receives a fresh snapshot', () => { assert.ok(current.sampledAt); assert.ok(Date.now() - current.sampledAt < 6000); assert.equal(current.available, raw.available); });
    if (raw.thumbHash) {
      check('real cover bytes match hash and are available through module cache', () => {
        const { createHash } = require('node:crypto');
        const bytes = Buffer.from(raw.thumbnail, 'base64');
        assert.equal(raw.thumbnailMime, 'image/jpeg');
        assert.equal(bytes.readUInt16BE(0), 0xffd8);
        assert.equal(bytes.readUInt16BE(bytes.length - 2), 0xffd9);
        assert.ok(bytes.length <= 262144);
        assert.equal(createHash('sha256').update(bytes).digest('hex'), raw.thumbHash);
        assert.equal(current.thumbHash, raw.thumbHash);
        const cached = media.thumb(current.thumbHash);
        assert.ok(cached);
        assert.equal(cached.mime, 'image/jpeg');
        assert.equal(cached.b64, raw.thumbnail);
        report.thumbnail = { bytes: bytes.length, mime: cached.mime, hash: raw.thumbHash };
      });
    } else report.limitations.push('The current player exposed no readable thumbnail.');
    assert.equal((await media.control('invalid', 'unused')).error, 'ACTION_NOT_ALLOWED');
    assert.equal((await media.control('play', '')).error, 'INVALID_SESSION');
    assert.equal((await media.control('seek', 'unused', -1)).error, 'INVALID_POSITION');
    report.checks.push('SMTC invalid action, identifier, seek rejected before spawn');
    // An impossible identifier can exercise session guard without transport calls.
    const guarded = await media.control('pause', '__NERV_ACCEPTANCE_NONEXISTENT_APP__');
    check('SMTC stale identifier blocks transport', () => { assert.equal(guarded.ok, false); assert.ok(['SESSION_CHANGED', 'NO_SESSION'].includes(guarded.error)); });
    report.mediaGuard = guarded;
    report.limitations.push('No playback, pause, skip, seek, or intentional mute/volume transition was performed. Volume readback is rounded to 0.01%; restore writes that precision.');
    report.limitations.push('Only default multimedia render endpoint is enumerated; other output devices, device switching, actual expired session and no-device cases were not exercised.');
    report.limitations.push('SMTC title/art, timeline and capabilities depend on the selected real player; zero timeline/canSeek=false are preserved. Audible correctness is not assessed.');
    report.ok = true;
  } finally {
    audio.stop();
    media.stop();
  }
  check('stop releases persistent bridge state', () => assert.deepEqual(audio.diagnostics(), { running: false, stopped: true, lastError: null }));
  check('stop clears SMTC snapshot', () => assert.equal(media.current().available, false));
}
main().catch(error => { report.ok = false; report.error = error.stack || String(error); process.exitCode = 1; }).finally(() => { report.finishedAt = new Date().toISOString(); console.log(JSON.stringify(report, null, 2)); });
