'use strict';

/**
 * NERV Panel —— 日志模块
 *
 * 需求第 7.2 节：日志写本地文件，按天/大小滚动。
 * 本模块把日志写到 logs/ 目录：按天切分文件，单文件超过 8MB 时追加序号切分。
 */

const fs = require('fs');
const path = require('path');
const { ROOT_DIR } = require('./config');

const LOG_DIR = path.join(ROOT_DIR, 'logs');
const MAX_BYTES = 8 * 1024 * 1024;
const MAX_FILES = 30;

function ensureDir() {
  if (!fs.existsSync(LOG_DIR)) fs.mkdirSync(LOG_DIR, { recursive: true });
}

function pad(n) {
  return String(n).padStart(2, '0');
}

function dayStamp(d) {
  return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
}

function timeStamp(d) {
  return dayStamp(d) + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes()) + ':' + pad(d.getSeconds());
}

let currentDay = '';
let currentIndex = 0;
let currentSize = 0;
let currentFile = '';
/* 上一次做过日志清理的日期：跨天时再清一次，避免长期运行时旧日志无限堆积 */
let cleanedDay = '';

function pickFile(now) {
  const day = dayStamp(now);
  if (day !== currentDay) {
    currentDay = day;
    currentIndex = 0;
    currentFile = '';
  }
  if (!currentFile) {
    let idx = currentIndex;
    for (;;) {
      const name = idx === 0 ? day + '.log' : day + '.' + idx + '.log';
      const full = path.join(LOG_DIR, name);
      let size = 0;
      try {
        size = fs.statSync(full).size;
      } catch (_) {
        size = 0;
      }
      if (size < MAX_BYTES) {
        currentFile = full;
        currentSize = size;
        currentIndex = idx;
        break;
      }
      idx += 1;
    }
  } else if (currentSize >= MAX_BYTES) {
    currentIndex += 1;
    currentFile = '';
    return pickFile(now);
  }
  return currentFile;
}

function rotateCleanup() {
  try {
    const files = fs.readdirSync(LOG_DIR)
      .filter((f) => f.endsWith('.log'))
      .map((f) => ({ f, t: fs.statSync(path.join(LOG_DIR, f)).mtimeMs }))
      .sort((a, b) => b.t - a.t);
    for (const item of files.slice(MAX_FILES)) {
      fs.unlinkSync(path.join(LOG_DIR, item.f));
    }
  } catch (_) {
    /* 清理失败不影响主流程 */
  }
}

function write(level, args) {
  const now = new Date();
  const text = args.map((a) => {
    if (typeof a === 'string') return a;
    try {
      return JSON.stringify(a);
    } catch (_) {
      return String(a);
    }
  }).join(' ');
  const line = '[' + timeStamp(now) + '] [' + level + '] ' + text;

  if (level === 'ERROR') console.error(line);
  else console.log(line);

  try {
    ensureDir();
    const file = pickFile(now);
    if (currentDay !== cleanedDay) {
      cleanedDay = currentDay;
      rotateCleanup();
    }
    fs.appendFileSync(file, line + '\n', 'utf8');
    currentSize += Buffer.byteLength(line, 'utf8') + 1;
  } catch (_) {
    /* 磁盘写入异常时只保留控制台输出 */
  }
}

const logger = {
  info: (...args) => write('INFO', args),
  warn: (...args) => write('WARN', args),
  error: (...args) => write('ERROR', args),
  init: () => {
    ensureDir();
    rotateCleanup();
  },
  rotateCleanup,
  LOG_DIR
};

module.exports = logger;
