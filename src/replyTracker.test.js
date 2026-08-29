const { test } = require('node:test');
const assert = require('node:assert/strict');
const replyTracker = require('./replyTracker');

// replyTracker is a single shared module-level Map pair, so each test uses its
// own unlikely-to-collide ids rather than resetting global state between tests.

test('set() tracks both directions: original -> reply and reply -> original', () => {
  replyTracker.set('orig-1', 'reply-1');
  assert.equal(replyTracker.get('orig-1'), 'reply-1');
  assert.equal(replyTracker.getOriginalId('reply-1'), 'orig-1');
});

test('delete() removes both directions', () => {
  replyTracker.set('orig-2', 'reply-2');
  replyTracker.delete('orig-2');
  assert.equal(replyTracker.get('orig-2'), undefined);
  assert.equal(replyTracker.getOriginalId('reply-2'), undefined);
});

test('getOriginalId() on an untracked reply id is undefined', () => {
  assert.equal(replyTracker.getOriginalId('never-tracked'), undefined);
});

test('delete() on an untracked original id is a no-op, not a throw', () => {
  assert.doesNotThrow(() => replyTracker.delete('never-tracked'));
});
