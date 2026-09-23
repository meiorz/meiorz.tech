/**
 * luau-table.js: a tiny reader for Luau table literals (ES module, no dependencies).
 *
 * The obby course (/obby/obbycourse.luau) is a real Luau ModuleScript:
 *
 *   --!strict
 *   export type Course = { ... }
 *   local course: Course = { name = "...", rows = { "....", ... } }
 *   return course
 *
 * The browser cannot run Luau, and this site never evaluates code, so this module
 * reads only the data: the table literal bound by `local course`. It is a small
 * recursive-descent parser for the literal subset of Luau table constructors:
 *
 *   tables     { a = 1, "x"; ["key"] = v, [2] = v }   (trailing , or ; allowed)
 *   strings    "double" or 'single' quoted (escapes: \\ \" \' \n \t), or [[long]]
 *   numbers    42  -7  3.5  .5  1e3  0x1F  0b101  1_000
 *   literals   true  false  nil
 *   comments   -- line   and   --[[ block ]]  /  --[==[ block ]==]
 *
 * Anything else (function calls, operators, variables) is a clear error that names
 * the line and column. Line endings may be LF or CRLF.
 *
 * A table with only positional values becomes an array, a table with only keyed
 * fields becomes a plain object, and mixing the two is an error. A keyed field set
 * to `nil` is dropped (in Luau, a nil field does not exist). A `nil` in a positional
 * list is an error: it would leave a hole, and dropping it would shift every later
 * index away from what Luau sees.
 */

const MAX_DEPTH = 32;
const NAME = /[A-Za-z_][A-Za-z0-9_]*/y;
const NUMBER = /-?[ \t]*(?:0[xX][0-9A-Fa-f_]+|0[bB][01_]+|(?:[0-9][0-9_]*(?:\.[0-9_]*)?|\.[0-9][0-9_]*)(?:[eE][+-]?[0-9]+)?)/y;
const ESCAPES = { '\\': '\\', '"': '"', "'": "'", n: '\n', t: '\t' };
const KEYWORDS = new Set(['and', 'break', 'do', 'else', 'elseif', 'end', 'false', 'for', 'function',
  'if', 'in', 'local', 'nil', 'not', 'or', 'repeat', 'return', 'then', 'true', 'until', 'while']);

/** A parse error that knows where it happened (1-based line and column). */
export class LuauSyntaxError extends SyntaxError {
  constructor(message, source, index, sourceName) {
    const before = source.slice(0, index);
    const line = before.split('\n').length;
    const column = index - before.lastIndexOf('\n');
    super(`${sourceName}:${line}:${column}: ${message}`);
    this.name = 'LuauSyntaxError';
    this.line = line;
    this.column = column;
  }
}

/**
 * Reads the table bound by `local course[: Type] = { ... }` and returns it as
 * plain JavaScript data. Throws LuauSyntaxError for anything it cannot read.
 * @param {string} src the whole .luau file
 * @param {string} [sourceName] used in error messages
 */
export function parseLuauCourse(src, sourceName = 'obbycourse.luau') {
  const reader = new Reader(src, sourceName);
  reader.seekBinding('course');
  const value = reader.value(0);
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    reader.fail('`course` must be a table with named fields, like { name = "..." }');
  }
  return value;
}

/**
 * Reads one table literal that starts at `start` (the index of its "{").
 * Exported for tests and for other data files.
 */
export function parseLuauTable(src, start = 0, sourceName = 'luau') {
  const reader = new Reader(src, sourceName);
  reader.i = reader.indexFromRaw(start);
  reader.trivia();
  if (reader.peek() !== '{') reader.fail('expected "{"');
  return reader.value(0);
}

class Reader {
  constructor(src, sourceName) {
    if (typeof src !== 'string') throw new TypeError('parseLuauCourse: expected the file contents as a string');
    this.raw = src;
    this.src = src.replace(/\r\n?/g, '\n'); // CRLF -> LF keeps line numbers right
    this.name = sourceName;
    this.i = 0;
  }

  /** Maps an index in the raw text to the normalized text (each CRLF became one LF). */
  indexFromRaw(rawIndex) {
    return rawIndex - (this.raw.slice(0, rawIndex).match(/\r\n/g) || []).length;
  }

  fail(message, at = this.i) {
    throw new LuauSyntaxError(message, this.src, Math.min(at, this.src.length), this.name);
  }

  peek(offset = 0) {
    return this.src[this.i + offset];
  }

  /** Describes what is at the cursor, for error messages. */
  found() {
    if (this.i >= this.src.length) return 'end of file';
    const word = /[^\s,;{}[\]=]+/y;
    word.lastIndex = this.i;
    const m = word.exec(this.src);
    return `"${(m ? m[0] : this.src[this.i]).slice(0, 20)}"`;
  }

  /** Length of a long bracket opener at the cursor ("[[" -> level 0, "[==[" -> 2), or -1. */
  longBracketLevel(at) {
    if (this.src[at] !== '[') return -1;
    let j = at + 1;
    while (this.src[j] === '=') j++;
    return this.src[j] === '[' ? j - at - 1 : -1;
  }

  /** Reads [[...]] / [==[...]==] at the cursor and returns its contents. */
  longBracket(what) {
    const level = this.longBracketLevel(this.i);
    const open = this.i;
    const close = `]${'='.repeat(level)}]`;
    const end = this.src.indexOf(close, open + level + 2);
    if (end < 0) this.fail(`unfinished long ${what} (missing ${close})`, open);
    let body = this.src.slice(open + level + 2, end);
    if (body.startsWith('\n')) body = body.slice(1); // Lua skips a first newline
    this.i = end + close.length;
    return body;
  }

  /** Skips whitespace and comments. */
  trivia() {
    for (;;) {
      while (this.i < this.src.length && /\s/.test(this.src[this.i])) this.i++;
      if (!this.src.startsWith('--', this.i)) return;
      this.i += 2;
      if (this.longBracketLevel(this.i) >= 0) {
        this.longBracket('comment');
      } else {
        const nl = this.src.indexOf('\n', this.i);
        this.i = nl < 0 ? this.src.length : nl + 1;
      }
    }
  }

  /**
   * Moves the cursor just past `local <name>[: Type] =`, skipping comments and
   * strings, so the same words inside a comment are never matched.
   */
  seekBinding(name) {
    const binding = new RegExp(`local[ \\t]+${name}(?![A-Za-z0-9_])[ \\t]*(?::[^=\\n]*)?=(?!=)`, 'y');
    while (this.i < this.src.length) {
      this.trivia();
      const c = this.peek();
      if (c === undefined) break;
      if (c === '"' || c === "'") {
        this.string();
        continue;
      }
      if (this.longBracketLevel(this.i) >= 0) {
        this.longBracket('string');
        continue;
      }
      const atWordStart = this.i === 0 || !/[A-Za-z0-9_]/.test(this.src[this.i - 1]);
      binding.lastIndex = this.i;
      if (atWordStart && binding.test(this.src)) {
        this.i = binding.lastIndex;
        return;
      }
      this.i++;
    }
    this.fail(`no "local ${name} = { ... }" binding found`, 0);
  }

  /** Reads a quoted string at the cursor. */
  string() {
    const quote = this.src[this.i];
    const start = this.i;
    let out = '';
    this.i++;
    for (;;) {
      const c = this.src[this.i];
      if (c === undefined || c === '\n') this.fail('unfinished string', start);
      this.i++;
      if (c === quote) return out;
      if (c === '\\') {
        const e = this.src[this.i];
        if (!(e in ESCAPES)) this.fail(`unsupported escape "\\${e ?? ''}" (this reader knows \\\\ \\" \\' \\n \\t)`, this.i - 1);
        out += ESCAPES[e];
        this.i++;
      } else {
        out += c;
      }
    }
  }

  /** Reads any value at the cursor. */
  value(depth) {
    this.trivia();
    const c = this.peek();
    if (c === '{') return this.table(depth);
    if (c === '"' || c === "'") return this.string();
    if (this.longBracketLevel(this.i) >= 0) return this.longBracket('string');
    NUMBER.lastIndex = this.i;
    const num = NUMBER.exec(this.src);
    if (num && !/[A-Za-z0-9_.]/.test(this.src[NUMBER.lastIndex] || '')) {
      const digits = num[0].replace(/[\s_]/g, '');
      // Number() reads 0x / 0b literals but not with a sign in front, so apply it here.
      const n = digits.startsWith('-') ? -Number(digits.slice(1)) : Number(digits);
      if (!Number.isFinite(n)) this.fail(`bad number ${num[0]}`);
      this.i = NUMBER.lastIndex;
      return n;
    }
    NAME.lastIndex = this.i;
    const word = NAME.exec(this.src);
    if (word) {
      const w = word[0];
      if (w === 'true' || w === 'false' || w === 'nil') {
        this.i = NAME.lastIndex;
        return w === 'true' ? true : w === 'false' ? false : null;
      }
      this.fail(`expected a value but found "${w}" (only literal data is supported: tables, strings, numbers, true, false, nil)`);
    }
    this.fail(`expected a value but found ${this.found()}`);
    return undefined; // unreachable: fail() throws
  }

  /** Reads { fields } at the cursor. */
  table(depth) {
    if (depth >= MAX_DEPTH) this.fail(`tables nested more than ${MAX_DEPTH} deep`);
    const open = this.i;
    this.i++; // "{"
    const list = [];
    const obj = {};
    let keyed = 0;
    for (;;) {
      this.trivia();
      if (this.peek() === '}') {
        this.i++;
        break;
      }
      if (this.peek() === undefined) this.fail('unfinished table (missing "}")', open);
      const fieldAt = this.i;
      let key;
      if (this.peek() === '[' && this.longBracketLevel(this.i) < 0) {
        this.i++;
        key = this.value(depth + 1);
        if (typeof key !== 'string' && typeof key !== 'number') this.fail('a [key] must be a string or a number', fieldAt);
        this.trivia();
        if (this.peek() !== ']') this.fail(`expected "]" but found ${this.found()}`);
        this.i++;
        this.expectEquals();
      } else {
        NAME.lastIndex = this.i;
        const name = NAME.exec(this.src);
        if (name && !KEYWORDS.has(name[0])) {
          const after = NAME.lastIndex;
          this.i = after;
          this.trivia();
          if (this.peek() === '=' && this.peek(1) !== '=') {
            key = name[0];
            this.i++;
          } else {
            this.i = fieldAt; // not a field name: let value() report it
          }
        }
      }
      const value = this.value(depth + 1);
      if (key === undefined) {
        if (value === null) this.fail(`nil in a list would leave a hole (index ${list.length + 1})`, fieldAt);
        list.push(value);
      } else {
        const k = String(key);
        if (Object.prototype.hasOwnProperty.call(obj, k)) this.fail(`duplicate key "${k}"`, fieldAt);
        keyed++;
        // defineProperty: a key such as "__proto__" stays a plain data property.
        if (value !== null) Object.defineProperty(obj, k, { value, enumerable: true, writable: true, configurable: true });
      }
      this.trivia();
      const sep = this.peek();
      if (sep === ',' || sep === ';') this.i++;
      else if (sep !== '}') this.fail(`expected "," or "}" after a field but found ${this.found()}`);
    }
    if (keyed && list.length) this.fail('mixed table: use either positional values or name = value fields, not both', open);
    return keyed ? obj : list;
  }

  expectEquals() {
    this.trivia();
    if (this.peek() !== '=' || this.peek(1) === '=') this.fail(`expected "=" but found ${this.found()}`);
    this.i++;
  }
}
