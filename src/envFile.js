// Round-trip-safe .env parsing for the admin panel's env editor: comments and
// blank lines survive a parse -> serialize cycle untouched, so editing one
// value doesn't reformat or lose the rest of the file.

const LINE_RE = /^([^=\s][^=]*?)\s*=\s*(.*)$/;

// Undo the same minimal quoting `serialize` applies, so round-tripping an
// unquoted value (the common case) is a no-op.
function unquote(value) {
  if (value.length >= 2 && value[0] === '"' && value[value.length - 1] === '"') {
    return value.slice(1, -1).replace(/\\(.)/g, '$1');
  }
  return value;
}

/** Parse .env file text into an ordered list of lines: pairs, comments, blanks. */
function parse(text) {
  return text.split('\n').map((raw) => {
    const trimmed = raw.trim();
    if (trimmed === '') return { type: 'blank' };
    if (trimmed.startsWith('#')) return { type: 'comment', raw };

    const match = LINE_RE.exec(trimmed);
    if (!match) return { type: 'comment', raw }; // unparseable line: keep as-is, don't lose it

    return { type: 'pair', key: match[1], value: unquote(match[2]) };
  });
}

// Quote only when needed (spaces, #, or quotes present) — keeps typical values
// (tokens, URLs, numbers) unquoted and readable.
function formatValue(value) {
  if (/[\s#"]/.test(value)) {
    return `"${value.replace(/(["\\])/g, '\\$1')}"`;
  }
  return value;
}

/** Serialize the parsed line list back into .env file text. */
function serialize(lines) {
  return lines
    .map((line) => {
      if (line.type === 'blank') return '';
      if (line.type === 'comment') return line.raw;
      return `${line.key}=${formatValue(line.value)}`;
    })
    .join('\n');
}

/** Convenience: pull just the key/value pairs out of a parsed line list. */
function pairsOf(lines) {
  return lines.filter((l) => l.type === 'pair').map(({ key, value }) => ({ key, value }));
}

/**
 * Given the current file text and a desired final `[{ key, value }]` list (the
 * admin panel's edited state), return updated file text: existing pairs get
 * their value updated in place (comments/blanks untouched), pairs missing from
 * `pairs` are dropped, and pairs not already in the file are appended at the end.
 */
function applyPairs(text, pairs) {
  const lines = parse(text);
  const desired = new Map(pairs.map((p) => [p.key, p.value]));
  const seen = new Set();

  const updated = lines
    .map((line) => {
      if (line.type !== 'pair') return line;
      if (!desired.has(line.key)) return null; // removed by the user
      seen.add(line.key);
      return { type: 'pair', key: line.key, value: desired.get(line.key) };
    })
    .filter(Boolean);

  for (const { key, value } of pairs) {
    if (!seen.has(key)) updated.push({ type: 'pair', key, value });
  }

  return serialize(updated);
}

module.exports = { parse, serialize, pairsOf, applyPairs };
