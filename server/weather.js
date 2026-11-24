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
 * 带一次重试的取 JSON。
 * 实测这条线路偶尔会整包被掐（`This operation was aborted`），
 * 单次失败就返回 502 会让面板天气频繁空窗，因此对网络类错误重试一次；
 * HTTP 4xx 这类确定性错误不重试。
 */
async function fetchJsonRetry(url) {
  try {
    return await fetchJson(url);
  } catch (err) {
    const msg = String((err && err.message) || '');
    if (/^HTTP 4\d\d/.test(msg)) throw err;
    await new Promise((r) => setTimeout(r, RETRY_DELAY_MS));
    return fetchJson(url);
  }
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
    name: first.name + (first.admin1 && first.admin1 !== first.name ? '' : ''),
    latitude: first.latitude,
    longitude: first.longitude,
    timezone: first.timezone || 'auto'
  };
  geoCache.set(city, geo);
  return geo;
}

async function fetchWeather(city) {
  const geo = await geocode(city);

  const forecastUrl =
    forecastBase() +
    '?latitude=' +
    geo.latitude +
    '&longitude=' +
    geo.longitude +
    '&current=temperature_2m,relative_humidity_2m,apparent_temperature,weather_code,wind_speed_10m,wind_direction_10m' +
    '&daily=weather_code,temperature_2m_max,temperature_2m_min' +
    '&timezone=' +
    encodeURIComponent(geo.timezone) +
    '&forecast_days=4';

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

  const days = [];
  const times = Array.isArray(d.time) ? d.time : [];
  for (let i = 0; i < Math.min(times.length, 4); i++) {
    days.push({
      label: weekdayLabel(times[i], i),
      date: times[i],
      code: d.weather_code && d.weather_code[i] != null ? d.weather_code[i] : null,
      desc: d.weather_code && WMO[d.weather_code[i]] ? WMO[d.weather_code[i]] : null,
      max: d.temperature_2m_max && Number.isFinite(d.temperature_2m_max[i]) ? Math.round(d.temperature_2m_max[i]) : null,
      min: d.temperature_2m_min && Number.isFinite(d.temperature_2m_min[i]) ? Math.round(d.temperature_2m_min[i]) : null
    });
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
    source: 'open-meteo',
    ts: Date.now()
  };
}

/* ------------------------------------------------------------------ 缓存 */

let cache = { data: null, ts: 0, key: null };
let inflight = null;

/**
 * 获取天气（带缓存与并发合并）。
 * @returns {Promise<object>} 失败时 reject，由调用方决定降级方式
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
    .finally(() => {
      inflight = null;
    });

  inflight = { key, promise };
  return promise;
}

module.exports = { getWeather, WMO, aqiLevel, windDirText, windLevel };
