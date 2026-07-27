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

/** Roll `count` dice of `sides` and sum them plus the modifier. */
function rollDice({ count, sides, modifier }) {
  const rolls = Array.from({ length: count }, () => 1 + Math.floor(Math.random() * sides));
  const total = rolls.reduce((sum, r) => sum + r, 0) + modifier;
  return { rolls, total };
}

module.exports = { parseDice, rollDice, MAX_COUNT, MAX_SIDES };
