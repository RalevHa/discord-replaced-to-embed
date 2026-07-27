const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createPasskeyAuth } = require('./passkeyAuth');

// The full register/login ceremonies need a real browser authenticator to
// produce a signed response — that's what @simplewebauthn/server's own test
// suite covers. What's ours to get right (and what these test) is the gating
// around it: the 2FA session checks, and enabled()'s opt-in switch.

function fakeReqRes({ body, session, params } = {}) {
  const req = { body, session: session || {}, params: params || {} };
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

function fakeStorage(overrides = {}) {
  return {
    listPasskeyDescriptors: () => [],
    listPasskeys: () => [],
    getPasskey: () => null,
    addPasskey: async () => {},
    removePasskey: async () => {},
    updatePasskeyCounter: async () => {},
    ...overrides,
  };
}

test('enabled() is false with no adminPublicUrl configured', () => {
  const passkey = createPasskeyAuth({ config: { adminPublicUrl: '' }, storage: fakeStorage() });
  assert.equal(passkey.enabled(), false);
});

test('enabled() is true once adminPublicUrl is set', () => {
  const passkey = createPasskeyAuth({
    config: { adminPublicUrl: 'https://fb.example.com' },
    storage: fakeStorage(),
  });
  assert.equal(passkey.enabled(), true);
});

test('handleLoginOptions rejects when the password step has not been completed', async () => {
  const passkey = createPasskeyAuth({
    config: { adminPublicUrl: 'https://fb.example.com' },
    storage: fakeStorage(),
  });
  const { req, res } = fakeReqRes({ session: { passwordVerified: false } });
  await passkey.handleLoginOptions(req, res);
  assert.equal(res.statusCode, 401);
});

test('handleLoginOptions rejects when no passkeys are registered even if password step passed', async () => {
  const passkey = createPasskeyAuth({
    config: { adminPublicUrl: 'https://fb.example.com' },
    storage: fakeStorage({ listPasskeyDescriptors: () => [] }),
  });
  const { req, res } = fakeReqRes({ session: { passwordVerified: true } });
  await passkey.handleLoginOptions(req, res);
  assert.equal(res.statusCode, 400);
});

test('handleLoginOptions issues a challenge and stores it on the session once gated checks pass', async () => {
  const passkey = createPasskeyAuth({
    config: { adminPublicUrl: 'https://fb.example.com' },
    storage: fakeStorage({ listPasskeyDescriptors: () => [{ id: 'cred-1', transports: ['internal'] }] }),
  });
  const { req, res } = fakeReqRes({ session: { passwordVerified: true } });
  await passkey.handleLoginOptions(req, res);
  assert.equal(res.statusCode, 200);
  assert.ok(req.session.currentChallenge);
  assert.ok(res.body.challenge);
});

test('handleLoginVerify rejects when the password step has not been completed', async () => {
  const passkey = createPasskeyAuth({
    config: { adminPublicUrl: 'https://fb.example.com' },
    storage: fakeStorage(),
  });
  const { req, res } = fakeReqRes({ session: { passwordVerified: false }, body: { response: { id: 'cred-1' } } });
  await passkey.handleLoginVerify(req, res);
  assert.equal(res.statusCode, 401);
  assert.equal(req.session.authenticated, undefined);
});

test('handleLoginVerify rejects an unknown credential id without ever setting authenticated', async () => {
  const passkey = createPasskeyAuth({
    config: { adminPublicUrl: 'https://fb.example.com' },
    storage: fakeStorage({ getPasskey: () => null }),
  });
  const { req, res } = fakeReqRes({
    session: { passwordVerified: true, currentChallenge: 'abc' },
    body: { response: { id: 'unknown-cred' } },
  });
  await passkey.handleLoginVerify(req, res);
  assert.equal(res.statusCode, 400);
  assert.notEqual(req.session.authenticated, true);
});

test('handleList and handleRemove pass through to storage', async () => {
  const removed = [];
  const passkey = createPasskeyAuth({
    config: { adminPublicUrl: 'https://fb.example.com' },
    storage: fakeStorage({
      listPasskeys: () => [{ id: 'cred-1', name: 'Bitwarden' }],
      removePasskey: async (id) => removed.push(id),
    }),
  });

  const list = fakeReqRes();
  passkey.handleList(list.req, list.res);
  assert.deepEqual(list.res.body, [{ id: 'cred-1', name: 'Bitwarden' }]);

  const del = fakeReqRes({ params: { id: 'cred-1' } });
  await passkey.handleRemove(del.req, del.res);
  assert.deepEqual(removed, ['cred-1']);
  assert.deepEqual(del.res.body, { ok: true });
});
