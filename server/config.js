'use strict';

/**
 * NERV Panel —— 配置读写模块
 *
 * 依据需求文档第 3 节：
 *   - 根目录只有一个配置文件 config.json
 *   - 启动时读取；不存在则用默认值自动生成
 *   - token 为空则生成随机并写回
 *   - 修改配置后重启服务即生效
 *
 * 本模块不写死任何绝对路径：配置路径由项目根目录 + 'config.json' 拼出。
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const os = require('os');

// 项目根目录（server/ 的上一级）
const ROOT_DIR = path.resolve(__dirname, '..');
const CONFIG_PATH = path.join(ROOT_DIR, 'config.json');

// 需求文档第 3 节规定的默认值
const DEFAULTS = {
  port: 5000,
  token: '',
  weatherCity: '合肥',
  weatherApiUrl: '',
  heroImagePath: 'assets/hero.jpg',
  refreshIntervalSec: 1,
  tabletWakeEnabled: false,
  tabletWakeUrl: 'http://<平板IP>:2323/?cmd=screenOn',
  tabletWakePassword: ''
};

// 字段类型校验表：只允许文档规定的字段，避免前端传入任意键污染配置
const SCHEMA = {
  port: { type: 'int', min: 1, max: 65535 },
  token: { type: 'string', max: 256 },
  weatherCity: { type: 'string', max: 64 },
  weatherApiUrl: { type: 'string', max: 512 },
  heroImagePath: { type: 'string', max: 512 },
  refreshIntervalSec: { type: 'int', min: 1, max: 60 },
  tabletWakeEnabled: { type: 'boolean' },
  tabletWakeUrl: { type: 'string', max: 512 },
  tabletWakePassword: { type: 'string', max: 128 }
};

let current = null;

function generateToken() {
  return crypto.randomBytes(24).toString('hex');
}

/** 取本机的局域网 IPv4 地址，优先 192.168 / 10. / 172.16-31 */
function lanIPv4() {
  const ifaces = os.networkInterfaces();
  const candidates = [];
  for (const name of Object.keys(ifaces)) {
    for (const net of ifaces[name] || []) {
      if (net.family !== 'IPv4' || net.internal) continue;
      candidates.push({ name, address: net.address });
    }
  }
  const scored = candidates.map((c) => {
    const a = c.address;
    let score = 0;
    if (/^192\.168\./.test(a)) score = 3;
    else if (/^10\./.test(a)) score = 2;
    else if (/^172\.(1[6-9]|2\d|3[01])\./.test(a)) score = 1;
    // 常见虚拟网卡降权
    if (/vmware|virtualbox|vethernet|hyper-v|wsl|loopback|tap|tun/i.test(c.name)) score -= 5;
    return { ...c, score };
  });
  scored.sort((x, y) => y.score - x.score);
  return scored.length ? scored[0].address : '127.0.0.1';
}

/** 用默认值 + 磁盘上的值，合并出一份合法配置 */
function normalize(raw) {
  const out = {};
  for (const key of Object.keys(DEFAULTS)) {
    const def = DEFAULTS[key];
    let value = Object.prototype.hasOwnProperty.call(raw, key) ? raw[key] : def;

    // 类型纠正
    if (typeof def === 'boolean') {
      value = value === true || value === 'true' || value === 1;
    } else if (typeof def === 'number') {
      const n = Number(value);
      value = Number.isFinite(n) ? Math.round(n) : def;
    } else {
      value = value === null || value === undefined ? '' : String(value);
    }

    // 范围纠正
    const rule = SCHEMA[key];
    if (rule) {
      if (rule.type === 'int') {
        if (value < rule.min) value = rule.min;
        if (value > rule.max) value = rule.max;
      } else if (rule.type === 'string' && value.length > rule.max) {
        value = value.slice(0, rule.max);
      }
    }
    out[key] = value;
  }

  // token 为空时生成随机值（文档：禁止写死 token）
  if (!out.token) out.token = generateToken();

  return out;
}

function writeConfig(cfg) {
  const tmp = CONFIG_PATH + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(cfg, null, 2) + '\n', 'utf8');
  fs.renameSync(tmp, CONFIG_PATH);
}

/**
 * 加载配置：不存在则生成默认文件；token 为空则生成并写回。
 * @returns {{config: object, created: boolean, tokenGenerated: boolean}}
 */
function loadConfig() {
  let raw = {};
  let created = false;
  let tokenGenerated = false;

  if (fs.existsSync(CONFIG_PATH)) {
    try {
      raw = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
    } catch (err) {
      // 配置文件损坏：备份后用默认值重建，避免服务无法启动
      const backup = CONFIG_PATH + '.broken-' + Date.now();
      try {
        fs.copyFileSync(CONFIG_PATH, backup);
      } catch (_) {
        /* 备份失败不阻塞启动 */
      }
      console.error('[config] config.json 解析失败，已备份为 ' + path.basename(backup) + ' 并重建默认配置');
      raw = {};
      created = true;
    }
  } else {
    created = true;
  }

  const hadToken = typeof raw.token === 'string' && raw.token.trim() !== '';
  const cfg = normalize(raw);
  if (!hadToken) tokenGenerated = true;

  // 未被识别/缺失的字段补全后写回磁盘，保证文件始终是完整字段集
  const before = JSON.stringify(raw);
  const after = JSON.stringify(cfg);
  if (created || tokenGenerated || before !== after) {
    writeConfig(cfg);
  }

  current = cfg;
  return { config: cfg, created, tokenGenerated };
}

/** 运行时读取当前配置（返回副本，避免调用方误改） */
function getConfig() {
  if (!current) loadConfig();
  return { ...current };
}

/**
 * 保存设置区提交的配置。
 * 只接受 SCHEMA 中的键；其他键直接忽略。
 * @param {object} patch 前端提交的部分字段
 * @returns {{saved: boolean, config: object, changed: string[], needsRestart: boolean}}
 */
function saveConfig(patch) {
  if (!patch || typeof patch !== 'object') {
    throw new Error('配置内容格式不正确');
  }
  const merged = { ...getConfig() };
  const changed = [];

  for (const key of Object.keys(SCHEMA)) {
    if (!Object.prototype.hasOwnProperty.call(patch, key)) continue;
    let value = patch[key];
    const rule = SCHEMA[key];

    if (rule.type === 'boolean') {
      value = value === true || value === 'true';
    } else if (rule.type === 'int') {
      const n = Number(value);
      if (!Number.isFinite(n)) throw new Error(key + ' 必须是数字');
      value = Math.round(n);
      if (value < rule.min || value > rule.max) {
        throw new Error(key + ' 必须在 ' + rule.min + '~' + rule.max + ' 之间');
      }
    } else {
      value = value === null || value === undefined ? '' : String(value).trim();
      if (value.length > rule.max) throw new Error(key + ' 长度超出上限');
    }

    if (merged[key] !== value) {
      merged[key] = value;
      changed.push(key);
    }
  }

  // token 不允许被清空
  if (!merged.token) merged.token = getConfig().token || generateToken();

  writeConfig(merged);
  const restartAffects = changed.includes('port') || changed.includes('tabletWakeEnabled') ||
    changed.includes('tabletWakeUrl') || changed.includes('tabletWakePassword');

  current = merged;
  return { saved: true, config: { ...merged }, changed, needsRestart: restartAffects };
}

const SERVER_VERSION = require(path.join(ROOT_DIR, 'package.json')).version || '1.0.0';

module.exports = {
  ROOT_DIR,
  CONFIG_PATH,
  DEFAULTS,
  SERVER_VERSION,
  loadConfig,
  getConfig,
  saveConfig,
  lanIPv4,
  generateToken
};
