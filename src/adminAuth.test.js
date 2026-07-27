const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createLoginLockout, timingSafeEqualStr, clientIp } = require('./adminAuth');

function fakeClock(start = 1000) {
  let t = start;
  return { now: () => t, advance: (ms) => (t += ms) };
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

test('different keys (IPs) are tracked independently', () => {
  const lockout = createLoginLockout({ maxAttempts: 2, lockoutMs: 5000 });
  lockout.recordFailure('1.1.1.1');
  lockout.recordFailure('1.1.1.1');
  assert.equal(lockout.isLocked('1.1.1.1'), true);
  assert.equal(lockout.isLocked('2.2.2.2'), false);
});
