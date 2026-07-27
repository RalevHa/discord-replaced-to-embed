// Read-only pm2 status/logs for the admin panel, via the `pm2` JS API (talks to
// the local pm2 daemon over IPC — same daemon the `pm2` CLI uses).
//
// Deliberately read-only: restart/stop/start go through deployWebhook.js's
// detached-subprocess helpers instead, since calling pm2.restart()/stop() on
// THIS process from in-process code risks getting killed before the HTTP
// response flushes.

const fs = require('fs');
const pm2 = require('pm2');

function withPm2(fn) {
  return new Promise((resolve, reject) => {
    pm2.connect((err) => {
      if (err) {
        reject(err);
        return;
      }
      fn((err2, result) => {
        pm2.disconnect();
        if (err2) reject(err2);
        else resolve(result);
      });
    });
  });
}

/** Pure — pulls the fields the admin panel cares about out of a pm2 describe() entry. */
function summarize(proc) {
  if (!proc) return null;
  const env = proc.pm2_env || {};
  return {
    name: env.name,
    status: env.status, // 'online' | 'stopped' | 'stopping' | 'errored' | ...
    pid: proc.pid || null,
    uptimeMs: env.status === 'online' && env.pm_uptime ? Date.now() - env.pm_uptime : 0,
    restarts: env.restart_time || 0,
    memoryBytes: proc.monit?.memory || 0,
    cpuPercent: proc.monit?.cpu || 0,
  };
}

async function describe(name) {
  const list = await withPm2((cb) => pm2.describe(name, cb));
  return list[0] || null;
}

/** @returns {Promise<object|null>} null if pm2 isn't managing a process by this name. */
async function status(name) {
  return summarize(await describe(name));
}

function tailFile(filePath, maxLines) {
  if (!filePath) return [];
  try {
    return fs.readFileSync(filePath, 'utf8').trim().split('\n').slice(-maxLines);
  } catch {
    return [];
  }
}

/** Tail this process's pm2-managed stdout/stderr log files. */
async function logs(name, maxLines = 50) {
  const proc = await describe(name);
  const env = proc?.pm2_env || {};
  return {
    out: tailFile(env.pm_out_log_path, maxLines),
    error: tailFile(env.pm_err_log_path, maxLines),
  };
}

module.exports = { status, logs, summarize };
