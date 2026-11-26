'use strict';

/**
 * NERV Panel —— 天气数据
 *
 * 数据源：Open-Meteo（免注册、免 API Key）
 *   - 地理编码：https://geocoding-api.open-meteo.com/v1/search
 *   - 天气预报：https://api.open-meteo.com/v1/forecast
 *   - 空气质量：https://air-quality-api.open-meteo.com/v1/air-quality
 *
 * 城市从 config.json 的 weatherCity 读取，绝不写死在业务代码里。
 * 任何字段拿不到就返回 null，前端显示「—」，不做任何估算或编造。
 */

const logger = require('./logger');
const { getConfig } = require('./config');

const GEO_URL = 'https://geocoding-api.open-meteo.com/v1/search';
const FORECAST_URL_FALLBACK = 'https://api.open-meteo.com/v1/forecast';
const AIR_URL = 'https://air-quality-api.open-meteo.com/v1/air-quality';

/** 预报地址读配置（weatherApiUrl），配置为空时用内置默认值 */
function forecastBase() {
  const v = (getConfig().weatherApiUrl || '').trim();
  return v || FORECAST_URL_FALLBACK;
}

const TIMEOUT_MS = 12000;
const RETRY_DELAY_MS = 600;
const CACHE_TTL_MS = 10 * 60 * 1000; // 天气变化缓慢，10 分钟内复用，避免频繁打外部接口
/* 需求一.3：上游偶发整包被掐（fetch failed / aborted），只重试 1 次远远不够，
   实测一次抖动就能让面板空窗 10 分钟。这里改成最多 3 次重试（共 4 次尝试），
   退避 0.6s → 1.2s → 2.4s；
   并且长时间保留「上一次成功的结果」作为兜底（STALE_TTL_MS = 6 小时），
   真断了的时候面板显示的是几小时前的真实数据 + 过期标记，而不是一片「—」。 */
const MAX_ATTEMPTS = 4;
const STALE_TTL_MS = 6 * 60 * 60 * 1000;
const FORECAST_DAYS = 7; // 需求一.4：天气详情要画 7 日温度曲线

/* WMO 天气代码 → 中文描述（Open-Meteo 官方对照表） */
const WMO = {
  0: '晴',
  1: '大部晴朗',
  2: '多云',
  3: '阴',
  45: '雾',
  48: '雾凇',
  51: '小毛毛雨',
  53: '毛毛雨',
  55: '大毛毛雨',
  56: '冻毛毛雨',
  57: '强冻毛毛雨',
  61: '小雨',
  63: '中雨',
  65: '大雨',
  66: '冻雨',
  67: '强冻雨',
  71: '小雪',
  73: '中雪',
  75: '大雪',
  77: '雪粒',
  80: '阵雨',
  81: '强阵雨',
  82: '暴阵雨',
  85: '阵雪',
  86: '强阵雪',
  95: '雷阵雨',
  96: '雷阵雨伴冰雹',
  99: '强雷阵雨伴冰雹'
};

/* 风向角度 → 中文方位 */
function windDirText(deg) {
  if (deg == null || !Number.isFinite(deg)) return null;
  const dirs = ['北风', '东北风', '东风', '东南风', '南风', '西南风', '西风', '西北风'];
  const idx = Math.round(((deg % 360) + 360) % 360 / 45) % 8;
  return dirs[idx];
}

/* 蒲福风级：Open-Meteo 返回 km/h */
function windLevel(kmh) {
  if (kmh == null || !Number.isFinite(kmh)) return null;
  const bounds = [1, 5, 11, 19, 28, 38, 49, 61, 74, 88, 102, 117];
  for (let i = 0; i < bounds.length; i++) {
    if (kmh < bounds[i]) return i;
  }
  return 12;
}

/* US AQI → 中文等级 */
function aqiLevel(aqi) {
  if (aqi == null || !Number.isFinite(aqi)) return null;
  if (aqi <= 50) return '优';
  if (aqi <= 100) return '良';
  if (aqi <= 150) return '轻度污染';
  if (aqi <= 200) return '中度污染';
  if (aqi <= 300) return '重度污染';
  return '严重污染';
}

function weekdayLabel(dateStr, index) {
  if (index === 0) return '今天';
  const names = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
  const d = new Date(dateStr + 'T00:00:00');
  if (isNaN(d.getTime())) return '—';
  return names[d.getDay()];
}

async function fetchJson(url) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: ctrl.signal, headers: { Accept: 'application/json' } });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

/**
 * 带退避重试的取 JSON（需求一.3）。
 * 实测这条线路偶尔会整包被掐（`fetch failed` / `This operation was aborted`），
 * 单次失败就返回 502 会让面板天气频繁空窗，因此对网络类错误做多次退避重试；
 * HTTP 4xx 这类确定性错误不重试（重试也没用，只会拖慢响应）。
 */
async function fetchJsonRetry(url) {
  let lastError = null;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    try {
      return await fetchJson(url);
    } catch (err) {
      lastError = err;
      const msg = String((err && err.message) || '');
      if (/^HTTP 4\d\d/.test(msg)) throw err;
      if (attempt < MAX_ATTEMPTS) {
        await new Promise((r) => setTimeout(r, RETRY_DELAY_MS * Math.pow(2, attempt - 1)));
      }
    }
  }
  throw lastError || new Error('WEATHER_UPSTREAM');
}

/* 城市名 → 经纬度（带进程内缓存，城市一般不变） */
const geoCache = new Map();

async function geocode(city) {
  if (geoCache.has(city)) return geoCache.get(city);
  const url = GEO_URL + '?name=' + encodeURIComponent(city) + '&count=1&language=zh&format=json';
  const j = await fetchJsonRetry(url);
  const first = j && Array.isArray(j.results) && j.results.length ? j.results[0] : null;
  if (!first) throw new Error('CITY_NOT_FOUND');
  const geo = {
    /* 同名城市较多时带上省/州做区分（例如「朝阳」） */
    name: first.name + (first.admin1 && first.admin1 !== first.name ? '·' + first.admin1 : ''),
    latitude: first.latitude,
    longitude: first.longitude,
    timezone: first.timezone || 'auto'
  };
  geoCache.set(city, geo);
  return geo;
}

async function fetchWeather(city) {
  const geo = await geocode(city);

  const base = forecastBase();
  const forecastUrl =
    base +
    (base.indexOf('?') >= 0 ? '&' : '?') +
    'latitude=' +
    geo.latitude +
    '&longitude=' +
    geo.longitude +
    '&current=temperature_2m,relative_humidity_2m,apparent_temperature,weather_code,wind_speed_10m,wind_direction_10m' +
    '&hourly=temperature_2m,weather_code' +
    '&daily=weather_code,temperature_2m_max,temperature_2m_min' +
    '&timezone=' +
    encodeURIComponent(geo.timezone) +
    '&forecast_days=' +
    FORECAST_DAYS;

  const cur = await fetchJsonRetry(forecastUrl);

  /* 空气质量失败不影响主天气，单独降级为 null */
  let air = null;
  try {
    const airUrl =
      AIR_URL +
      '?latitude=' +
      geo.latitude +
      '&longitude=' +
      geo.longitude +
      '&current=us_aqi,pm2_5&timezone=' +
      encodeURIComponent(geo.timezone);
    const a = await fetchJsonRetry(airUrl);
    if (a && a.current && Number.isFinite(a.current.us_aqi)) air = aqiLevel(a.current.us_aqi);
  } catch (err) {
    air = null;
  }

  const c = cur && cur.current ? cur.current : {};
  const d = cur && cur.daily ? cur.daily : {};
  const h = cur && cur.hourly ? cur.hourly : {};

  const days = [];
  const times = Array.isArray(d.time) ? d.time : [];
  /* 需求一.4：天气详情要画 7 日温度变化曲线，这里必须拿满 7 天（forecast_days=7 与之对应） */
  for (let i = 0; i < Math.min(times.length, FORECAST_DAYS); i++) {
    days.push({
      label: weekdayLabel(times[i], i),
      date: times[i],
      code: d.weather_code && d.weather_code[i] != null ? d.weather_code[i] : null,
      desc: d.weather_code && WMO[d.weather_code[i]] ? WMO[d.weather_code[i]] : null,
      max: d.temperature_2m_max && Number.isFinite(d.temperature_2m_max[i]) ? Math.round(d.temperature_2m_max[i]) : null,
      min: d.temperature_2m_min && Number.isFinite(d.temperature_2m_min[i]) ? Math.round(d.temperature_2m_min[i]) : null
    });
  }

  /* 一天只说一种天气：主卡显示的是「当前天气」，而 daily 里「今天」这一项
     是整天聚合值（凌晨/傍晚可能和当前不同，出现「主卡晴、今天阴」的矛盾）。
     这里把 days[0]（今天）的 code/desc 覆盖成与当前完全一致，
     保证主卡、详情、未来几天里对「今天」的口径永远一致。 */
  if (days.length && c.weather_code != null) {
    days[0].code = c.weather_code;
    if (WMO[c.weather_code]) days[0].desc = WMO[c.weather_code];
  }

  return {
    city: geo.name || city,
    code: c.weather_code != null ? c.weather_code : null,
    desc: c.weather_code != null && WMO[c.weather_code] ? WMO[c.weather_code] : null,
    temp: Number.isFinite(c.temperature_2m) ? Math.round(c.temperature_2m) : null,
    feels: Number.isFinite(c.apparent_temperature) ? Math.round(c.apparent_temperature) : null,
    humidity: Number.isFinite(c.relative_humidity_2m) ? Math.round(c.relative_humidity_2m) : null,
    windDir: windDirText(c.wind_direction_10m),
    windLevel: windLevel(c.wind_speed_10m),
    air,
    days,
    /* 当日逐小时气温（近 24 小时），详情页画「当日气温曲线」，见需求一.4 */
    hourly: buildHourly(h),
    source: 'open-meteo',
    ts: Date.now()
  };
}

/* 从 Open-Meteo hourly 里挑出「最近 24 个小时」的逐时气温，
   只保留时间 + 温度两个标量，供前端画曲线；拿不到就返回空数组。 */
function buildHourly(d) {
  const times = Array.isArray(d.time) ? d.time : [];
  const temps = Array.isArray(d.temperature_2m) ? d.temperature_2m : [];
  if (!times.length || !temps.length || times.length !== temps.length) return [];
  /* forecast_days=4 时 Open-Meteo 返回跨 4 天的 hourly；这里切到当天 00:00 起最近 24 条，
     保证曲线始终是「今天」的气温走势，不会把明天凌晨的数据混进来。 */
  const today = new Date();
  const todayStr = today.getFullYear() + '-' + String(today.getMonth() + 1).padStart(2, '0') + '-' + String(today.getDate()).padStart(2, '0');
  const out = [];
  for (let i = 0; i < times.length; i++) {
    const t = String(times[i] || '');
    if (t.indexOf(todayStr) !== 0) continue;
    const v = temps[i];
    if (v == null || !Number.isFinite(v)) { out.push({ h: t.slice(11, 16), t: null }); continue; }
    out.push({ h: t.slice(11, 16), t: Math.round(v) });
    if (out.length >= 24) break;
  }
  return out;
}

/* ------------------------------------------------------------------ 缓存 */

let cache = { data: null, ts: 0, key: null };
let inflight = null;

/**
 * 获取天气（带缓存与并发合并）。
 * 需求一.3：拉到新数据就返回；拉不到也不再直接 reject 让前端清空 ——
 * 只要还有 6 小时内成功过的数据，就把它原样返回并标记 stale:true，
 * 面板继续显示真实数值（前端在日期旁标注「数据已过期」），绝不出现「天气丢失」的空窗。
 * 真正从没成功过时才 reject，由调用方降级。
 * @returns {Promise<object>}
 */
async function getWeather() {
  const cfg = getConfig();
  const city = (cfg.weatherCity || '合肥').trim();
  const key = city + '|' + (cfg.weatherApiUrl || '');
  const now = Date.now();

  if (cache.data && cache.key === key && now - cache.ts < CACHE_TTL_MS) {
    return cache.data;
  }
  if (inflight && inflight.key === key) return inflight.promise;

  const promise = fetchWeather(city)
    .then((data) => {
      cache = { data, ts: Date.now(), key };
      return data;
    })
    .catch((err) => {
      /* 上游彻底失败：有旧数据就用旧数据顶上（标记过期），没有才抛错 */
      if (cache.data && cache.key === key && Date.now() - cache.ts < STALE_TTL_MS) {
        const ageMin = Math.round((Date.now() - cache.ts) / 60000);
        logger.warn(
          '天气刷新失败（' + (err && err.message ? err.message : err) + '），沿用 ' + ageMin + ' 分钟前的数据'
        );
        return Object.assign({}, cache.data, { stale: true, staleAgeMin: ageMin });
      }
      throw err;
    })
    .finally(() => {
      inflight = null;
    });

  inflight = { key, promise };
  return promise;
}

module.exports = { getWeather, WMO, aqiLevel, windDirText, windLevel };

