// Dice notation parsing/rolling for the /roll command, e.g. "2d6+3".

const DICE_RE = /^(\d{1,2})d(\d{1,4})([+-]\d{1,3})?$/i;
const MAX_COUNT = 100;
const MAX_SIDES = 1000;

/** Parse "NdM" (+/-modifier optional). Returns null if invalid or over caps. */
function parseDice(input) {
  const match = DICE_RE.exec((input || '').trim());
  if (!match) return null;

  const count = Number(match[1]);
  const sides = Number(match[2]);
  const modifier = match[3] ? Number(match[3]) : 0;
  if (count < 1 || count > MAX_COUNT || sides < 1 || sides > MAX_SIDES) return null;

  return { count, sides, modifier };
}

function pseudoRolls(count, sides) {
  return Array.from({ length: count }, () => 1 + Math.floor(Math.random() * sides));
}

// ponytail: random.org's free integer API has a daily quota per IP and can
// error/timeout, so fall back to Math.random rather than blocking the roll.
async function trueRandomRolls(count, sides) {
  const url = `https://www.random.org/integers/?num=${count}&min=1&max=${sides}&col=1&base=10&format=plain&rnd=new`;
  const res = await fetch(url, { signal: AbortSignal.timeout(3000) });
  const text = await res.text();
  if (!res.ok || /error/i.test(text)) throw new Error(`random.org: ${text.trim()}`);
  const rolls = text.trim().split('\n').map(Number);
  if (rolls.length !== count || rolls.some(Number.isNaN)) throw new Error('random.org: bad response');
  return rolls;
}

/** Roll `count` dice of `sides` and sum them plus the modifier. Uses random.org when available, else Math.random. */
async function rollDice({ count, sides, modifier }) {
  const rolls = await trueRandomRolls(count, sides).catch(() => pseudoRolls(count, sides));
  const total = rolls.reduce((sum, r) => sum + r, 0) + modifier;
  return { rolls, total };
}

module.exports = { parseDice, rollDice, MAX_COUNT, MAX_SIDES };
