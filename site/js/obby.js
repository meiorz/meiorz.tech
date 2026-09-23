/**
 * obby.js: Mei's Mini Obby, a small obstacle course on a text grid (ES module,
 * lazy-loaded by term.js). Luau-flavored, written in JavaScript: the course is a
 * Luau data module (/obby/obbycourse.luau), read at runtime by js/luau-table.js.
 *
 * Two layers:
 * 1. A pure, deterministic simulation: createWorld(course), initialState(world)
 *    and step(world, state, input). Integer cells, a fixed 12 Hz tick, no DOM,
 *    clock or randomness. tools/check-obby.mjs runs a breadth-first search over
 *    it to prove the course can be finished and no checkpoint can be skipped.
 * 2. The terminal UI, start(term): a .pane in the log, the grid drawn as runs
 *    of <span class="c-*"> (no inline styles, no HTML strings), keys and touch.
 *    The pane sits inside #log (a polite live region), so everything that changes
 *    during play (field, HUD, hint, legend) is aria-hidden and screen readers hear
 *    only term.status(): start, checkpoint, death or reset, pause and finish.
 *
 * Physics per tick (y grows down; grounded = solid, conveyor or pad just below):
 *   order       launch, conveyor, walk, vertical move (cell by cell), gravity
 *   walk        1 cell per tick, on the ground and in the air
 *   jump        from the ground only: vy = -2, then vy += 1 per tick, falls capped
 *               at 2. Heights per tick: 2, 3, 3, 2, 0. A 2-cell step is easy, a
 *               3-cell step needs timing, 4 is out of reach.
 *   jump pad    standing on it launches you (padLaunch)
 *   conveyor    pushes you 1 cell every `period` ticks of the global clock (conveyorPeriod)
 *   kill        entering it, or falling off the grid, respawns you at your checkpoint
 *   checkpoint  saves progress, forward only; finish wins
 */

import { parseLuauCourse } from './luau-table.js';

// ---- Simulation (pure; also imported by tools/check-obby.mjs) ----

export const TICK_HZ = 12;
export const JUMP_VY = 2; // initial upward speed of a jump, cells per tick
export const MAX_FALL = 2; // fastest fall, cells per tick
const STUDS_GRAVITY = 196.2; // studs/s^2, a common default gravity in stud units

// Cell kinds; each is also an index into CELL_CLASS.
const AIR = 0, SOLID = 1, KILL = 2, CONVEYOR = 3, JUMPPAD = 4, CHECKPOINT = 5, FINISH = 6;

const KINDS = { solid: SOLID, kill: KILL, conveyor: CONVEYOR, jumppad: JUMPPAD, checkpoint: CHECKPOINT, finish: FINISH };
const CELL_CLASS = ['c-air', 'c-solid', 'c-kill', 'c-conv', 'c-jump', 'c-check', 'c-finish'];
const KIND_LABEL = ['air', 'wall', 'lava', 'conveyor', 'jump pad', 'checkpoint', 'finish']; // for the legend
const AIR_CHARS = new Set(['.', ' ']);

/** No keys pressed. */
export const IDLE = Object.freeze({ dx: 0, jump: false, reset: false });

/**
 * A conveyor's speed in studs/s -> how many ticks between 1-cell pushes.
 * 15 studs/s over 2.5-stud cells is 6 cells/s: one push every 2 ticks at 12 Hz.
 */
export function conveyorPeriod(speed, cellStuds) {
  return Math.max(1, Math.round((TICK_HZ * cellStuds) / Math.abs(speed)));
}

/**
 * A jump pad's launch speed in studs/s -> initial vy in cells per tick. Launched at
 * vy = n you rise n(n + 1) / 2 cells, so pick the n closest to the real apex v^2/2g:
 * 100 studs/s gives ~25.5 studs = 10.2 cells, so n = 4 (10 cells).
 */
export function padLaunch(speed, cellStuds) {
  const apexCells = (speed * speed) / (2 * STUDS_GRAVITY * cellStuds);
  const n = Math.round((Math.sqrt(1 + 8 * apexCells) - 1) / 2);
  return Math.min(8, Math.max(JUMP_VY + 1, n));
}

function gcd(a, b) {
  return b ? gcd(b, a % b) : a;
}

/**
 * Validates parsed course data and precomputes the grid.
 * Throws an Error naming the problem (row/column numbers are 1-based, as in Luau).
 */
export function createWorld(course) {
  const fail = (msg) => {
    throw new Error(`obbycourse.luau: ${msg}`);
  };
  if (!course || typeof course !== 'object') fail('expected a course table');
  const rows = course.rows;
  if (!Array.isArray(rows) || !rows.length || rows.some((r) => typeof r !== 'string')) fail('rows must be a list of strings');
  const height = rows.length;
  const width = rows[0].length;
  rows.forEach((r, i) => {
    if (r.length !== width) fail(`rows[${i + 1}] is ${r.length} cells wide; rows[1] is ${width}`);
    if (!/^[\x20-\x7e]*$/.test(r)) fail(`rows[${i + 1}] has a character outside printable ASCII`);
  });
  if (course.width != null && course.width !== width) fail(`width = ${course.width}, but the rows are ${width} wide`);
  if (course.height != null && course.height !== height) fail(`height = ${course.height}, but there are ${height} rows`);
  const cellStuds = course.cellStuds;
  if (typeof cellStuds !== 'number' || !(cellStuds > 0)) fail('cellStuds must be a positive number');

  const stages = Array.isArray(course.stages) ? [...course.stages].sort((a, b) => a.id - b.id) : [];
  stages.forEach((s, i) => {
    if (!s || s.id !== i + 1 || typeof s.name !== 'string') fail('stages must be numbered 1, 2, 3, ... and each needs a name');
  });
  const stageCount = stages.length;
  if (!stageCount) fail('the course needs at least one stage');

  // Tile legend: one character -> behavior.
  const legend = new Map();
  for (const [i, t] of (Array.isArray(course.tiles) ? course.tiles : []).entries()) {
    const where = `tiles[${i + 1}]`;
    if (!t || typeof t.char !== 'string' || t.char.length !== 1 || AIR_CHARS.has(t.char)) fail(`${where}.char must be one character other than "." or space`);
    if (legend.has(t.char)) fail(`${where}: "${t.char}" is defined twice`);
    // Own properties only: "constructor" or "toString" must not pass as a kind.
    const code = Object.prototype.hasOwnProperty.call(KINDS, t.kind) ? KINDS[t.kind] : 0;
    if (!code) fail(`${where}.kind "${t.kind}" is not one of ${Object.keys(KINDS).join(', ')}`);
    const tile = { char: t.char, code, dir: 0, period: 0, launch: 0, stage: 0 };
    if (code === CONVEYOR) {
      if (typeof t.speed !== 'number' || t.speed === 0) fail(`${where}: a conveyor needs a non-zero speed`);
      tile.dir = Math.sign(t.speed);
      tile.period = conveyorPeriod(t.speed, cellStuds);
    } else if (code === JUMPPAD) {
      if (typeof t.speed !== 'number' || t.speed <= 0) fail(`${where}: a jump pad needs a positive speed`);
      tile.launch = padLaunch(t.speed, cellStuds);
    } else if (code === CHECKPOINT || code === FINISH) {
      if (!Number.isInteger(t.stage) || t.stage < 1) fail(`${where}: a ${t.kind} needs a whole-number stage`);
      tile.stage = code === FINISH ? stageCount + 1 : t.stage;
    }
    legend.set(t.char, Object.freeze(tile));
  }

  const cells = new Uint8Array(width * height); // kind per cell
  const tileAt = new Array(width * height).fill(null); // tile per cell (null = air)
  const checkpoints = new Array(stageCount + 1).fill(null); // [stage] -> { x, y }
  let finish = null;
  let phasePeriod = 1; // conveyors repeat every phasePeriod ticks
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const ch = rows[y][x];
      if (AIR_CHARS.has(ch)) continue;
      const tile = legend.get(ch);
      if (!tile) fail(`rows[${y + 1}] column ${x + 1}: "${ch}" is not in tiles`);
      const i = x + y * width;
      cells[i] = tile.code;
      tileAt[i] = tile;
      if (tile.code === CHECKPOINT) {
        if (tile.stage > stageCount) fail(`checkpoint "${ch}" is for stage ${tile.stage}, but there are ${stageCount} stages`);
        if (checkpoints[tile.stage]) fail(`stage ${tile.stage} has more than one checkpoint`);
        checkpoints[tile.stage] = Object.freeze({ x, y });
      } else if (tile.code === FINISH) {
        if (finish) fail('there is more than one finish');
        finish = Object.freeze({ x, y });
      } else if (tile.code === CONVEYOR) {
        phasePeriod = (phasePeriod * tile.period) / gcd(phasePeriod, tile.period);
      }
    }
  }
  for (let s = 1; s <= stageCount; s++) if (!checkpoints[s]) fail(`stage ${s} has no checkpoint`);
  if (!finish) fail('there is no finish');

  return Object.freeze({
    name: typeof course.name === 'string' ? course.name : 'obby',
    width,
    height,
    cells,
    tileAt,
    rows: Object.freeze([...rows]),
    tiles: Object.freeze([...legend.values()]), // in file order, for the on-screen legend
    stages: Object.freeze(stages.map((s) => Object.freeze({ id: s.id, name: s.name, hint: typeof s.hint === 'string' ? s.hint : '' }))),
    stageCount,
    checkpoints: Object.freeze(checkpoints),
    spawn: checkpoints[1],
    finish,
    phasePeriod,
  });
}

/** The state at the start of a run: standing on checkpoint 1. */
export function initialState(world) {
  const splits = new Array(world.stageCount + 2).fill(null); // [stage] -> tick it was reached
  splits[1] = 0;
  return Object.freeze({
    x: world.spawn.x,
    y: world.spawn.y,
    vy: 0,
    tick: 0,
    stage: 1,
    deaths: 0,
    won: false,
    splits: Object.freeze(splits),
    lastDeath: null, // { x, y, tick } of the latest death, for the UI
    events: Object.freeze([]), // what happened during the last step
  });
}

function kindAt(world, x, y) {
  if (x < 0 || x >= world.width || y < 0 || y >= world.height) return AIR;
  return world.cells[x + y * world.width];
}

function isSolid(world, x, y) {
  const k = kindAt(world, x, y);
  return k === SOLID || k === CONVEYOR || k === JUMPPAD;
}

export function isGrounded(world, x, y) {
  return isSolid(world, x, y + 1);
}

function respawn(world, s, why) {
  if (why === 'death') s.lastDeath = { x: s.x, y: s.y, tick: s.tick };
  const cp = world.checkpoints[s.stage];
  s.x = cp.x;
  s.y = cp.y;
  s.vy = 0;
  s.deaths += 1;
  s.events.push(why);
}

function reach(s, stage) {
  const splits = [...s.splits];
  splits[stage] = s.tick;
  s.splits = Object.freeze(splits);
}

/** Applies the cell the player just entered. Returns true if the step is over. */
function touch(world, s) {
  const tile = world.tileAt[s.x + s.y * world.width];
  if (!tile) return false;
  if (tile.code === KILL) {
    respawn(world, s, 'death');
    return true;
  }
  if (tile.code === CHECKPOINT && tile.stage > s.stage) {
    s.stage = tile.stage;
    reach(s, tile.stage);
    s.events.push('checkpoint');
  } else if (tile.code === FINISH) {
    s.won = true;
    reach(s, tile.stage);
    s.events.push('win');
    return true;
  }
  return false;
}

/** Moves one cell sideways unless a solid cell or the edge is in the way. */
function slide(world, s, dx) {
  const nx = s.x + dx;
  if (nx < 0 || nx >= world.width || isSolid(world, nx, s.y)) return false;
  s.x = nx;
  return touch(world, s);
}

/**
 * Advances one tick. Pure: returns a new frozen state and never changes `state`.
 * input = { dx: -1 | 0 | 1, jump: boolean, reset?: boolean }
 * The returned state's `events` lists what happened: 'jump', 'pad',
 * 'checkpoint', 'death', 'reset', 'win'.
 */
export function step(world, state, input = IDLE) {
  if (state.won) return state;
  const s = { ...state, tick: state.tick + 1, events: [] };
  const done = () => {
    s.events = Object.freeze(s.events);
    return Object.freeze(s);
  };
  if (input.reset) {
    respawn(world, s, 'reset');
    return done();
  }

  // 1. Launch: only from the ground, judged before anything moves.
  const below = isGrounded(world, s.x, s.y) ? world.tileAt[s.x + (s.y + 1) * world.width] : null;
  if (below && below.code === JUMPPAD) {
    s.vy = -below.launch;
    s.events.push('pad');
  } else if (below && input.jump) {
    s.vy = -JUMP_VY;
    s.events.push('jump');
  }

  // 2. Conveyor push, in step with the global tick.
  if (below && below.code === CONVEYOR && s.tick % below.period === 0 && slide(world, s, below.dir)) return done();

  // 3. Walk.
  const dx = Math.sign(input.dx || 0);
  if (dx && slide(world, s, dx)) return done();

  // 4. Vertical move, one cell at a time so nothing is skipped.
  const dir = Math.sign(s.vy);
  for (let n = Math.abs(s.vy); n > 0; n--) {
    const ny = s.y + dir;
    if (ny >= world.height) {
      respawn(world, s, 'death'); // fell off the bottom
      return done();
    }
    if (ny < 0 || isSolid(world, s.x, ny)) {
      s.vy = 0; // landed, or bumped a ceiling
      break;
    }
    s.y = ny;
    if (touch(world, s)) return done();
  }

  // 5. Gravity.
  s.vy = s.vy >= 0 && isGrounded(world, s.x, s.y) ? 0 : Math.min(s.vy + 1, MAX_FALL);
  return done();
}

// ---- Terminal UI ----

const COURSE_URL = '/obby/obbycourse.luau';
const TICK_MS = 1000 / TICK_HZ;
const JUMP_BUFFER_TICKS = 3; // a jump pressed up to 3 ticks early still counts
const MESSAGE_TICKS = 24; // how long a HUD message stays (2 s)
const DEATH_MARK_TICKS = 8; // how long an "x" marks where you fell
const MIN_VIEW_COLS = 16;
const MAX_TAPS = 4;
const KEYMAP = {
  arrowleft: 'left', a: 'left', arrowright: 'right', d: 'right',
  ' ': 'jump', arrowup: 'jump', w: 'jump', r: 'reset', escape: 'quit', arrowdown: 'none',
};
const TEXT_ONLY = String.fromCodePoint(0xfe0e); // U+FE0E: draw arrows as text, not emoji

let current = null; // the game on screen, if any

function seconds(ticks) {
  return `${(ticks / TICK_HZ).toFixed(1)}s`;
}

function plural(n, word) {
  return `${n} ${word}${n === 1 ? '' : 's'}`;
}

/** Writes text only when it changed (no DOM churn at 12 Hz). */
function setText(node, text) {
  if (node.textContent !== text) node.textContent = text;
}

/** Legend glyphs for one kind: "1-4" for a run of 3+ consecutive digits, else "< >". */
function glyphs(chars) {
  const digits = chars.every((c, i) => /[0-9]/.test(c) && (i === 0 || c.charCodeAt(0) === chars[i - 1].charCodeAt(0) + 1));
  return digits && chars.length > 2 ? `${chars[0]}-${chars[chars.length - 1]}` : chars.join(' ');
}

let paneCount = 0;

/** A button that runs a shell command (term.js handles [data-cmd] clicks). */
function cmdButton(term, cmd) {
  return term.el('button', { class: 'link-btn', text: cmd, attrs: { type: 'button', 'data-cmd': cmd } });
}

class Game {
  constructor(term, world) {
    this.term = term;
    this.world = world;
    this.state = initialState(world);
    this.started = false; // the clock starts with the first move
    this.begun = false; // the pane is on screen and the prompt is hidden
    this.ended = false;
    this.running = false;
    this.how = ''; // last control used: 'keyboard', 'mouse', 'touch' or 'pen'
    this.releaseAll(); // sets keys, touches and taps (one queued move per tap)
    this.jumpBuffer = 0;
    this.message = null; // { text, until }
    this.viewCols = world.width;
    this.camX = 0;
    this.rowKeys = [];
    this.raf = 0;
    this.last = 0;
    this.acc = 0;
    this.frame = this.frame.bind(this);
    this.onVisibility = () => this.updateRunning();
    this.build();
    this.mode = {
      name: 'obby',
      ps1: '',
      onSubmit() {},
      onExit: () => this.end('Stopped.'),
    };
  }

  // -- DOM --

  build() {
    const { el } = this.term;
    const w = this.world;
    const helpId = `obby-keys-${++paneCount}`;
    this.hud = {
      stage: el('span'),
      deaths: el('span'),
      time: el('span'),
      note: el('span', { class: 'meta' }),
    };
    this.field = el('pre', { class: 'obby-field', attrs: { 'aria-hidden': 'true' } });
    this.rowEls = [];
    for (let y = 0; y < w.height; y++) {
      const row = el('span');
      this.rowEls.push(row);
      this.field.append(row, y < w.height - 1 ? '\n' : '');
    }
    // Hidden from screen readers: the stage hint is spoken with the checkpoint
    // status instead (and once at the start), not on every re-render.
    this.hint = el('p', { class: 'hint', attrs: { 'aria-hidden': 'true' } });
    const btn = (glyph, label, name) => el('button', { text: glyph, attrs: { type: 'button', 'aria-label': label, 'data-obby': name } });
    this.controls = el('div', { class: 'obby-controls' },
      btn(`◀${TEXT_ONLY}`, 'Move left', 'left'),
      btn(`▲${TEXT_ONLY}`, 'Jump', 'jump'),
      btn(`▶${TEXT_ONLY}`, 'Move right', 'right'),
      btn('⟲', 'Restart from the last checkpoint', 'reset'),
      btn('✕', 'Quit obby', 'quit'));
    this.footer = el('div', { class: 'pane__footer', attrs: { id: helpId } },
      '←/→ or A/D move · Space/↑/W jump · R restart · Esc quit');
    this.pane = el('div', {
      class: 'pane',
      // aria-live="off": the game updates in place inside #log; only status() speaks.
      attrs: { tabindex: '0', role: 'application', 'aria-label': `obby: ${w.name}`, 'aria-describedby': helpId, 'aria-live': 'off' },
      on: {
        keydown: (e) => this.onKeyDown(e),
        keyup: (e) => this.onKeyUp(e),
        focusin: () => this.updateRunning(),
        focusout: (e) => {
          if (!this.pane.contains(e.relatedTarget)) {
            this.releaseAll();
            this.updateRunning(false);
          }
        },
      },
    },
    el('div', { class: 'pane__bar' },
      el('span', {}, `obby — ${w.name}`),
      ' ',
      el('span', {}, 'Luau-flavored, written in JavaScript · not affiliated with Roblox')),
    el('div', { class: 'pane__body' },
      // Rewritten every tick, so aria-hidden; status() announces the events it shows.
      el('p', { class: 'obby-hud', attrs: { 'aria-hidden': 'true' } }, this.hud.stage, ' ', this.hud.deaths, ' ', this.hud.time, ' ', this.hud.note),
      this.field,
      this.legend(),
      this.hint,
      this.controls),
    this.footer);

    for (const b of this.controls.querySelectorAll('button')) {
      // Keep keyboard focus on the pane itself, so Space means "jump", not "press this button again".
      b.addEventListener('mousedown', (e) => e.preventDefault());
      b.addEventListener('pointerdown', (e) => this.onButtonDown(e, b.dataset.obby));
      for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) {
        b.addEventListener(type, () => this.onButtonUp(b.dataset.obby));
      }
      b.addEventListener('click', (e) => this.onButtonClick(e, b.dataset.obby));
    }
    this.resizer = new ResizeObserver(() => this.measure());
    this.resizer.observe(this.field);
  }

  /**
   * One line under the field that says what each glyph is, colored like the field:
   * "@ you · # wall · ^ lava · < > conveyor · J jump pad · 1-4 checkpoint · F finish".
   * aria-hidden like the field it explains.
   */
  legend() {
    const { el } = this.term;
    const byKind = new Map(); // kind -> chars, in file order
    for (const t of this.world.tiles) {
      if (!byKind.has(t.code)) byKind.set(t.code, []);
      byKind.get(t.code).push(t.char);
    }
    const parts = [el('span', { class: 'c-player', text: '@' }), ' you'];
    for (const [code, chars] of byKind) {
      parts.push(' · ', el('span', { class: CELL_CLASS[code], text: glyphs(chars) }), ` ${KIND_LABEL[code]}`);
    }
    return el('p', { class: 'hint obby-legend', attrs: { 'aria-hidden': 'true' } }, ...parts);
  }

  /** How many columns fit; on narrow screens the view follows the player. */
  measure() {
    if (this.ended) return;
    const probe = this.term.el('span', { text: '·'.repeat(20) });
    this.field.append(probe);
    const cell = probe.getBoundingClientRect().width / 20;
    probe.remove();
    const fit = cell > 0 ? Math.floor(this.field.clientWidth / cell) : this.world.width;
    const cols = Math.min(this.world.width, Math.max(MIN_VIEW_COLS, fit));
    if (cols !== this.viewCols) {
      this.viewCols = cols;
      this.rowKeys = [];
      this.render();
    }
  }

  render() {
    const { world: w, state: s } = this;
    const { el } = this.term;

    setText(this.hud.stage, `stage ${s.stage}/${w.stageCount}`);
    setText(this.hud.deaths, `deaths ${s.deaths}`);
    setText(this.hud.time, `time ${seconds(s.tick)}`);
    let note = '';
    if (this.message && s.tick < this.message.until) note = this.message.text;
    else if (!this.running && !this.ended) note = 'paused: click or tap the course to resume';
    else if (!this.started) note = 'ready: move or jump to start';
    setText(this.hud.note, note);
    const stage = w.stages[s.stage - 1];
    setText(this.hint, `Stage ${stage.id} · ${stage.name}${stage.hint ? `: ${stage.hint}` : ''}`);

    // Camera: centered on the player when the course is wider than the view.
    const maxCam = w.width - this.viewCols;
    const camX = maxCam > 0 ? Math.max(0, Math.min(maxCam, s.x - (this.viewCols >> 1))) : 0;
    if (camX !== this.camX) {
      this.camX = camX;
      this.rowKeys = [];
    }
    const mark = s.lastDeath && s.tick - s.lastDeath.tick < DEATH_MARK_TICKS ? s.lastDeath : null;

    for (let y = 0; y < w.height; y++) {
      let chars = '';
      let kinds = '';
      for (let x = camX; x < camX + this.viewCols; x++) {
        let ch;
        let kind;
        if (x === s.x && y === s.y) {
          ch = '@';
          kind = 'p';
        } else if (mark && x === mark.x && y === mark.y) {
          ch = 'x';
          kind = String(KILL);
        } else {
          const code = w.cells[x + y * w.width];
          ch = code === AIR ? '·' : w.rows[y][x];
          kind = String(code);
        }
        chars += ch;
        kinds += kind;
      }
      const key = chars + kinds;
      if (key === this.rowKeys[y]) continue;
      this.rowKeys[y] = key;
      // One <span> per run of same-kind cells.
      const runs = [];
      for (let i = 0; i < chars.length;) {
        let j = i + 1;
        while (j < chars.length && kinds[j] === kinds[i]) j++;
        const cls = kinds[i] === 'p' ? 'c-player' : CELL_CLASS[Number(kinds[i])];
        runs.push(el('span', { class: cls, text: chars.slice(i, j) }));
        i = j;
      }
      this.rowEls[y].replaceChildren(...runs);
    }
  }

  // -- Loop --

  /** Runs the clock only while the pane (or one of its buttons) has focus and the tab is visible. */
  updateRunning(focused = this.pane.contains(document.activeElement)) {
    const run = !this.ended && focused && document.visibilityState === 'visible';
    if (run && !this.running) {
      this.running = true;
      this.last = performance.now();
      this.acc = 0;
      this.raf = requestAnimationFrame(this.frame);
    } else if (!run && this.running) {
      this.running = false;
      cancelAnimationFrame(this.raf);
      if (!this.ended && document.visibilityState === 'visible') this.term.status('obby paused. Focus the course to resume.');
    }
    this.render();
  }

  frame(now) {
    if (!this.running) return;
    if (!this.pane.contains(document.activeElement)) {
      // Focus can move without a focusout event (e.g. while the window is in the background).
      this.releaseAll();
      this.updateRunning(false);
      return;
    }
    this.acc += Math.min(now - this.last, 250); // after a stall, don't fast-forward
    this.last = now;
    let stepped = false;
    while (this.acc >= TICK_MS && this.running) {
      this.acc -= TICK_MS;
      if (this.tick()) stepped = true; // idle before the first move: nothing to redraw
    }
    if (stepped && !this.ended) this.render();
    if (this.running) this.raf = requestAnimationFrame(this.frame);
  }

  input() {
    const held = (this.keys.right || this.touches.right > 0 ? 1 : 0) - (this.keys.left || this.touches.left > 0 ? 1 : 0);
    const dx = this.taps.length ? this.taps.shift() : held;
    return { dx, jump: this.jumpBuffer > 0, reset: false };
  }

  /** Advances the world one tick; false while it waits for the first move. */
  tick(input = this.input()) {
    if (!this.started) {
      if (!input.dx && !input.jump && !input.reset) return false; // the world waits for the first move
      this.started = true;
    }
    const next = step(this.world, this.state, input);
    this.state = next;
    if (this.jumpBuffer > 0) this.jumpBuffer = next.events.includes('jump') || next.events.includes('pad') ? 0 : this.jumpBuffer - 1;
    for (const ev of next.events) this.announce(ev);
    return true;
  }

  /** The stage's name and hint as one sentence, for status(). */
  stageText(id) {
    const stage = this.world.stages[id - 1];
    return `${stage.name}.${stage.hint ? ` ${stage.hint}` : ''}`;
  }

  /** Discrete events only: status() is the one channel screen readers hear. */
  announce(ev) {
    const { term, world: w, state: s } = this;
    const say = (text, hud = text) => {
      this.message = { text: hud, until: s.tick + MESSAGE_TICKS };
      term.status(text);
    };
    if (ev === 'checkpoint') {
      say(`Checkpoint ${s.stage} of ${w.stageCount}: ${this.stageText(s.stage)}`, `checkpoint ${s.stage}!`);
    } else if (ev === 'death') {
      say(`Oof. Back to checkpoint ${s.stage}. Deaths: ${s.deaths}.`, `oof! back to checkpoint ${s.stage}`);
    } else if (ev === 'reset') {
      say(`Reset. Back to checkpoint ${s.stage}. Deaths: ${s.deaths}.`, `reset to checkpoint ${s.stage}`);
    } else if (ev === 'win') {
      this.win();
    }
  }

  // -- Input --

  releaseAll() {
    this.taps = [];
    this.keys = { left: false, right: false };
    this.touches = { left: 0, right: 0 };
  }

  onKeyDown(e) {
    if (this.ended || e.ctrlKey || e.metaKey || e.altKey || e.isComposing) return;
    const action = KEYMAP[e.key.toLowerCase()];
    if (!action || (e.key === ' ' && e.target !== this.pane)) return; // a focused button clicks on Space
    this.how = 'keyboard';
    e.preventDefault(); // also for ArrowDown, which would scroll the page mid-jump
    if (action === 'left' || action === 'right') this.keys[action] = true;
    if (!e.repeat) this.act(action);
  }

  onKeyUp(e) {
    const action = KEYMAP[e.key.toLowerCase()];
    if (action === 'left' || action === 'right') this.keys[action] = false;
  }

  /** One press of a control, from a key or a button. */
  act(action) {
    if (action === 'quit') {
      this.quit();
      return;
    }
    if (action === 'left' || action === 'right') {
      if (this.taps.length < MAX_TAPS) this.taps.push(action === 'right' ? 1 : -1);
    } else if (action === 'jump') {
      this.jumpBuffer = JUMP_BUFFER_TICKS;
    } else if (action === 'reset' && this.started) {
      this.tick({ dx: 0, jump: false, reset: true });
    }
    if (!this.running) this.updateRunning();
  }

  /** Touch and mouse: hold an arrow to keep moving; jump on press. */
  onButtonDown(e, name) {
    if (this.ended || e.button !== 0) return;
    this.how = e.pointerType || 'mouse';
    e.preventDefault(); // keeps focus on the pane and stops text selection
    if (!this.pane.contains(document.activeElement)) this.pane.focus({ preventScroll: true });
    if (name === 'left' || name === 'right') {
      this.touches[name]++;
      try {
        e.currentTarget.setPointerCapture(e.pointerId);
      } catch {
        /* capture is optional */
      }
    }
    if (name !== 'reset' && name !== 'quit') this.act(name);
  }

  onButtonUp(name) {
    if (name === 'left' || name === 'right') this.touches[name] = Math.max(0, this.touches[name] - 1);
  }

  /** Pointer presses were handled on pointerdown; keyboard clicks (Enter/Space) have detail 0. */
  onButtonClick(e, name) {
    if (this.ended) return;
    if (e.detail === 0) this.how = 'keyboard';
    if (e.detail === 0 || name === 'reset' || name === 'quit') this.act(name);
    if (!this.ended && e.detail !== 0) this.pane.focus({ preventScroll: true });
  }

  // -- Start and end --

  /** Puts the game on screen. False if term refused the mode (a newer command took over). */
  begin() {
    // Mode first: if it is refused, pushMode() has already called onExit -> end(),
    // and nothing was printed or hidden.
    if (!this.term.pushMode(this.mode)) return false;
    this.begun = true;
    this.term.print(this.pane);
    this.term.setPromptVisible(false);
    this.measure();
    this.render();
    document.addEventListener('visibilitychange', this.onVisibility);
    this.pane.focus({ preventScroll: true });
    this.updateRunning(); // no focusin fires while the browser window is in the background
    this.term.scrollToBottom();
    this.term.status(`obby started. Stage 1 of ${this.world.stageCount}: ${this.stageText(1)}`);
    return true;
  }

  /** Stops the game and leaves its last frame in the log. Safe to call twice. */
  end(footerText) {
    if (this.ended) return;
    this.ended = true;
    this.running = false;
    cancelAnimationFrame(this.raf);
    document.removeEventListener('visibilitychange', this.onVisibility);
    this.resizer.disconnect();
    this.message = null;
    this.render();
    this.hud.note.textContent = '';
    this.controls.remove();
    this.footer.textContent = footerText;
    this.pane.removeAttribute('tabindex');
    this.pane.removeAttribute('aria-describedby');
    this.pane.setAttribute('role', 'group'); // a finished game is just a labeled record in the log
    if (this.begun) this.term.setPromptVisible(true);
    if (current === this) current = null;
  }

  /** Ends the game, removes OUR mode (never another program's), then prints `lines`. */
  leave(footerText, ...lines) {
    this.end(footerText);
    this.term.popMode(this.mode); // no-op unless our mode is on top; onExit -> end() is a no-op now
    const out = this.term.print(...lines);
    // Keyboard and mouse players go back to typing. After a tap, focusing #cmd would
    // pop up the on-screen keyboard, so focus the result instead (the pane just lost
    // its tabindex, which would otherwise drop focus to <body>).
    const touch = this.how ? this.how === 'touch' || this.how === 'pen' : this.term.isCoarsePointer();
    if (touch) {
      out.tabIndex = -1;
      out.focus({ preventScroll: true });
    } else {
      this.term.focusInput();
    }
    this.term.scrollToBottom();
    return out;
  }

  quit() {
    const s = this.state;
    const out = this.leave('Quit.',
      `obby: quit at stage ${s.stage}/${this.world.stageCount} after ${seconds(s.tick)} (${plural(s.deaths, 'death')}). Play again: `,
      cmdButton(this.term, 'obby'));
    out.classList.add('out--muted');
  }

  win() {
    const { world: w, state: s, term } = this;
    const { el } = term;
    const nameWidth = Math.max(...w.stages.map((st) => st.name.length));
    const lines = w.stages.map((st) => {
      const from = s.splits[st.id];
      const to = s.splits[st.id + 1];
      const time = from != null && to != null ? seconds(to - from) : 'skipped';
      return `stage ${st.id}  ${st.name.padEnd(nameWidth)}  ${time.padStart(7)}`;
    });
    lines.push(`${'total'.padEnd(nameWidth + 9)}  ${seconds(s.tick).padStart(7)}`);
    const table = el('pre', { text: lines.join('\n') });
    table.dataset.label = 'Stage times';
    this.leave('Finished!',
      el('p', { class: 'out--ok' }, `You finished ${w.name} in ${seconds(s.tick)} with ${plural(s.deaths, 'death')}.`),
      table,
      el('p', {}, 'Built by Mei · course data is a real Luau module: ', cmdButton(term, 'cat obby/obbycourse.luau')),
      el('p', { class: 'hint' }, 'Play again: ', cmdButton(term, 'obby')));
    term.status(`Finished in ${(s.tick / TICK_HZ).toFixed(1)} seconds with ${plural(s.deaths, 'death')}.`);
  }
}

/** Entry point used by term.js: `obby` (arguments are ignored). */
export async function start(term, _args) {
  // term.js marks a launch stale when the visitor moves on while it loads (another
  // command, a data-cmd click). A stale launch must not take over, and must not
  // throw either (term.js would then pop every mode, including the newer program's).
  const stale = () => typeof term.isStale === 'function' && term.isStale();
  let text;
  try {
    const res = await fetch(COURSE_URL, { credentials: 'same-origin' });
    if (!res.ok) throw new Error(`could not load ${COURSE_URL} (HTTP ${res.status})`);
    text = await res.text();
  } catch (err) {
    if (stale()) return;
    throw err;
  }
  if (stale()) return;
  const world = createWorld(parseLuauCourse(text));
  // Safety net: if a game is still on screen, end it and remove its own mode.
  if (current) {
    const prev = current; // end() clears `current`
    prev.end('Replaced by a new game.');
    term.popMode(prev.mode);
  }
  const game = new Game(term, world);
  if (game.begin()) current = game;
}
