const { test } = require('node:test');
const assert = require('node:assert/strict');
const { parse, serialize, pairsOf, applyPairs } = require('./envFile');

const SAMPLE = [
  '# Discord bot token',
  'DISCORD_BOT_TOKEN=abc123',
  '',
  '# comma-separated guild IDs',
  'ALLOWED_GUILD_IDS=111,222',
  'PORT=3000',
].join('\n');

test('parse -> serialize round-trips unquoted values, comments, and blanks exactly', () => {
  assert.equal(serialize(parse(SAMPLE)), SAMPLE);
});

test('pairsOf extracts only key/value pairs, in order', () => {
  assert.deepEqual(pairsOf(parse(SAMPLE)), [
    { key: 'DISCORD_BOT_TOKEN', value: 'abc123' },
    { key: 'ALLOWED_GUILD_IDS', value: '111,222' },
    { key: 'PORT', value: '3000' },
  ]);
});

test('values with spaces/quotes/# are quoted on serialize and unquoted back on parse', () => {
  const lines = [{ type: 'pair', key: 'MSG', value: 'hello "world" # not a comment' }];
  const text = serialize(lines);
  assert.equal(text, 'MSG="hello \\"world\\" # not a comment"');
  assert.deepEqual(parse(text), [{ type: 'pair', key: 'MSG', value: 'hello "world" # not a comment' }]);
});

test('applyPairs updates an existing value in place, keeping comments/blanks untouched', () => {
  const result = applyPairs(SAMPLE, [
    { key: 'DISCORD_BOT_TOKEN', value: 'abc123' },
    { key: 'ALLOWED_GUILD_IDS', value: '333' },
    { key: 'PORT', value: '3000' },
  ]);
  assert.equal(
    result,
    ['# Discord bot token', 'DISCORD_BOT_TOKEN=abc123', '', '# comma-separated guild IDs', 'ALLOWED_GUILD_IDS=333', 'PORT=3000'].join(
      '\n'
    )
  );
});

test('applyPairs drops keys missing from the desired list', () => {
  const result = applyPairs(SAMPLE, [{ key: 'DISCORD_BOT_TOKEN', value: 'abc123' }]);
  assert.deepEqual(pairsOf(parse(result)), [{ key: 'DISCORD_BOT_TOKEN', value: 'abc123' }]);
});

test('applyPairs appends brand-new keys at the end', () => {
  const result = applyPairs(SAMPLE, [
    { key: 'DISCORD_BOT_TOKEN', value: 'abc123' },
    { key: 'ALLOWED_GUILD_IDS', value: '111,222' },
    { key: 'PORT', value: '3000' },
    { key: 'NEW_VAR', value: 'new value' },
  ]);
  assert.ok(result.endsWith('NEW_VAR="new value"'));
});
