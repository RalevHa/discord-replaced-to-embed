// Pure link-rewriting logic — no external dependencies, so it's trivially testable
// and importable without installing anything (see ../index.test.js).

// [label, domain, newHost] — matches https://(any.subdomains.)domain/PATH, keeps PATH.
const RULES = [
  ['TikTok',            'tiktok.com',    'a.tnktok.com'],
  ['Bilibili',          'bilibili.com',  'www.vxbilibili.com'],
  ['X (Twitter)',       'x.com',         'fixupx.com'],
  ['Pixiv',             'pixiv.net',     'www.phixiv.net'],
  ['Bluesky',           'bsky.app',      'bskx.app'],
];

const URL_RULES = RULES.map(([label, domain, newHost]) => {
  const esc = domain.replace(/\./g, '\\.');
  return {
    label,
    // Scheme + any leading subdomains optional (so vt./vm./www. all match and get
    // dropped). Lookbehind rejects a preceding domain char so the domain won't match
    // inside a larger one ("x.com" in "fix.com", "tiktok" in "nottiktok.com"). Path
    // stops before "||" so it doesn't swallow a spoiler's closing bar (or text after it).
    pattern: new RegExp(`(?<![\\w.@-])(?:https?://)?(?:[\\w-]+\\.)*?${esc}/((?:(?!\\|\\|)[^\\s])+)`, 'gi'),
    replace: (match, path) => `https://${newHost}/${path}`,
  };
});

// Early-exit trigger built from the same domains.
const TRIGGER = new RegExp(RULES.map(([, d]) => d.replace(/\./g, '\\.')).join('|'), 'i');

// Discord spoiler tags (||text||) can wrap a link plus other words, so a link is
// "spoilered" whenever it falls inside any ||...|| span, not just when the bars
// touch it directly. Returns [start, end) content ranges (bars excluded).
function findSpoilerRanges(text) {
  return [...text.matchAll(/\|\|([\s\S]+?)\|\|/g)].map((m) => [m.index + 2, m.index + 2 + m[1].length]);
}

function isInSpoiler(ranges, start, end) {
  return ranges.some(([s, e]) => start >= s && end <= e);
}

/**
 * Applies all URL replacement rules to a given text.
 * Returns { newText, replaced: [{ label, original, converted }] }
 */
function applyReplacements(text) {
  let newText = text;
  const replaced = [];
  const spoilerRanges = findSpoilerRanges(text);

  for (const rule of URL_RULES) {
    // Reset lastIndex for global regexes
    rule.pattern.lastIndex = 0;

    const matches = [...text.matchAll(rule.pattern)];
    for (const match of matches) {
      const original = match[0];
      const url = rule.replace(match[0], match[1]);
      const spoiler = isInSpoiler(spoilerRanges, match.index, match.index + original.length);
      const converted = spoiler ? `||${url}||` : url;

      // Only record if the URL actually changed
      if (original !== converted) {
        replaced.push({ label: rule.label, original, converted });
      }
    }

    // Apply the replacement globally to newText
    rule.pattern.lastIndex = 0;
    newText = newText.replace(rule.pattern, (m, path, offset) => {
      const url = rule.replace(m, path);
      return isInSpoiler(spoilerRanges, offset, offset + m.length) ? `||${url}||` : url;
    });
  }

  return { newText, replaced };
}

module.exports = { applyReplacements, RULES, TRIGGER };
