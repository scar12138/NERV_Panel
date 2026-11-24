'use strict';

/**
 * NERV Panel —— 电源与系统操作
 *
 * 需求文档 5.4 与 7.2：
 *   - 电源操作只接受 shutdown / restart / sleep / lock / logout
 *   - 服务端二次校验白名单，白名单之外的 action 直接拒绝
 *   - 不允许前端传入任意命令或文件路径
 */

const os = require('os');
const { execFile } = require('child_process');
const logger = require('./logger');

/* 白名单：action -> 实际执行的系统命令（固定参数，不接受前端拼接） */
const POWER_ACTIONS = {
  lock: { label: '锁屏', file: 'rundll32.exe', args: ['user32.dll,LockWorkStation'] },
  logout: { label: '注销', file: 'shutdown.exe', args: ['/l'] },
  sleep: { label: '睡眠', file: 'rundll32.exe', args: ['powrprof.dll,SetSuspendState', '0,1,0'] },
  restart: { label: '重启', file: 'shutdown.exe', args: ['/r', '/t', '3'] },
  shutdown: { label: '关机', file: 'shutdown.exe', args: ['/s', '/t', '3'] }
};

/* 系统操作白名单（均为 Windows 自带、可真实执行的命令）
   键名严格照需求文档第 4 节接口表：只接受 displayOff / taskManager */
const SYSTEM_ACTIONS = {
  /* 熄灭显示器：向窗口广播 WM_SYSCOMMAND / SC_MONITORPOWER 2 */
  displayOff: {
    label: '熄灭显示器',
    file: 'powershell.exe',
    args: [
      '-NoProfile',
      '-NonInteractive',
      '-ExecutionPolicy',
      'Bypass',
      '-Command',
      '(Add-Type -MemberDefinition \'[DllImport("user32.dll")]public static extern IntPtr SendMessage(IntPtr hWnd,int Msg,IntPtr wParam,IntPtr lParam);\' -Name Win32 -Namespace NERV -PassThru)::SendMessage([IntPtr]0xffff,0x0112,[IntPtr]0xF170,[IntPtr]2)'
    ]
  },
  taskManager: { label: '打开任务管理器', file: 'taskmgr.exe', args: [] }
};

function runDetached(file, args) {
  return new Promise((resolve, reject) => {
    try {
      const child = execFile(file, args, { windowsHide: true, timeout: 15000 }, (err) => {
        if (err) reject(err);
        else resolve();
      });
      child.unref && child.unref();
    } catch (err) {
      reject(err);
    }
  });
}

/**
 * 执行电源操作。
 * @param {string} action 前端传入的动作名
 * @returns {Promise<{ok:boolean, action:string, label?:string, error?:string, message?:string}>}
 */
async function power(action) {
  const key = String(action || '').trim();
  const def = Object.prototype.hasOwnProperty.call(POWER_ACTIONS, key) ? POWER_ACTIONS[key] : null;
  if (!def) {
    return { ok: false, error: 'ACTION_NOT_ALLOWED', message: '不支持的电源操作：' + (key || '(空)') };
  }
  if (/^(darwin|linux)/i.test(os.platform())) {
    return { ok: false, error: 'PLATFORM_UNSUPPORTED', message: '电源操作仅支持 Windows' };
  }
  try {
    await runDetached(def.file, def.args);
    logger.info('执行电源操作：' + def.label + '（' + key + '）');
    return { ok: true, action: key, label: def.label };
  } catch (err) {
    logger.error('电源操作失败：' + key + ' —— ' + (err && err.message));
    return { ok: false, action: key, error: 'EXEC_FAILED', message: '执行失败：' + (err && err.message) };
  }
}

/**
 * 执行系统操作（熄灭显示器 / 打开任务管理器）。
 */
async function systemAction(action) {
  const key = String(action || '').trim();
  const def = Object.prototype.hasOwnProperty.call(SYSTEM_ACTIONS, key) ? SYSTEM_ACTIONS[key] : null;
  if (!def) {
    return { ok: false, error: 'ACTION_NOT_ALLOWED', message: '不支持的系统操作：' + (key || '(空)') };
  }
  try {
    await runDetached(def.file, def.args);
    logger.info('执行系统操作：' + def.label + '（' + key + '）');
    return { ok: true, action: key, label: def.label };
  } catch (err) {
    logger.error('系统操作失败：' + key + ' —— ' + (err && err.message));
    return { ok: false, action: key, error: 'EXEC_FAILED', message: '执行失败：' + (err && err.message) };
  }
}

module.exports = { power, systemAction, POWER_ACTIONS, SYSTEM_ACTIONS };
