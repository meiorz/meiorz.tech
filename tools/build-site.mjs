#!/usr/bin/env node
/**
 * build-site.mjs: renders the pages from string resources, the way an Android app
 * keeps its copy in res/values/strings.xml. Zero dependencies.
 *
 *   res/values/strings.xml   every string, by name (<string>, <string-array>)
 *   res/layout/*.html        page layouts that name strings instead of holding copy
 *
 *   node tools/build-site.mjs           writes the files below
 *   node tools/build-site.mjs --check   writes nothing; fails if a file is out of date
 *
 * Outputs (committed, so site/ still deploys as-is):
 *   site/<name>.html     one per layout. In a layout, @string/name becomes the string
 *                        (escaped for where it sits: element content, an attribute or
 *                        JSON-LD) and @array/name, alone on its line, becomes one <li>
 *                        per item.
 *   site/js/strings.js   R.string / R.array with only the names the scripts in site/js
 *                        reference, plus stringResource(R.string.name, ...formatArgs).
 *
 * The build fails on an unknown or duplicate name, a string nothing uses, markup in a
 * string that is used as plain text, and anything in strings.xml it does not understand.
 *
 * Exit codes: 0 ok, 1 out of date (--check) or a resource error, 2 bad usage.
 */
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const STRINGS_XML = 'res/values/strings.xml';
const LAYOUT_DIR = 'res/layout';
const JS_DIR = 'site/js';
const STRINGS_JS = 'site/js/strings.js';

const NAME = '[a-z][a-z0-9_]*';
const INLINE_TAGS = new Set(['a', 'code', 'strong', 'em', 'kbd']);
const XML_ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

const args = process.argv.slice(2);
const checkOnly = args.includes('--check');
if (args.some((a) => a !== '--check')) {
  console.error('Usage: node tools/build-site.mjs [--check]');
  process.exit(2);
}

const errors = [];
const read = (rel) => readFileSync(join(ROOT, rel), 'utf8').replace(/\r\n/g, '\n');

// ---------------------------------------------------------------------------
// strings.xml
// ---------------------------------------------------------------------------

/** Checks one value: entities are well-formed and only inline tags appear. */
function validate(name, value) {
  for (const m of value.matchAll(/<\/?([a-zA-Z][\w-]*)[^>]*>/g)) {
    if (!INLINE_TAGS.has(m[1].toLowerCase())) errors.push(`${STRINGS_XML}: "${name}" uses <${m[1]}>; only ${[...INLINE_TAGS].join(', ')} are allowed`);
  }
  const bare = value.replace(/<\/?[a-zA-Z][^>]*>/g, '').replace(/&(?:amp|lt|gt|quot|apos|#\d+|#x[0-9a-fA-F]+);/g, '');
  if (/[<>&]/.test(bare)) errors.push(`${STRINGS_XML}: "${name}" has a bare <, > or & (write &lt; &gt; &amp;)`);
}

function parseResources(xml) {
  const strings = new Map();
  const arrays = new Map();
  const collapse = (s) => s.replace(/\s+/g, ' ').trim();
  const declare = (map, name, value) => {
    if (!new RegExp(`^${NAME}$`).test(name)) errors.push(`${STRINGS_XML}: "${name}" is not a snake_case name`);
    if (strings.has(name) || arrays.has(name)) errors.push(`${STRINGS_XML}: "${name}" is declared twice`);
    map.set(name, value);
  };
  const rest = xml
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<string-array\s+name="([^"]*)"\s*>([\s\S]*?)<\/string-array>/g, (m, name, body) => {
      const items = [];
      const left = body.replace(/<item>([\s\S]*?)<\/item>/g, (mm, item) => {
        items.push(collapse(item));
        return '';
      });
      if (left.trim()) errors.push(`${STRINGS_XML}: "${name}" has text outside its <item> elements`);
      items.forEach((item, i) => validate(`${name}[${i}]`, item));
      declare(arrays, name, items);
      return '';
    })
    .replace(/<string\s+name="([^"]*)"\s*>([\s\S]*?)<\/string>/g, (m, name, body) => {
      const value = collapse(body);
      validate(name, value);
      declare(strings, name, value);
      return '';
    })
    .replace(/^\s*<\?xml[^>]*\?>/, '')
    .replace(/<\/?resources>/g, '');
  if (rest.trim()) errors.push(`${STRINGS_XML}: could not read: ${rest.trim().slice(0, 80)}`);
  return { strings, arrays };
}

/** A value as plain text (entities decoded), or null if it holds markup. */
function plainText(value) {
  if (/<\/?[a-zA-Z]/.test(value)) return null;
  return value.replace(/&(?:(amp|lt|gt|quot|apos)|#(\d+)|#x([0-9a-fA-F]+));/g,
    (m, named, dec, hex) => (named ? XML_ENTITIES[named] : String.fromCodePoint(dec ? Number(dec) : parseInt(hex, 16))));
}

const res = parseResources(read(STRINGS_XML));
const used = new Set();

function lookup(kind, name, where) {
  const map = kind === 'array' ? res.arrays : res.strings;
  if (!map.has(name)) {
    errors.push(`${where}: unknown ${kind} "${name}"`);
    return null;
  }
  used.add(name);
  return map.get(name);
}

// ---------------------------------------------------------------------------
// Layouts
// ---------------------------------------------------------------------------

const escapeAttr = (s) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');

function renderLayout(rel) {
  const src = read(rel);
  const jsonLd = [...src.matchAll(/<script\s+type="application\/ld\+json">[\s\S]*?<\/script>/g)]
    .map((m) => [m.index, m.index + m[0].length]);
  const html = src.replace(new RegExp(`@(string|array)/(${NAME})`, 'g'), (m, kind, name, at) => {
    const value = lookup(kind, name, rel);
    if (value == null) return m;
    const lineStart = src.lastIndexOf('\n', at) + 1;
    if (kind === 'array') {
      const indent = src.slice(lineStart, at);
      if (indent.trim() || !/^[ \t]*(?:\n|$)/.test(src.slice(at + m.length))) errors.push(`${rel}: @array/${name} must be alone on its line`);
      return value.map((item) => `<li>${item}</li>`).join(`\n${indent}`);
    }
    const inJsonLd = jsonLd.some(([a, b]) => at > a && at < b);
    const inTag = src.lastIndexOf('<', at) > src.lastIndexOf('>', at);
    if (!inJsonLd && !inTag) return value; // element content: inline markup and entities pass through
    const text = plainText(value);
    if (text == null) {
      errors.push(`${rel}: "${name}" holds markup but is used as plain text (${inJsonLd ? 'JSON-LD' : 'attribute'})`);
      return m;
    }
    return inJsonLd ? JSON.stringify(text).slice(1, -1) : escapeAttr(text);
  });
  const note = `<!-- Generated by tools/build-site.mjs from ${rel} and ${STRINGS_XML}. Edit those, not this file. -->\n`;
  return html.replace(/^(<!doctype html>\n)?/i, (m) => m + note);
}

const outputs = new Map();
for (const file of readdirSync(join(ROOT, LAYOUT_DIR)).filter((f) => f.endsWith('.html')).sort()) {
  outputs.set(`site/${file}`, renderLayout(`${LAYOUT_DIR}/${file}`));
}

// ---------------------------------------------------------------------------
// site/js/strings.js: only what the scripts reference, as plain text
// ---------------------------------------------------------------------------

const refs = { string: new Set(), array: new Set() };
for (const file of readdirSync(join(ROOT, JS_DIR)).filter((f) => f.endsWith('.js') && `${JS_DIR}/${f}` !== STRINGS_JS).sort()) {
  const rel = `${JS_DIR}/${file}`;
  for (const m of read(rel).matchAll(new RegExp(`\\bR\\.(string|array)\\.(${NAME})`, 'g'))) {
    if (lookup(m[1], m[2], rel) != null) refs[m[1]].add(m[2]);
  }
}

function scriptText(name, value) {
  const text = plainText(value);
  if (text == null) errors.push(`${STRINGS_XML}: "${name}" holds markup but a script uses it (scripts get plain text)`);
  return text ?? '';
}

const entry = (name, value) => `    ${name}: ${JSON.stringify(value)},\n`;
outputs.set(STRINGS_JS, `/*
 * strings.js: the string resources the scripts in this folder use.
 * Generated by tools/build-site.mjs from ${STRINGS_XML}. Edit that file, not this one.
 *
 *   import { R, stringResource } from './strings.js';
 *   stringResource(R.string.term_loading, 'obby')
 */
export const R = Object.freeze({
  string: Object.freeze({
${[...refs.string].sort().map((n) => entry(n, scriptText(n, res.strings.get(n)))).join('')}  }),
  array: Object.freeze({
${[...refs.array].sort().map((n) => entry(n, res.arrays.get(n).map((item, i) => scriptText(`${n}[${i}]`, item)))).join('')}  }),
});

const ARG = /%(\\d+)\\$s/g;

/** Like Compose's stringResource(): the string, with %1$s, %2$s ... replaced by formatArgs. */
export function stringResource(value, ...formatArgs) {
  return String(value).replace(ARG, (m, n) => (n <= formatArgs.length ? String(formatArgs[n - 1]) : m));
}

/**
 * The string split around its format arguments, which are kept as they are, so an
 * argument can be a DOM node: stringParts(R.string.term_plain_file, link) -> ['Plain file: ', link].
 */
export function stringParts(value, ...formatArgs) {
  const parts = [];
  let last = 0;
  for (const m of String(value).matchAll(ARG)) {
    parts.push(value.slice(last, m.index), m[1] <= formatArgs.length ? formatArgs[m[1] - 1] : m[0]);
    last = m.index + m[0].length;
  }
  parts.push(value.slice(last));
  return parts.filter((part) => part !== '');
}
`);

for (const name of [...res.strings.keys(), ...res.arrays.keys()]) {
  if (!used.has(name)) errors.push(`${STRINGS_XML}: "${name}" is not used by any layout or script`);
}

// ---------------------------------------------------------------------------
// Write or check
// ---------------------------------------------------------------------------

if (errors.length) {
  for (const e of errors) console.error(`build-site: ${e}`);
  process.exit(1);
}

let stale = 0;
for (const [rel, text] of outputs) {
  let current = null;
  try {
    current = read(rel);
  } catch { /* not written yet */ }
  if (current === text) continue;
  stale++;
  if (checkOnly) console.error(`build-site: ${rel} is out of date; run node tools/build-site.mjs`);
  else writeFileSync(join(ROOT, rel), text);
}
const total = `${res.strings.size} strings, ${res.arrays.size} arrays`;
if (checkOnly) {
  if (stale) process.exit(1);
  console.log(`build-site: ${outputs.size} files are up to date (${total})`);
} else {
  console.log(`build-site: ${stale ? `wrote ${stale} of ${outputs.size} files` : `${outputs.size} files already up to date`} (${total})`);
}
