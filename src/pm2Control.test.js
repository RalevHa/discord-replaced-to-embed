const { test } = require('node:test');
const assert = require('node:assert/strict');
const { summarize } = require('./pm2Control');

test('summarize returns null for a missing process', () => {
  assert.equal(summarize(null), null);
});

test('summarize extracts status/pid/restarts/memory/cpu from a describe() entry', () => {
  const proc = {
    pid: 1234,
    monit: { memory: 52428800, cpu: 3 },
    pm2_env: { name: 'discord-bot', status: 'online', restart_time: 2, pm_uptime: Date.now() - 60000 },
  };
  const s = summarize(proc);
  assert.equal(s.name, 'discord-bot');
  assert.equal(s.status, 'online');
  assert.equal(s.pid, 1234);
  assert.equal(s.restarts, 2);
  assert.equal(s.memoryBytes, 52428800);
  assert.equal(s.cpuPercent, 3);
  assert.ok(s.uptimeMs >= 60000 && s.uptimeMs < 61000);
});

test('summarize reports zero uptime when the process is not online', () => {
  const proc = { pid: null, monit: {}, pm2_env: { name: 'discord-bot', status: 'stopped', restart_time: 5, pm_uptime: Date.now() - 60000 } };
  assert.equal(summarize(proc).uptimeMs, 0);
});
