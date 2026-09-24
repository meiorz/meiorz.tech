#!/usr/bin/env node
/**
 * check-site.mjs: zero-dependency pre-deploy checks for site/.
 *
 *   1. paths    lowercase, URL-safe names; only file types the privacy scan can read (no PDF,
 *               DOCX, CSV, ...); no junk or build-manifest files; required files exist
 *   2. privacy  nothing from the FORBIDDEN list (phone numbers, other e-mail addresses, GPA,
 *               trackers, stream-channel URLs, AI-screener text, ...), also in file names and
 *               image metadata. Text is scanned as written AND as a browser would show it
 *               (tags removed, HTML entities and JS escapes decoded, Unicode spaces/dashes folded)
 *   3. csp      nothing the Content-Security-Policy would block (inline styles and scripts,
 *               event handlers, eval, third-party requests)
 *   4. links    every local href/src/srcset/url()/import/fetch path and every
 *               https://www.meiorz.tech/... URL resolves to a real file, with exact case
 *   5. config   staticwebapp.config.json parses, is <= 20 KB, its routes are sound, and its
 *               CSP is exactly the SPEC section 3 policy
 *   6. budgets  per-file and total size budgets
 *   7. html     lang, charset, title, alt text, unique ids
 *   8. syntax   JavaScript parses (node --check), JSON parses, text is valid UTF-8
 *   9. claims   facts that were corrected stay corrected, and removed details stay removed:
 *               no course grades, named transfer-target universities, weekly hours or
 *               follower/subscriber numbers (not even as a goal), and no A.S. /
 *               associate-degree or expected-graduation claims. Scanned as written and
 *               as displayed, like the privacy check; matches are printed. The
 *               removed-details rules are fixture-tested by tools/test-removed-details.mjs.
 *
 * Usage: node tools/check-site.mjs [--root <repo-dir>] [--strict] [--quiet]
 *   --root    repository root (default: the parent of this tools/ folder)
 *   --strict  treat warnings as failures
 *   --quiet   list only the checks that found something
 *
 * CHECK_SITE_PRIVATE_TERMS (env, optional): extra terms that must never be published,
 * separated by commas (or newlines). Keep them out of the repo (use a repo secret in CI).
 * Matches are reported by position only; the term is never printed.
 *
 * Exit codes: 0 all checks passed (warnings allowed), 1 at least one check failed,
 * 2 bad usage or the checker could not run.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, posix, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { gzipSync, inflateSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { findRule, LETTER_GRADE, REMOVED_DETAILS } from './lib/removed-details.mjs';

// ---------------------------------------------------------------------------
// Rules and budgets. KB = 1024 bytes.
// ---------------------------------------------------------------------------

const KB = 1024;
const CONFIG_FILE = 'staticwebapp.config.json';
const CONFIG_MAX = 20 * KB; // platform limit for staticwebapp.config.json
const TOTAL_BUDGET = 5 * KB * KB;
const DEFAULT_FILE_BUDGET = 400 * KB;
const MAX_FILES = 15000; // Azure Static Web Apps Free plan file limit
const PUBLIC_EMAIL = 'business@meiorz.tech';
const OWN_HOSTS = /^(?:www\.)?meiorz\.tech$/i;

/** First matching entry wins: [exact path or RegExp, max bytes]. */
const BUDGETS = [
  ['index.html', 45 * KB],
  ['css/term.css', 25 * KB],
  ['js/term.js', 56 * KB],
  ['js/obby.js', 36 * KB],
  ['js/meii.js', 40 * KB],
  ['img/og.png', 150 * KB],
  ['img/avatar.svg', 12 * KB],
  [/^img\//, 60 * KB],
  [/^archive\/img\//, 400 * KB],
  [CONFIG_FILE, CONFIG_MAX],
];

const REQUIRED = [
  'index.html', '404.html', CONFIG_FILE,
  'css/term.css', 'css/archive.css',
  'js/theme.js', 'js/term.js', 'js/obby.js', 'js/luau-table.js', 'js/meii.js',
  'obby/obbycourse.luau',
  'img/avatar.svg', 'img/favicon.svg', 'img/og.png',
  'resume.txt', 'llms.txt', 'index.md', 'robots.txt', 'sitemap.xml',
  'archive/index.html', 'archive/home-2023.html', 'archive/blog/index.html',
];

const TEXT_EXT = new Set(['.html', '.htm', '.css', '.js', '.mjs', '.json', '.webmanifest',
  '.txt', '.md', '.xml', '.svg', '.luau', '.map']);
// Fail closed: only types the privacy scan can read (text, plus PNG/JPEG metadata) may deploy.
// WebP/GIF/AVIF stay out until imageMetadata() learns their metadata chunks.
const DEPLOYABLE_EXT = new Set([...TEXT_EXT, '.png', '.jpg', '.jpeg', '.ico']);
const DOCUMENT_EXT = new Set(['.pdf', '.doc', '.docx', '.odt', '.rtf', '.pages', '.csv', '.tsv', '.xls',
  '.xlsx', '.ods', '.numbers', '.ppt', '.pptx', '.odp', '.key', '.epub', '.zip', '.7z', '.rar', '.tar', '.tgz']);
const JUNK_FILES = new Set(['.ds_store', 'thumbs.db', 'desktop.ini']);
// Any of these would make the SWA builder (Oryx) try to build site/ if skip_app_build is removed.
const BUILD_MANIFESTS = new Set(['gemfile', 'gemfile.lock', 'package.json', 'package-lock.json',
  'yarn.lock', 'pnpm-lock.yaml', 'requirements.txt', 'pyproject.toml', 'composer.json']);

/**
 * FORBIDDEN content (SPEC section 1). Patterns are deliberately generic: this file is
 * public, so it must not spell out the private values it guards against. A phone number,
 * for example, is caught by its shape, and a stream handle belongs in
 * CHECK_SITE_PRIVATE_TERMS.
 */
// Between phone-number digit groups: optional spaces around one optional separator
// (ASCII - . / or a Unicode hyphen/dash/minus). The decoded view (see decodedView) also
// folds no-break spaces and dashes to ASCII, so entity- or typographically-written
// numbers match too.
const PHONE_SEP = String.raw`\s*[-./\u2010-\u2015\u2212]?\s*`;
const PRIVATE_WORD_HASHES = new Set(['ecc2b32b16516dc9bca16ca5f0650d17a011f2e6c112cc229a3153e99aeedeff']);
const hashCache = new Map();
function sha256(word) {
  if (!hashCache.has(word)) hashCache.set(word, createHash('sha256').update(word).digest('hex'));
  return hashCache.get(word);
}
const FORBIDDEN = [
  { id: 'phone-number', why: 'phone-number-shaped text (no phone number is ever published)',
    re: new RegExp(String.raw`(?<![\w.])(?:\+?1${PHONE_SEP})?(?:\(\s*[2-9]\d{2}\s*\)|[2-9]\d{2})${PHONE_SEP}[2-9]\d{2}${PHONE_SEP}\d{4}(?!\w)`, 'g') },
  { id: 'telephone', why: 'telephone field or tel: link', re: /\btelephone\b|\btel:/gi },
  { id: 'school-email', why: 'school e-mail domain', re: /mail\.ccsf\.edu/gi },
  // Stored as SHA-256 of the lower-cased word, so this public file does not name it.
  { id: 'old-org-email', why: 'old organisation name or address', re: /[A-Za-z0-9]+/g,
    ok: (w) => !PRIVATE_WORD_HASHES.has(sha256(w.toLowerCase())) },
  // Case-sensitive on purpose: /gpa/i would hit "imgpane".
  { id: 'gpa', why: 'GPA (never published)',
    re: /GPA|(?<![A-Za-z])[Gg][Pp][Aa](?![a-z])|\b[Gg]\.\s?[Pp]\.\s?[Aa]\b|\b[Gg](?:rade|RADE)[-\s][Pp](?:oint|OINT)\b/g },
  LETTER_GRADE, // id 'grade': B-F, A+, A- (tools/lib/removed-details.mjs; a plain A is check 9's course-grade)
  { id: 'class-standing', why: 'class standing', re: /sophomore/gi },
  { id: 'academic-or-health', why: 'withdrawal or disability detail', re: /\bdisabilit(?:y|ies)\b|\bwithdr(?:aw|ew)\w*/gi },
  { id: 'course-repeat', why: 'repeated course',
    re: /\b(?:[Rr]epeated|[Rr]etook|[Rr]etaken|[Rr]etake)\s+(?:the\s+)?(?:course|class|[A-Z]{2,5}\s?\d{2,3}[A-Z]?)\b/g },
  { id: 'health', why: 'health detail',
    re: /\b(?:medical|health|mental[-\s]health)\s+(?:leave|condition|issues?|reasons?)\b|\bleave of absence\b|\bdiagnosed\b|\bdisability accommodations?\b/gi },
  { id: 'stream-channel', why: 'stream channel URL (never published)', re: /twitch\.tv\//gi },
  { id: 'old-notion', why: 'link to the old Notion pages (not archived; use the archive note instead)', re: /\bnotion\.(?:site|so)\b/gi },
  { id: 'tracker', why: 'analytics or tracker',
    re: /google-analytics|googletagmanager|gtag\(|googlesyndication|doubleclick\.net|connect\.facebook\.net|hotjar|clarity\.ms|plausible\.io/gi },
  { id: 'pronouns', why: 'pronouns', re: /\bpronouns?\b|\b(?:she|he|they)\/(?:her|him|them|they|she|he)\b/gi },
  { id: 'astrology', why: 'astrology',
    re: /\b(?:astrolog\w*|zodiac|horoscope|sagittarius|taurus|gemini|(?:sun|moon|rising) sign)\b/gi },
  { id: 'ai-screener-text', why: 'text addressed to automated screeners',
    re: /\b(?:ignore|disregard) (?:all |any |the )?(?:previous|prior|above|earlier) (?:instructions|prompts?)|\brank this (?:candidate|resume|applicant)/gi },
  { id: 'street-address', why: 'street address',
    re: /\b\d{1,5}\s+(?:[A-Z][a-z]+\s+){1,3}(?:St|Street|Ave|Avenue|Blvd|Boulevard|Rd|Road|Ln|Lane)\b/g },
];
const PATH_ADDRESS = /\d+-[a-z]+(?:-[a-z]+)*-(?:st|street|ave|avenue|blvd|rd|road)\b/i;
const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/g;

/**
 * CLAIMS (check 9): corrected facts and removed details that must not come back. Unlike
 * FORBIDDEN, these are not private, so matches are printed. `ok(text, start, end)` may
 * accept a match in context. The removed-details rules (grades, transfer targets, weekly
 * hours, follower numbers) live in tools/lib/removed-details.mjs, with failing and allowed
 * fixtures in tools/test-removed-details.mjs.
 */
const CLAIMS = [
  ...REMOVED_DETAILS,
  { id: 'degree-claim', why: 'A.S./associate-degree or graduation-date claim',
    re: new RegExp([
      String.raw`(?<![\w.])A\.\s?S\.(?!\w)`, // A.S., A. S., A.S.-T
      String.raw`\bAS-T\b|\bAS\s+(?:[Dd]egrees?\b|in\s+[A-Z])`,
      String.raw`\b[Aa]ssociate(?:'s|\u2019s)?\s+(?:[Dd]egrees?\b|(?:of|in)\s+(?:Science|Arts)\b)`,
      String.raw`\b[Dd]egree\s+expected\b|\b[Ee]xpected\s+(?:graduation|to\s+graduate)\b`,
      // "Expected 2027", "expected May 2027"; a season ("expected Fall 2027", the ASL certificate) is allowed
      String.raw`\b[Ee]xpected\s+(?:(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.?\s+)?20\d\d\b`,
      String.raw`\b[Gg]raduat(?:ing|es?|ion)\b[^.\n]{0,25}?\b20\d\d\b`,
    ].join('|'), 'g') },
];

// ---------------------------------------------------------------------------
// Command line
// ---------------------------------------------------------------------------

const opts = { root: null, strict: false, quiet: false };
{
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--strict') opts.strict = true;
    else if (a === '--quiet') opts.quiet = true;
    else if (a === '--root' && argv[i + 1]) opts.root = argv[++i];
    else if (a.startsWith('--root=')) opts.root = a.slice(7);
    else if (a === '-h' || a === '--help') {
      console.log('Usage: node tools/check-site.mjs [--root <repo-dir>] [--strict] [--quiet]');
      process.exit(0);
    } else {
      console.error(`check-site: unknown argument "${a}" (try --help)`);
      process.exit(2);
    }
  }
}

const started = performance.now();
const ROOT = opts.root ? resolve(opts.root) : fileURLToPath(new URL('..', import.meta.url));
const SITE = join(ROOT, 'site');
const env = process.env;
const color = !env.NO_COLOR && (process.stdout.isTTY || env.GITHUB_ACTIONS === 'true' || !!env.FORCE_COLOR);
const paint = (code) => (s) => (color ? `\x1b[${code}m${s}\x1b[0m` : String(s));
const red = paint('31');
const green = paint('32');
const yellow = paint('33');
const dim = paint('2');
const bold = paint('1');

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

/** Replace every character except newlines with a space, keeping offsets and line numbers. */
const blank = (s) => s.replace(/[^\n]/g, ' ');

const fmtSize = (n) => (n >= KB * KB ? `${(n / KB / KB).toFixed(2)} MB`
  : n >= KB ? `${(n / KB).toFixed(1)} KB` : `${n} B`);

function lineCol(text, index) {
  let line = 1;
  let last = -1;
  for (let i = text.indexOf('\n'); i !== -1 && i < index; i = text.indexOf('\n', i + 1)) {
    line++;
    last = i;
  }
  return { line, col: index - last };
}

function decodeEntities(s) {
  return s.replace(/&(#x[0-9a-f]+|#\d+|amp|quot|apos|lt|gt);/gi, (m, e) => {
    const k = e.toLowerCase();
    if (k[0] === '#') return codePoint(k[1] === 'x' ? parseInt(k.slice(2), 16) : parseInt(k.slice(1), 10));
    return { amp: '&', quot: '"', apos: "'", lt: '<', gt: '>' }[k];
  });
}

// Null prototype: "&constructor;" must not resolve to Object.prototype.constructor.
const NAMED_ENTITIES = Object.assign(Object.create(null), {
  amp: '&', quot: '"', apos: "'", lt: '<', gt: '>', nbsp: ' ', ensp: ' ', emsp: ' ', thinsp: ' ', numsp: ' ',
  puncsp: ' ', hyphen: '-', dash: '-', ndash: '-', mdash: '-', minus: '-', horbar: '-', commat: '@',
  period: '.', sol: '/', lpar: '(', rpar: ')', plus: '+', colon: ':', lowbar: '_', percnt: '%',
  shy: '', zwj: '', zwnj: '',
});
const INLINE_TAGS = new Set(['a', 'abbr', 'b', 'bdi', 'bdo', 'big', 'cite', 'code', 'data', 'del', 'dfn', 'em',
  'font', 'i', 'ins', 'kbd', 'label', 'mark', 'nobr', 'output', 'q', 's', 'samp', 'small', 'span', 'strong',
  'sub', 'sup', 'time', 'tspan', 'tt', 'u', 'var', 'wbr']);
const DECODE_MARKUP = String.raw`(?<tag><!--[\s\S]*?(?:-->|$)|<[a-zA-Z/!?][^>]*>)|&(?<ent>#x[0-9a-fA-F]+|#\d+|[a-zA-Z][a-zA-Z0-9]*);?`;
const DECODE_ESCAPES = String.raw`\\u\{(?<ub>[0-9a-fA-F]{1,6})\}|\\u(?<u4>[0-9a-fA-F]{4})|\\x(?<x2>[0-9a-fA-F]{2})`;
// Browsers read &#150; and &#151; as the Windows-1252 en and em dashes.
const codePoint = (n) => (n === 150 || n === 151 ? '-'
  : Number.isInteger(n) && n >= 0 && n <= 0x10ffff ? String.fromCodePoint(n) : '');

/**
 * The text roughly as a reader sees it, for the privacy scan: comments and inline tags
 * removed (so `<span>415</span>-555` joins up), other tags turned into a space (block
 * boundaries separate words on screen too), HTML entities decoded (the
 * semicolon is optional, as in browsers), JS/JSON \u and \x escapes decoded, Unicode
 * spaces folded to ' ' and hyphens/dashes/minus to '-', invisible characters dropped.
 * `map[i]` is the offset in `text` that output character i came from. `blockBreak` is what
 * a non-inline tag becomes (the claims check passes U+2029 so it can see paragraph ends).
 */
function decodedView(text, ext, blockBreak = ' ') {
  const markup = /^\.(?:html?|svg|xml|md)$/.test(ext);
  const script = markup || /^\.(?:m?js|json|webmanifest|map)$/.test(ext);
  const parts = [markup && DECODE_MARKUP, script && DECODE_ESCAPES].filter(Boolean);
  const out = [];
  const map = [];
  const emit = (s, at) => {
    for (const ch of s) {
      const folded = /[\u00a0\u1680\u2000-\u200a\u202f\u205f\u3000]/.test(ch) ? ' '
        : /[\u2010-\u2015\u2212\ufe58\ufe63\uff0d]/.test(ch) ? '-'
          : /[\u00ad\u200b-\u200d\u2060\ufeff]/.test(ch) ? '' : ch;
      for (let k = 0; k < folded.length; k++) {
        out.push(folded[k]);
        map.push(at);
      }
    }
  };
  let last = 0;
  const copy = (a, b) => {
    for (let k = a; k < b; k++) {
      const code = text.charCodeAt(k);
      if (code < 0x80) {
        out.push(text[k]);
        map.push(k);
      } else if (code >= 0xd800 && code <= 0xdbff && k + 1 < b) {
        emit(text.slice(k, k + 2), k);
        k++;
      } else emit(text[k], k);
    }
  };
  if (parts.length) {
    for (const m of text.matchAll(new RegExp(parts.join('|'), 'g'))) {
      const g = m.groups;
      copy(last, m.index);
      last = m.index + m[0].length;
      if (g.tag != null) {
        const name = /^<\/?([a-zA-Z][\w-]*)/.exec(g.tag)?.[1].toLowerCase();
        if (name && !INLINE_TAGS.has(name)) emit(blockBreak, m.index);
        continue;
      }
      let rep;
      let used = m[0].length;
      if (g.ent != null) {
        const e = g.ent.toLowerCase();
        rep = e[0] === '#' ? codePoint(e[1] === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10)) : NAMED_ENTITIES[e];
        // Without a semicolon, browsers take the longest known name: "&nbsp555" is nbsp + "555".
        for (let k = e.length - 1; rep == null && e[0] !== '#' && !m[0].endsWith(';') && k >= 2; k--) {
          if (NAMED_ENTITIES[e.slice(0, k)] != null) {
            rep = NAMED_ENTITIES[e.slice(0, k)];
            used = k + 1;
          }
        }
        if (rep == null) { // unknown entity: keep it as written
          copy(m.index, last);
          continue;
        }
      } else {
        rep = codePoint(parseInt(g.ub ?? g.u4 ?? g.x2, 16));
      }
      emit(rep, m.index);
      copy(m.index + used, last); // the rest of a semicolon-less name, if any
    }
  }
  copy(last, text.length);
  return { text: out.join(''), map };
}

// ---------------------------------------------------------------------------
// Findings
// ---------------------------------------------------------------------------

class Check {
  constructor(n, title) {
    this.n = n;
    this.title = title;
    this.items = [];
    this.stats = '';
  }

  add(level, file, text, index, rule, msg) {
    const pos = text != null && index != null ? lineCol(text, index) : null;
    this.items.push({ level, file: file ? `site/${file}` : null, pos, rule, msg: String(msg).replace(/\s+/g, ' ') });
  }

  error(file, text, index, rule, msg) { this.add('error', file, text, index, rule, msg); }
  warn(file, text, index, rule, msg) { this.add('warn', file, text, index, rule, msg); }
  get errors() { return this.items.filter((i) => i.level === 'error').length; }
  get warnings() { return this.items.filter((i) => i.level === 'warn').length; }
}

// ---------------------------------------------------------------------------
// Load site/
// ---------------------------------------------------------------------------

let statSite;
try {
  statSite = statSync(SITE);
} catch {
  statSite = null;
}
if (!statSite || !statSite.isDirectory()) {
  console.error(`check-site: no site/ folder under ${ROOT}`);
  process.exit(2);
}

const files = [];
const dirSet = new Set(['']);
(function walk(dir) {
  const entries = readdirSync(dir, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1));
  for (const ent of entries) {
    const abs = join(dir, ent.name);
    const rel = relative(SITE, abs).split(sep).join('/');
    if (ent.isSymbolicLink()) files.push({ rel, abs, size: 0, ext: '', symlink: true });
    else if (ent.isDirectory()) {
      dirSet.add(rel);
      walk(abs);
    } else if (ent.isFile()) {
      files.push({ rel, abs, size: statSync(abs).size, ext: posix.extname(rel).toLowerCase() });
    }
  }
})(SITE);

const fileSet = new Set(files.map((f) => f.rel));
const byLower = new Map(files.map((f) => [f.rel.toLowerCase(), f.rel]));
const byRel = new Map(files.map((f) => [f.rel, f]));
const utf8 = new TextDecoder('utf-8', { fatal: true });
const utf8Lossy = new TextDecoder('utf-8');

for (const f of files) {
  if (f.symlink) continue;
  f.buf = readFileSync(f.abs);
  if (TEXT_EXT.has(f.ext)) {
    try {
      f.text = utf8.decode(f.buf);
    } catch {
      f.badUtf8 = true;
      f.text = utf8Lossy.decode(f.buf);
    }
  }
}
const textFiles = files.filter((f) => f.text != null);
const htmlFiles = textFiles.filter((f) => f.ext === '.html' || f.ext === '.htm');
const svgFiles = textFiles.filter((f) => f.ext === '.svg');
const cssFiles = textFiles.filter((f) => f.ext === '.css');
const jsFiles = textFiles.filter((f) => f.ext === '.js' || f.ext === '.mjs');

let config = null;
let configError = null;
if (byRel.has(CONFIG_FILE)) {
  try {
    config = JSON.parse(byRel.get(CONFIG_FILE).text);
  } catch (e) {
    configError = e.message;
  }
}
const routes = Array.isArray(config?.routes) ? config.routes.filter((r) => r && typeof r.route === 'string') : [];

// ---------------------------------------------------------------------------
// Markup parsing (HTML and SVG). Regex-based on purpose: the files are ours and
// well-formed, and this keeps the checker dependency-free. Offsets are preserved so
// findings carry real line numbers.
// ---------------------------------------------------------------------------

function parseAttrs(s) {
  const attrs = new Map();
  for (const m of s.matchAll(/([^\s"'<>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g)) {
    const name = m[1].toLowerCase();
    if (!attrs.has(name)) attrs.set(name, decodeEntities(m[2] ?? m[3] ?? m[4] ?? ''));
  }
  return attrs;
}

function parseMarkup(src) {
  // Comments are blanked so commented-out markup is not treated as live
  // (the privacy scan still reads the raw text, comments included).
  let text = src.replace(/<!--[\s\S]*?(?:-->|$)/g, blank);
  const scripts = [];
  const styles = [];
  const rawText = (tag, list) => (m, attrStr, body, offset) => {
    const open = `<${m.slice(1, tag.length + 1)}${attrStr}>`;
    list.push({ attrs: parseAttrs(attrStr), body, index: offset, bodyIndex: offset + open.length });
    return open + blank(body) + m.slice(open.length + body.length);
  };
  text = text.replace(/<script\b((?:[^>"']|"[^"]*"|'[^']*')*)>([\s\S]*?)<\/script\s*>/gi, rawText('script', scripts));
  text = text.replace(/<style\b((?:[^>"']|"[^"]*"|'[^']*')*)>([\s\S]*?)<\/style\s*>/gi, rawText('style', styles));

  const templates = [...text.matchAll(/<template\b[^>]*>[\s\S]*?<\/template\s*>/gi)]
    .map((m) => [m.index, m.index + m[0].length]);
  const tags = [];
  for (const m of text.matchAll(/<([a-zA-Z][\w:-]*)((?:[^>"']|"[^"]*"|'[^']*')*)>/g)) {
    const inTemplate = templates.some(([a, b]) => m.index > a && m.index < b);
    tags.push({ name: m[1].toLowerCase(), attrs: parseAttrs(m[2]), index: m.index, inTemplate });
  }
  const ids = new Set(tags.filter((t) => t.attrs.has('id')).map((t) => t.attrs.get('id')));
  return { text, tags, scripts, styles, ids };
}

for (const f of [...htmlFiles, ...svgFiles]) f.doc = parseMarkup(f.text);

// ---------------------------------------------------------------------------
// JavaScript views: `code` has comments blanked; `bare` also blanks string, template
// and regex contents; `inString[i]` is 1 inside string or template text. A small
// tokenizer, good enough for our own hand-written modules.
// ---------------------------------------------------------------------------

const REGEX_AFTER_WORD = new Set(['return', 'typeof', 'instanceof', 'in', 'of', 'new', 'delete',
  'void', 'throw', 'case', 'do', 'else', 'yield', 'await']);

function jsViews(src) {
  const n = src.length;
  const code = src.split('');
  const bare = src.split('');
  const inString = new Uint8Array(n);
  const wipe = (arr, a, b) => {
    for (let k = a; k < b && k < n; k++) if (arr[k] !== '\n') arr[k] = ' ';
  };
  const templates = []; // brace depth at each open `${`
  let depth = 0;
  let prev = ''; // last significant token class/char
  let i = 0;
  const scanTemplate = (from) => { // from = index just after ` or }
    let j = from;
    while (j < n && src[j] !== '`' && !(src[j] === '$' && src[j + 1] === '{')) j += src[j] === '\\' ? 2 : 1;
    wipe(bare, from, j);
    inString.fill(1, from, j);
    if (src[j] === '$') {
      templates.push(depth);
      prev = '{';
      return j + 2;
    }
    prev = 'a';
    return j + 1;
  };
  while (i < n) {
    const c = src[i];
    const d = src[i + 1];
    if (c === '/' && d === '/') {
      const j = src.indexOf('\n', i);
      const end = j === -1 ? n : j;
      wipe(code, i, end);
      wipe(bare, i, end);
      i = end;
    } else if (c === '/' && d === '*') {
      const j = src.indexOf('*/', i + 2);
      const end = j === -1 ? n : j + 2;
      wipe(code, i, end);
      wipe(bare, i, end);
      i = end;
    } else if (c === '"' || c === "'") {
      let j = i + 1;
      while (j < n && src[j] !== c && src[j] !== '\n') j += src[j] === '\\' ? 2 : 1;
      wipe(bare, i + 1, j);
      inString.fill(1, i + 1, j);
      prev = 'a';
      i = j + 1;
    } else if (c === '`') {
      i = scanTemplate(i + 1);
    } else if (c === '}' && templates.length && templates[templates.length - 1] === depth) {
      templates.pop();
      i = scanTemplate(i + 1);
    } else if (c === '/' && (prev === '' || prev === 'kw' || /[(,=:[!&|?{};+\-*%<>~^]/.test(prev))) {
      let j = i + 1;
      let inClass = false;
      while (j < n && src[j] !== '\n') {
        if (src[j] === '\\') j++;
        else if (src[j] === '[') inClass = true;
        else if (src[j] === ']') inClass = false;
        else if (src[j] === '/' && !inClass) break;
        j++;
      }
      wipe(bare, i + 1, j);
      prev = 'a';
      i = j + 1;
    } else if (/[\w$]/.test(c)) {
      let j = i;
      while (j < n && /[\w$]/.test(src[j])) j++;
      prev = REGEX_AFTER_WORD.has(src.slice(i, j)) ? 'kw' : 'a';
      i = j;
    } else {
      if (c === '{') depth++;
      else if (c === '}') depth--;
      if (!/\s/.test(c)) prev = c;
      i++;
    }
  }
  return { code: code.join(''), bare: bare.join(''), inString };
}

for (const f of jsFiles) Object.assign(f, jsViews(f.text));

// ---------------------------------------------------------------------------
// Reference resolution (shared by the links, csp and config checks)
// ---------------------------------------------------------------------------

/** Does an SWA route pattern match a request path? Mirrors the documented rules. */
function routeMatches(pattern, path) {
  const star = pattern.indexOf('*');
  if (star === -1) {
    if (pattern === path) return true;
    if (pattern.endsWith('/index.html')) { // an index.html route also matches its folder
      const folder = pattern.slice(0, -'index.html'.length);
      return path === folder || path === folder.slice(0, -1);
    }
    return false;
  }
  if (!path.startsWith(pattern.slice(0, star))) return false;
  const rest = pattern.slice(star + 1);
  if (!rest) return true;
  const exts = /^\.\{(.+)\}$/.exec(rest)?.[1].split(',') ?? (rest.startsWith('.') ? [rest.slice(1)] : []);
  return exts.some((e) => path.endsWith(`.${e.trim()}`));
}

const firstRoute = (path) => routes.find((r) => routeMatches(r.route, path));

/**
 * Classify a URL found in file `fromRel`. Returns one of
 *   { kind: 'skip' } | { kind: 'external', url, scheme } | { kind: 'own', url: URL }
 *   { kind: 'fragment', hash } | { kind: 'local', rel, isDir, hash, relative } | { kind: 'bad', msg }
 * ('own' = an absolute http(s) URL on www.meiorz.tech or meiorz.tech.)
 */
function classify(fromRel, raw) {
  const url = raw.trim();
  if (!url) return { kind: 'skip' };
  if (url.startsWith('//')) return { kind: 'external', url };
  const scheme = /^([a-z][a-z0-9+.-]*):/i.exec(url);
  if (scheme) {
    const s = scheme[1].toLowerCase();
    if (s === 'http' || s === 'https') {
      try {
        const u = new URL(url);
        if (OWN_HOSTS.test(u.hostname)) return { kind: 'own', url: u };
      } catch {
        return { kind: 'bad', msg: `malformed URL "${url}"` };
      }
    }
    return { kind: 'external', url, scheme: s };
  }
  const hashAt = url.indexOf('#');
  const hash = hashAt === -1 ? '' : url.slice(hashAt + 1);
  let path = (hashAt === -1 ? url : url.slice(0, hashAt)).replace(/\?.*$/, '');
  if (!path) return hash ? { kind: 'fragment', hash } : { kind: 'skip' };
  try {
    path = decodeURI(path);
  } catch {
    return { kind: 'bad', msg: `malformed URL "${url}"` };
  }
  const isRelative = !path.startsWith('/');
  const joined = posix.normalize(posix.join(isRelative ? posix.dirname(fromRel) : '', path.replace(/^\/+/, '')));
  if (joined === '..' || joined.startsWith('../')) return { kind: 'bad', msg: `"${url}" points outside site/` };
  const rel = joined === '.' ? '' : joined.replace(/\/$/, '');
  return { kind: 'local', rel, isDir: path.endsWith('/') || rel === '', hash, relative: isRelative };
}

/** Verify that a local reference resolves; reports on `check`. Returns the target rel or null. */
function verifyLocal(check, f, text, index, ref, raw) {
  let target = ref.isDir ? (ref.rel ? `${ref.rel}/index.html` : 'index.html') : ref.rel;
  if (!fileSet.has(target)) {
    const requestPath = `/${ref.rel}${ref.isDir && ref.rel ? '/' : ''}`;
    const route = firstRoute(requestPath);
    if (!ref.isDir && dirSet.has(ref.rel) && fileSet.has(`${ref.rel}/index.html`)) {
      check.warn(f.rel, text, index, 'folder-without-slash',
        `"${raw}" is a folder; link to "/${ref.rel}/" so relative links on that page resolve`);
      target = `${ref.rel}/index.html`;
    } else if (route && (route.redirect || route.rewrite)) {
      return null; // served by a redirect/rewrite route (targets are verified by the config check)
    } else {
      const other = byLower.get(target.toLowerCase());
      check.error(f.rel, text, index, 'broken-link', other
        ? `"${raw}" -> site/${target} differs in case from site/${other} (SWA paths are case-sensitive)`
        : `"${raw}" -> site/${target} does not exist`);
      return null;
    }
  }
  if (ref.hash && /\.html?$/.test(target) && !['top', ''].includes(ref.hash) && !ref.hash.startsWith(':~:')) {
    const doc = byRel.get(target)?.doc;
    let id = ref.hash;
    try {
      id = decodeURIComponent(id);
    } catch { /* keep raw */ }
    if (doc && !doc.ids.has(id)) check.error(f.rel, text, index, 'missing-anchor', `"${raw}": no id="${id}" in site/${target}`);
  }
  return target;
}

// ---------------------------------------------------------------------------
// 1. Paths
// ---------------------------------------------------------------------------

function checkPaths() {
  const c = new Check(1, 'Paths: lowercase, URL-safe, scannable file types, no junk, required files present');
  for (const f of files) {
    const base = posix.basename(f.rel).toLowerCase();
    if (f.symlink) c.error(f.rel, null, null, 'symlink', 'symbolic link (not deployed reliably); copy the file instead');
    if (/[A-Z]/.test(f.rel)) c.error(f.rel, null, null, 'uppercase', 'uppercase letters in path (SWA paths are case-sensitive; use lowercase)');
    else if (!/^[a-z0-9._\-/]+$/.test(f.rel)) c.error(f.rel, null, null, 'unsafe-path', 'use only a-z 0-9 . _ - in file and folder names');
    if (JUNK_FILES.has(base)) c.error(f.rel, null, null, 'junk-file', 'OS junk file');
    else if (BUILD_MANIFESTS.has(base) || base.endsWith('.csproj')) {
      c.error(f.rel, null, null, 'build-manifest', 'build manifest in site/ (the SWA builder would try to build the folder)');
    } else if (/\.(?:br|gz)$/.test(base)) {
      c.error(f.rel, null, null, 'precompressed', 'precompressed copy (SWA may serve it in place of the original)');
    } else if (f.rel.split('/').some((seg) => seg.startsWith('.') && seg !== '.well-known')) {
      c.error(f.rel, null, null, 'dotfile', 'hidden file or folder in site/');
    } else if (!f.symlink && !DEPLOYABLE_EXT.has(f.ext)) {
      c.error(f.rel, null, null, 'file-type', DOCUMENT_EXT.has(f.ext)
        ? `${f.ext} documents can carry contact details and metadata the privacy check cannot read; publish resume.txt or an HTML page instead`
        : f.ext ? `${f.ext} files are not read by the privacy check; publish text, HTML, SVG, PNG or JPEG instead`
          : 'file without an extension (not read by the privacy check)');
    }
    if (!f.symlink && f.size === 0) c.warn(f.rel, null, null, 'empty-file', 'file is empty');
  }
  const missing = REQUIRED.filter((r) => !fileSet.has(r));
  for (const r of missing) c.error(r, null, null, 'missing', 'required file is missing');
  c.stats = `${files.length} files, ${dirSet.size - 1} folders, ${REQUIRED.length - missing.length}/${REQUIRED.length} required files present`;
  return c;
}

// ---------------------------------------------------------------------------
// 2. Privacy
// ---------------------------------------------------------------------------

function privateTerms() {
  return (env.CHECK_SITE_PRIVATE_TERMS || '').split(/[\r\n,]/).map((t) => t.trim()).filter((t) => t.length >= 3)
    .map((t, i) => {
      const digits = t.replace(/[\s()./+-]/g, '');
      const source = /^\d+$/.test(digits) && digits.length >= 4
        ? digits.split('').join('[\\s()./+-]*') // digits match with any separators
        : t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      return { id: `private-term-${i + 1}`, why: `private term #${i + 1} (CHECK_SITE_PRIVATE_TERMS)`, re: new RegExp(source, 'gi') };
    });
}

/** Text chunks that PNG and JPEG files carry (tEXt/iTXt/zTXt, XMP, comments) + EXIF presence. */
function imageMetadata(buf) {
  const texts = [];
  let exif = false;
  if (buf.length > 8 && buf.readUInt32BE(0) === 0x89504e47) {
    for (let p = 8; p + 12 <= buf.length;) {
      const len = buf.readUInt32BE(p);
      const type = buf.toString('latin1', p + 4, p + 8);
      const data = buf.subarray(p + 8, p + 8 + len);
      if (type === 'tEXt') texts.push(data.toString('latin1'));
      else if (type === 'zTXt' || type === 'iTXt') {
        const nul = data.indexOf(0);
        try {
          if (type === 'zTXt') texts.push(inflateSync(data.subarray(nul + 2)).toString('latin1'));
          else {
            const compressed = data[nul + 1] === 1;
            let q = data.indexOf(0, nul + 3); // end of language tag
            q = data.indexOf(0, q + 1); // end of translated keyword
            const body = data.subarray(q + 1);
            texts.push((compressed ? inflateSync(body) : body).toString('utf8'));
          }
        } catch {
          texts.push(data.toString('latin1'));
        }
      } else if (type === 'eXIf') exif = true;
      else if (type === 'IEND') break;
      p += 12 + len;
    }
  } else if (buf.length > 4 && buf[0] === 0xff && buf[1] === 0xd8) {
    for (let p = 2; p + 4 <= buf.length && buf[p] === 0xff;) {
      const marker = buf[p + 1];
      if (marker === 0xd9 || marker === 0xda) break; // end of image / start of scan
      if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
        p += 2;
        continue;
      }
      const seg = buf.subarray(p + 4, p + 2 + buf.readUInt16BE(p + 2));
      const head = seg.toString('latin1', 0, 29);
      if (marker === 0xe1 && head.startsWith('Exif')) exif = true;
      else if ((marker === 0xe1 && head.startsWith('http://ns.adobe.com/xap/')) || marker === 0xfe) texts.push(seg.toString('utf8'));
      p += 2 + seg.length + 2;
    }
  }
  return { texts, exif };
}

function checkPrivacy() {
  const c = new Check(2, 'Privacy: nothing from the FORBIDDEN list');
  const rules = [...FORBIDDEN, ...privateTerms(),
    { id: 'email', why: `e-mail address other than ${PUBLIC_EMAIL}`, re: EMAIL, ok: (s) => s.toLowerCase() === PUBLIC_EMAIL }];
  // Base64 payloads are random letters; blank them so they cannot trip the word rules.
  const find = (text) => {
    const clean = text.replace(/;base64,[A-Za-z0-9+/=]+/g, blank);
    const hits = [];
    for (const r of rules) {
      for (const m of clean.matchAll(r.re)) if (!r.ok?.(m[0])) hits.push({ r, start: m.index, end: m.index + m[0].length });
    }
    return hits;
  };
  const report = (f, text, index, h, note) => c.error(f.rel, text, index, h.r.id,
    `${note ? `${note}: ` : ''}${h.r.why} [redacted, ${h.end - h.start} chars]`);
  /** Scan a text file as written, then as decoded; decoded hits that overlap a raw hit of the same rule are dropped. */
  const scanText = (f) => {
    const raw = find(f.text);
    for (const h of raw) report(f, f.text, h.start, h);
    const view = decodedView(f.text, f.ext);
    if (view.text === f.text) return;
    for (const h of find(view.text)) {
      const a = view.map[h.start];
      const b = view.map[h.end - 1] + 1;
      if (raw.some((x) => x.r === h.r && x.start < b && a < x.end)) continue;
      report(f, f.text, a, h, 'as displayed (entities/escapes decoded, tags removed)');
    }
  };
  /** Scan text with no usable position (file names, image metadata, binary content). */
  const scanLoose = (f, text, where) => {
    const seen = new Set();
    for (const t of [text, decodedView(text, '.txt').text]) {
      for (const h of find(t)) {
        const key = `${h.r.id}:${t.slice(h.start, h.end)}`;
        if (!seen.has(key)) report(f, null, null, h, where);
        seen.add(key);
      }
    }
  };
  let images = 0;
  let binaries = 0;
  for (const f of files) {
    if (f.symlink) continue;
    scanLoose(f, f.rel, 'file name');
    if (PATH_ADDRESS.test(f.rel)) c.error(f.rel, null, null, 'street-address', 'file name looks like a street address');
    if (f.text != null) scanText(f);
    else if (/^\.(?:png|jpe?g|ico)$/.test(f.ext)) {
      images++;
      // An .ico can wrap PNG images: read the metadata of each one.
      const starts = f.ext === '.ico' ? [...f.buf.toString('latin1').matchAll(/\x89PNG\r\n\x1a\n/g)].map((m) => m.index) : [0];
      for (const at of starts) {
        const meta = imageMetadata(f.buf.subarray(at));
        for (const t of meta.texts) scanLoose(f, t, 'image metadata');
        if (meta.exif) c.warn(f.rel, null, null, 'exif', 'embedded EXIF metadata (camera, timestamps, maybe location): strip it');
      }
    } else {
      // Not deployable (check 1 fails it), but read what we can: uncompressed PDF, RTF, CSV...
      binaries++;
      scanLoose(f, f.buf.toString('latin1'), 'file content');
    }
  }
  c.stats = `${textFiles.length} text files (as written and as displayed), ${images} images` +
    `${binaries ? `, ${binaries} other files` : ''} and ${files.length} file names scanned against ${rules.length} rules`;
  return c;
}

// ---------------------------------------------------------------------------
// 3. CSP compatibility
// ---------------------------------------------------------------------------

const LOAD_RELS = /\b(?:stylesheet|icon|preload|modulepreload|prefetch|preconnect|dns-prefetch|manifest|apple-touch-icon|mask-icon)\b/i;
const FORBIDDEN_TAGS = new Set(['iframe', 'frame', 'frameset', 'object', 'embed', 'applet', 'base']);

/** URLs a tag makes the browser fetch (not navigations). */
function loadUrls(tag) {
  const out = [];
  const a = tag.attrs;
  const add = (v) => v != null && out.push(v);
  if (['script', 'img', 'source', 'audio', 'video', 'track', 'input', 'iframe', 'embed'].includes(tag.name)) add(a.get('src'));
  if (tag.name === 'img' || tag.name === 'source') {
    for (const part of (a.get('srcset') || '').split(',')) if (part.trim()) add(part.trim().split(/\s+/)[0]);
  }
  if (tag.name === 'video') add(a.get('poster'));
  if (tag.name === 'object') add(a.get('data'));
  if (tag.name === 'link' && LOAD_RELS.test(a.get('rel') || '')) add(a.get('href'));
  if (['image', 'use', 'feimage'].includes(tag.name)) add(a.get('href') ?? a.get('xlink:href'));
  return out;
}

function checkMarkupCsp(c, f) {
  const { doc } = f;
  const t = doc.text;
  for (const s of doc.styles) c.error(f.rel, t, s.index, 'style-block', '<style> block (blocked by style-src \'self\'; move it to a .css file)');
  for (const s of doc.scripts) {
    const type = (s.attrs.get('type') || '').trim().toLowerCase();
    const hasBody = s.body.trim() !== '';
    if (s.attrs.has('src')) {
      if (hasBody) c.error(f.rel, t, s.index, 'script-body', '<script src> must be empty');
    } else if (type === 'application/ld+json' && f.ext !== '.svg') {
      try {
        JSON.parse(s.body);
      } catch (e) {
        c.error(f.rel, t, s.bodyIndex, 'json-ld', `JSON-LD does not parse: ${e.message}`);
      }
    } else {
      c.error(f.rel, t, s.index, 'inline-script', 'inline <script> (blocked by script-src \'self\'; only JSON-LD data blocks may be inline)');
    }
  }
  for (const tag of doc.tags) {
    const a = tag.attrs;
    if (FORBIDDEN_TAGS.has(tag.name)) c.error(f.rel, t, tag.index, 'forbidden-tag', `<${tag.name}> is blocked by the CSP (and would reach a third party)`);
    if (a.has('style')) c.error(f.rel, t, tag.index, 'inline-style', `style="" attribute on <${tag.name}> (blocked by style-src 'self'; use a class)`);
    for (const [name, value] of a) {
      if (/^on[a-z]+$/.test(name)) c.error(f.rel, t, tag.index, 'event-handler', `inline ${name}="" handler (blocked by the CSP; use addEventListener)`);
      if (['href', 'src', 'action', 'formaction', 'xlink:href'].includes(name) && /^\s*javascript:/i.test(value)) {
        c.error(f.rel, t, tag.index, 'javascript-url', 'javascript: URL (blocked by the CSP)');
      }
    }
    if (tag.name === 'form' && a.has('action')) {
      const ref = classify(f.rel, a.get('action'));
      if (ref.kind === 'external' && ref.scheme !== 'mailto') c.error(f.rel, t, tag.index, 'form-action', 'form posts to another origin (form-action allows \'self\' and mailto: only)');
    }
    for (const u of loadUrls(tag)) {
      const ref = classify(f.rel, u);
      if (ref.kind === 'external' && ref.scheme !== 'data') {
        c.error(f.rel, t, tag.index, 'third-party-request', `<${tag.name}> loads "${u}" from another origin (blocked by the CSP; host it under site/)`);
      } else if (ref.kind === 'own') {
        c.warn(f.rel, t, tag.index, 'absolute-self-url', `<${tag.name}> loads "${u}" by absolute URL; use a root-relative path so previews work`);
      }
    }
    if (tag.name === 'noscript' && f.ext !== '.svg') c.warn(f.rel, t, tag.index, 'noscript', '<noscript> (the contract keeps all content visible without it)');
  }
}

function checkCsp() {
  const c = new Check(3, 'CSP: no inline styles/scripts, handlers, eval or third-party requests');
  for (const f of [...htmlFiles, ...svgFiles]) checkMarkupCsp(c, f);
  for (const f of cssFiles) {
    for (const m of f.text.matchAll(/url\(\s*(?:"([^"]*)"|'([^']*)'|([^)\s]*))\s*\)|@import\s+['"]([^'"]+)['"]/gi)) {
      const u = m[1] ?? m[2] ?? m[3] ?? m[4] ?? '';
      const ref = classify(f.rel, u);
      if (ref.kind === 'external' && ref.scheme !== 'data') c.error(f.rel, f.text, m.index, 'third-party-request', `CSS loads "${u}" from another origin`);
    }
  }
  // view: 'bare' = code only (strings blanked), 'code' = code + strings, 'string' = inside a string only.
  const jsRules = [
    ['bare', /\beval\s*\(/g, 'error', 'eval', 'eval() (blocked: no \'unsafe-eval\')'],
    ['bare', /\bnew\s+Function\s*\(/g, 'error', 'eval', 'new Function() (blocked: no \'unsafe-eval\')'],
    ['code', /\bset(?:Timeout|Interval)\s*\(\s*['"`]/g, 'error', 'eval', 'string passed to a timer (evaluated as code)'],
    // Quoted or not: CSP blocks <div style=color:red> as well as style="...".
    ['string', /(?<![.\w-])style\s*=(?!=)/g, 'error', 'inline-style', 'style= attribute in markup built by JS (blocked by style-src \'self\'; use classes)'],
    ['code', /\.setAttribute\s*\(\s*['"]style['"]/g, 'error', 'inline-style', 'setAttribute("style", ...) (blocked by the CSP; use classes or el.style.prop)'],
    ['code', /\.setAttribute\s*\(\s*['"]on[a-z]+['"]/g, 'error', 'event-handler', 'inline event handler set as an attribute'],
    ['code', /\b(?:fetch|import|EventSource|WebSocket|sendBeacon)\s*\(\s*['"`](?:[a-z][a-z0-9+.-]*:)?\/\//gi, 'error', 'third-party-request', 'request to another origin'],
    // Loading properties/attributes set to another origin (e.g. a tracking pixel: new Image().src = 'https://...').
    // Not href: <a href> is a navigation, which the CSP allows.
    ['code', /\.(?:src|srcset|poster|action|formAction)\s*=\s*['"`](?:[a-z][a-z0-9+.-]*:)?\/\//g, 'error', 'third-party-request', 'loading property set to another origin (blocked by the CSP; host it under site/)'],
    ['code', /\.setAttribute\s*\(\s*['"](?:src|srcset|poster|data|action|formaction)['"]\s*,\s*['"`](?:[a-z][a-z0-9+.-]*:)?\/\//gi, 'error', 'third-party-request', 'loading attribute set to another origin (blocked by the CSP; host it under site/)'],
    ['code', /(?<![\w$.])['"]?(?:src|srcset|poster|action|formaction)['"]?\s*:\s*['"`](?:[a-z][a-z0-9+.-]*:)?\/\//g, 'error', 'third-party-request', 'loading attribute (in an attrs object) set to another origin (blocked by the CSP)'],
    ['bare', /\bdocument\.cookie\b/g, 'error', 'cookie', 'document.cookie (the site promises "No cookies")'],
    ['bare', /\.(?:inner|outer)HTML\s*\+?=(?!=)(?!\s*(['"`])\1)|\binsertAdjacentHTML\s*\(|\bdocument\.write(?:ln)?\s*\(/g, 'warn', 'html-sink',
      'HTML string sink: make sure no user input reaches it (prefer textContent / createElement)'],
  ];
  for (const f of jsFiles) {
    for (const [view, re, level, rule, msg] of jsRules) {
      for (const m of f[view === 'string' ? 'code' : view].matchAll(re)) {
        if (view === 'string' && !f.inString[m.index]) continue; // not inside a string literal
        c[level === 'error' ? 'error' : 'warn'](f.rel, f.text, m.index, rule, msg);
      }
    }
  }
  c.stats = `${htmlFiles.length} HTML, ${svgFiles.length} SVG, ${cssFiles.length} CSS and ${jsFiles.length} JS files`;
  return c;
}

// ---------------------------------------------------------------------------
// 4. Links
// ---------------------------------------------------------------------------

const URL_ATTRS = new Set(['href', 'src', 'poster', 'data', 'action', 'formaction', 'xlink:href']);

function checkLinks() {
  const c = new Check(4, 'Links: local references resolve (case-exact)');
  let count = 0;
  const handle = (f, text, index, raw, { rootOnly = false, folderIndex = false } = {}) => {
    const ref = classify(f.rel, raw);
    if (ref.kind === 'bad') {
      c.error(f.rel, text, index, 'bad-url', ref.msg);
    } else if (ref.kind === 'fragment') {
      count++;
      const doc = f.doc;
      if (doc && !['top'].includes(ref.hash) && !doc.ids.has(ref.hash)) c.error(f.rel, text, index, 'missing-anchor', `"#${ref.hash}": no element with that id on this page`);
    } else if (ref.kind === 'local') {
      count++;
      if (ref.relative && rootOnly) {
        c.error(f.rel, text, index, 'relative-in-404', `"${raw}" is relative; 404.html is served at any depth, so use a root-relative path`);
      } else if (ref.relative && folderIndex) {
        c.warn(f.rel, text, index, 'relative-in-folder-index', `"${raw}" is relative; this page is also served as /${posix.dirname(f.rel)} (no trailing slash), where it resolves differently`);
      }
      verifyLocal(c, f, text, index, ref, raw);
    }
  };
  // `node` = true for JSON-LD identifiers ("@id": ".../#mei"): their fragments name
  // graph nodes, not elements on the page.
  const handleOwn = (f, text, index, raw, u, node = false) => {
    count++;
    if (u.protocol !== 'https:') c.warn(f.rel, text, index, 'insecure-self-link', `"${raw}" uses http:`);
    if (!/^www\./i.test(u.hostname)) c.warn(f.rel, text, index, 'apex-link', `"${raw}": use https://www.meiorz.tech/... (the bare domain only redirects)`);
    let path = u.pathname;
    try {
      path = decodeURI(path);
    } catch { /* keep */ }
    const rel = path.replace(/^\/+/, '').replace(/\/$/, '');
    verifyLocal(c, f, text, index, { rel, isDir: path.endsWith('/') || rel === '', hash: node ? '' : u.hash.slice(1) }, raw);
  };

  for (const f of [...htmlFiles, ...svgFiles]) {
    const rootOnly = f.rel === '404.html';
    const folderIndex = f.ext !== '.svg' && f.rel.endsWith('/index.html');
    for (const tag of f.doc.tags) {
      for (const [name, value] of tag.attrs) {
        if (URL_ATTRS.has(name) && !/^\s*javascript:/i.test(value)) handle(f, f.doc.text, tag.index, value, { rootOnly, folderIndex });
      }
      if (tag.attrs.has('srcset')) {
        for (const part of tag.attrs.get('srcset').split(',')) {
          const u = part.trim().split(/\s+/)[0];
          if (u) handle(f, f.doc.text, tag.index, u, { rootOnly, folderIndex });
        }
      }
    }
  }
  for (const f of cssFiles) {
    for (const m of f.text.matchAll(/url\(\s*(?:"([^"]*)"|'([^']*)'|([^)\s]*))\s*\)|@import\s+['"]([^'"]+)['"]/gi)) {
      const u = m[1] ?? m[2] ?? m[3] ?? m[4] ?? '';
      if (!u.startsWith('#') && !/^data:/i.test(u)) handle(f, f.text, m.index, u);
    }
  }
  for (const f of jsFiles) {
    const importRe = /\b(?:import|export)\b[^'"`;()]*?\bfrom\s*(['"])([^'"]+)\1|\bimport\s*\(\s*(['"])([^'"]+)\3\s*\)|\bimport\s+(['"])([^'"]+)\5|\bnew\s+URL\s*\(\s*(['"])([^'"]+)\7\s*,\s*import\.meta\.url/g;
    for (const m of f.code.matchAll(importRe)) {
      const spec = m[2] ?? m[4] ?? m[6] ?? m[8];
      if (/^(?:\.{1,2})?\//.test(spec)) handle(f, f.text, m.index, spec);
      else if (!/^[a-z][a-z0-9+.-]*:/i.test(spec)) c.error(f.rel, f.text, m.index, 'bare-import', `bare import "${spec}" (no bundler: browsers cannot resolve it)`);
    }
    // Root-relative file paths in string literals, e.g. fetch('/resume.txt').
    for (const m of f.code.matchAll(/(['"`])(\/(?:[\w.-]+\/)*[\w.-]+\.(?:html?|css|m?js|json|txt|md|luau|svg|png|jpe?g|webp|avif|gif|ico|xml))\1/g)) {
      handle(f, f.text, m.index, m[2]);
    }
  }
  // Relative markdown links in index.md and llms.txt (absolute ones are covered below).
  for (const f of textFiles.filter((x) => x.ext === '.md' || x.rel === 'llms.txt')) {
    for (const m of f.text.matchAll(/\]\(\s*<?([^)\s>]+)>?(?:\s+"[^"]*")?\s*\)/g)) handle(f, f.text, m.index, m[1]);
  }
  // Absolute URLs to this site anywhere in text: canonical, og:image, JSON-LD, sitemap,
  // robots.txt, llms.txt... (the attribute and markdown passes above leave these to this one).
  for (const f of textFiles) {
    const ldRanges = (f.doc?.scripts ?? [])
      .filter((s) => (s.attrs.get('type') || '').trim().toLowerCase() === 'application/ld+json')
      .map((s) => [s.bodyIndex, s.bodyIndex + s.body.length]);
    for (const m of f.text.matchAll(/\bhttps?:\/\/(?:www\.)?meiorz\.tech(?![\w-])(?!\.[\w-])[^\s"'<>()[\]{}\\`]*/gi)) {
      const raw = m[0].replace(/[.,;:!?*]+$/, '');
      let u;
      try {
        u = new URL(raw);
      } catch {
        c.error(f.rel, f.text, m.index, 'bad-url', `malformed URL "${raw}"`);
        continue;
      }
      handleOwn(f, f.text, m.index, raw, u, ldRanges.some(([a, b]) => m.index >= a && m.index < b));
    }
  }
  c.stats = `${count} references checked`;
  return c;
}

// ---------------------------------------------------------------------------
// 5. staticwebapp.config.json
// ---------------------------------------------------------------------------

const CONFIG_KEYS = new Set(['routes', 'navigationFallback', 'responseOverrides', 'mimeTypes', 'globalHeaders',
  'auth', 'networking', 'forwardingGateway', 'platform', 'trailingSlash']);
const ROUTE_KEYS = new Set(['route', 'methods', 'allowedRoles', 'headers', 'redirect', 'statusCode', 'rewrite']);
const REQUIRED_HEADERS = {
  'x-content-type-options': /^nosniff$/i,
  'referrer-policy': /\S/,
  'permissions-policy': /\S/,
  'cross-origin-opener-policy': /^same-origin$/i,
  'x-frame-options': /^deny$/i,
};
const REQUIRED_MIME = ['.luau', '.md', '.txt'];
// SPEC section 3. The site needs every directive: e.g. without connect-src 'self' the
// resume and obby fetches fall back to default-src 'none' and fail; without img-src every
// image is blocked.
const EXPECTED_CSP = "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:; " +
  "font-src 'self'; connect-src 'self'; manifest-src 'self'; base-uri 'none'; form-action 'self' mailto:; " +
  "frame-ancestors 'none'; object-src 'none'; upgrade-insecure-requests";

/** Directive name -> source list. Browsers use the first of duplicate directives and ignore the rest. */
function parseCsp(value) {
  const directives = new Map();
  const duplicates = [];
  for (const part of value.split(';')) {
    const [name, ...sources] = part.trim().split(/\s+/).filter(Boolean);
    if (!name) continue;
    const key = name.toLowerCase();
    if (directives.has(key)) duplicates.push(key);
    else directives.set(key, sources);
  }
  return { directives, duplicates };
}
const EXPECTED_DIRECTIVES = parseCsp(EXPECTED_CSP).directives;
const sourceKey = (list) => list.map((s) => s.toLowerCase()).sort().join(' ');

function checkCspPolicy(c, text, value, where) {
  const idx = Math.max(0, text.indexOf(value.slice(0, 40)));
  const { directives, duplicates } = parseCsp(value);
  for (const d of duplicates) c.error(CONFIG_FILE, text, idx, 'csp', `${where}: duplicate ${d} (browsers ignore all but the first)`);
  for (const [name, want] of EXPECTED_DIRECTIVES) {
    const got = directives.get(name);
    const spelled = want.length ? `${name} ${want.join(' ')}` : name;
    if (!got) c.error(CONFIG_FILE, text, idx, 'csp', `${where}: missing "${spelled}" (SPEC section 3 policy)`);
    else if (sourceKey(got) !== sourceKey(want)) {
      c.error(CONFIG_FILE, text, idx, 'csp', `${where}: must be exactly "${spelled}", found "${[name, ...got].join(' ')}"`);
    }
  }
  for (const [name, sources] of directives) {
    if (EXPECTED_DIRECTIVES.has(name)) continue; // compared exactly above
    c.warn(CONFIG_FILE, text, idx, 'csp-extra', `${where}: ${name} is not part of the SPEC section 3 policy`);
    for (const s of sources) {
      if (/^'(?:unsafe-inline|unsafe-eval|unsafe-hashes|wasm-unsafe-eval|strict-dynamic)'$/i.test(s) || s === '*' || /^(?:https?|wss?|blob):$/i.test(s) || /[.*]/.test(s.replace(/^'.*'$/, ''))) {
        c.error(CONFIG_FILE, text, idx, 'csp', `${where}: ${name} allows ${s}`);
      } else if (s === 'data:' && name !== 'img-src') {
        c.error(CONFIG_FILE, text, idx, 'csp', `${where}: data: is only acceptable in img-src (found in ${name})`);
      }
    }
  }
}

function checkConfig() {
  const c = new Check(5, `Config: ${CONFIG_FILE} is valid and sound`);
  const f = byRel.get(CONFIG_FILE);
  if (!f) {
    c.error(CONFIG_FILE, null, null, 'missing', 'config file is missing');
    return c;
  }
  const text = f.text;
  const at = (needle) => Math.max(0, text.indexOf(needle));
  if (f.size > CONFIG_MAX) c.error(CONFIG_FILE, null, null, 'too-large', `${fmtSize(f.size)} exceeds the 20 KB platform limit`);
  if (configError) {
    c.error(CONFIG_FILE, null, null, 'json', `does not parse: ${configError}`);
    return c;
  }
  if (!config || typeof config !== 'object' || Array.isArray(config)) {
    c.error(CONFIG_FILE, null, null, 'json', 'top level must be an object');
    return c;
  }
  for (const k of Object.keys(config)) if (!CONFIG_KEYS.has(k)) c.error(CONFIG_FILE, text, at(`"${k}"`), 'unknown-key', `unknown top-level key "${k}"`);
  if ('navigationFallback' in config) {
    c.error(CONFIG_FILE, text, at('"navigationFallback"'), 'navigation-fallback', 'navigationFallback turns every missing URL into a 200 "soft 404"; remove it');
  }
  if (config.trailingSlash != null && !['always', 'never', 'auto'].includes(config.trailingSlash)) {
    c.error(CONFIG_FILE, text, at('"trailingSlash"'), 'trailing-slash', 'trailingSlash must be always, never or auto');
  }

  // Routes
  const list = config.routes ?? [];
  if (!Array.isArray(list)) c.error(CONFIG_FILE, text, at('"routes"'), 'routes', 'routes must be an array');
  const seen = new Map();
  (Array.isArray(list) ? list : []).forEach((r, i) => {
    const where = `routes[${i}]`;
    if (!r || typeof r !== 'object' || typeof r.route !== 'string') {
      c.error(CONFIG_FILE, null, null, 'routes', `${where} needs a "route" string`);
      return;
    }
    const idx = at(`"${r.route}"`);
    for (const k of Object.keys(r)) if (!ROUTE_KEYS.has(k)) c.error(CONFIG_FILE, text, idx, 'routes', `${where}: unknown key "${k}"`);
    if (!r.route.startsWith('/')) c.error(CONFIG_FILE, text, idx, 'routes', `${where}: route must start with "/"`);
    const star = r.route.indexOf('*');
    if (star !== -1 && (r.route.indexOf('/', star) !== -1 || !/^\*(?:\.[\w-]+|\.\{[\w-]+(?:,[\w-]+)*\})?$/.test(r.route.slice(star)))) {
      c.error(CONFIG_FILE, text, idx, 'routes', `${where}: "${r.route}" wildcards are only supported at the end of a path`);
    }
    if (r.redirect && r.rewrite) c.error(CONFIG_FILE, text, idx, 'routes', `${where}: redirect and rewrite cannot be combined`);
    if (r.redirect && r.statusCode != null && ![301, 302, 307, 308].includes(r.statusCode)) {
      c.error(CONFIG_FILE, text, idx, 'routes', `${where}: redirect statusCode must be 301, 302, 307 or 308`);
    }
    const key = `${r.route} ${(r.methods || []).join(',')}`;
    if (seen.has(key)) c.error(CONFIG_FILE, text, idx, 'duplicate-route', `${where} duplicates routes[${seen.get(key)}] and can never match`);
    else seen.set(key, i);
    if (star === -1) {
      const shadow = list.slice(0, i).findIndex((e) => e && typeof e.route === 'string' && e.route.includes('*') && !e.methods && routeMatches(e.route, r.route));
      if (shadow !== -1) c.warn(CONFIG_FILE, text, idx, 'shadowed-route', `${where} is shadowed by routes[${shadow}] ("${list[shadow].route}") and never matches`);
    }
    for (const [kind, target] of [['redirect', r.redirect], ['rewrite', r.rewrite]]) {
      if (typeof target !== 'string') continue;
      if (/^https?:\/\//i.test(target)) continue; // external redirect
      const ref = classify('', target);
      if (ref.kind !== 'local' || ref.relative) {
        c.error(CONFIG_FILE, text, idx, 'route-target', `${where}: ${kind} target "${target}" must be root-relative`);
        continue;
      }
      const file = ref.isDir ? (ref.rel ? `${ref.rel}/index.html` : 'index.html') : ref.rel;
      if (!fileSet.has(file)) c.error(CONFIG_FILE, text, idx, 'route-target', `${where}: ${kind} target "${target}" -> site/${file} does not exist`);
      // Follow redirects from the target to catch chains and loops.
      if (kind === 'redirect') {
        const visited = [r.route];
        let path = target.replace(/[?#].*$/, '');
        for (let hop = 0; hop < 10; hop++) {
          const next = routes.find((e) => routeMatches(e.route, path) || routeMatches(e.route.toLowerCase(), path.toLowerCase()));
          if (!next?.redirect || /^https?:/i.test(next.redirect)) break;
          if (visited.includes(next.route)) {
            c.error(CONFIG_FILE, text, idx, 'redirect-loop', `${where}: redirect loop via "${next.route}"`);
            break;
          }
          c.warn(CONFIG_FILE, text, idx, 'redirect-chain', `${where}: target "${path}" redirects again via "${next.route}"`);
          visited.push(next.route);
          path = next.redirect.replace(/[?#].*$/, '');
        }
      }
    }
    // A route header replaces the global one for that route; an empty value removes it.
    for (const [name, value] of Object.entries(r.headers || {})) {
      const key = name.toLowerCase();
      const v = String(value ?? '').trim();
      if (key !== 'content-security-policy' && !Object.hasOwn(REQUIRED_HEADERS, key)) continue;
      if (!v) c.error(CONFIG_FILE, text, idx, 'headers', `${where}: empty ${name} header removes the global one on this route`);
      else if (key === 'content-security-policy') checkCspPolicy(c, text, v, where);
      else if (!REQUIRED_HEADERS[key].test(v)) c.error(CONFIG_FILE, text, idx, 'headers', `${where}: unexpected ${name}: "${v}"`);
    }
  });

  // Response overrides
  const overrides = config.responseOverrides ?? {};
  for (const [code, o] of Object.entries(overrides)) {
    if (!['400', '401', '403', '404'].includes(code)) c.error(CONFIG_FILE, text, at(`"${code}"`), 'overrides', `responseOverrides cannot override ${code}`);
    const target = o?.rewrite ?? o?.redirect;
    if (typeof target === 'string' && target.startsWith('/')) {
      const ref = classify('', target);
      const file = ref.isDir ? `${ref.rel ? `${ref.rel}/` : ''}index.html` : ref.rel;
      if (!fileSet.has(file)) c.error(CONFIG_FILE, text, at(`"${code}"`), 'overrides', `responseOverrides ${code} -> site/${file} does not exist`);
    }
  }
  if (!overrides['404']?.rewrite) c.error(CONFIG_FILE, null, null, 'overrides', 'responseOverrides needs "404": { "rewrite": "/404.html" }');

  // Global headers
  const headers = Object.fromEntries(Object.entries(config.globalHeaders ?? {}).map(([k, v]) => [k.toLowerCase(), String(v)]));
  const csp = headers['content-security-policy'];
  if (!csp) c.error(CONFIG_FILE, null, null, 'csp', 'globalHeaders has no Content-Security-Policy');
  else checkCspPolicy(c, text, csp, 'globalHeaders');
  for (const [name, re] of Object.entries(REQUIRED_HEADERS)) {
    if (!headers[name]) c.error(CONFIG_FILE, null, null, 'headers', `globalHeaders is missing ${name}`);
    else if (!re.test(headers[name].trim())) c.error(CONFIG_FILE, text, at(headers[name]), 'headers', `unexpected ${name}: "${headers[name]}"`);
  }

  // MIME types
  const mime = config.mimeTypes ?? {};
  for (const [ext, type] of Object.entries(mime)) {
    if (!ext.startsWith('.')) c.error(CONFIG_FILE, text, at(`"${ext}"`), 'mime', `mimeTypes key "${ext}" must start with "."`);
    if (!/^[a-z]+\/[a-z0-9.+-]+(?:;\s*charset=[a-z0-9-]+)?$/i.test(String(type))) c.error(CONFIG_FILE, text, at(`"${ext}"`), 'mime', `"${type}" is not a valid media type`);
  }
  for (const ext of REQUIRED_MIME) if (!mime[ext]) c.error(CONFIG_FILE, null, null, 'mime', `mimeTypes has no entry for ${ext}`);

  const redirects = routes.filter((r) => r.redirect).length;
  c.stats = `${fmtSize(f.size)} of 20 KB, ${routes.length} routes (${redirects} redirects), ${Object.keys(headers).length} global headers`;
  return c;
}

// ---------------------------------------------------------------------------
// 6. Budgets
// ---------------------------------------------------------------------------

function budgetFor(rel) {
  const hit = BUDGETS.find(([p]) => (typeof p === 'string' ? p === rel : p.test(rel)));
  return hit ? { max: hit[1], explicit: true } : { max: DEFAULT_FILE_BUDGET, explicit: false };
}

function checkBudgets() {
  const c = new Check(6, 'Budgets: per-file and total size');
  const rows = [];
  let total = 0;
  let gzTotal = 0;
  for (const f of files) {
    total += f.size;
    const gz = f.text != null ? gzipSync(f.buf, { level: 9 }).length : f.size;
    gzTotal += gz;
    const b = budgetFor(f.rel);
    if (b.explicit) rows.push({ rel: f.rel, size: f.size, gz, max: b.max });
    if (f.size > b.max) c.error(f.rel, null, null, 'over-budget', `${fmtSize(f.size)} exceeds the ${fmtSize(b.max)} budget`);
    else if (b.explicit && f.size > 0.9 * b.max) c.warn(f.rel, null, null, 'near-budget', `${fmtSize(f.size)} is over 90% of the ${fmtSize(b.max)} budget`);
  }
  if (total > TOTAL_BUDGET) c.error(null, null, null, 'total', `site/ is ${fmtSize(total)}, over the ${fmtSize(TOTAL_BUDGET)} budget`);
  if (files.length > MAX_FILES) c.error(null, null, null, 'file-count', `${files.length} files exceeds the ${MAX_FILES}-file platform limit`);
  c.table = { rows, total, gzTotal };
  c.stats = `site/ is ${fmtSize(total)} (${fmtSize(gzTotal)} gzipped) of ${fmtSize(TOTAL_BUDGET)}`;
  return c;
}

// ---------------------------------------------------------------------------
// 7. HTML basics
// ---------------------------------------------------------------------------

function checkHtml() {
  const c = new Check(7, 'HTML: lang, charset, title, alt text, unique ids');
  for (const f of htmlFiles) {
    const { text, tags } = f.doc;
    if (!/^\s*<!doctype html>/i.test(f.text)) c.warn(f.rel, null, null, 'doctype', 'missing <!doctype html>');
    const html = tags.find((t) => t.name === 'html');
    if (!html?.attrs.get('lang')) c.error(f.rel, text, html?.index ?? null, 'lang', '<html> needs a lang attribute');
    if (!tags.some((t) => t.name === 'meta' && t.attrs.has('charset'))) c.error(f.rel, null, null, 'charset', 'missing <meta charset="utf-8">');
    if (!tags.some((t) => t.name === 'meta' && t.attrs.get('name') === 'viewport')) c.warn(f.rel, null, null, 'viewport', 'missing <meta name="viewport">');
    const title = /<title\b[^>]*>([\s\S]*?)<\/title\s*>/i.exec(text);
    if (!title || !title[1].trim()) c.error(f.rel, null, null, 'title', 'missing or empty <title>');
    const idsSeen = new Map();
    for (const t of tags) {
      if (t.name === 'img' && !t.attrs.has('alt')) c.error(f.rel, text, t.index, 'img-alt', '<img> without alt (use alt="" for decorative images)');
      if (t.attrs.get('target') === '_blank' && !/\bnoopener\b|\bnoreferrer\b/i.test(t.attrs.get('rel') || '')) {
        c.warn(f.rel, text, t.index, 'target-blank', 'target="_blank" without rel="noopener"');
      }
      const id = t.attrs.get('id');
      if (id != null && !t.inTemplate) {
        if (idsSeen.has(id)) c.error(f.rel, text, t.index, 'duplicate-id', `duplicate id="${id}" (first on line ${lineCol(text, idsSeen.get(id)).line})`);
        else idsSeen.set(id, t.index);
      }
    }
    if (/^archive\/blog\/(?!index\.html$)[^/]+\.html$/.test(f.rel)) {
      const robots = tags.find((t) => t.name === 'meta' && t.attrs.get('name') === 'robots');
      if (!/noindex/i.test(robots?.attrs.get('content') || '')) c.warn(f.rel, null, null, 'archive-noindex', 'archived post should carry <meta name="robots" content="noindex">');
    }
  }
  c.stats = `${htmlFiles.length} pages`;
  return c;
}

// ---------------------------------------------------------------------------
// 8. Syntax
// ---------------------------------------------------------------------------

function checkSyntax() {
  const c = new Check(8, 'Syntax: JS parses, JSON parses, text is UTF-8');
  for (const f of textFiles) if (f.badUtf8) c.error(f.rel, null, null, 'utf8', 'not valid UTF-8');
  for (const f of textFiles.filter((x) => x.ext === '.json' || x.ext === '.webmanifest')) {
    try {
      JSON.parse(f.text);
    } catch (e) {
      c.error(f.rel, null, null, 'json', `does not parse: ${e.message}`);
    }
  }
  // Classic scripts are the ones loaded by a plain <script src> (e.g. js/theme.js); the rest are modules.
  const classic = new Set();
  for (const f of htmlFiles) {
    for (const s of f.doc.scripts) {
      if (!s.attrs.has('src') || (s.attrs.get('type') || '').toLowerCase() === 'module') continue;
      const ref = classify(f.rel, s.attrs.get('src'));
      if (ref.kind === 'local') classic.add(ref.rel);
    }
  }
  for (const f of jsFiles) {
    const type = classic.has(f.rel) ? 'commonjs' : 'module';
    const r = spawnSync(process.execPath, [`--input-type=${type}`, '--check'], { input: f.text, encoding: 'utf8', timeout: 20000 });
    if (r.error) {
      c.error(f.rel, null, null, 'node-check', `could not run node --check: ${r.error.message}`);
    } else if (r.status !== 0) {
      const line = /\[stdin\]:(\d+)/.exec(r.stderr)?.[1];
      const msg = (/^\w*Error: .*$/m.exec(r.stderr)?.[0] || r.stderr.trim().split('\n').pop() || 'syntax error').trim();
      c.items.push({ level: 'error', file: `site/${f.rel}`, pos: line ? { line: +line, col: 1 } : null, rule: 'syntax', msg: `${msg} (parsed as ${type === 'module' ? 'an ES module' : 'a classic script'})` });
    }
  }
  c.stats = `${jsFiles.length} JS files parsed (${classic.size} classic, ${jsFiles.length - classic.size} modules)`;
  return c;
}

// ---------------------------------------------------------------------------
// 9. Claims
// ---------------------------------------------------------------------------

function checkClaims() {
  const c = new Check(9, 'Claims: no grades, transfer targets, weekly hours, follower numbers, A.S. or graduation claims');
  const short = (s) => (s.length > 60 ? `${s.slice(0, 57)}...` : s).replace(/\s+/g, ' ');
  const find = (text) => CLAIMS.flatMap((r) => findRule(r, text).map((h) => ({ r, ...h })));
  for (const f of textFiles) {
    const text = f.text.replace(/;base64,[A-Za-z0-9+/=]+/g, blank);
    const raw = find(text);
    for (const h of raw) c.error(f.rel, f.text, h.start, h.r.id, `${h.r.why}: "${short(h.s)}"`);
    const view = decodedView(text, f.ext, '\u2029');
    if (view.text === text) continue;
    for (const h of find(view.text)) {
      const a = view.map[h.start];
      const b = view.map[h.end - 1] + 1;
      if (raw.some((x) => x.r === h.r && x.start < b && a < x.end)) continue;
      c.error(f.rel, f.text, a, h.r.id, `as displayed: ${h.r.why}: "${short(h.s)}"`);
    }
  }
  c.stats = `${textFiles.length} text files against ${CLAIMS.length} rules`;
  return c;
}

// ---------------------------------------------------------------------------
// Run and report
// ---------------------------------------------------------------------------

let checks;
try {
  checks = [checkPaths(), checkPrivacy(), checkCsp(), checkLinks(), checkConfig(), checkBudgets(), checkHtml(), checkSyntax(),
    checkClaims()];
} catch (e) {
  console.error(`check-site: internal error: ${e.stack || e}`);
  process.exit(2);
}

const MAX_LISTED = 40;
const out = [];
out.push(bold(`check-site  ${SITE}`));
out.push('');
for (const c of checks) {
  const failed = c.errors > 0 || (opts.strict && c.warnings > 0);
  const label = failed ? red('[FAIL]') : c.warnings ? yellow('[WARN]') : green('[PASS]');
  if (opts.quiet && !c.items.length) continue;
  out.push(`${label} ${c.n}. ${c.title}  ${dim(`- ${c.stats}`)}`);
  // Errors first, then by file and position.
  const rank = (it) => [it.level === 'error' ? 0 : 1, it.file || '', it.pos?.line ?? 0, it.pos?.col ?? 0];
  const sorted = [...c.items].sort((x, y) => {
    const [a, b] = [rank(x), rank(y)];
    return a[0] - b[0] || a[1].localeCompare(b[1]) || a[2] - b[2] || a[3] - b[3];
  });
  for (const it of sorted.slice(0, MAX_LISTED)) {
    const where = it.file ? `${it.file}${it.pos ? `:${it.pos.line}:${it.pos.col}` : ''}` : 'site/';
    const mark = it.level === 'error' ? red('x') : yellow('!');
    out.push(`       ${mark} ${where}  ${dim(it.rule)}  ${it.msg}`);
  }
  if (sorted.length > MAX_LISTED) out.push(dim(`       ... and ${sorted.length - MAX_LISTED} more`));
}

const budget = checks.find((c) => c.table);
if (budget && !opts.quiet) {
  out.push('');
  out.push(bold('Budgets'));
  const w = Math.max(24, ...budget.table.rows.map((r) => r.rel.length + 2));
  out.push(dim(`  ${'file'.padEnd(w)}${'size'.padStart(10)}${'gzip'.padStart(10)}${'budget'.padStart(10)}${'used'.padStart(7)}`));
  const row = (name, size, gz, max) => {
    const pct = max ? Math.round((size / max) * 100) : null;
    const used = pct == null ? '' : `${pct}%`;
    const painted = pct == null ? used : pct > 100 ? red(used.padStart(7)) : pct > 90 ? yellow(used.padStart(7)) : used.padStart(7);
    return `  ${name.padEnd(w)}${fmtSize(size).padStart(10)}${(gz == null ? '' : fmtSize(gz)).padStart(10)}${(max ? fmtSize(max) : '').padStart(10)}${pct == null ? '' : painted}`;
  };
  for (const r of budget.table.rows) out.push(row(r.rel, r.size, r.gz, r.max));
  out.push(row(`site/ (${files.length} files)`, budget.table.total, budget.table.gzTotal, TOTAL_BUDGET));
}

const errors = checks.reduce((n, c) => n + c.errors, 0);
const warnings = checks.reduce((n, c) => n + c.warnings, 0);
const failedChecks = checks.filter((c) => c.errors > 0 || (opts.strict && c.warnings > 0)).length;
const ok = failedChecks === 0;
const secs = ((performance.now() - started) / 1000).toFixed(2);
out.push('');
out.push(`${ok ? green(bold('PASS')) : red(bold('FAIL'))}  ${checks.length - failedChecks}/${checks.length} checks passed, ` +
  `${errors} error${errors === 1 ? '' : 's'}, ${warnings} warning${warnings === 1 ? '' : 's'} (${secs} s)`);
console.log(out.join('\n'));

// Inline annotations on the PR diff when running in GitHub Actions.
if (env.GITHUB_ACTIONS === 'true') {
  const esc = (s) => String(s).replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A');
  const prop = (s) => esc(s).replace(/:/g, '%3A').replace(/,/g, '%2C');
  for (const c of checks) {
    for (const it of c.items.slice(0, 50)) {
      const kind = it.level === 'error' || opts.strict ? 'error' : 'warning';
      const loc = it.file ? `file=${prop(it.file)}${it.pos ? `,line=${it.pos.line},col=${it.pos.col}` : ''},` : '';
      console.log(`::${kind} ${loc}title=${prop(`check-site ${it.rule}`)}::${esc(it.msg)}`);
    }
  }
}

process.exitCode = ok ? 0 : 1;
