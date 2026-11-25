'use strict';

/**
 * NERV Panel —— 常用软件（favorites）
 *
 * 需求文档 4 节与 5.2：
 *   - config.json 的 favoriteAppIds 只存 id，不存路径，顺序即显示顺序
 *   - GET /api/favorites 按该顺序从**全量扫描结果**解析出来（含 running）
 *   - POST /api/favorites 只接受 {action:"add"|"remove", id}，id 必须在全量列表内
 *
 * 为什么 id 必须重新校验：config.json 是可以手改的，
 * 里面可能留着已经卸载掉的软件 id。解析时跳过找不到的，不报错也不编造。
 */

const apps = require('./apps');
const { getConfig, saveConfig } = require('./config');
const logger = require('./logger');

/**
 * 解析常用列表。返回的每一项与 /api/apps 同构，另外保持 favoriteAppIds 的顺序。
 * 找不到的 id 直接跳过（软件可能已经卸载）。
 */
async function list() {
  const all = await apps.scanApps();
  const ids = getConfig().favoriteAppIds || [];
  const byId = new Map(all.map((a) => [a.id, a]));
  const picked = [];
  ids.forEach((id) => {
    const item = byId.get(id);
    if (item) picked.push(item);
  });
  return apps.withRunning(picked);
}

/**
 * 写操作互斥：Promise 链确保同一时刻只有一个写操作在途，
 * 防止并发请求导致 favoriteAppIds 数据互相覆盖丢失。
 */
let _writeChain = Promise.resolve();

/**
 * 增删常用。只写 id，不写路径。
 * @param {'add'|'remove'} action
 * @param {string} id
 */
async function update(action, id) {
  const run = () => _runUpdate(action, id);
  const promise = _writeChain.then(run, run);
  _writeChain = promise.then(undefined, () => {});
  return promise;
}

/**
 * 增删常用的实际逻辑（由互斥 Promise 链顺序调用）。
 * @param {'add'|'remove'} action
 * @param {string} id
 */
async function _runUpdate(action, id) {
  const act = String(action || '').trim();
  if (act !== 'add' && act !== 'remove') {
    return { ok: false, error: 'ACTION_NOT_ALLOWED', message: '只支持 add 和 remove' };
  }
  const key = String(id || '').trim();
  if (!key) {
    return { ok: false, error: 'ID_REQUIRED', message: '缺少项目 id' };
  }

  const all = await apps.scanApps();
  const exists = all.some((a) => a.id === key);
  if (!exists) {
    return { ok: false, error: 'ID_NOT_ALLOWED', message: '这个项目不在可启动列表里' };
  }

  const current = (getConfig().favoriteAppIds || []).slice();
  let next;
  if (act === 'add') {
    if (current.indexOf(key) >= 0) {
      /* 已经在里面，不重复加，也不算失败 */
      next = current;
    } else {
      next = current.concat([key]);
    }
  } else {
    next = current.filter((x) => x !== key);
  }

  if (next.length !== current.length || next.some((x, i) => x !== current[i])) {
    saveConfig({ favoriteAppIds: next });
    logger.info('常用软件' + (act === 'add' ? '添加' : '移除') + '：' + key);
  }

  const resolved = await list();
  return { ok: true, favorites: resolved };
}

module.exports = { list, update };
