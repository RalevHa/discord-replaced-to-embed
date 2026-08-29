// Pure link-rewriting logic — no external dependencies, so it's trivially testable
// and importable without installing anything (see ../index.test.js).

// [label, domain, newHost] — matches https://(any.subdomains.)domain/PATH, keeps PATH.
const RULES = [
  ['TikTok',            'tiktok.com',    'a.tnktok.com'],
  ['Bilibili',          'bilibili.com',  'www.vxbilibili.com'],
  ['X (Twitter)',       'x.com',         'fixupx.com'],
  ['Pixiv',             'pixiv.net',     'www.phixiv.net'],
  ['Bluesky',           'bsky.app',      'bskx.app'],
  ['Instagram',         'instagram.com', 'oginstagram.com'],
  ['Twitter',           'twitter.com',   'fxtwitter.com'],
  ['Reddit',            'reddit.com',    'fxreddit.seria.moe'],
  ['FurAffinity',       'furaffinity.net', 'xfuraffinity.net'],
  ['Iwara',             'iwara.tv',      'fxiwara.seria.moe'],
  ['Tumblr',            'tumblr.com',    'tpmblr.com'],
  ['Threads',           'threads.net',   'fixthreads.seria.moe'],
  ['Threads',           'threads.com',   'fixthreads.seria.moe'],
  ['PTT',               'ptt.cc',        'fxptt.seria.moe'],
  ['DeviantArt',        'deviantart.com', 'fixdeviantart.com'],
];

// Facebook is NOT handled here — there's no reliable "fixup" host to redirect to,
// so it gets a native embed built from scraped Open Graph data instead. See
// facebook.js and its wiring in events/messageCreate.js.

// Known alternate fixer hosts per label, for platforms with more than one working
// option (pulled from embed-fixer's own fix-method list). First entry is always
// that label's current RULES default. A label with no entry here has only one
// known fixer and isn't configurable via /fixer or the admin panel.
const FIXER_OPTIONS = {
  'TikTok':       ['a.tnktok.com', 'tnktok.com', 'tiktokez.com', 'kktiktok.com'],
  'Bilibili':     ['www.vxbilibili.com', 'fxbilibili.seria.moe', 'bilibiliez.com'],
  'X (Twitter)':  ['fixupx.com', 'fixvx.com', 'xeezz.com'],
  'Bluesky':      ['bskx.app', 'fxbsky.app'],
  'Instagram':    ['oginstagram.com', 'kkinstagram.com', 'eeinstagram.com', 'fxig.seria.moe', 'zzinstagram.com', 'g.embedez.com'],
  'Twitter':      ['fxtwitter.com', 'vxtwitter.com', 'xeezz.com'],
  'Reddit':       ['fxreddit.seria.moe', 'vxreddit.com', 'redditez.com'],
  'FurAffinity':  ['xfuraffinity.net', 'fxraffinity.net'],
  'Threads':      ['fixthreads.seria.moe', 'vxthreads.net'],
};

function isValidFixerHost(label, host) {
  // Object.hasOwn guards against `label` being an inherited Object.prototype
  // property name (e.g. "__proto__", "constructor", "toString") — those would
  // otherwise resolve to a non-array value and make `.includes` throw.
  return Object.hasOwn(FIXER_OPTIONS, label) && FIXER_OPTIONS[label].includes(host);
}

const URL_RULES = RULES.map(([label, domain, newHost]) => {
  const esc = domain.replace(/\./g, '\\.');
  return {
    label,
    defaultHost: newHost,
    // Scheme + any leading subdomains optional (so vt./vm./www. all match and get
    // dropped). Lookbehind rejects a preceding domain char so the domain won't match
    // inside a larger one ("x.com" in "fix.com", "tiktok" in "nottiktok.com"). Path
    // stops before "||" so it doesn't swallow a spoiler's closing bar (or text after it).
    pattern: new RegExp(`(?<![\\w.@-])(?:https?://)?(?:[\\w-]+\\.)*?${esc}/((?:(?!\\|\\|)[^\\s])+)`, 'gi'),
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
 * @param {Record<string, string>} [overrides] label -> fixer host, e.g. from a guild's
 *   /fixer picks. Unknown/invalid hosts are ignored (falls back to the default) so a
 *   hand-edited or corrupted stored override can't smuggle in an arbitrary redirect host.
 * Returns { newText, replaced: [{ label, original, converted }] }
 */
function applyReplacements(text, overrides = {}) {
  let newText = text;
  const replaced = [];
  const spoilerRanges = findSpoilerRanges(text);

  for (const rule of URL_RULES) {
    const host = isValidFixerHost(rule.label, overrides[rule.label])
      ? overrides[rule.label]
      : rule.defaultHost;

    // Reset lastIndex for global regexes
    rule.pattern.lastIndex = 0;

    const matches = [...text.matchAll(rule.pattern)];
    for (const match of matches) {
      const original = match[0];
      const url = `https://${host}/${match[1]}`;
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
      const url = `https://${host}/${path}`;
      return isInSpoiler(spoilerRanges, offset, offset + m.length) ? `||${url}||` : url;
    });
  }

  return { newText, replaced };
}

module.exports = {
  applyReplacements,
  RULES,
  TRIGGER,
  FIXER_OPTIONS,
  isValidFixerHost,
  findSpoilerRanges,
  isInSpoiler,
};
