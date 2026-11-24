'use strict';

/**
 * NERV Panel —— 主视觉图片上传
 *
 * 需求文档 4 节：POST /api/hero-image 接收本地图片文件（jpg/png/webp），
 * 校验 Token 与文件类型后存到**独立的用户图片位置**，写回 customHeroImagePath，
 * **禁止覆盖 heroImagePath 指向的默认图**。
 *
 * 所以：
 *   - 默认图 public/assets/hero.jpg 永远只读，任何人都不覆盖它
 *   - 用户换的图一律写到 data/hero/ 下（与 public 分离，不在静态目录里裸奔）
 *   - customHeroImagePath 存相对路径，前端用 /custom-hero/<file> 取图
 *     （由 index.js 提供受控的静态映射，而不是把 data 目录整个暴露出去）
 */

const fs = require('fs');
const path = require('path');
const logger = require('./logger');
const { ROOT_DIR, getConfig, saveConfig } = require('./config');

const HERO_DIR = path.join(ROOT_DIR, 'data', 'hero');
const MAX_BYTES = 8 * 1024 * 1024;
/** 只认这三种，其它的（gif/svg/bmp）一律拒绝 */
const ALLOWED = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp'
};

function ensureDir() {
  try {
    fs.mkdirSync(HERO_DIR, { recursive: true });
  } catch (err) {
    /* 已存在 */
  }
}

/**
 * 用文件头魔数判断真实格式，不信任前端给的 Content-Type / 文件名后缀。
 * 返回 mime 或 null。
 */
function sniffType(buf) {
  if (!buf || buf.length < 12) return null;
  /* JPEG: FF D8 FF */
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  /* PNG: 89 50 4E 47 0D 0A 1A 0A */
  if (
    buf[0] === 0x89 &&
    buf[1] === 0x50 &&
    buf[2] === 0x4e &&
    buf[3] === 0x47 &&
    buf[4] === 0x0d &&
    buf[5] === 0x0a &&
    buf[6] === 0x1a &&
    buf[7] === 0x0a
  ) {
    return 'image/png';
  }
  /* WebP: "RIFF" .... "WEBP" */
  if (
    buf.slice(0, 4).toString('ascii') === 'RIFF' &&
    buf.slice(8, 12).toString('ascii') === 'WEBP'
  ) {
    return 'image/webp';
  }
  return null;
}

/** 删掉旧的用户图，避免 data/hero 目录越攒越多 */
function removeOldUserImage() {
  const c = getConfig();
  const old = String(c.customHeroImagePath || '');
  if (!old) return;
  const file = path.basename(old);
  const full = path.join(HERO_DIR, file);
  /* 只删 data/hero 里的文件，绝不越界删除别处的东西 */
  if (path.dirname(path.resolve(full)) !== path.resolve(HERO_DIR)) return;
  try {
    if (fs.existsSync(full)) fs.unlinkSync(full);
  } catch (err) {
    logger.warn('删除旧的主视觉图片失败：' + (err && err.message));
  }
}

/**
 * 保存上传的主视觉图片。
 * @param {Buffer} buf 原始字节
 * @returns {{ok:boolean,error?:string,message?:string,customHeroImagePath?:string}}
 */
function saveHeroImage(buf) {
  if (!Buffer.isBuffer(buf) || !buf.length) {
    return { ok: false, error: 'EMPTY_FILE', message: '没有收到图片内容' };
  }
  if (buf.length > MAX_BYTES) {
    return { ok: false, error: 'TOO_LARGE', message: '图片超过 8 MB，请先压缩再上传' };
  }
  const mime = sniffType(buf);
  if (!mime || !ALLOWED[mime]) {
    return { ok: false, error: 'BAD_TYPE', message: '只支持 jpg / png / webp 三种格式' };
  }

  ensureDir();
  const ext = ALLOWED[mime];
  const name = 'hero-' + Date.now() + ext;
  const full = path.join(HERO_DIR, name);

  try {
    fs.writeFileSync(full, buf);
  } catch (err) {
    logger.error('保存主视觉图片失败：' + (err && err.message));
    return { ok: false, error: 'WRITE_FAILED', message: '保存图片失败：' + (err && err.message) };
  }

  const rel = path.posix.join('data/hero', name);
  try {
    removeOldUserImage();
    /* 注意：写的是 customHeroImagePath，不是 heroImagePath —— 默认图必须留着 */
    saveConfig({ customHeroImagePath: rel });
  } catch (err) {
    logger.error('写入 customHeroImagePath 失败：' + (err && err.message));
    return { ok: false, error: 'CONFIG_FAILED', message: '图片已保存但配置写入失败' };
  }

  logger.info('主视觉图片已更新：' + rel);
  return { ok: true, customHeroImagePath: rel };
}

/** 清空用户图，回到默认图 */
function resetHeroImage() {
  try {
    removeOldUserImage();
    saveConfig({ customHeroImagePath: '' });
    logger.info('主视觉图片已恢复为默认图');
    return { ok: true, customHeroImagePath: '' };
  } catch (err) {
    return { ok: false, error: 'CONFIG_FAILED', message: String((err && err.message) || '') };
  }
}

module.exports = { saveHeroImage, resetHeroImage, HERO_DIR };
