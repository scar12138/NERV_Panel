'use strict';

/**
 * NERV Panel —— 平板唤醒（阶段 6 第二层，默认关闭）
 *
 * 原理：FreeKiosk（免费开源 MIT，网页全屏 Kiosk 浏览器）内置 REST API，
 * 向它的亮屏端点发一次 GET 即可点亮屏幕。FreeKiosk 的 REST API 默认端口是 8080，
 * 亮屏端点是 /api/screen/on，鉴权用 X-Api-Key 请求头或 HTTP Basic 密码。
 *
 * 但地址一律以 config.json 的 tabletWakeUrl 为准，代码不假定任何一家软件的路径或端口，
 * 因此本模块只做两件事：把配置里的地址原样请求一次；把配置里的密码按两种通用方式带上
 * （查询参数 password= 和请求头 X-Api-Key）。这样换成其他 Kiosk 软件的接口也不会失效。
 *
 * 开关：config.json 的 tabletWakeEnabled（默认 false）
 * 地址：config.json 的 tabletWakeUrl
 * 密码：config.json 的 tabletWakePassword（空则不附加）
 *
 * 一切参数都读配置，代码里不出现任何 IP、端口或密码。
 */

const http = require('http');
const https = require('https');
const { URL } = require('url');
const { getConfig } = require('./config');
const logger = require('./logger');

const TIMEOUT_MS = 6000;
const RETRIES = 2;

/** 判断配置里的地址是否仍是未填写的占位值 */
function isPlaceholder(url) {
  return !url || /[<>]/.test(url) || !/^https?:\/\//i.test(url);
}

/** 把唤醒密码附加到查询串上（兼容 `?password=` 形式的 Kiosk 接口） */
function withPassword(rawUrl, password) {
  if (!password) return rawUrl;
  let u;
  try {
    u = new URL(rawUrl);
  } catch (err) {
    return rawUrl;
  }
  if (!u.searchParams.has('password')) u.searchParams.set('password', password);
  return u.toString();
}

/**
 * 请求头。密码同时以 X-Api-Key 形式带上，
 * 这样 FreeKiosk 的 API Key 鉴权和部分 Kiosk 的 Basic 鉴权都能命中；
 * 不带密码时不附加任何鉴权头。
 */
function headersFor(password) {
  const h = { 'User-Agent': 'NERV-Panel' };
  if (password) h['X-Api-Key'] = password;
  return h;
}

function getOnce(targetUrl, password) {
  return new Promise((resolve, reject) => {
    let u;
    try {
      u = new URL(targetUrl);
    } catch (err) {
      reject(new Error('唤醒地址格式不正确'));
      return;
    }
    const lib = u.protocol === 'https:' ? https : http;
    const req = lib.get(
      u,
      {
        timeout: TIMEOUT_MS,
        headers: headersFor(password)
      },
      (res) => {
        let body = '';
        res.setEncoding('utf8');
        res.on('data', (chunk) => {
          if (body.length < 4096) body += chunk;
        });
        res.on('end', () => {
          if (res.statusCode && res.statusCode >= 200 && res.statusCode < 400) {
            resolve({ status: res.statusCode, body });
          } else {
            reject(new Error('平板返回 HTTP ' + res.statusCode));
          }
        });
      }
    );
    req.on('timeout', () => {
      req.destroy(new Error('连接超时'));
    });
    req.on('error', (err) => {
      reject(err);
    });
  });
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * 点亮平板屏幕。失败不影响服务端主流程，只写日志。
 * @param {string} reason 触发原因，仅用于日志
 * @returns {Promise<{ok:boolean, skipped?:string, attempts?:number, message?:string}>}
 */
async function wakeTablet(reason) {
  const c = getConfig();
  if (!c.tabletWakeEnabled) {
    return { ok: false, skipped: 'DISABLED' };
  }
  if (isPlaceholder(c.tabletWakeUrl)) {
    logger.warn('平板唤醒已开启，但 tabletWakeUrl 仍是占位值，跳过。请在设置区或 config.json 填入平板的实际地址');
    return { ok: false, skipped: 'PLACEHOLDER_URL', message: 'tabletWakeUrl 未填写实际地址' };
  }

  const target = withPassword(c.tabletWakeUrl, c.tabletWakePassword);
  let lastError = null;

  for (let i = 1; i <= RETRIES + 1; i += 1) {
    try {
      const res = await getOnce(target, c.tabletWakePassword);
      logger.info(
        '平板唤醒成功' + (reason ? '（' + reason + '）' : '') + '：HTTP ' + res.status + '，第 ' + i + ' 次尝试'
      );
      return { ok: true, attempts: i };
    } catch (err) {
      lastError = err;
      logger.warn('平板唤醒失败（第 ' + i + ' 次）：' + (err && err.message ? err.message : err));
      if (i <= RETRIES) await delay(2000);
    }
  }

  return {
    ok: false,
    attempts: RETRIES + 1,
    message: lastError && lastError.message ? lastError.message : '未知错误'
  };
}

module.exports = { wakeTablet, isPlaceholder };
