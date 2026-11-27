'use strict';

// Read-only real Windows verification. No existing device ID is ever sent with
// its actual flow to SetDevice: this script cannot intentionally switch defaults.
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const path = require('node:path');
const audio = require('../server/audio');

async function rawBridge(requests) {
  return new Promise((resolve, reject) => {
    const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', path.join(__dirname, '../server/ps/audio-session.ps1')], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '', stderr = '';
    const timer = setTimeout(() => { child.kill(); reject(new Error('Bridge timeout')); }, 15000);
    child.stdout.setEncoding('utf8'); child.stderr.setEncoding('utf8');
    child.stdout.on('data', chunk => { stdout += chunk; });
    child.stderr.on('data', chunk => { stderr += chunk; });
    child.on('error', error => { clearTimeout(timer); reject(error); });
    child.on('close', code => {
      clearTimeout(timer);
      if (code !== 0 || stderr) return reject(new Error(`Bridge ${code}: ${stderr}`));
      try { resolve(stdout.trim().split(/\r?\n/).map(line => JSON.parse(line))); } catch (error) { reject(error); }
    });
    child.stdin.end(requests.map(request => JSON.stringify(request)).join('\n') + '\n');
  });
}
async function main() {
  assert.equal(process.platform, 'win32');
  const invalid = [null, [], {}, { id: 'bad', flow: 'output' }, { id: 'device:' + '0'.repeat(64), flow: 'both' }, { id: 'device:' + '0'.repeat(64), flow: 'OUTPUT' }, { id: 'device:' + '0'.repeat(64) + '\n', flow: 'input' }, { id: 'device:' + 'A'.repeat(64), flow: 'input' }, { id: 'device:' + '0'.repeat(64), flow: 'input', command: 'unused' }];
  for (const body of invalid) assert.equal((await audio.device(body)).error, 'INVALID_DEVICE');
  assert.equal(audio.diagnostics().running, false, 'Malformed requests must not spawn a bridge');
  audio.start();
  try {
    const sessions = await audio.sessions();
    assert.equal(sessions.ok, true, 'Existing session snapshot regressed');
    assert.ok(sessions.master);
    const initial = await audio.devices();
    assert.equal(initial.ok, true);
    assert.ok(Array.isArray(initial.devices));
    assert.equal(initial.defaultRole, 'multimedia');
    assert.deepEqual(initial.switchRoles, ['console', 'multimedia', 'communications']);
    assert.equal(new Set(initial.devices.map(row => row.id)).size, initial.devices.length);
    for (const row of initial.devices) {
      assert.deepEqual(Object.keys(row).sort(), ['flow', 'id', 'isDefault', 'name']);
      assert.match(row.id, /^device:[a-f0-9]{64}$/);
      assert.ok(['output', 'input'].includes(row.flow));
      assert.equal(typeof row.isDefault, 'boolean');
      assert.ok(typeof row.name === 'string' && row.name.length);
      const opposite = row.flow === 'output' ? 'input' : 'output';
      assert.equal((await audio.device({ id: row.id, flow: opposite })).error, 'DEVICE_NOT_FOUND');
    }
    for (const flow of ['output', 'input']) {
      assert.ok(initial.devices.filter(row => row.flow === flow && row.isDefault).length <= 1);
      const impossible = 'device:' + '0'.repeat(64);
      assert.ok(!initial.devices.some(row => row.id === impossible));
      assert.equal((await audio.device({ id: impossible, flow })).error, 'DEVICE_NOT_FOUND');
    }
    const raw = await rawBridge([
      { requestId: 'r1', operation: 'device', id: 'bad;Write-Output nope', flow: 'output' },
      { requestId: 'r2', operation: 'device', id: 'device:' + '0'.repeat(64), flow: 'OUTPUT' },
      { requestId: 'r3', operation: 'devices' }
    ]);
    assert.equal(raw[0].result.ok, false); assert.equal(raw[0].result.message, 'INVALID_DEVICE');
    assert.equal(raw[1].result.ok, false); assert.equal(raw[1].result.message, 'INVALID_DEVICE');
    assert.equal(raw[2].result.ok, true);
    const final = await audio.devices();
    assert.equal(final.ok, true);
    assert.deepEqual(final.devices, initial.devices, 'Device/default snapshot changed during read-only tests');
    assert.equal(audio.diagnostics().lastError, null);
    console.log(JSON.stringify({ ok: true, checks: ['PowerShell bridge compiled native C#', 'real active render/capture enumeration', 'friendly names and opaque IDs', `${invalid.length} malformed bodies rejected before spawn`, 'fresh unknown-ID and wrong-flow rejection', 'raw bridge malformed ID and flow rejection', 'defaults unchanged'], devices: final.devices, limitations: ['No actual device switch performed; PolicyConfig mutation is not exercised.'] }, null, 2));
  } finally { audio.stop(); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
