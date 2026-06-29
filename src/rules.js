// Pure link-rewriting logic — no external dependencies, so it's trivially testable
// and importable without installing anything (see ../index.test.js).

// [label, domain, newHost] — matches https://(any.subdomains.)domain/PATH, keeps PATH.
const RULES = [
  ['TikTok',            'tiktok.com',    'a.tnktok.com'],
  ['Bilibili',          'bilibili.com',  'www.vxbilibili.com'],
  ['X (Twitter)',       'x.com',         'fixupx.com'],
  ['Pixiv',             'pixiv.net',     'www.phixiv.net'],
  ['Reddit',            'reddit.com',    'rxddit.com'],
  ['Threads',           'threads.net',   'vxthreads.net'],
  ['Bluesky',           'bsky.app',      'bskx.app'],
];

const URL_RULES = RULES.map(([label, domain, newHost]) => {
  const esc = domain.replace(/\./g, '\\.');
  return {
    label,
    // Scheme + any leading subdomains optional (so vt./vm./www. all match and get
    // dropped). Lookbehind rejects a preceding domain char so the domain won't match
    // inside a larger one ("x.com" in "fix.com", "tiktok" in "nottiktok.com").
    pattern: new RegExp(`(?<![\\w.@-])(?:https?://)?(?:[\\w-]+\\.)*?${esc}/([^\\s]+)`, 'gi'),
    replace: (match, path) => `https://${newHost}/${path}`,
  };
});

// Early-exit trigger built from the same domains.
const TRIGGER = new RegExp(RULES.map(([, d]) => d.replace(/\./g, '\\.')).join('|'), 'i');

/**
 * Applies all URL replacement rules to a given text.
 * Returns { newText, replaced: [{ label, original, converted }] }
 */
function applyReplacements(text) {
  let newText = text;
  const replaced = [];

  for (const rule of URL_RULES) {
    // Reset lastIndex for global regexes
    rule.pattern.lastIndex = 0;

    const matches = [...text.matchAll(rule.pattern)];
    for (const match of matches) {
      const original = match[0];
      const converted = match[0].replace(rule.pattern, rule.replace);
      rule.pattern.lastIndex = 0; // reset after single-match replace

      // Only record if the URL actually changed
      if (original !== converted) {
        replaced.push({ label: rule.label, original, converted });
      }
    }

    // Apply the replacement globally to newText
    rule.pattern.lastIndex = 0;
    newText = newText.replace(rule.pattern, rule.replace);
  }

  return { newText, replaced };
}

module.exports = { applyReplacements, RULES, TRIGGER };
