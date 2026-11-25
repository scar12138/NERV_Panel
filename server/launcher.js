'use strict';

/**
 * NERV Panel —— 启动应用
 *
 * 需求文档 5.1 与 7.2：
 *   - 只接受 GET /api/apps 列表里出现过的 id，其他一律拒绝
 *   - 前端不能传任意文件路径过来执行
 *   - 服务端按扫描时记录的启动方式执行（lnk 快捷方式 或 Steam appid）
 */

const { spawn } = require('child_process');
const logger = require('./logger');
const apps = require('./apps');

/* Steam 协议启动，避免依赖 steam.exe 的绝对路径 */
function steamUrl(appid) {
  return 'steam://rungameid/' + appid;
}

function openWithShell(target) {
  return new Promise((resolve, reject) => {
    /* 交给 explorer.exe 处理：快捷方式、可执行文件、steam:// 这样的协议都能打开，
       且不经过 cmd，路径里的 & | ^ 等字符不会被当成命令解释 */
    let child;
    try {
      child = spawn('explorer.exe', [target], { windowsHide: true, detached: true, stdio: 'ignore' });
    } catch (err) {
      reject(err);
      return;
    }
    child.once('error', (err) => reject(err));
    child.once('spawn', () => {
      child.unref();
      resolve();
    });
  });
}

/**
 * 启动一个列表内的项目。
 * @param {string} id 来自 /api/apps 的 id
 * @returns {Promise<{ok:boolean, id:string, name?:string, error?:string, message?:string}>}
 */
async function launch(id) {
  const key = String(id || '').trim();
  if (!key) {
    return { ok: false, error: 'ID_MISSING', message: '缺少要启动的项目 id' };
  }

  /* 列表可能因缓存过期而不存在，先确保已扫描过一次 */
  let item = apps.getById(key);
  if (!item) {
    try {
      await apps.scanApps(true);
    } catch (err) {
      logger.warn('启动前重新扫描失败：' + (err && err.message));
    }
    item = apps.getById(key);
  }
  if (!item) {
    return { ok: false, error: 'ID_NOT_ALLOWED', message: '该项目不在可启动列表中，拒绝执行' };
  }

  try {
    if (item.launch && item.launch.kind === 'steam') {
      await openWithShell(steamUrl(item.launch.appid));
    } else if (item.launch && item.launch.kind === 'lnk') {
      await openWithShell(item.launch.path);
    } else {
      return { ok: false, error: 'LAUNCH_UNSUPPORTED', message: '该项目的启动方式不受支持' };
    }
    logger.info('启动项目：' + item.name + '（' + item.id + '）');
    return { ok: true, id: item.id, name: item.name };
  } catch (err) {
    logger.error('启动失败：' + item.name + ' —— ' + (err && err.message));
    return { ok: false, id: item.id, name: item.name, error: 'EXEC_FAILED', message: '启动失败：' + (err && err.message) };
  }
}

module.exports = { launch };
