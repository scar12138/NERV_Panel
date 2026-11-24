'use strict';

/**
 * NERV Panel —— 控制类接口的 Token 校验
 *
 * 需求文档第 4 节与 7.2：
 *   - 控制类请求必须校验 Token，缺失或错误一律拒绝，并返回明确错误
 *   - Token 来自 config.json（首次运行自动生成），不在任何地方写死
 *   - Token 只在局域网内使用，通过请求头 X-NERV-Token 传递
 *
 * 注意：GET 类只读接口（/api/status、/api/metrics、/api/weather、/api/apps）
 * 由平板浏览器直接访问，不要求 Token；凡是会改变电脑状态的接口都必须校验。
 */

const crypto = require('crypto');
const { getConfig } = require('./config');

const HEADER = 'x-nerv-token';

function safeEqual(a, b) {
  const ba = Buffer.from(String(a || ''), 'utf8');
  const bb = Buffer.from(String(b || ''), 'utf8');
  if (!ba.length || !bb.length || ba.length !== bb.length) return false;
  try {
    return crypto.timingSafeEqual(ba, bb);
  } catch (err) {
    return false;
  }
}

/** 检查请求是否携带正确 Token；返回 {ok, code, message} */
function checkToken(req) {
  const expected = getConfig().token;
  if (!expected) {
    return { ok: false, code: 'TOKEN_NOT_CONFIGURED', message: '服务端尚未配置 token，请重启服务端' };
  }
  const got = req.get(HEADER) || (req.body && req.body.token) || '';
  if (!got) {
    return { ok: false, code: 'TOKEN_MISSING', message: '缺少访问令牌，请在设置中填入服务端 token' };
  }
  if (!safeEqual(got, expected)) {
    return { ok: false, code: 'TOKEN_INVALID', message: '访问令牌不正确' };
  }
  return { ok: true };
}

/** Express 中间件包装 */
function requireToken(req, res, next) {
  const r = checkToken(req);
  if (!r.ok) {
    res.status(401).json({ ok: false, error: r.code, message: r.message });
    return;
  }
  next();
}

module.exports = { requireToken, checkToken, HEADER };
