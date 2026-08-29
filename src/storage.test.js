const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createStorage } = require('./storage');

// No Upstash config in any of these — exercises the in-memory fallback, which
// is deterministic and doesn't need a real Redis instance.
function memStorage() {
  return createStorage({ upstash: {} });
}

test('hasPasskeys is false until one is added', async () => {
  const storage = memStorage();
  assert.equal(storage.hasPasskeys(), false);
  await storage.addPasskey({
    id: 'cred-1',
    publicKey: 'base64url-pubkey',
    counter: 0,
    transports: ['internal'],
    deviceType: 'singleDevice',
    backedUp: false,
    name: 'Bitwarden',
    createdAt: 1000,
  });
  assert.equal(storage.hasPasskeys(), true);
});

test('listPasskeys omits the public key but keeps display fields', async () => {
  const storage = memStorage();
  await storage.addPasskey({
    id: 'cred-1',
    publicKey: 'secret-key-material',
    counter: 0,
    transports: ['internal'],
    deviceType: 'singleDevice',
    backedUp: false,
    name: 'Bitwarden',
    createdAt: 1000,
  });
  const list = storage.listPasskeys();
  assert.equal(list.length, 1);
  assert.equal(list[0].id, 'cred-1');
  assert.equal(list[0].name, 'Bitwarden');
  assert.equal(list[0].createdAt, 1000);
  assert.equal('publicKey' in list[0], false);
});

test('getPasskey returns the full internal record, including the public key', async () => {
  const storage = memStorage();
  await storage.addPasskey({
    id: 'cred-1',
    publicKey: 'secret-key-material',
    counter: 0,
    transports: ['internal'],
    deviceType: 'singleDevice',
    backedUp: false,
    name: 'Bitwarden',
    createdAt: 1000,
  });
  assert.equal(storage.getPasskey('cred-1').publicKey, 'secret-key-material');
  assert.equal(storage.getPasskey('missing'), null);
});

test('listPasskeyDescriptors is just { id, transports } for every credential', async () => {
  const storage = memStorage();
  await storage.addPasskey({ id: 'a', publicKey: 'x', counter: 0, transports: ['usb'], name: 'A', createdAt: 1 });
  await storage.addPasskey({ id: 'b', publicKey: 'y', counter: 0, transports: ['internal'], name: 'B', createdAt: 2 });
  const descriptors = storage.listPasskeyDescriptors().sort((a, b) => a.id.localeCompare(b.id));
  assert.deepEqual(descriptors, [
    { id: 'a', transports: ['usb'] },
    { id: 'b', transports: ['internal'] },
  ]);
});

test('updatePasskeyCounter bumps the stored counter (replay-attack defense)', async () => {
  const storage = memStorage();
  await storage.addPasskey({ id: 'cred-1', publicKey: 'x', counter: 0, transports: [], name: 'A', createdAt: 1 });
  await storage.updatePasskeyCounter('cred-1', 7);
  assert.equal(storage.getPasskey('cred-1').counter, 7);
});

test('updatePasskeyCounter on an unknown id is a no-op, not a throw', async () => {
  const storage = memStorage();
  await assert.doesNotReject(() => storage.updatePasskeyCounter('nope', 5));
});

test('removePasskey removes it from both listPasskeys and hasPasskeys', async () => {
  const storage = memStorage();
  await storage.addPasskey({ id: 'cred-1', publicKey: 'x', counter: 0, transports: [], name: 'A', createdAt: 1 });
  await storage.removePasskey('cred-1');
  assert.equal(storage.hasPasskeys(), false);
  assert.deepEqual(storage.listPasskeys(), []);
});

test('getFixerOverrides is empty until a fixer host is set', async () => {
  const storage = memStorage();
  assert.deepEqual(storage.getFixerOverrides('guild-1'), {});
  await storage.setFixerHost('guild-1', 'Instagram', 'kkinstagram.com');
  assert.deepEqual(storage.getFixerOverrides('guild-1'), { Instagram: 'kkinstagram.com' });
});

test('setFixerHost for a second platform keeps the first guild override intact', async () => {
  const storage = memStorage();
  await storage.setFixerHost('guild-1', 'Instagram', 'kkinstagram.com');
  await storage.setFixerHost('guild-1', 'Reddit', 'vxreddit.com');
  assert.deepEqual(storage.getFixerOverrides('guild-1'), {
    Instagram: 'kkinstagram.com',
    Reddit: 'vxreddit.com',
  });
});

test('resetFixerHost removes just the one platform override', async () => {
  const storage = memStorage();
  await storage.setFixerHost('guild-1', 'Instagram', 'kkinstagram.com');
  await storage.setFixerHost('guild-1', 'Reddit', 'vxreddit.com');
  await storage.resetFixerHost('guild-1', 'Instagram');
  assert.deepEqual(storage.getFixerOverrides('guild-1'), { Reddit: 'vxreddit.com' });
});

test('resetFixerHost on an unset platform is a no-op', async () => {
  const storage = memStorage();
  await assert.doesNotReject(() => storage.resetFixerHost('guild-1', 'Instagram'));
  assert.deepEqual(storage.getFixerOverrides('guild-1'), {});
});

test('isChannelIgnored is false until a channel is added', async () => {
  const storage = memStorage();
  assert.equal(storage.isChannelIgnored('guild-1', 'chan-1'), false);
  await storage.addIgnoredChannel('guild-1', 'chan-1');
  assert.equal(storage.isChannelIgnored('guild-1', 'chan-1'), true);
  assert.deepEqual(storage.getIgnoredChannels('guild-1'), ['chan-1']);
});

test('removeIgnoredChannel removes just the one channel', async () => {
  const storage = memStorage();
  await storage.addIgnoredChannel('guild-1', 'chan-1');
  await storage.addIgnoredChannel('guild-1', 'chan-2');
  await storage.removeIgnoredChannel('guild-1', 'chan-1');
  assert.equal(storage.isChannelIgnored('guild-1', 'chan-1'), false);
  assert.equal(storage.isChannelIgnored('guild-1', 'chan-2'), true);
});

test('removeIgnoredChannel on a guild with no ignored channels is a no-op', async () => {
  const storage = memStorage();
  await assert.doesNotReject(() => storage.removeIgnoredChannel('guild-1', 'chan-1'));
  assert.deepEqual(storage.getIgnoredChannels('guild-1'), []);
});

test('isWebhookRepostEnabled is false until enabled, and toggles back off', async () => {
  const storage = memStorage();
  assert.equal(storage.isWebhookRepostEnabled('guild-1'), false);
  await storage.setWebhookRepostEnabled('guild-1', true);
  assert.equal(storage.isWebhookRepostEnabled('guild-1'), true);
  await storage.setWebhookRepostEnabled('guild-1', false);
  assert.equal(storage.isWebhookRepostEnabled('guild-1'), false);
});
