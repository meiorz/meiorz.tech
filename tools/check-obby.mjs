#!/usr/bin/env node
/**
 * check-obby.mjs: lints the obby course file and proves the course can be finished
 * (zero dependencies).
 *
 * It reads site/obby/obbycourse.luau with the site's own reader (site/js/luau-table.js)
 * and plays it with the game's own simulation (createWorld / initialState / step from
 * site/js/obby.js), so the proof covers exactly what visitors play. Checks:
 *
 *   1. physics   the documented rules hold on tiny built-in courses (jump apex 3,
 *                pad apex 10, conveyor pushes 1 cell every 2 ticks, kill, checkpoints)
 *   2. lint      a structural Luau lint of the WHOLE file (the site's reader only looks
 *                at the `course` table): line 1 is `--!strict`; every token is valid
 *                Luau and one this data module is allowed to use; brackets balance;
 *                the file is `[export] type` declarations, then one typed
 *                `local course: T = <literal table>`, then `return course` and nothing
 *                else; every type name is declared; and the table's shape matches its
 *                declared types (required/unknown fields, string/number/boolean,
 *                string-singleton unions such as TileKind, optional `?`, `{ T }` lists).
 *                It also checks that the lint and the site's reader read the same data,
 *                and that the lint rejects a set of built-in broken fixtures.
 *                LIMITS: this is a lint for the small subset of Luau this file uses,
 *                not a Luau compiler or type checker (no generics, functions,
 *                intersections or inference). For a full check, run the official
 *                `luau-analyze` on the file; this zero-dependency tool does not download it.
 *   3. finish    a breadth-first search over every reachable state
 *                (x, y, vy, conveyor phase, stage) with all 6 inputs per tick
 *                (left / none / right, with or without jump) reaches the finish
 *   4. replay    the shortest input script found by the search, replayed through
 *                step() from a fresh start, really wins, in the same number of ticks
 *   5. respawn   from every checkpoint, at every conveyor phase, the finish is reachable
 *   6. order     no checkpoint can be skipped: with checkpoint k made unreachable,
 *                the finish is unreachable too
 *   7. softlock  from every reachable state the finish is still reachable (dying and
 *                respawning allowed), so nobody ever has to press R to get unstuck
 *
 * Usage: node tools/check-obby.mjs [--show] [--course <file.luau>]
 *   --show    also print the shortest route on the grid and its input script
 *   --course  check another course file (default: site/obby/obbycourse.luau); the
 *             broken-fixture self-test always uses the default file
 *
 * Exit codes: 0 all checks passed, 1 a check failed (including any lint problem),
 * 2 the checker could not run (missing file, parse error, invalid course).
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const ROOT = new URL('..', import.meta.url);
const args = process.argv.slice(2);
const SHOW = args.includes('--show');
const courseArg = args.indexOf('--course');
const DEFAULT_COURSE = fileURLToPath(new URL('site/obby/obbycourse.luau', ROOT));
const COURSE = courseArg >= 0 && args[courseArg + 1] ? args[courseArg + 1] : DEFAULT_COURSE;

function readCourse(file) {
  try {
    return readFileSync(file, 'utf8');
  } catch (err) {
    console.error(`check-obby: cannot read ${file}: ${err.message}`);
    process.exit(2);
  }
  return '';
}

let sim;
let parseLuauCourse;
try {
  sim = await import(new URL('site/js/obby.js', ROOT));
  ({ parseLuauCourse } = await import(new URL('site/js/luau-table.js', ROOT)));
} catch (err) {
  console.error(`check-obby: could not load the game modules: ${err.message}`);
  process.exit(2);
}
const { createWorld, initialState, step, conveyorPeriod, padLaunch, isGrounded, TICK_HZ, IDLE } = sim;

let failures = 0;
const ok = (msg) => console.log(`  ok    ${msg}`);
const bad = (msg) => {
  failures++;
  console.log(`  FAIL  ${msg}`);
};
const expect = (cond, msg, detail = '') => (cond ? ok(msg) : bad(detail ? `${msg} (${detail})` : msg));
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

/** The 6 inputs a player can give in one tick. */
const INPUTS = [];
for (const dx of [0, 1, -1]) for (const jump of [false, true]) INPUTS.push(Object.freeze({ dx, jump, reset: false }));
const inputName = (i) => `${i.dx > 0 ? 'R' : i.dx < 0 ? 'L' : '.'}${i.jump ? 'J' : ''}`;

// ---------------------------------------------------------------------------
// 1. Physics rules on tiny courses
// ---------------------------------------------------------------------------

const LEGEND = [
  { char: '#', kind: 'solid' },
  { char: '^', kind: 'kill' },
  { char: '<', kind: 'conveyor', speed: -15 },
  { char: '>', kind: 'conveyor', speed: 15 },
  { char: 'J', kind: 'jumppad', speed: 100 },
  { char: '1', kind: 'checkpoint', stage: 1 },
  { char: '2', kind: 'checkpoint', stage: 2 },
  { char: 'F', kind: 'finish', stage: 3 },
];

function mini(rows) {
  return createWorld({
    name: 'test',
    cellStuds: 2.5,
    tiles: LEGEND,
    stages: [{ id: 1, name: 'a' }, { id: 2, name: 'b' }],
    rows,
  });
}

/** Runs `inputs` (one per tick) and returns every state along the way. */
function run(world, inputs, from = initialState(world)) {
  const states = [from];
  for (const input of inputs) states.push(step(world, states[states.length - 1], input));
  return states;
}

const JUMP = Object.freeze({ dx: 0, jump: true, reset: false });

function physics() {
  console.log('1. physics');
  const blank = '..............';
  const floor = [blank, blank, blank, blank, blank, blank, blank, blank, blank, blank, blank, blank, '1............2', '##############'];
  // Flat checkpoint 2 far away and a finish nowhere: add F off to the side.
  floor[0] = '.............F';
  const flat = mini(floor);
  const heights = run(flat, [JUMP, IDLE, IDLE, IDLE, IDLE, IDLE]).slice(1).map((s) => flat.spawn.y - s.y);
  expect(heights.join(',') === '2,3,3,2,0,0', 'a jump rises 2, 3, 3, 2, 0 cells: apex 3, lands after 5 ticks', `got ${heights.join(',')}`);

  const held = run(flat, [JUMP, JUMP, JUMP, JUMP, JUMP, JUMP]).slice(1).map((s) => flat.spawn.y - s.y);
  expect(held.join(',') === '2,3,3,2,0,2', 'holding jump only jumps again after landing', `got ${held.join(',')}`);

  expect(padLaunch(100, 2.5) === 4 && conveyorPeriod(15, 2.5) === 2 && conveyorPeriod(-15, 2.5) === 2,
    'course units convert: pad 100 studs/s -> launch 4, conveyor 15 studs/s -> every 2 ticks');

  const padRows = [...floor];
  padRows[13] = '#J############';
  const pad = mini(padRows);
  const walkOn = run(pad, [{ dx: 1, jump: false }, ...Array(12).fill(IDLE)]);
  const apex = Math.max(...walkOn.map((s) => pad.spawn.y - s.y));
  expect(apex === 10, 'a jump pad launches the player 10 cells up', `apex ${apex}`);

  const beltRows = [...floor];
  beltRows[13] = '######<<<<<<##';
  beltRows[12] = '1.........2...';
  const belt = mini(beltRows);
  const onBelt = { ...initialState(belt), x: 9 };
  const ride = run(belt, Array(4).fill(IDLE), onBelt).map((s) => s.x);
  expect(ride.join(',') === '9,9,8,8,7', 'a "<" conveyor pushes 1 cell left every 2 ticks', `x: ${ride.join(',')}`);
  const against = run(belt, Array(4).fill({ dx: 1, jump: false }), onBelt).map((s) => s.x);
  expect(against.join(',') === '9,10,10,11,11', 'walking against a belt still makes progress (1 cell per 2 ticks)', `x: ${against.join(',')}`);

  const killRows = [...floor];
  killRows[12] = '1.^..........2';
  const kill = mini(killRows);
  const hit = run(kill, [{ dx: 1, jump: false }, { dx: 1, jump: false }]);
  const last = hit[hit.length - 1];
  expect(last.events.includes('death') && last.deaths === 1 && last.x === kill.spawn.x && last.y === kill.spawn.y,
    'a kill tile respawns the player at the checkpoint and counts a death');

  const back = run(flat, Array(13).fill({ dx: 1, jump: false }));
  const atTwo = back[back.length - 1];
  const returned = run(flat, Array(13).fill({ dx: -1, jump: false }), atTwo);
  const end = returned[returned.length - 1];
  expect(atTwo.stage === 2 && end.x === flat.spawn.x && end.stage === 2, 'checkpoints only move forward');

  const pure = initialState(flat);
  const snapshot = JSON.stringify(pure);
  step(flat, pure, JUMP);
  expect(JSON.stringify(pure) === snapshot && Object.isFrozen(pure), 'step() is pure: the old state is unchanged');
}

// ---------------------------------------------------------------------------
// 2. Luau lint: the whole file, token by token. A lint for the subset of Luau
//    this data module uses, NOT a Luau compiler or type checker.
// ---------------------------------------------------------------------------

const LUAU_KEYWORDS = new Set(['and', 'break', 'do', 'else', 'elseif', 'end', 'false', 'for', 'function', 'if',
  'in', 'local', 'nil', 'not', 'or', 'repeat', 'return', 'then', 'true', 'until', 'while']);
/** Every Luau operator and punctuation token, longest first ("..." never lexes as "." "." "."). */
const LUAU_OPS = ['...', '..=', '//=', '..', '==', '~=', '<=', '>=', '::', '->', '+=', '-=', '*=', '/=', '%=', '^=', '//',
  '+', '-', '*', '/', '%', '^', '#', '&', '~', '<', '>', '=', '(', ')', '{', '}', '[', ']', ';', ':', ',', '.', '|', '?'];
/** The tokens this data module may use: type declarations, one typed local table, return. */
const DATA_OPS = new Set(['{', '}', '[', ']', '(', ')', '=', ',', ';', ':', '|', '?', '-']);
const DATA_KEYWORDS = new Set(['local', 'return', 'true', 'false', 'nil']);
const BUILTIN_TYPES = new Set(['string', 'number', 'boolean', 'any', 'unknown']);
const LUAU_NUMBER = /0[xX][0-9A-Fa-f_]+|0[bB][01_]+|(?:[0-9][0-9_]*(?:\.[0-9_]*)?|\.[0-9][0-9_]*)(?:[eE][+-]?[0-9_]+)?/y;
const LUAU_NAME = /[A-Za-z_][A-Za-z0-9_]*/y;
const STRING_ESCAPES = { a: '\x07', b: '\b', f: '\f', n: '\n', r: '\r', t: '\t', v: '\v', '\\': '\\', '"': '"', "'": "'", '\n': '\n' };

class LintProblem extends Error {}

/** Reads a quoted string starting at `start`; Luau's escapes are accepted. */
function lexString(text, start, fail) {
  const quote = text[start];
  let value = '';
  let i = start + 1;
  for (;;) {
    const c = text[i];
    if (c === undefined || c === '\n') fail('unfinished string', start);
    if (c === quote) return { value, end: i + 1 };
    if (c !== '\\') {
      value += c;
      i++;
      continue;
    }
    const e = text[i + 1];
    let m;
    if (e !== undefined && Object.hasOwn(STRING_ESCAPES, e)) {
      value += STRING_ESCAPES[e];
      i += 2;
    } else if (e === 'z') {
      i += 2;
      while (/\s/.test(text[i] || '')) i++;
    } else if ((m = /^x([0-9A-Fa-f]{2})/.exec(text.slice(i + 1, i + 4)))) {
      value += String.fromCharCode(parseInt(m[1], 16));
      i += 4;
    } else if ((m = /^[0-9]{1,3}/.exec(text.slice(i + 1, i + 4)))) {
      if (Number(m[0]) > 255) fail(`escape "\\${m[0]}" is above 255`, i);
      value += String.fromCharCode(Number(m[0]));
      i += 1 + m[0].length;
    } else if ((m = /^u\{([0-9A-Fa-f]{1,8})\}/.exec(text.slice(i + 1, i + 13))) && parseInt(m[1], 16) <= 0x10ffff) {
      value += String.fromCodePoint(parseInt(m[1], 16));
      i += 1 + m[0].length;
    } else {
      fail(`invalid escape "\\${e ?? ''}" in a string`, i);
    }
  }
}

/** Splits the source into Luau tokens (comments and whitespace dropped). */
function lexLuau(text, fail) {
  const toks = [];
  const longLevel = (at) => {
    if (text[at] !== '[') return -1;
    let j = at + 1;
    while (text[j] === '=') j++;
    return text[j] === '[' ? j - at - 1 : -1;
  };
  const longEnd = (at, what) => {
    const level = longLevel(at);
    const close = `]${'='.repeat(level)}]`;
    const end = text.indexOf(close, at + level + 2);
    if (end < 0) fail(`unfinished long ${what} (no closing ${close})`, at);
    return { body: text.slice(at + level + 2, end).replace(/^\n/, ''), end: end + close.length };
  };
  let i = 0;
  while (i < text.length) {
    const c = text[i];
    const at = i;
    if (' \t\n\r\f\v'.includes(c)) {
      i++;
    } else if (text.startsWith('--', i)) {
      if (longLevel(i + 2) >= 0) i = longEnd(i + 2, 'comment').end;
      else i = text.includes('\n', i) ? text.indexOf('\n', i) : text.length;
    } else if (c === '"' || c === "'") {
      const s = lexString(text, i, fail);
      toks.push({ t: 'string', v: s.value, at });
      i = s.end;
    } else if (longLevel(i) >= 0) {
      const s = longEnd(i, 'string');
      toks.push({ t: 'string', v: s.body, at });
      i = s.end;
    } else if (/[0-9]/.test(c) || (c === '.' && /[0-9]/.test(text[i + 1] || ''))) {
      LUAU_NUMBER.lastIndex = i;
      const m = LUAU_NUMBER.exec(text);
      const v = Number(m[0].replace(/_/g, ''));
      i = LUAU_NUMBER.lastIndex;
      if (/[A-Za-z0-9_.]/.test(text[i] || '') || !Number.isFinite(v)) fail(`malformed number "${text.slice(at, i + 1)}"`, at);
      toks.push({ t: 'number', v, at });
    } else {
      LUAU_NAME.lastIndex = i;
      const w = LUAU_NAME.exec(text);
      if (w) {
        toks.push({ t: LUAU_KEYWORDS.has(w[0]) ? 'kw' : 'name', v: w[0], at });
        i = LUAU_NAME.lastIndex;
        continue;
      }
      const op = LUAU_OPS.find((o) => text.startsWith(o, i));
      if (!op) fail(`unexpected character "${c}" (not a Luau token)`, at);
      toks.push({ t: 'op', v: op, at });
      i += op.length;
    }
  }
  toks.push({ t: 'eof', v: '', at: text.length });
  return toks;
}

function checkBrackets(toks, fail, where) {
  const closer = new Map([['(', ')'], ['[', ']'], ['{', '}']]);
  const stack = [];
  for (const tk of toks) {
    if (tk.t !== 'op') continue;
    if (closer.has(tk.v)) {
      stack.push(tk);
    } else if (tk.v === ')' || tk.v === ']' || tk.v === '}') {
      const open = stack.pop();
      if (!open) fail(`"${tk.v}" has no opening bracket`, tk.at);
      if (closer.get(open.v) !== tk.v) fail(`"${tk.v}" does not match the "${open.v}" at line ${where(open.at)}`, tk.at);
    }
  }
  if (stack.length) fail(`"${stack[stack.length - 1].v}" is never closed`, stack[stack.length - 1].at);
}

/**
 * Recursive descent over the tokens, for exactly this shape:
 *   module := { ["export"] "type" Name "=" Type [";"] }
 *             "local" Name ":" Type "=" Table [";"] "return" Name [";"] EOF
 *   Type   := Simple ["?"] { "|" Simple ["?"] }
 *   Simple := Name | "string literal" | true | false | nil | "(" Type ")"
 *           | "{" Type "}" | "{" [ Name ":" Type { ("," | ";") Name ":" Type } [","|";"] ] "}"
 *   Value  := Table | string | ["-"] number | true | false | nil
 *   Table  := "{" [ Field { ("," | ";") Field } [","|";"] ] "}"
 *   Field  := "[" (string | number) "]" "=" Value | Name "=" Value | Value
 */
class LintParser {
  constructor(toks, fail) {
    this.toks = toks;
    this.k = 0;
    this.fail = fail;
  }

  get tok() {
    return this.toks[this.k];
  }

  peek() {
    return this.toks[Math.min(this.k + 1, this.toks.length - 1)];
  }

  isOp(v, tk = this.tok) {
    return tk.t === 'op' && tk.v === v;
  }

  isName(v) {
    return this.tok.t === 'name' && (v === undefined || this.tok.v === v);
  }

  accept(v) {
    if (!this.isOp(v)) return false;
    this.k++;
    return true;
  }

  error(msg) {
    const tk = this.tok;
    const found = tk.t === 'eof' ? 'the end of the file' : tk.t === 'string' ? 'a string' : `"${tk.v}"`;
    this.fail(`${msg}, found ${found}`, tk.at);
  }

  expect(v, context = '') {
    if (!this.accept(v)) this.error(`expected "${v}"${context}`);
  }

  name(what) {
    if (!this.isName()) this.error(`expected ${what}`);
    return this.toks[this.k++];
  }

  module() {
    const types = new Map();
    while (this.isName('export') || (this.isName('type') && this.peek().t === 'name')) {
      if (this.isName('export')) {
        this.k++;
        if (!this.isName('type')) this.error('expected "type" after "export"');
      }
      this.k++; // "type"
      const id = this.name('a type name');
      if (types.has(id.v) || BUILTIN_TYPES.has(id.v)) this.fail(`type "${id.v}" is declared twice or shadows a built-in type`, id.at);
      this.expect('=', ` after "type ${id.v}"`);
      types.set(id.v, { type: this.type(), at: id.at });
      this.accept(';');
    }
    if (!(this.tok.t === 'kw' && this.tok.v === 'local')) this.error('expected "export type ..." or "local <name>: <Type> = { ... }"');
    this.k++;
    const local = this.name('a name after "local"');
    if (!this.accept(':')) this.error(`expected a type annotation ("local ${local.v}: T = ...")`);
    const annotation = this.type();
    this.expect('=', ` after "local ${local.v}: ..."`);
    if (!this.isOp('{')) this.error(`expected a table after "local ${local.v}: ... ="`);
    const value = this.value(0);
    this.accept(';');
    if (!(this.tok.t === 'kw' && this.tok.v === 'return')) this.error(`expected "return ${local.v}" after the table`);
    this.k++;
    const ret = this.name(`"${local.v}" after "return"`);
    if (ret.v !== local.v) this.fail(`the module returns "${ret.v}", but the table is "local ${local.v}"`, ret.at);
    this.accept(';');
    if (this.tok.t !== 'eof') this.error(`expected the end of the file after "return ${local.v}"`);
    return { types, local, annotation, value };
  }

  type() {
    const options = [this.simpleType()];
    while (this.accept('|')) options.push(this.simpleType());
    return options.length === 1 ? options[0] : { k: 'union', options };
  }

  simpleType() {
    const tk = this.tok;
    let t;
    if (tk.t === 'string') {
      this.k++;
      t = { k: 'lit', v: tk.v };
    } else if (tk.t === 'kw' && (tk.v === 'nil' || tk.v === 'true' || tk.v === 'false')) {
      this.k++;
      t = tk.v === 'nil' ? { k: 'nil' } : { k: 'lit', v: tk.v === 'true' };
    } else if (tk.t === 'name') {
      this.k++;
      t = { k: 'ref', name: tk.v, at: tk.at };
    } else if (this.isOp('{')) {
      t = this.tableType();
    } else if (this.accept('(')) {
      t = this.type();
      this.expect(')', ' to close "("');
    } else {
      this.error('expected a type');
    }
    if (this.accept('?')) {
      t = { k: 'opt', inner: t };
      if (this.isOp('?')) this.error('expected one "?" (this lint accepts T?, not T??)');
    }
    return t;
  }

  tableType() {
    this.k++; // "{"
    const props = new Map();
    if (this.accept('}')) return { k: 'table', props, array: null };
    if (this.isOp('[')) this.error('indexer types ([K]: V) are outside this lint\'s subset');
    if (!(this.isName() && this.isOp(':', this.peek()))) {
      const array = this.type();
      this.expect('}', ' to close the list type "{ T }"');
      return { k: 'table', props, array };
    }
    for (;;) {
      const id = this.name('a field name');
      if (props.has(id.v)) this.fail(`field "${id.v}" is declared twice`, id.at);
      this.expect(':', ` after field "${id.v}"`);
      props.set(id.v, this.type());
      if (this.accept(',') || this.accept(';')) {
        if (this.accept('}')) break;
        continue;
      }
      this.expect('}', ' or "," after a field type');
      break;
    }
    return { k: 'table', props, array: null };
  }

  value(depth) {
    const tk = this.tok;
    if (this.isOp('{')) return this.table(depth);
    if (tk.t === 'string' || tk.t === 'number') {
      this.k++;
      return { k: tk.t, v: tk.v, at: tk.at };
    }
    if (this.isOp('-') && this.peek().t === 'number') {
      this.k += 2;
      return { k: 'number', v: -this.toks[this.k - 1].v, at: tk.at };
    }
    if (tk.t === 'kw' && (tk.v === 'true' || tk.v === 'false')) {
      this.k++;
      return { k: 'boolean', v: tk.v === 'true', at: tk.at };
    }
    if (tk.t === 'kw' && tk.v === 'nil') {
      this.k++;
      return { k: 'nil', at: tk.at };
    }
    this.error('expected a literal value (table, string, number, true, false or nil)');
    return null;
  }

  table(depth) {
    const open = this.tok;
    if (depth >= 32) this.error('tables nested more than 32 deep');
    this.k++; // "{"
    const fields = [];
    while (!this.accept('}')) {
      const at = this.tok.at;
      let key = null;
      if (this.accept('[')) {
        const k = this.value(depth + 1);
        if (k.k !== 'string' && k.k !== 'number') this.fail('a [key] must be a string or a number', at);
        this.expect(']', ' after "[key"');
        this.expect('=', ' after "[key]"');
        key = k.v;
      } else if (this.isName() && this.isOp('=', this.peek())) {
        key = this.tok.v;
        this.k += 2;
      }
      fields.push({ key, value: this.value(depth + 1), at });
      if (this.accept(',') || this.accept(';')) continue;
      this.expect('}', ' or "," after a table field');
      break;
    }
    return { k: 'table', fields, at: open.at };
  }
}

/** Declared-type checks: every type name exists, no alias cycles, and the table matches its annotation. */
function checkTypes(mod, where) {
  const { types } = mod;
  const at = (i) => `line ${where(i)}`;
  const problems = [];
  const refs = [];
  const walk = (t) => {
    if (t.k === 'ref') refs.push(t);
    else if (t.k === 'opt') walk(t.inner);
    else if (t.k === 'union') t.options.forEach(walk);
    else if (t.k === 'table') {
      if (t.array) walk(t.array);
      t.props.forEach(walk);
    }
  };
  for (const { type } of types.values()) walk(type);
  walk(mod.annotation);
  for (const r of refs) if (!types.has(r.name) && !BUILTIN_TYPES.has(r.name)) problems.push(`${at(r.at)}: unknown type "${r.name}"`);
  if (problems.length) return problems;

  const resolve = (t) => {
    const seen = new Set();
    while (t.k === 'ref' && types.has(t.name)) {
      if (seen.has(t.name)) return null;
      seen.add(t.name);
      t = types.get(t.name).type;
    }
    return t;
  };
  for (const [name, decl] of types) if (!resolve({ k: 'ref', name })) problems.push(`${at(decl.at)}: type "${name}" is defined in terms of itself`);
  if (problems.length) return problems;

  const show = (t) => {
    if (t.k === 'ref') return t.name;
    if (t.k === 'nil') return 'nil';
    if (t.k === 'lit') return typeof t.v === 'string' ? JSON.stringify(t.v) : String(t.v);
    if (t.k === 'opt') return `${show(t.inner)}?`;
    if (t.k === 'union') return t.options.map(show).join(' | ');
    return t.array ? `{ ${show(t.array)} }` : '{ ... }';
  };
  const describe = (v) => {
    if (v.k === 'table') return 'a table';
    if (v.k === 'nil') return 'nil';
    return v.k === 'string' ? JSON.stringify(v.v.length > 30 ? `${v.v.slice(0, 30)}...` : v.v) : String(v.v);
  };
  const allowsNil = (t) => {
    const r = resolve(t);
    return r.k === 'nil' || r.k === 'opt' || (r.k === 'ref' && (r.name === 'any' || r.name === 'unknown'))
      || (r.k === 'union' && r.options.some(allowsNil));
  };
  const check = (v, type, path) => {
    const t = resolve(type);
    const here = `${at(v.at)}: ${path}`;
    switch (t.k) {
      case 'opt':
        return v.k === 'nil' ? [] : check(v, t.inner, path);
      case 'nil':
        return v.k === 'nil' ? [] : [`${here}: expected nil, got ${describe(v)}`];
      case 'lit':
        return v.k === (typeof t.v === 'string' ? 'string' : 'boolean') && v.v === t.v ? [] : [`${here}: expected ${show(t)}, got ${describe(v)}`];
      case 'union':
        return t.options.some((o) => !check(v, o, path).length) ? [] : [`${here}: ${describe(v)} is not ${show(t)}`];
      case 'ref':
        if (t.name === 'any' || t.name === 'unknown') return [];
        return v.k === t.name ? [] : [`${here}: expected ${t.name}, got ${describe(v)}`];
      case 'table': {
        if (v.k !== 'table') return [`${here}: expected a table, got ${describe(v)}`];
        const out = [];
        if (t.array) {
          let n = 0;
          for (const f of v.fields) {
            if (f.key !== null) out.push(`${at(f.at)}: ${path}: the list ${show(t)} cannot have the key ${JSON.stringify(f.key)}`);
            else out.push(...check(f.value, t.array, `${path}[${++n}]`));
          }
          return out;
        }
        const seen = new Set();
        for (const f of v.fields) {
          const key = f.key === null ? null : String(f.key);
          if (key === null) out.push(`${at(f.at)}: ${path}: a value without a field name, but ${show(type)} has only named fields`);
          else if (seen.has(key)) out.push(`${at(f.at)}: ${path}.${key}: duplicate field`);
          else if (typeof f.key !== 'string' || !t.props.has(key)) out.push(`${at(f.at)}: ${path}: field "${key}" is not in type ${show(type)}`);
          else out.push(...check(f.value, t.props.get(key), `${path}.${key}`));
          if (key !== null) seen.add(key);
        }
        for (const [name, pt] of t.props) if (!seen.has(name) && !allowsNil(pt)) out.push(`${here}: missing field "${name}: ${show(pt)}"`);
        return out;
      }
      default:
        return [`${here}: cannot check against this type`];
    }
  };
  return check(mod.value, mod.annotation, mod.local.v);
}

/** The literal as plain JS data, the way js/luau-table.js returns it (nil fields dropped). */
function toData(v) {
  if (v.k === 'nil') return null;
  if (v.k !== 'table') return v.v;
  if (v.fields.every((f) => f.key === null)) return v.fields.map((f) => toData(f.value));
  const obj = {};
  for (const f of v.fields) {
    const d = toData(f.value);
    if (d !== null) Object.defineProperty(obj, String(f.key), { value: d, enumerable: true, writable: true, configurable: true });
  }
  return obj;
}

/** Lints a whole .luau source. Returns { problems: string[], data } (data only when there are no problems). */
function lintLuau(src) {
  const text = src.replace(/\r\n?/g, '\n');
  const where = (i) => {
    const before = text.slice(0, i);
    return `${before.split('\n').length}:${i - before.lastIndexOf('\n')}`;
  };
  const fail = (msg, i) => {
    throw new LintProblem(`line ${where(i)}: ${msg}`);
  };
  try {
    if (text.charCodeAt(0) === 0xfeff) fail('the file starts with a byte-order mark', 0);
    if (text.split('\n', 1)[0].trimEnd() !== '--!strict') fail('line 1 must be "--!strict"', 0);
    const toks = lexLuau(text, fail);
    for (const tk of toks) {
      if (tk.t === 'op' && !DATA_OPS.has(tk.v)) fail(`"${tk.v}" is not allowed in this data module (literal data and type declarations only)`, tk.at);
      if (tk.t === 'kw' && !DATA_KEYWORDS.has(tk.v)) fail(`keyword "${tk.v}" is not allowed in this data module (no code, only data)`, tk.at);
    }
    checkBrackets(toks, fail, where);
    const mod = new LintParser(toks, fail).module();
    const problems = checkTypes(mod, where);
    return { problems, data: problems.length ? undefined : toData(mod.value) };
  } catch (err) {
    if (err instanceof LintProblem) return { problems: [err.message] };
    throw err;
  }
}

/** Mutations of the real course file that the lint must reject: [name, find, replace]. */
const BROKEN_FIXTURES = [
  ['a misspelled "--!strict"', '--!strict\n', '--!strictt\n'],
  ['"export tpye"', 'export type Course', 'export tpye Course'],
  ['an extra "{" in a type', 'export type Stage = {', 'export type Stage = {{'],
  ['"number??,," in a type', 'speed: number?,', 'speed: number??,,'],
  ['an undeclared type name', 'tiles: { Tile },', 'tiles: { Tyle },'],
  ['a tile kind outside TileKind', 'kind = "conveyor"', 'kind = "conveyer"'],
  ['a string where a number belongs', 'width = 60,', 'width = "60",'],
  ['a field the type does not declare', 'version = 1,', 'version = 1,\n  verison = 2,'],
  ['a missing required field', '  cellStuds = 2.5,\n', ''],
  ['a function call in the data', 'width = 60,', 'width = math.floor(60),'],
  ['an unfinished string', '"Hello, World Hills"', '"Hello, World Hills'],
  ['an unclosed table', '  },\n}\n', '  },\n'],
  ['"retrun course("', 'return course', 'retrun course('],
  ['code after "return course"', 'return course', 'return course end'],
];

function lint() {
  console.log(`2. luau lint: ${COURSE}`);
  console.log('      (a zero-dependency structural lint for the subset of Luau this file uses;');
  console.log('       it is not a Luau compiler or type checker: run luau-analyze for that)');
  const src = readCourse(COURSE);
  const result = lintLuau(src);
  if (result.problems.length) {
    bad(`the file fails the lint (${plural(result.problems.length, 'problem')}):`);
    for (const p of result.problems.slice(0, 20)) console.log(`          ${p}`);
  } else {
    ok('--!strict, valid tokens only, balanced brackets, declared types, typed `local course`, `return course`, table matches its types');
    let reader;
    try {
      reader = parseLuauCourse(src);
    } catch (err) {
      reader = err;
    }
    expect(!(reader instanceof Error) && JSON.stringify(reader) === JSON.stringify(result.data),
      "the lint and the site's reader (js/luau-table.js) read the same data",
      reader instanceof Error ? reader.message : 'the two readings differ');
  }

  // Self-test: the lint must reject broken versions of the real file.
  const base = readCourse(DEFAULT_COURSE).replace(/\r\n?/g, '\n');
  if (lintLuau(base).problems.length) {
    bad('broken-fixture self-test skipped: site/obby/obbycourse.luau itself fails the lint');
    return;
  }
  for (const [name, find, replace] of BROKEN_FIXTURES) {
    if (!base.includes(find)) {
      bad(`fixture "${name}" could not be built: its text is no longer in obbycourse.luau (update BROKEN_FIXTURES)`);
      continue;
    }
    const problems = lintLuau(base.replace(find, replace)).problems;
    if (problems.length) ok(`rejects ${name}: ${problems[0]}`);
    else bad(`the lint accepted a broken fixture: ${name}`);
  }
}

// ---------------------------------------------------------------------------
// 3-7. The real course
// ---------------------------------------------------------------------------

function keyOf(world, s) {
  const phase = s.tick % world.phasePeriod;
  return `${s.x},${s.y},${s.vy},${phase},${s.stage}`;
}

/**
 * Explores every state reachable from `roots`. `allow(from, to)` can veto a transition.
 * Returns { nodes: Map key -> { state, parent, input, depth }, wins: [key...] }.
 */
function explore(world, roots, allow = () => true) {
  const nodes = new Map();
  const queue = [];
  const wins = [];
  for (const state of roots) {
    const key = keyOf(world, state);
    if (!nodes.has(key)) {
      nodes.set(key, { state, parent: null, input: null, depth: 0, edges: [] });
      queue.push(key);
    }
  }
  for (let head = 0; head < queue.length; head++) {
    const key = queue[head];
    const node = nodes.get(key);
    const first = node.state.tick === 0; // the game only starts on a real key press
    for (const input of INPUTS) {
      if (first && !input.dx && !input.jump) continue;
      const next = step(world, node.state, input);
      if (!allow(node.state, next)) continue;
      if (next.won) {
        node.edges.push('WIN');
        wins.push({ from: key, input });
        continue;
      }
      const nextKey = keyOf(world, next);
      node.edges.push(nextKey);
      if (!nodes.has(nextKey)) {
        nodes.set(nextKey, { state: next, parent: key, input, depth: node.depth + 1, edges: [] });
        queue.push(nextKey);
      }
    }
  }
  return { nodes, wins };
}

/** Keys of all states that can reach a win. */
function canWin(graph) {
  const reverse = new Map();
  const good = new Set();
  const queue = [];
  for (const [key, node] of graph.nodes) {
    for (const to of node.edges) {
      if (to === 'WIN') {
        if (!good.has(key)) {
          good.add(key);
          queue.push(key);
        }
      } else {
        if (!reverse.has(to)) reverse.set(to, []);
        reverse.get(to).push(key);
      }
    }
  }
  for (let head = 0; head < queue.length; head++) {
    for (const from of reverse.get(queue[head]) || []) {
      if (!good.has(from)) {
        good.add(from);
        queue.push(from);
      }
    }
  }
  return good;
}

function respawnStates(world) {
  const list = [];
  for (let stage = 1; stage <= world.stageCount; stage++) {
    const cp = world.checkpoints[stage];
    for (let phase = 0; phase < world.phasePeriod; phase++) {
      // tick = phase + phasePeriod keeps tick > 0 (a respawn is never the very first frame)
      list.push({ ...initialState(world), x: cp.x, y: cp.y, stage, tick: phase + world.phasePeriod });
    }
  }
  return list;
}

function course() {
  console.log(`3-7. course: ${COURSE}`);
  let world;
  try {
    world = createWorld(parseLuauCourse(readCourse(COURSE)));
  } catch (err) {
    console.error(`check-obby: ${err.message}`);
    process.exit(2);
  }
  console.log(`      "${world.name}": ${world.width}x${world.height} cells, ${world.stageCount} stages, conveyor cycle ${world.phasePeriod} ticks`);

  for (let stage = 1; stage <= world.stageCount; stage++) {
    const cp = world.checkpoints[stage];
    expect(isGrounded(world, cp.x, cp.y), `checkpoint ${stage} has solid ground under it`);
  }

  const start = initialState(world);
  const graph = explore(world, [start, ...respawnStates(world)]);
  // 3. shortest route from the start (BFS order = fewest ticks)
  const fromStart = explore(world, [start]);
  const win = fromStart.wins.length
    ? fromStart.wins.reduce((a, b) => (fromStart.nodes.get(a.from).depth <= fromStart.nodes.get(b.from).depth ? a : b))
    : null;
  if (!win) {
    bad(`the finish is unreachable from the start (${fromStart.nodes.size} states explored)`);
    return;
  }
  const script = [win.input];
  const route = [];
  for (let key = win.from; key; key = fromStart.nodes.get(key).parent) {
    const node = fromStart.nodes.get(key);
    route.push(node.state);
    if (node.input) script.push(node.input);
  }
  script.reverse();
  route.reverse();
  const ticks = script.length;
  ok(`the finish is reachable: shortest run ${ticks} ticks (${(ticks / TICK_HZ).toFixed(1)} s at ${TICK_HZ} Hz), ${fromStart.nodes.size} states explored`);

  // 4. replay the script through the real step()
  const replay = run(world, script);
  const final = replay[replay.length - 1];
  expect(final.won && final.tick === ticks && final.deaths === 0, 'replaying the shortest input script from a fresh start wins with 0 deaths',
    `won=${final.won}, tick=${final.tick}, deaths=${final.deaths}`);
  const order = [];
  for (const s of replay) if (s.events.includes('checkpoint')) order.push(s.stage);
  expect(order.join(',') === Array.from({ length: world.stageCount - 1 }, (_, i) => i + 2).join(','),
    'the shortest run touches every checkpoint in order', `touched ${order.join(',') || 'none'}`);

  // 5. every checkpoint (every phase) can still reach the finish
  const good = canWin(graph);
  const stuckRespawns = respawnStates(world).filter((s) => !good.has(keyOf(world, s)));
  expect(!stuckRespawns.length, `every respawn (${world.stageCount} checkpoints x ${world.phasePeriod} phases) can reach the finish`,
    stuckRespawns.map((s) => `stage ${s.stage} phase ${s.tick % world.phasePeriod}`).join('; '));

  // 6. no checkpoint can be skipped
  for (let k = 2; k <= world.stageCount; k++) {
    // Remove every transition that touches checkpoint k. Any win left over is a run
    // that skipped it (possibly straight to a later checkpoint).
    const skip = explore(world, [start], (from, to) => !(from.stage < k && to.stage === k));
    expect(!skip.wins.length, `checkpoint ${k} cannot be skipped`);
  }

  // 7. no soft-locks
  const stuck = [...graph.nodes.keys()].filter((key) => !good.has(key));
  expect(!stuck.length, `no soft-locks: all ${graph.nodes.size} reachable states can still reach the finish`,
    `${stuck.length} stuck, e.g. ${stuck.slice(0, 3).map((k) => `(x,y,vy,phase,stage)=(${k})`).join(' ')}`);

  if (SHOW) {
    const grid = world.rows.map((r) => [...r]);
    for (const s of route) if (grid[s.y][s.x] === '.') grid[s.y][s.x] = '*';
    console.log('\n      shortest route (* = where the player is after each tick):');
    for (const [y, r] of grid.entries()) console.log(`      ${String(y + 1).padStart(2)} ${r.join('')}`);
    const runs = [];
    for (const input of script) {
      const name = inputName(input);
      if (runs.length && runs[runs.length - 1][0] === name) runs[runs.length - 1][1]++;
      else runs.push([name, 1]);
    }
    console.log(`\n      input script (R/L = right/left, J = jump, . = wait; xN = N ticks):\n      ${runs.map(([n, c]) => (c > 1 ? `${n}x${c}` : n)).join(' ')}`);
  }
}

console.log('check-obby: can Mei\'s Mini Obby be finished?');
physics();
lint();
course();
console.log(failures ? `\ncheck-obby: ${failures} check(s) failed` : '\ncheck-obby: all checks passed');
process.exit(failures ? 1 : 0);
