const { test } = require('node:test');
const assert = require('node:assert/strict');
const { parseDice, rollDice, MAX_COUNT, MAX_SIDES } = require('./dice');

test('parses plain NdM', () => {
  assert.deepEqual(parseDice('2d6'), { count: 2, sides: 6, modifier: 0 });
});

test('parses NdM with positive and negative modifiers', () => {
  assert.deepEqual(parseDice('1d20+5'), { count: 1, sides: 20, modifier: 5 });
  assert.deepEqual(parseDice('2d6-1'), { count: 2, sides: 6, modifier: -1 });
});

test('is case-insensitive and trims whitespace', () => {
  assert.deepEqual(parseDice(' 1D100 '), { count: 1, sides: 100, modifier: 0 });
});

test('rejects garbage input', () => {
  assert.equal(parseDice('nope'), null);
  assert.equal(parseDice('d20'), null);
  assert.equal(parseDice('2x6'), null);
  assert.equal(parseDice(''), null);
});

test('rejects counts/sides over the caps', () => {
  assert.equal(parseDice(`${MAX_COUNT + 1}d6`), null);
  assert.equal(parseDice(`1d${MAX_SIDES + 1}`), null);
  assert.equal(parseDice('0d6'), null);
});

test('rollDice returns rolls within [1, sides] and a matching total', () => {
  const spec = { count: 5, sides: 6, modifier: 3 };
  const { rolls, total } = rollDice(spec);
  assert.equal(rolls.length, 5);
  for (const r of rolls) assert.ok(r >= 1 && r <= 6);
  assert.equal(total, rolls.reduce((a, b) => a + b, 0) + 3);
});
