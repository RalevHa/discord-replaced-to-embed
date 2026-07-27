const { test } = require('node:test');
const assert = require('node:assert/strict');
const { restartProcess, stopProcess, startProcess } = require('./deployWebhook');

// Only the validation guard is tested here — a valid call spawns a real
// `powershell.exe` subprocess, which isn't available (or safe to trigger) in
// this test environment.

test('rejects process names that aren\'t safe to interpolate into a shell command', () => {
  assert.throws(() => restartProcess('discord-bot; rm -rf /'), /Invalid pm2 process name/);
  assert.throws(() => stopProcess('$(whoami)'), /Invalid pm2 process name/);
  assert.throws(() => startProcess('name with spaces'), /Invalid pm2 process name/);
});
