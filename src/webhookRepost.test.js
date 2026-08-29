const { test } = require('node:test');
const assert = require('node:assert/strict');
const { trackRepost, getRepostAuthorId, untrackRepost } = require('./webhookRepost');

// Only the pure tracking map is unit-tested here — getOrCreateWebhook/repost
// need a real discord.js channel/message/webhook and aren't, consistent with
// every other Discord-side event handler in this codebase.

test('trackRepost records the impersonated author for a repost message', () => {
  trackRepost('repost-1', 'author-1');
  assert.equal(getRepostAuthorId('repost-1'), 'author-1');
});

test('untrackRepost removes it', () => {
  trackRepost('repost-2', 'author-2');
  untrackRepost('repost-2');
  assert.equal(getRepostAuthorId('repost-2'), undefined);
});

test('getRepostAuthorId on an untracked message id is undefined', () => {
  assert.equal(getRepostAuthorId('never-tracked'), undefined);
});
