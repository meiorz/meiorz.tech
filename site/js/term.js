/**
 * term.js: the interactive shell for www.meiorz.tech (ES module, no dependencies).
 *
 * The page is a normal HTML document first: every section is already printed
 * and reads fine on its own. This module only enhances it: it reveals the
 * terminal (#terminal) and its prompt (#prompt), runs commands, prints output into #log (role="log")
 * and lazy-loads the two programs (obby, meiorz-cli). If anything here fails, the
 * static page keeps working and the terminal never appears.
 *
 * User-facing text comes from string resources (res/values/strings.xml, built
 * into ./strings.js): R.string.term_exit, stringResource(R.string.term_loading, name), and
 * stringParts() when an argument is a DOM node.
 *
 * ===== API for lazy modules (js/obby.js, js/meiorz-cli.js) =====
 *
 *   export async function start(term, args) { ... }
 *
 * `args` = the words after the command name (`obby a b` -> ['a', 'b']).
 * The shell does not wait for start() to settle before accepting the next
 * command. If start() throws or rejects (or a mode's onSubmit does), the
 * shell prints an .out--error line, pops every pushed mode (calling onExit)
 * and shows the prompt again.
 *
 * Stale launches: each launch gets its own `term`. If the visitor moves on
 * while a program loads (another command runs, a data-cmd button is clicked),
 * the launch goes stale: start() is skipped if the import was pending,
 * term.isStale() turns true and term.pushMode() refuses. Check isStale()
 * after your own awaits (e.g. a fetch), BEFORE printing a pane or hiding the
 * prompt; if true, just return.
 *
 * term (frozen object):
 *   el(tag, props = {}, ...children) -> HTMLElement
 *     props = { class, text, attrs: { name: value }, on: { event: fn } }.
 *     Children are Nodes or strings; strings always become text (never HTML).
 *     null/undefined/false children and attrs are skipped; arrays are flattened;
 *     attr value true = empty attribute. Never set a `style` attribute (the CSP
 *     blocks it): use the classes in /css/term.css.
 *   print(...nodesOrStrings) -> HTMLElement
 *     Appends ONE <div class="out"> to #log (one insertion = one screen reader
 *     announcement) and returns it: term.print('Saved.').classList.add('out--ok')
 *     #log is a live region (role="log", aria-live="polite"), and content you
 *     later update in place stays live. Anything that changes rapidly (HUD,
 *     timer, spinner) must be aria-hidden="true", or be written only when its
 *     text actually changes; announce discrete events through status().
 *   printPre(text, cls?) -> HTMLElement
 *     Appends <div class="out {cls}"><pre>text</pre></div>. A <pre> wider than
 *     the screen gets tabindex="0" so keyboard users can scroll it.
 *   echo(cmdline) -> HTMLElement
 *     Appends <div class="echo" aria-hidden="true"><span class="ps1">PS1</span> cmdline</div>
 *     with the current mode's ps1.
 *     (print/printPre/echo follow the newest output only if the reader is
 *     already at the bottom. After replacing or growing an element in place,
 *     e.g. spinner -> answer, call scrollToBottom() yourself.)
 *   status(text)          Sets #status (role="status"). Throttle it yourself.
 *   scrollToBottom()      Scrolls the newest output to just above the prompt
 *                         (re-measures the prompt first).
 *   focusInput(opts?)     Focuses #cmd without scrolling. With { ifFine: true }
 *                         it does nothing on touch-first devices (no surprise
 *                         on-screen keyboard after a tap).
 *   isCoarsePointer()     true on touch-first devices (last pointer touch/pen,
 *                         or none yet and the primary pointer is coarse).
 *   reducedMotion()       true if the OS asks for reduced motion OR the visitor
 *                         ran `motion off`. Check it before JS animations.
 *   run(cmdline) -> Promise
 *     Runs a SHELL command as if typed (echo with the shell PS1, shell
 *     history, output). It does not touch the mode stack: popMode(yourMode)
 *     first if you want to leave your mode. Safe to call from onSubmit.
 *   isStale() -> boolean  true once this launch has been superseded (above).
 *   pushMode(mode) -> boolean   Takes over the prompt until popped. mode = {
 *     name: string, ps1: string | Node,
 *     onSubmit(line) -> void | Promise   Enter pressed; lines typed while a
 *                                        returned promise is pending are queued.
 *     placeholder?: string, hint?: string | Node (replaces the hint under the
 *                        input; see setHint() for changing it later),
 *     promptClass?: string (extra class(es) on #prompt, e.g. 'cli-box'),
 *     echo?: boolean     default true: the shell echoes the line with your ps1
 *                        just before onSubmit; false = you render it.
 *     onKeyDown?(e) -> boolean   sees every keydown in #cmd first (IME
 *                        composition filtered out). Return true = handled and
 *                        the shell does nothing else (call e.preventDefault()).
 *     onExit?()          called exactly once when the mode is removed
 *                        (popMode, data-cmd click or crash). }
 *     Each mode has its own Up/Down history. If the launch is stale it
 *     returns false, pushes nothing and calls mode.onExit() so you can clean up.
 *   popMode(mode?) -> boolean   popMode(yourMode) removes it only if it is the
 *                         top mode (else no-op); popMode() removes the top
 *                         mode. Never the shell. Calls onExit(); true if a mode
 *                         was removed. Don't call it from inside onExit().
 *   setHint(nodeOrText | null)  Sets the hint line under the prompt for your
 *                         mode (shown while your mode is on top). null restores
 *                         the default. After changing the Node in place, pass
 *                         it again so the prompt height and scroll update.
 *                         Never write into #cmd-help directly.
 *   setPromptVisible(bool) Hides/shows #prompt, e.g. while a game pane has focus.
 *   clear()               Clears #log only, like `clear` or Ctrl+L.
 *   version               '1.2.0'
 *
 * Keys in #cmd: Enter submits; Up/Down = history of the current mode; Tab
 * completes (shell only, only with text and a match; a second Tab on the same
 * line moves focus, so it never traps); Ctrl+L clears the log; Ctrl+C with
 * nothing selected prints ^C and clears the line; Esc clears the line. The
 * mode's onKeyDown always gets the first chance.
 *
 * The header nav links are plain in-page links. Buttons with data-cmd="..."
 * ("run obby", help and ls entries) pop every mode (onExit),
 * show the prompt, then run the command through the same queue as typed
 * lines. So a module that hides the prompt should also pushMode() with an
 * onExit() that stops it; such a click then ends it cleanly.
 *
 * CSS hooks: .pane .pane__bar .pane__body .pane__footer .obby-* .c-* .cli-*
 * .out--* .link-btn (all in /css/term.css). CSP: no inline styles, never parse
 * user input as HTML (build DOM with el()/textContent), no string-to-code
 * evaluation, network only via same-origin fetch().
 */

import { R, stringParts, stringResource } from './strings.js';

const VERSION = '1.2.0';
const PS1 = R.string.term_ps1;
const HOME = '/home/meiorz';
const EMAIL = 'business@meiorz.tech';

const OPEN_TARGETS = {
  resume: '/resume.txt',
  github: 'https://github.com/meiorz',
  linkedin: 'https://www.linkedin.com/in/mei-o-525a0b227',
  archive: '/archive/',
  lull: 'https://github.com/meiorz/lull',
  hopout: 'https://github.com/meiorz/hopout',
};

const THEMES = ['auto', 'dark', 'light']; // the toggle cycles in this order

const root = document.documentElement;
const reduceMotionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
const darkQuery = window.matchMedia('(prefers-color-scheme: dark)');
const coarseQuery = window.matchMedia('(pointer: coarse)');

/** Own-property lookup: user input must never resolve to Object.prototype members. */
const has = (obj, key) => Object.prototype.hasOwnProperty.call(obj, key);
const get = (obj, key) => (has(obj, key) ? obj[key] : undefined);

/* DOM references, filled in by init(). */
let logEl;
let formEl;
let inputEl;
let statusEl;
let hintEl;
let ps1El;
let toggleEl;
let defaultHint = [];

// ---- Small helpers ----

/** Appends children (Nodes or strings, possibly nested arrays) to a parent. */
function appendKids(parent, kids) {
  for (const kid of kids.flat(Infinity)) {
    if (kid == null || kid === false) continue;
    parent.append(kid instanceof Node ? kid : String(kid));
  }
}

/** DOM helper; see the API notes at the top of this file. */
function el(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  const { class: cls, text, attrs, on } = props || {};
  if (cls) node.className = cls;
  if (text != null) node.textContent = String(text);
  if (attrs) {
    for (const [name, value] of Object.entries(attrs)) {
      if (value == null || value === false) continue;
      node.setAttribute(name, value === true ? '' : String(value));
    }
  }
  if (on) {
    for (const [type, fn] of Object.entries(on)) node.addEventListener(type, fn);
  }
  appendKids(node, children);
  return node;
}

/** A detached output block: <div class="out {cls}">children</div>. */
function out(cls, ...children) {
  return el('div', { class: cls ? `out ${cls}` : 'out' }, ...children);
}

/** A link. External links stay in the same tab, like the rest of the page. */
function link(href, text = href) {
  return el('a', { attrs: { href }, text });
}

/** A button that runs a shell command when clicked. */
function cmdBtn(cmd, label = cmd) {
  return el('button', { class: 'link-btn', text: label, attrs: { type: 'button', 'data-cmd': cmd } });
}

/** A button that types text into the prompt (for commands that need an argument). */
function fillBtn(text, label) {
  return el('button', { class: 'link-btn', text: label, attrs: { type: 'button', 'data-fill': text } });
}

function kbd(text) {
  return el('kbd', { text });
}

/** A <pre> for printed text. `label` names it if it becomes a scrollable region. */
function preEl(text, label) {
  const pre = el('pre', { text: String(text) });
  if (label) pre.dataset.label = label;
  return pre;
}

function errMsg(err) {
  const msg = err && err.message ? err.message : String(err);
  return msg.length > 160 ? `${msg.slice(0, 157)}...` : msg;
}

function store(key, value) {
  try {
    if (value == null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    /* storage blocked: the setting lasts for this page view only */
  }
}

function reducedMotion() {
  return reduceMotionQuery.matches || root.classList.contains('motion-off');
}

/** Levenshtein distance, for "did you mean" suggestions. */
function distance(a, b) {
  const row = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    let diag = row[0];
    row[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const up = row[j];
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, diag + (a[i - 1] === b[j - 1] ? 0 : 1));
      diag = up;
    }
  }
  return row[b.length];
}

function commonPrefix(list) {
  let prefix = list[0] || '';
  for (const item of list) {
    while (!item.startsWith(prefix)) prefix = prefix.slice(0, -1);
  }
  return prefix;
}

// ---- Output and scrolling ----

let quiet = 0; // > 0 while a shell command runs: it reveals its own output at the end
let pinPending = false;

function scrollNode(node, block) {
  try {
    node.scrollIntoView({ block, inline: 'nearest', behavior: 'instant' });
  } catch {
    node.scrollIntoView({ block, inline: 'nearest' }); // older engines without 'instant'
  }
}

/** True when the end of the log is on screen, just above the sticky prompt. */
function isFollowing() {
  const limit = formEl.hidden ? window.innerHeight : formEl.getBoundingClientRect().top;
  const end = logEl.getBoundingClientRect().bottom;
  return end <= limit + 8 && end > -8;
}

/** Keep the newest output visible (coalesced to one scroll per frame). */
function pin() {
  if (pinPending) return;
  pinPending = true;
  requestAnimationFrame(() => {
    pinPending = false;
    scrollToBottom();
  });
}

function scrollToBottom() {
  updatePromptHeight(); // a mode may have resized the prompt since it was last measured
  scrollNode(logEl.lastElementChild || logEl, 'end');
}

/**
 * After a command: show all of its output if it fits above the prompt,
 * otherwise put its echo line at the top so it can be read from the start.
 */
function reveal(startEl) {
  updatePromptHeight();
  const last = logEl.lastElementChild;
  if (!last || !startEl || !startEl.isConnected) {
    scrollNode(logEl, 'end');
    return;
  }
  const promptH = formEl.hidden ? 0 : formEl.getBoundingClientRect().height;
  const room = window.innerHeight - promptH - 32;
  const span = last.getBoundingClientRect().bottom - startEl.getBoundingClientRect().top;
  if (span > room) scrollNode(startEl, 'start');
  else scrollNode(last, 'end');
}

/** Gives wide <pre> blocks a tab stop and a name so keyboard users can scroll them. */
function markScrollable(scope) {
  requestAnimationFrame(() => {
    const pres = scope.matches && scope.matches('pre') ? [scope] : scope.querySelectorAll('pre');
    for (const pre of pres) {
      if (pre.closest('[aria-hidden="true"]')) continue;
      if (pre.tabIndex === 0 || pre.scrollWidth <= pre.clientWidth + 1) continue;
      pre.tabIndex = 0;
      pre.setAttribute('role', 'group');
      pre.setAttribute('aria-label', pre.dataset.label || R.string.term_scrollable_label);
    }
  });
}

/** The single place where anything is inserted into #log. */
function append(node) {
  const follow = quiet === 0 && (pinPending || isFollowing());
  logEl.append(node);
  if (node.querySelector && (node.matches('pre') || node.querySelector('pre'))) markScrollable(node);
  if (follow) pin();
  return node;
}

function print(...children) {
  return append(out('', ...children));
}

function printPre(text, cls) {
  return append(out(cls || '', preEl(text)));
}

function echoLine(text, ps1 = PS1) {
  const label = typeof ps1 === 'string' ? ps1 : ps1 instanceof Node ? ps1.cloneNode(true) : '';
  return append(el('div', { class: 'echo', attrs: { 'aria-hidden': 'true' } }, el('span', { class: 'ps1' }, label), ' ', String(text)));
}

function echo(cmdline) {
  return echoLine(cmdline, currentMode().ps1);
}

let statusTimer = 0;
function status(text) {
  if (!statusEl) return;
  // Clear first so the same message twice is still announced.
  statusEl.textContent = '';
  clearTimeout(statusTimer);
  statusTimer = setTimeout(() => {
    statusEl.textContent = String(text ?? '');
  }, 40);
}

/* How the visitor last pointed: 'mouse', 'touch', 'pen' or '' (not yet). */
let lastPointer = '';

function isCoarsePointer() {
  if (lastPointer === 'touch' || lastPointer === 'pen') return true;
  return lastPointer === 'mouse' ? false : coarseQuery.matches;
}

function focusInput(opts) {
  if (opts && opts.ifFine && isCoarsePointer()) return; // no surprise keyboard after a tap
  if (inputEl && !formEl.hidden) inputEl.focus({ preventScroll: true });
}

function clearLog() {
  logEl.replaceChildren();
  scrollNode(logEl, 'end');
  status(R.string.term_output_cleared);
}

let promptHeight = 0; // last measured height of the sticky prompt

function updatePromptHeight() {
  promptHeight = formEl.hidden ? 0 : formEl.getBoundingClientRect().height;
  const h = promptHeight ? Math.ceil(promptHeight) + 16 : 0;
  root.style.setProperty('--prompt-h', `${h}px`);
}

/* The prompt resized itself (e.g. a hint wrapped): if it grew while stuck to
   the bottom and now covers output that was visible, follow. */
function onPromptResize() {
  let follow = false;
  if (!formEl.hidden) {
    const r = formEl.getBoundingClientRect();
    const grew = r.height - promptHeight;
    const end = logEl.getBoundingClientRect().bottom;
    follow = grew > 1 && Math.abs(r.bottom - window.innerHeight) < 2 && end > r.top && end <= r.top + grew + 8;
  }
  updatePromptHeight();
  if (follow) pin();
}

function setPromptVisible(visible) {
  formEl.hidden = !visible;
  updatePromptHeight();
}

// ---- Modes and history ----

const shellMode = { name: 'shell', ps1: PS1 }; // lines go straight to runShell()
const modes = [shellMode];
const histories = new WeakMap();
let appliedPromptClass = [];
let exiting = false;

function currentMode() {
  return modes[modes.length - 1];
}

function historyOf(mode) {
  let h = histories.get(mode);
  if (!h) {
    h = { items: [], index: 0, draft: '' };
    histories.set(mode, h);
  }
  return h;
}

function remember(mode, line) {
  const h = historyOf(mode);
  if (line.trim() && h.items[h.items.length - 1] !== line) {
    h.items.push(line);
    if (h.items.length > 200) h.items.shift();
  }
  h.index = h.items.length;
  h.draft = '';
}

function setInput(value) {
  inputEl.value = value;
  const end = value.length;
  try {
    inputEl.setSelectionRange(end, end);
  } catch {
    /* some input types do not support selection; ours does */
  }
}

function historyStep(mode, dir) {
  const h = historyOf(mode);
  if (!h.items.length) return;
  if (h.index === h.items.length) h.draft = inputEl.value;
  h.index = Math.max(0, Math.min(h.items.length, h.index + dir));
  setInput(h.index === h.items.length ? h.draft : h.items[h.index]);
}

const hints = new WeakMap(); // mode -> hint set later with setHint()

/** Shows the top mode's hint, or the shell's default (marked .hint--default). */
function renderHint() {
  const mode = currentMode();
  const hint = hints.has(mode) ? hints.get(mode) : mode.hint;
  const custom = hint != null && hint !== '';
  if (custom) hintEl.replaceChildren(hint instanceof Node ? hint : String(hint));
  else hintEl.replaceChildren(...defaultHint.map((n) => n.cloneNode(true)));
  hintEl.classList.toggle('hint--default', !custom);
}

function applyMode() {
  const mode = currentMode();
  const ps1 = mode.ps1 == null ? '' : mode.ps1;
  ps1El.replaceChildren(ps1 instanceof Node ? ps1 : String(ps1));
  // Touch devices hide the key hint, so the shell's input says it instead.
  inputEl.placeholder = mode.placeholder || (mode === shellMode && isCoarsePointer() ? R.string.term_placeholder : '');
  formEl.classList.remove(...appliedPromptClass);
  appliedPromptClass = String(mode.promptClass || '').split(/\s+/).filter(Boolean);
  formEl.classList.add(...appliedPromptClass);
  renderHint();
  updatePromptHeight();
}

/** Sets the hint for `mode` (default: the top mode); null restores its default. */
function setHint(hint, mode = currentMode()) {
  if (!modes.includes(mode)) return;
  if (hint == null) hints.delete(mode);
  else hints.set(mode, hint);
  if (mode !== currentMode()) return;
  const follow = isFollowing(); // measured before the prompt changes size
  renderHint();
  updatePromptHeight();
  if (follow) pin();
}

function pushMode(mode) {
  if (!mode || typeof mode.onSubmit !== 'function') {
    throw new TypeError('term.pushMode: mode.onSubmit(line) is required');
  }
  if (modes.includes(mode)) return false;
  modes.push(mode);
  applyMode();
  return true;
}

function callExit(mode) {
  if (typeof mode.onExit !== 'function') return;
  exiting = true;
  try {
    mode.onExit();
  } catch (err) {
    console.error(err);
  } finally {
    exiting = false;
  }
}

/** Removes the top mode; with `target`, only if `target` is the top mode. */
function popMode(target) {
  if (modes.length <= 1 || exiting) return false;
  if (target && target !== currentMode()) return false;
  const mode = modes.pop();
  hints.delete(mode);
  applyMode();
  callExit(mode);
  return true;
}

/* Bumped whenever the visitor moves on; a launch from an older generation is stale. */
let launchGen = 0;

/** Leave every pushed mode and bring the shell prompt back. */
function exitModes() {
  launchGen++; // a program still loading must not take over afterwards
  while (modes.length > 1 && popMode()) {
    /* popMode() returns false if it could not pop (e.g. called during onExit) */
  }
  setPromptVisible(true);
}

function reportModuleError(name, err) {
  console.error(err);
  exitModes();
  append(out('out--error', stringResource(R.string.term_error_module, name, errMsg(err))));
  pin();
}

// ---- A tiny read-only filesystem rooted at ~ (/home/meiorz) ----

const dir = (entries, extra = {}) => ({ kind: 'dir', entries, ...extra });
const sec = (id) => ({ kind: 'section', id });
const proj = (slug) => ({ kind: 'project', slug });

// Listed in this order: ~ alphabetically, projects/ in page order.
const FS = dir({
  archive: dir({}, { href: '/archive/' }),
  // Hidden files (ls -a): a self-portrait and two Minecraft icons.
  '.portrait.png': { kind: 'image', src: '/img/portrait.png', size: 453, show: 240, alt: R.string.term_img_portrait_alt },
  '.pixel-pale.png': { kind: 'image', src: '/img/pixel-pale.png', size: 200, show: 128, pixel: true, alt: R.string.term_img_pixel_pale_alt },
  '.pixel-ender.png': { kind: 'image', src: '/img/pixel-ender.png', size: 200, show: 128, pixel: true, alt: R.string.term_img_pixel_ender_alt },
  'contact.txt': sec('contact'),
  'education.md': sec('education'),
  'experience.md': sec('experience'),
  games: dir({ obby: { kind: 'program', name: 'obby' }, 'meiorz-cli': { kind: 'program', name: 'meiorz-cli' } }, { section: 'play' }),
  obby: dir({ 'obbycourse.luau': { kind: 'fetch', url: '/obby/obbycourse.luau' } }),
  projects: dir(
    {
      'lull.md': proj('lull'),
      'hopout.md': proj('hopout'),
      'bert-sentiment.md': proj('bert-sentiment'),
    },
    { section: 'projects' },
  ),
  'resume.txt': { kind: 'fetch', url: '/resume.txt' },
  'skills.txt': sec('skills'),
});

/** Resolves a path relative to ~. Returns { node, path } or null. */
function resolve(input) {
  let p = String(input || '').trim();
  if (p === HOME || p.startsWith(`${HOME}/`)) p = p.slice(HOME.length);
  else if (p === '~' || p.startsWith('~/')) p = p.slice(1);
  else if (p.startsWith('/')) return null; // nothing outside home
  const parts = [];
  for (const seg of p.split('/')) {
    if (!seg || seg === '.') continue;
    if (seg === '..') parts.pop(); // ~ is as high as you can go
    else parts.push(seg);
  }
  let node = FS;
  for (const seg of parts) {
    if (node.kind !== 'dir') return null;
    const next = get(node.entries, seg);
    if (!next) return null;
    node = next;
  }
  return { node, path: parts.join('/') };
}

function entriesOf(node) {
  return Object.entries(node.entries);
}

/** Clickable ls output for a directory. Dotfiles are listed only with `all` (ls -a). */
function listing(node, prefix, all = false) {
  const ul = el('ul', { class: 'ls' });
  for (const [name, child] of entriesOf(node)) {
    if (name.startsWith('.') && !all) continue;
    const path = prefix + name;
    let item;
    if (child.kind === 'dir') item = cmdBtn(`ls ${path}/`, `${name}/`);
    else if (child.kind === 'program') item = cmdBtn(child.name, name);
    else item = cmdBtn(`cat ${path}`, name);
    item.classList.add(child.kind === 'dir' ? 'dir' : 'file');
    ul.append(el('li', {}, item));
  }
  return ul;
}

/** Path completion for the last word of the line. */
function completePath(word) {
  const tilde = word.startsWith('~/') ? '~/' : '';
  const rest = word.slice(tilde.length);
  const cut = rest.lastIndexOf('/') + 1;
  const dirPart = rest.slice(0, cut);
  const base = rest.slice(cut);
  const found = resolve(dirPart || '~');
  if (!found || found.node.kind !== 'dir') return [];
  return entriesOf(found.node)
    .filter(([name]) => name.startsWith(base) && (base.startsWith('.') || !name.startsWith('.')))
    .map(([name, child]) => tilde + dirPart + name + (child.kind === 'dir' ? '/' : ''));
}

// ---- Printing page content ----

/**
 * Copies a static section for the log: ids removed,
 * headings turned into <p class="h1|h2|h3"> so the outline stays unique,
 * and the outer <section>/<article> turned into a plain <div>.
 */
function cloneForLog(src) {
  const copy = src.cloneNode(true);
  for (const n of [copy, ...copy.querySelectorAll('[id]')]) n.removeAttribute('id');
  for (const n of [copy, ...copy.querySelectorAll('[aria-labelledby], [aria-describedby]')]) {
    n.removeAttribute('aria-labelledby');
    n.removeAttribute('aria-describedby');
  }
  for (const h of copy.querySelectorAll('h1, h2, h3, h4')) {
    const p = document.createElement('p');
    p.className = [h.className, h.tagName.toLowerCase()].filter(Boolean).join(' ');
    p.append(...h.childNodes);
    h.replaceWith(p);
  }
  const wrapper = el('div', { class: copy.classList.contains('project') ? 'clone project' : 'clone' });
  wrapper.append(...copy.childNodes);
  return wrapper;
}

function section(id) {
  const src = document.getElementById(id);
  return src ? out('', cloneForLog(src)) : out('out--error', stringResource(R.string.term_error_section, id));
}

function project(slug) {
  const src = document.getElementById(`proj-${slug}`);
  return src ? out('', cloneForLog(src)) : out('out--error', stringResource(R.string.term_cat_missing, `projects/${slug}.md`));
}

/** A picture file: the image itself, at a fixed display size (no layout shift). */
function image(node) {
  return out('', el('img', {
    class: node.pixel ? 'term-img pixel' : 'term-img',
    attrs: { src: node.src, alt: node.alt, width: node.show, height: node.show, decoding: 'async' },
  }));
}

async function fetchText(url) {
  const res = await fetch(url, { cache: 'no-cache', credentials: 'same-origin' });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.text();
}

async function fetchFile(url, label) {
  try {
    const text = await fetchText(url);
    return out('', preEl(text.replace(/\s+$/, ''), label), el('p', { class: 'hint' }, stringParts(R.string.term_plain_file, link(url))));
  } catch (err) {
    return out('out--error', stringParts(R.string.term_cat_load_failed, label, errMsg(err), link(url)));
  }
}

async function catNode(node, path) {
  switch (node.kind) {
    case 'dir':
      return out('out--error', stringResource(R.string.term_cat_is_dir, path));
    case 'section':
      return section(node.id);
    case 'project':
      return project(node.slug);
    case 'image':
      return image(node);
    case 'fetch':
      return fetchFile(node.url, path);
    case 'program':
      return out('', stringParts(R.string.term_cat_is_program, path, cmdBtn(node.name)));
    default:
      return out('out--error', stringResource(R.string.term_cat_unreadable, path));
  }
}

/** A directory that doubles as a page section (projects/, games/): list it, then print the section. */
function dirWithSection(node, prefix) {
  const box = section(node.section);
  box.prepend(listing(node, prefix));
  return box;
}

// ---- Lazy programs ----

const LOADERS = {
  obby: () => import('./obby.js'),
  'meiorz-cli': () => import('./meiorz-cli.js'),
};

/**
 * The term object one launch gets: the shared API plus isStale(), and a
 * pushMode()/setHint() that know which launch (and which mode) they belong to.
 */
function launchApi(gen) {
  const isStale = () => gen !== launchGen;
  let own = null; // the mode this launch pushed
  return Object.freeze({
    ...api,
    isStale,
    pushMode(mode) {
      if (isStale()) {
        // The visitor moved on while this program loaded: don't take over.
        if (mode && !modes.includes(mode)) callExit(mode);
        return false;
      }
      const pushed = pushMode(mode);
      if (pushed) own = mode;
      return pushed;
    },
    setHint(hint) {
      setHint(hint, own && modes.includes(own) ? own : currentMode());
    },
  });
}

async function launch(name, args) {
  const gen = ++launchGen;
  status(stringResource(R.string.term_loading, name));
  let mod;
  try {
    mod = await LOADERS[name]();
  } catch (err) {
    console.error(err);
    status('');
    return out('out--error', stringResource(R.string.term_error_load, name, errMsg(err)));
  }
  status('');
  if (gen !== launchGen) return null; // superseded while loading
  if (typeof mod.start !== 'function') {
    return out('out--error', stringResource(R.string.term_error_no_start, name));
  }
  try {
    const result = mod.start(launchApi(gen), args);
    if (result && typeof result.then === 'function') {
      result.catch((err) => reportModuleError(name, err));
    }
  } catch (err) {
    reportModuleError(name, err);
  }
  return null;
}

// ---- Theme and motion ----

function currentTheme() {
  const t = root.getAttribute('data-theme');
  return t === 'dark' || t === 'light' ? t : 'auto';
}

/* A plain button whose label states the current value (a 3-way cycle can't
   be a pressed/unpressed toggle); status() announces each change. */
function syncToggle() {
  if (toggleEl) toggleEl.textContent = stringResource(R.string.theme_toggle, currentTheme());
}

function setTheme(theme) {
  if (theme === 'auto') root.removeAttribute('data-theme');
  else root.setAttribute('data-theme', theme);
  store('theme', theme === 'auto' ? null : theme);
  syncToggle();
}

function setMotion(on) {
  root.classList.toggle('motion-off', !on);
  store('motion', on ? null : 'off');
}

// ---- Commands ----

const GROUPS = ['Sections', 'Files', 'Play', 'Shell'];
const GROUP_LABELS = {
  Sections: R.string.term_group_sections,
  Files: R.string.term_group_files,
  Play: R.string.term_group_play,
  Shell: R.string.term_group_shell,
};

/**
 * Tags each command with its help group; usage defaults to the bare name.
 * A command: { about, usage?, more?, needsArg?, run(args, rest) }. run returns
 * output (an .out element, an array of them, a Node, a string, or a Promise of
 * any of these) or null. needsArg: help shows a button that fills the prompt.
 */
function group(name, defs) {
  for (const [cmd, def] of Object.entries(defs)) Object.assign(def, { group: name, usage: def.usage || cmd });
  return defs;
}

const USAGE_THEME = R.string.term_theme_usage;

const COMMANDS = {
  ...group('Sections', {
    whoami: { about: R.string.term_cmd_whoami_about, run: () => section('intro') },
    projects: { about: R.string.term_cmd_projects_about, run: () => dirWithSection(FS.entries.projects, 'projects/') },
    skills: { about: R.string.term_cmd_skills_about, run: () => section('skills') },
    education: { about: R.string.term_cmd_education_about, run: () => section('education') },
    experience: { about: R.string.term_cmd_experience_about, run: () => section('experience') },
    asl: {
      about: R.string.term_cmd_asl_about,
      run: () => out('',
        el('p', {}, R.string.term_asl_body_1),
        el('p', {}, stringParts(R.string.term_asl_body_3, cmdBtn('skills')))),
    },
    contact: { about: R.string.term_cmd_contact_about, run: () => section('contact') },
    hire: {
      about: R.string.term_cmd_hire_about,
      run: () => out('',
        el('p', {}, R.string.intro_seeking),
        el('p', {}, stringParts(R.string.term_hire_links, link(`mailto:${EMAIL}?subject=${encodeURIComponent(R.string.term_hire_subject)}`, EMAIL), link('/resume.txt', R.string.footer_resume)))),
    },
  }),

  ...group('Files', {
    ls: {
      usage: 'ls [path]',
      about: R.string.term_cmd_ls_about,
      more: R.string.term_cmd_ls_more,
      run: (args) => {
        const target = args.find((a) => !a.startsWith('-')) || '~';
        const found = resolve(target);
        if (!found) return out('out--error', stringResource(R.string.term_ls_missing, target));
        const { node, path } = found;
        const prefix = path ? `${path}/` : '';
        if (node.kind !== 'dir') return out('', path);
        if (node.href) return out('', stringParts(R.string.term_ls_own_part, prefix, link(node.href)));
        const all = args.some((a) => /^-[a-z]*a/i.test(a));
        return node.section ? dirWithSection(node, prefix) : out('', listing(node, prefix, all));
      },
    },
    cat: {
      usage: 'cat <file>',
      about: R.string.term_cmd_cat_about,
      more: R.string.term_cmd_cat_more,
      needsArg: true,
      run: async (args) => {
        const targets = args.filter((a) => !a.startsWith('-')).slice(0, 4);
        if (!targets.length) return out('out--error', R.string.term_cat_no_operand);
        const results = [];
        for (const target of targets) {
          const found = resolve(target);
          results.push(found ? await catNode(found.node, target) : out('out--error', stringResource(R.string.term_cat_missing, target)));
        }
        return results;
      },
    },
    resume: {
      about: R.string.term_cmd_resume_about,
      more: R.string.term_cmd_resume_more,
      run: () => fetchFile('/resume.txt', 'resume.txt'),
    },
    open: {
      usage: 'open <target>',
      about: R.string.term_cmd_open_about,
      more: R.string.term_cmd_open_more,
      needsArg: true,
      run: (args) => {
        const raw = args[0] || '';
        const target = raw.toLowerCase().replace(/\.txt$/, '');
        const url = get(OPEN_TARGETS, target);
        if (!url) return out('out--error', stringResource(raw ? R.string.term_open_unknown : R.string.term_open_no_target, raw));
        try {
          window.open(url, '_blank', 'noopener');
        } catch {
          /* blocked: the printed link still works */
        }
        return out('', stringParts(R.string.term_open_opening, target, link(url)));
      },
    },
  }),

  ...group('Play', {
    games: { about: R.string.term_cmd_games_about, run: () => dirWithSection(FS.entries.games, 'games/') },
    obby: {
      about: R.string.term_cmd_obby_about,
      more: R.string.term_cmd_obby_more,
      run: (args) => launch('obby', args),
    },
    'meiorz-cli': {
      about: R.string.term_cmd_cli_about,
      more: R.string.term_cmd_cli_more,
      run: (args) => launch('meiorz-cli', args),
    },
  }),

  ...group('Shell', {
    help: {
      about: R.string.term_cmd_help_about,
      more: R.string.term_cmd_help_more,
      run: () => helpOutput(),
    },
    man: { usage: 'man <command>', about: R.string.term_cmd_man_about, needsArg: true, run: (args) => manOutput(args[0]) },
    history: {
      about: R.string.term_cmd_history_about,
      more: R.string.term_cmd_history_more,
      run: () => {
        const items = historyOf(shellMode).items;
        if (!items.length) return out('out--muted', R.string.term_history_empty);
        return out('', preEl(items.map((line, i) => `${String(i + 1).padStart(4)}  ${line}`).join('\n'), R.string.term_history_label));
      },
    },
    clear: {
      about: R.string.term_cmd_clear_about,
      more: R.string.term_cmd_clear_more,
      run: () => clearLog(),
    },
    theme: {
      usage: 'theme [light|dark|auto]',
      about: R.string.term_cmd_theme_about,
      more: R.string.term_cmd_theme_more,
      run: (args) => {
        const want = (args[0] || '').toLowerCase();
        if (!want) {
          const t = currentTheme();
          return out('', t === 'auto'
            ? stringResource(R.string.term_theme_current_auto, darkQuery.matches ? 'dark' : 'light', USAGE_THEME)
            : stringResource(R.string.term_theme_current, t, USAGE_THEME));
        }
        if (!THEMES.includes(want)) return out('out--error', stringResource(R.string.term_theme_unknown, args[0], USAGE_THEME));
        setTheme(want);
        return out('out--ok', stringResource(want === 'auto' ? R.string.term_theme_set_auto : R.string.term_theme_set, want));
      },
    },
    motion: {
      usage: 'motion [on|off]',
      about: R.string.term_cmd_motion_about,
      more: R.string.term_cmd_motion_more,
      run: (args) => {
        const want = (args[0] || '').toLowerCase();
        const osNote = reduceMotionQuery.matches ? ` ${R.string.term_motion_os_note}` : '';
        if (!want) return out('', stringResource(R.string.term_motion_current, reducedMotion() ? 'off' : 'on', osNote));
        if (want !== 'on' && want !== 'off') return out('out--error', stringResource(R.string.term_motion_unknown, args[0]));
        setMotion(want === 'on');
        return out('out--ok', want === 'off' ? R.string.term_motion_off : stringResource(R.string.term_motion_on, osNote));
      },
    },
    echo: { usage: 'echo <text>', about: R.string.term_cmd_echo_about, run: (args, rest) => out('', rest.replace(/\$(USER|HOME)\b/g, (_, v) => (v === 'USER' ? 'meiorz' : HOME))) },
    date: { about: R.string.term_cmd_date_about, run: () => out('', new Date().toString()) },
    pwd: { about: R.string.term_cmd_pwd_about, run: () => out('', HOME) },
    cd: { usage: 'cd [dir]', about: R.string.term_cmd_cd_about, run: () => out('', R.string.term_cd) },
    sudo: {
      usage: 'sudo <command>',
      about: R.string.term_cmd_sudo_about,
      run: () => out('', R.string.term_sudo),
    },
    exit: {
      about: R.string.term_cmd_exit_about,
      run: () => out('', R.string.term_exit),
    },
  }),
};

const ALIASES = { courses: 'education', academics: 'education', play: 'games' };
const COMMAND_NAMES = [...Object.keys(COMMANDS), ...Object.keys(ALIASES)].sort();

function canonical(name) {
  return get(ALIASES, name) || name;
}

function commandFor(name) {
  return get(COMMANDS, canonical(name));
}

function aliasesOf(name) {
  return Object.keys(ALIASES).filter((a) => ALIASES[a] === name);
}

function helpOutput() {
  const box = out('', el('p', {}, R.string.term_help_intro, ' ', el('span', { class: 'meta' }, R.string.term_help_man)));
  for (const group of GROUPS) {
    const dl = el('dl', { class: 'cmds' });
    for (const [name, c] of Object.entries(COMMANDS)) {
      if (c.group !== group) continue;
      const args = c.usage.slice(name.length);
      const button = c.needsArg ? fillBtn(`${name} `, name) : cmdBtn(name);
      const aliases = aliasesOf(name);
      dl.append(el('dt', {}, button, args), el('dd', {}, c.about, aliases.length ? ` ${stringResource(R.string.term_help_aliases, aliases.join(', '))}` : ''));
    }
    box.append(el('p', { class: 'group' }, GROUP_LABELS[group]), dl);
  }
  box.append(
    el('p', { class: 'hint' }, stringParts(R.string.term_help_keys, kbd('↑'), kbd('↓'), kbd('Tab'), kbd('Ctrl'), kbd('L'), kbd('Ctrl'), kbd('C'), kbd('Esc'))),
  );
  return box;
}

function manOutput(word) {
  const asked = (word || '').toLowerCase();
  if (!asked) return out('', stringParts(R.string.term_man_which, cmdBtn('man obby')));
  const name = canonical(asked);
  const c = commandFor(asked);
  if (!c) return out('out--error', stringResource(R.string.term_man_missing, word));
  const part = (title, ...lines) => [el('p', { class: 'group' }, title), ...lines.map((l) => el('p', { class: 'indent' }, l))];
  const aliases = aliasesOf(name);
  return out(
    'man',
    part('NAME', `${name} - ${c.about}`),
    part('SYNOPSIS', c.usage),
    part('DESCRIPTION', c.more || `${c.about[0].toUpperCase()}${c.about.slice(1)}.`),
    aliases.length ? part('ALIASES', aliases.join(', ')) : null,
  );
}

function suggest(word) {
  if (word.length < 2) return null;
  let best = null;
  let bestD = 3; // suggest only within distance 2
  for (const name of COMMAND_NAMES) {
    const d = distance(word, name);
    if (d < bestD && d < name.length) {
      best = name;
      bestD = d;
    }
  }
  return best;
}

function notFound(word) {
  const box = out('', el('span', { class: 'out--error' }, stringParts(R.string.term_not_found, word, cmdBtn('help'))));
  const found = resolve(word);
  let hint = null;
  if (found && found.path) hint = found.node.kind === 'dir' ? `ls ${found.path}/` : `cat ${word}`;
  else hint = suggest(word.toLowerCase());
  if (hint) box.append(el('br'), ...stringParts(R.string.term_did_you_mean, cmdBtn(hint)));
  return box;
}

/** Normalizes a command's return value into zero or more .out elements. */
function emitResult(result) {
  if (result == null) return;
  const list = Array.isArray(result) ? result : [result];
  for (const item of list) {
    if (item == null) continue;
    if (item instanceof HTMLElement && item.classList.contains('out')) append(item);
    else append(out('', item));
  }
}

/** Runs one shell line: echo, execute, print, then scroll the output into view. */
async function runShell(line) {
  const text = String(line ?? '');
  const trimmed = text.trim();
  const word = trimmed.split(/\s+/, 1)[0];
  const rest = trimmed.slice(word.length).trim();
  quiet++;
  const echoEl = echoLine(text, PS1);
  remember(shellMode, text);
  try {
    if (!word) return;
    launchGen++; // the visitor moved on: a program still loading must not take over
    const command = commandFor(word.toLowerCase());
    emitResult(command ? await command.run(rest ? rest.split(/\s+/) : [], rest) : notFound(word));
  } catch (err) {
    console.error(err);
    append(out('out--error', `${word}: ${errMsg(err)}`));
  } finally {
    quiet--;
    reveal(echoEl);
  }
}

// ---- Tab completion ----

let lastTabLine = null;

function candidatesFor(value) {
  const start = value.search(/\S*$/); // where the last word starts
  const head = value.slice(0, start);
  const word = value.slice(start);
  if (!head.trim()) {
    return { head, word, list: COMMAND_NAMES.filter((n) => n.startsWith(word.toLowerCase())) };
  }
  const cmd = canonical(head.trim().split(/\s+/)[0].toLowerCase());
  const pick = (options) => options.filter((o) => o.startsWith(word.toLowerCase()));
  let list = [];
  if (cmd === 'ls' || cmd === 'cat') list = completePath(word);
  else if (cmd === 'open') list = pick(Object.keys(OPEN_TARGETS));
  else if (cmd === 'theme') list = pick(THEMES);
  else if (cmd === 'motion') list = pick(['on', 'off']);
  else if (cmd === 'man') list = pick(COMMAND_NAMES);
  return { head, word, list };
}

/** Returns true if Tab was used (so the caller prevents focus from moving). */
function tabComplete() {
  const value = inputEl.value;
  if (!value.trim() || inputEl.selectionStart !== value.length || inputEl.selectionEnd !== value.length) return false;
  const { head, word, list } = candidatesFor(value);
  if (!list.length) return false;
  if (list.length === 1) {
    const only = list[0];
    const next = head + (only.endsWith('/') ? only : `${only} `);
    if (next === value) return false;
    setInput(next);
    lastTabLine = null;
    return true;
  }
  const common = commonPrefix(list);
  if (common.length > word.length) {
    setInput(head + common);
    lastTabLine = null;
    return true;
  }
  if (lastTabLine === value) return false; // already listed: let Tab move focus
  lastTabLine = value;
  const names = list.map((c) => {
    const trimmed = c.endsWith('/') ? c.slice(0, -1) : c;
    return trimmed.slice(trimmed.lastIndexOf('/') + 1) + (c.endsWith('/') ? '/' : '');
  });
  // Visible in the log, announced once through the status region.
  const line = out('out--muted', names.join('  '));
  line.setAttribute('aria-hidden', 'true');
  append(line);
  pin();
  status(stringResource(R.string.term_completions, names.length, names.join(', ')));
  return true;
}

// ---- Input handling ----

let queue = Promise.resolve();
function enqueue(task) {
  queue = queue.then(task).catch((err) => console.error(err));
  return queue;
}

function nothingSelected() {
  if (inputEl.selectionStart !== inputEl.selectionEnd) return false;
  const sel = window.getSelection();
  return !sel || sel.isCollapsed || !String(sel);
}

function onKeyDown(e) {
  if (e.isComposing || e.keyCode === 229) return; // IME (e.g. Japanese) composition
  const mode = currentMode();
  if (typeof mode.onKeyDown === 'function') {
    let handled = false;
    try {
      handled = mode.onKeyDown(e) === true;
    } catch (err) {
      reportModuleError(mode.name, err);
      return;
    }
    if (handled) return;
  }
  const key = e.key;
  const plain = !e.ctrlKey && !e.altKey && !e.metaKey;
  const ctrlOnly = e.ctrlKey && !e.altKey && !e.metaKey;
  if (key !== 'Tab') lastTabLine = null;

  if (plain && !e.shiftKey && (key === 'ArrowUp' || key === 'ArrowDown')) {
    e.preventDefault();
    historyStep(mode, key === 'ArrowUp' ? -1 : 1);
  } else if (key === 'Tab' && plain && !e.shiftKey) {
    if (mode === shellMode && tabComplete()) e.preventDefault();
  } else if (ctrlOnly && key.toLowerCase() === 'l') {
    e.preventDefault();
    clearLog();
  } else if (ctrlOnly && key.toLowerCase() === 'c' && nothingSelected()) {
    e.preventDefault();
    echoLine(`${inputEl.value}^C`, mode.ps1);
    pin();
    setInput('');
    historyOf(mode).index = historyOf(mode).items.length;
  } else if (key === 'Escape' && inputEl.value) {
    e.preventDefault();
    setInput('');
  }
}

function onSubmit(e) {
  e.preventDefault();
  const line = inputEl.value;
  setInput('');
  lastTabLine = null;
  const mode = currentMode();
  if (mode === shellMode) {
    enqueue(() => runShell(line));
    return;
  }
  remember(mode, line);
  enqueue(async () => {
    if (!modes.includes(mode)) return; // the mode ended while this line waited
    if (mode.echo !== false) echoLine(line, mode.ps1);
    pin();
    try {
      await mode.onSubmit(line);
    } catch (err) {
      reportModuleError(mode.name, err);
    }
  });
}

const INTERACTIVE = 'a, button, input, textarea, select, summary, label, [tabindex], [contenteditable], [role="button"], [role="option"], [role="listbox"]';

/**
 * Header nav links are plain in-page links: the browser scrolls; we also move
 * focus to the section's heading so keyboard and screen reader users land there.
 */
function onChipClick(chip) {
  let id = '';
  try {
    id = decodeURIComponent(chip.hash.slice(1));
  } catch {
    return;
  }
  const heading = id && document.getElementById(id)?.querySelector('h1, h2');
  if (heading) requestAnimationFrame(() => heading.focus({ preventScroll: true }));
}

/** [data-cmd] buttons (run obby, help and ls entries) run commands; [data-fill] types into the prompt. */
function onDocumentClick(e) {
  if (!root.classList.contains('term-ready') || e.defaultPrevented || e.button !== 0) return;
  if (!(e.target instanceof Element)) return;
  const modified = e.metaKey || e.ctrlKey || e.shiftKey || e.altKey;
  const chip = e.target.closest('.site-nav a[href^="#"]');
  if (chip) {
    if (!modified) onChipClick(chip);
    return; // native navigation, no command
  }
  const target = e.target.closest('[data-cmd], [data-fill]');
  if (!target) return;
  if (target.tagName === 'A' && modified) return; // new tab etc.
  e.preventDefault();
  const how = e.detail === 0 ? 'keyboard' : e.pointerType || lastPointer || 'mouse';
  if (target.hasAttribute('data-fill')) {
    exitModes();
    setInput(target.getAttribute('data-fill'));
    inputEl.focus({ preventScroll: true });
    return;
  }
  const cmd = target.getAttribute('data-cmd');
  exitModes(); // settles a pending mode submit so the queue drains
  enqueue(() => {
    exitModes(); // a program may have started while this click waited
    return runShell(cmd);
  }).then(() => {
    // Keep focus a program took (obby's pane, a menu). Mouse users keep
    // typing; touch users get no surprise keyboard; keyboard users go to the
    // prompt (on screen; Shift+Tab walks back into the output) unless the
    // button is in the log already.
    const active = document.activeElement;
    if (active && active !== document.body && active !== target) return;
    if (how === 'mouse' || (how === 'keyboard' && !logEl.contains(target))) focusInput();
  });
}

/** Clicking the terminal (log, prompt, empty space) focuses the input. */
function onScreenClick(e) {
  if (formEl.hidden || lastPointer === 'touch' || lastPointer === 'pen') return;
  if (!(e.target instanceof Element) || e.target.closest(INTERACTIVE)) return;
  const sel = window.getSelection();
  if (sel && String(sel)) return;
  focusInput();
}

/**
 * The back-to-top button: shown once the intro has scrolled out of view, and
 * marked .near-terminal while the terminal is on screen (CSS hides it there on
 * small screens). Observers, not a scroll handler.
 */
function initToTop() {
  const button = document.getElementById('to-top');
  const intro = document.getElementById('intro');
  if (!button || !intro || !('IntersectionObserver' in window)) return;
  new IntersectionObserver(([entry]) => button.classList.toggle('is-visible', !entry.isIntersecting)).observe(intro);
  const terminal = document.getElementById('terminal');
  if (terminal) new IntersectionObserver(([entry]) => button.classList.toggle('near-terminal', entry.isIntersecting)).observe(terminal);
  button.addEventListener('click', (e) => {
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    e.preventDefault();
    window.scrollTo({ top: 0, behavior: reducedMotion() ? 'instant' : 'smooth' });
    document.getElementById('h-intro')?.focus({ preventScroll: true });
  });
}

// ---- The public API object and init ----

function run(cmdline) {
  return runShell(cmdline);
}

const api = Object.freeze({
  el,
  print,
  printPre,
  echo,
  status,
  scrollToBottom,
  focusInput,
  isCoarsePointer,
  reducedMotion,
  run,
  isStale: () => false,
  pushMode,
  popMode,
  setHint: (hint) => setHint(hint),
  setPromptVisible,
  clear: clearLog,
  version: VERSION,
});

function init() {
  logEl = document.getElementById('log');
  formEl = document.getElementById('prompt');
  inputEl = document.getElementById('cmd');
  statusEl = document.getElementById('status');
  hintEl = document.getElementById('cmd-help');
  toggleEl = document.getElementById('theme-toggle');
  const screenEl = document.getElementById('terminal');
  ps1El = formEl ? formEl.querySelector('.ps1') : null;
  if (!logEl || !formEl || !inputEl || !hintEl || !ps1El || !screenEl) return; // not the home page

  defaultHint = [...hintEl.childNodes].map((n) => n.cloneNode(true));

  inputEl.addEventListener('keydown', onKeyDown);
  formEl.addEventListener('submit', onSubmit);
  document.addEventListener('click', onDocumentClick);
  screenEl.addEventListener('click', onScreenClick);
  document.addEventListener(
    'pointerdown',
    (e) => {
      lastPointer = e.pointerType || 'mouse';
    },
    { capture: true, passive: true },
  );

  if (toggleEl) {
    syncToggle();
    toggleEl.addEventListener('click', () => {
      const next = THEMES[(THEMES.indexOf(currentTheme()) + 1) % THEMES.length];
      setTheme(next);
      status(stringResource(next === 'auto' ? R.string.term_theme_status_auto : R.string.term_theme_status, next));
    });
  }

  // Keep scroll padding equal to the sticky prompt's real height.
  if ('ResizeObserver' in window) new ResizeObserver(onPromptResize).observe(formEl);
  let resizeTimer = 0;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => markScrollable(logEl), 200);
  });

  // Ready: reveal JS-only controls and the prompt, then say hello.
  // (Appended directly so it never scrolls the page on load.)
  root.classList.add('term-ready');
  initToTop();
  formEl.hidden = false;
  applyMode(); // shell prompt: default hint, touch placeholder, prompt height
  logEl.append(out('out--muted', stringParts(R.string.term_welcome, cmdBtn('help'))));
}

try {
  init();
} catch (err) {
  // Leave the static page exactly as it was.
  console.error(err);
  root.classList.remove('term-ready');
  if (formEl) formEl.hidden = true;
}
