// Handles POST /deploy-webhook: GitHub calls this the moment a push lands, so
// the bot redeploys instantly instead of waiting for scripts/auto-deploy.ps1's
// next scheduled poll. Verifies GitHub's HMAC signature, then re-runs that same
// script (detached, so it survives this process being restarted mid-deploy).

const crypto = require('crypto');
const path = require('path');
const { spawn } = require('child_process');

const DEPLOY_SCRIPT = path.join(__dirname, '..', 'scripts', 'auto-deploy.ps1');

function isValidSignature(secret, body, signatureHeader) {
  const expected = `sha256=${crypto.createHmac('sha256', secret).update(body).digest('hex')}`;
  const a = Buffer.from(signatureHeader || '');
  const b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function triggerDeploy() {
  spawn('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', DEPLOY_SCRIPT], {
    detached: true,
    stdio: 'ignore',
    windowsHide: true,
  }).unref();
}

/** Node http handler for POST /deploy-webhook. */
function handleDeployWebhook(req, res, config) {
  if (!config.deployWebhookSecret) {
    res.writeHead(404).end();
    return;
  }

  const chunks = [];
  req.on('data', (c) => chunks.push(c));
  req.on('end', () => {
    const body = Buffer.concat(chunks);

    if (!isValidSignature(config.deployWebhookSecret, body, req.headers['x-hub-signature-256'])) {
      res.writeHead(401).end('bad signature');
      return;
    }

    const event = req.headers['x-github-event'];
    if (event === 'ping') {
      res.writeHead(200).end('pong');
      return;
    }

    if (event === 'push') {
      let payload;
      try {
        payload = JSON.parse(body.toString('utf8'));
      } catch {
        res.writeHead(400).end('bad json');
        return;
      }
      if (payload.ref === `refs/heads/${config.deployBranch}`) {
        console.log(`Deploy webhook: push to ${config.deployBranch}, redeploying...`);
        triggerDeploy();
      }
    }

    res.writeHead(200).end('ok');
  });
}

module.exports = { handleDeployWebhook, isValidSignature };
