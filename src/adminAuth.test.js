const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createAdminAuth, createLoginLockout, timingSafeEqualStr, clientIp } = require('./adminAuth');

function fakeClock(start = 1000) {
  let t = start;
  return { now: () => t, advance: (ms) => (t += ms) };
}

function fakeReqRes(body) {
  const req = { body, session: {}, headers: {}, ip: '1.2.3.4' };
  const res = {
    statusCode: 200,
    body: undefined,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    },
  };
  return { req, res };
}

function fakeStorage(hasPasskeys) {
  return { hasPasskeys: () => hasPasskeys };
}

test('timingSafeEqualStr matches equal strings and rejects mismatches/different lengths', () => {
  assert.equal(timingSafeEqualStr('hunter2', 'hunter2'), true);
  assert.equal(timingSafeEqualStr('hunter2', 'hunter3'), false);
  assert.equal(timingSafeEqualStr('short', 'longerpassword'), false);
});

test('allows attempts under the threshold', () => {
  const lockout = createLoginLockout({ maxAttempts: 5, lockoutMs: 1000 });
  for (let i = 0; i < 4; i++) lockout.recordFailure('1.2.3.4');
  assert.equal(lockout.isLocked('1.2.3.4'), false);
});

test('locks out after reaching maxAttempts, and unlocks after lockoutMs passes', () => {
  const clock = fakeClock();
  const lockout = createLoginLockout({ maxAttempts: 3, lockoutMs: 5000, now: clock.now });
  lockout.recordFailure('1.2.3.4');
  lockout.recordFailure('1.2.3.4');
  assert.equal(lockout.isLocked('1.2.3.4'), false);
  lockout.recordFailure('1.2.3.4');
  assert.equal(lockout.isLocked('1.2.3.4'), true);

  clock.advance(5001);
  assert.equal(lockout.isLocked('1.2.3.4'), false);
});

test('clearFailures resets the counter (successful login forgets prior failures)', () => {
  const lockout = createLoginLockout({ maxAttempts: 3, lockoutMs: 5000 });
  lockout.recordFailure('1.2.3.4');
  lockout.recordFailure('1.2.3.4');
  lockout.clearFailures('1.2.3.4');
  lockout.recordFailure('1.2.3.4');
  assert.equal(lockout.isLocked('1.2.3.4'), false);
});

test('clientIp prefers CF-Connecting-IP over req.ip (unspoofable vs. attacker-controlled X-Forwarded-For)', () => {
  assert.equal(clientIp({ headers: { 'cf-connecting-ip': '9.9.9.9' }, ip: '1.2.3.4' }), '9.9.9.9');
  assert.equal(clientIp({ headers: {}, ip: '1.2.3.4' }), '1.2.3.4');
});

test('handleLogin: correct password with no passkeys registered logs in fully (bootstrap case)', () => {
  const auth = createAdminAuth({ adminPassword: 'hunter2', sessionSecret: 'x' }, fakeStorage(false));
  const { req, res } = fakeReqRes({ password: 'hunter2' });
  auth.handleLogin(req, res);
  assert.equal(req.session.authenticated, true);
  assert.equal(req.session.passwordVerified, undefined);
  assert.deepEqual(res.body, { ok: true, requiresPasskey: false });
});

test('handleLogin: correct password with a passkey registered only marks passwordVerified, not authenticated', () => {
  const auth = createAdminAuth({ adminPassword: 'hunter2', sessionSecret: 'x' }, fakeStorage(true));
  const { req, res } = fakeReqRes({ password: 'hunter2' });
  auth.handleLogin(req, res);
  assert.equal(req.session.authenticated, false);
  assert.equal(req.session.passwordVerified, true);
  assert.deepEqual(res.body, { ok: true, requiresPasskey: true });
});

test('handleLogin: wrong password never sets passwordVerified even with a passkey registered', () => {
  const auth = createAdminAuth({ adminPassword: 'hunter2', sessionSecret: 'x' }, fakeStorage(true));
  const { req, res } = fakeReqRes({ password: 'wrong' });
  auth.handleLogin(req, res);
  assert.equal(res.statusCode, 401);
  assert.equal(req.session.authenticated, undefined);
  assert.equal(req.session.passwordVerified, undefined);
});

test('handleSession reports passwordVerified so the frontend can resume the 2nd step after a refresh', () => {
  const auth = createAdminAuth({ adminPassword: 'hunter2', sessionSecret: 'x' }, fakeStorage(true));
  const { req, res } = fakeReqRes();
  req.session = { authenticated: false, passwordVerified: true };
  auth.handleSession(req, res);
  assert.deepEqual(res.body, { authenticated: false, passwordVerified: true });
});

test('different keys (IPs) are tracked independently', () => {
  const lockout = createLoginLockout({ maxAttempts: 2, lockoutMs: 5000 });
  lockout.recordFailure('1.1.1.1');
  lockout.recordFailure('1.1.1.1');
  assert.equal(lockout.isLocked('1.1.1.1'), true);
  assert.equal(lockout.isLocked('2.2.2.2'), false);
});
