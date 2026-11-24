'use strict';

/**
 * NERV Panel —— 平板唤醒（阶段 6 第二层，默认关闭）
 *
 * 原理：Fully Kiosk Browser 内置 Remote Administration Web 接口，
 * 向 http://<平板IP>:2323/?cmd=screenOn 发一次 GET 即可点亮屏幕。
 * 服务端启动成功后按需调用一次，让长时间息屏的平板自己亮回来。
 *
 * 开关：config.json 的 tabletWakeEnabled（默认 false）
 * 地址：config.json 的 tabletWakeUrl（默认占位 http://<平板IP>:2323/?cmd=screenOn）
 * 密码：config.json 的 tabletWakePassword（Fully Kiosk 的 Remote Admin 密码，空则不附加）
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

/** 把唤醒密码附加到查询串上（Fully Kiosk Remote Admin 的 password 参数） */
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

function getOnce(targetUrl) {
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
        headers: { 'User-Agent': 'NERV-Panel' }
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
      const res = await getOnce(target);
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
