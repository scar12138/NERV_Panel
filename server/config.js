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

// 项目根目录（server/ 的上一级）。
// 桌面打包版支持两个可选环境变量（不设置时行为与原来的源码运行完全一致）：
//   NERV_PANEL_ROOT   —— 持久化数据目录（config.json / data / logs / cache 都放这里）
//   NERV_PANEL_PUBLIC —— 前端静态目录（打包时前端资源不从数据目录读，只读打包出的 public）
const PACKAGED_ROOT = process.env.NERV_PANEL_ROOT ? path.resolve(process.env.NERV_PANEL_ROOT) : '';
const ROOT_DIR = PACKAGED_ROOT || path.resolve(__dirname, '..');
const PUBLIC_DIR = process.env.NERV_PANEL_PUBLIC
  ? path.resolve(process.env.NERV_PANEL_PUBLIC)
  : path.join(ROOT_DIR, 'public');
const CONFIG_PATH = path.join(ROOT_DIR, 'config.json');

// 需求文档第 3 节规定的默认值
const DEFAULTS = {
  port: 5000,
  token: '',
  weatherCity: '合肥',
  // 阶段 3 选定的天气数据源：Open-Meteo（免注册、免 API Key）
  weatherApiUrl: 'https://api.open-meteo.com/v1/forecast',
  // 默认主视觉：只读保留，换图时禁止覆盖、改名或删除这个文件
  heroImagePath: 'assets/hero.jpg',
  // 用户换过的图；为空时显示 heroImagePath 的默认图
  customHeroImagePath: '',
  refreshIntervalSec: 1,
  // 启动页常用软件的 id 列表，顺序即显示顺序；只存 id 不存路径，禁止预置
  favoriteAppIds: [],
  tabletWakeEnabled: false,
  // 需求文档第 3 节规定的默认值（含尖括号的占位，服务端会识别为未填写并跳过）
  // FreeKiosk REST API：默认端口 8080、亮屏端点 /api/screen/on，见 TABLET-SETUP.md 第五节
  tabletWakeUrl: 'http://<平板IP>:8080/api/screen/on',
  tabletWakePassword: ''
};

// 字段类型校验表：只允许文档规定的字段，避免前端传入任意键污染配置
const SCHEMA = {
  port: { type: 'int', min: 1, max: 65535 },
  token: { type: 'string', max: 256 },
  weatherCity: { type: 'string', max: 64 },
  weatherApiUrl: { type: 'string', max: 512 },
  heroImagePath: { type: 'string', max: 512 },
  customHeroImagePath: { type: 'string', max: 512 },
  refreshIntervalSec: { type: 'int', min: 1, max: 60 },
  favoriteAppIds: { type: 'stringArray', max: 512, maxItems: 200 },
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
    if (Array.isArray(def)) {
      // 数组型（目前只有 favoriteAppIds）：只保留非空字符串，去重，保序
      if (!Array.isArray(value)) value = def.slice();
      const seen = new Set();
      const cleaned = [];
      for (const item of value) {
        if (typeof item !== 'string') continue;
        const s = item.trim();
        if (!s || seen.has(s)) continue;
        seen.add(s);
        cleaned.push(s);
      }
      value = cleaned;
    } else if (typeof def === 'boolean') {
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
      } else if (rule.type === 'stringArray') {
        if (value.length > rule.maxItems) value = value.slice(0, rule.maxItems);
        value = value.map((s) => (s.length > rule.max ? s.slice(0, rule.max) : s));
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
 * 旧版本配置迁移。
 * 只做两件事：把空着的 weatherApiUrl 补上选定数据源；把旧版平板 Kiosk 软件
 * 的唤醒地址格式换成 FreeKiosk 的写法。用户自己填的其它地址一律不动。
 */
function migrate(raw) {
  const notes = [];

  /* 旧版本在部分写入路径下把 UTF-8 中文字符串按 GBK 写盘，读出来变成
     「鍚堣偉」（合肥）这种乱码。这里反向还原：按 GBK 编码回字节再按 UTF-8 解码。
     成功条件：结果变了、不含替换符、且解出来是正常 CJK 字符。 */
  let iconv = null;
  try {
    iconv = require('iconv-lite');
  } catch (e) {
    iconv = null;
  }
  function unmojibake(value) {
    if (!iconv || typeof value !== 'string' || !value) return value;
    try {
      const restored = iconv.encode(value, 'gbk').toString('utf8');
      if (restored && restored !== value && restored.indexOf('\uFFFD') < 0 && /[\u4e00-\u9fff]/.test(restored)) {
        return restored;
      }
    } catch (e) {
      /* 保持原值 */
    }
    return value;
  }

  if (Object.prototype.hasOwnProperty.call(raw, 'weatherApiUrl')) {
    if (typeof raw.weatherApiUrl !== 'string' || !raw.weatherApiUrl.trim()) {
      raw.weatherApiUrl = DEFAULTS.weatherApiUrl;
      notes.push('weatherApiUrl 为空，已写入默认数据源');
    }
  }
  if (Object.prototype.hasOwnProperty.call(raw, 'weatherCity')) {
    const fixed = unmojibake(raw.weatherCity);
    if (fixed !== raw.weatherCity) {
      raw.weatherCity = fixed;
      notes.push('weatherCity 编码异常已修复');
    }
  }
  if (typeof raw.tabletWakeUrl === 'string') {
    const fixed = unmojibake(raw.tabletWakeUrl);
    if (fixed !== raw.tabletWakeUrl) {
      raw.tabletWakeUrl = fixed;
      notes.push('tabletWakeUrl 编码异常已修复');
    }
    // 旧版 Kiosk 软件把命令塞在查询串里（特征是有 cmd= 参数），FreeKiosk 用的是
    // REST 路径 /api/screen/on。只认「命令写在查询串里」这一个特征做迁移，
    // 用户自己填的 REST 地址一律不动。
    const u = raw.tabletWakeUrl.trim();
    if (/[?&]cmd=/i.test(u)) {
      raw.tabletWakeUrl = DEFAULTS.tabletWakeUrl;
      notes.push('tabletWakeUrl 已从旧版 Kiosk 格式换成 FreeKiosk 默认地址');
    }
  }
  return notes;
}

/**
 * 加载配置：不存在则生成默认文件；token 为空则生成并写回。
 * @returns {{config: object, created: boolean, tokenGenerated: boolean, migrated: string[]}}
 */
function loadConfig() {
  let raw = {};
  let created = false;
  let tokenGenerated = false;
  let migrated = [];

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

  migrated = migrate(raw);

  const hadToken = typeof raw.token === 'string' && raw.token.trim() !== '';
  const cfg = normalize(raw);
  if (!hadToken) tokenGenerated = true;

  // 未被识别/缺失的字段补全后写回磁盘，保证文件始终是完整字段集
  const before = JSON.stringify(raw);
  const after = JSON.stringify(cfg);
  if (created || tokenGenerated || migrated.length || before !== after) {
    writeConfig(cfg);
  }

  current = cfg;
  return { config: cfg, created, tokenGenerated, migrated };
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

    if (rule.type === 'stringArray') {
      if (!Array.isArray(value)) throw new Error(key + ' 必须是数组');
      const seen = new Set();
      const cleaned = [];
      for (const item of value) {
        if (typeof item !== 'string') throw new Error(key + ' 的每一项都必须是字符串');
        const s = item.trim();
        if (!s || seen.has(s)) continue;
        seen.add(s);
        cleaned.push(s);
      }
      if (cleaned.length > rule.maxItems) throw new Error(key + ' 数量超出上限');
      value = cleaned;
      // 数组要用内容比较，不能用 !==
      if (JSON.stringify(merged[key]) !== JSON.stringify(value)) {
        merged[key] = value;
        changed.push(key);
      }
      continue;
    }

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

// 版本号永远跟代码走，不跟数据目录走（打包后 package.json 与代码同目录）
const SERVER_VERSION = (function () {
  try {
    return require(path.join(__dirname, '..', 'package.json')).version || '1.0.0';
  } catch (_) {
    return '1.0.0';
  }
})();

module.exports = {
  ROOT_DIR,
  PUBLIC_DIR,
  CONFIG_PATH,
  DEFAULTS,
  SERVER_VERSION,
  loadConfig,
  getConfig,
  saveConfig,
  lanIPv4,
  generateToken
};
