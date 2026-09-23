#!/usr/bin/env node
/**
 * make-og.mjs: renders the Open Graph card, site/img/og.png (1200x630).
 *
 * Zero dependencies. It uses a tiny RGB canvas, a hand-drawn 5x7 bitmap font
 * and a PNG encoder built on node:zlib (deflate + crc32, Node 20.15+/22.2+).
 *
 *   node tools/make-og.mjs              # writes site/img/og.png
 *   node tools/make-og.mjs path/to.png  # writes somewhere else
 *
 * The output is deterministic for a given Node/zlib version, so running it
 * again without changes should not show up as a diff.
 */
import zlib from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const WIDTH = 1200;
export const HEIGHT = 630;
const BUDGET_BYTES = 150 * 1024;

// Colours come from the site's dark theme (css/term.css) so the card matches the page.
const COLOR = {
  backdrop: '#1a1f2b',
  backdropDot: '#232a38',
  shadow: '#0a0c10',
  frame: '#2e3440',
  titlebar: '#161a20',
  screen: '#0f1115',
  fg: '#e6e6e6',
  muted: '#a0a8b3',
  prompt: '#7ee0a1',
  accent: '#7cc4ff',
  dotRed: '#ff8f8f',
  dotYellow: '#f2c46d',
  dotGreen: '#7ee0a1',
};

// ---------------------------------------------------------------------------
// 5x7 bitmap font, drawn by hand for this card. Each glyph is 7 rows of 5
// columns ('#' = ink), top row first, separated by spaces. The bottom row is
// the baseline; g j p q y have raised descenders so they fit the 7-row cell.
// ---------------------------------------------------------------------------
const MIDDLE_DOT = String.fromCharCode(0xb7); // U+00B7, kept out of the source so the file stays ASCII

const GLYPHS = {
  A: '.###. #...# #...# ##### #...# #...# #...#',
  B: '####. #...# #...# ####. #...# #...# ####.',
  C: '.###. #...# #.... #.... #.... #...# .###.',
  D: '####. #...# #...# #...# #...# #...# ####.',
  E: '##### #.... #.... ####. #.... #.... #####',
  F: '##### #.... #.... ####. #.... #.... #....',
  G: '.###. #...# #.... #.### #...# #...# .####',
  H: '#...# #...# #...# ##### #...# #...# #...#',
  I: '.###. ..#.. ..#.. ..#.. ..#.. ..#.. .###.',
  J: '..### ...#. ...#. ...#. ...#. #..#. .##..',
  K: '#...# #..#. #.#.. ##... #.#.. #..#. #...#',
  L: '#.... #.... #.... #.... #.... #.... #####',
  M: '#...# ##.## #.#.# #.#.# #...# #...# #...#',
  N: '#...# #...# ##..# #.#.# #..## #...# #...#',
  O: '.###. #...# #...# #...# #...# #...# .###.',
  P: '####. #...# #...# ####. #.... #.... #....',
  Q: '.###. #...# #...# #...# #.#.# #..#. .##.#',
  R: '####. #...# #...# ####. #.#.. #..#. #...#',
  S: '.#### #.... #.... .###. ....# ....# ####.',
  T: '##### ..#.. ..#.. ..#.. ..#.. ..#.. ..#..',
  U: '#...# #...# #...# #...# #...# #...# .###.',
  V: '#...# #...# #...# #...# #...# .#.#. ..#..',
  W: '#...# #...# #...# #.#.# #.#.# #.#.# .#.#.',
  X: '#...# #...# .#.#. ..#.. .#.#. #...# #...#',
  Y: '#...# #...# .#.#. ..#.. ..#.. ..#.. ..#..',
  Z: '##### ....# ...#. ..#.. .#... #.... #####',
  a: '..... ..... .###. ....# .#### #...# .####',
  b: '#.... #.... #.##. ##..# #...# #...# ####.',
  c: '..... ..... .###. #.... #.... #...# .###.',
  d: '....# ....# .##.# #..## #...# #...# .####',
  e: '..... ..... .###. #...# ##### #.... .###.',
  f: '..##. .#..# .#... ###.. .#... .#... .#...',
  g: '..... ..... .#### #...# .#### ....# .###.',
  h: '#.... #.... #.##. ##..# #...# #...# #...#',
  i: '..#.. ..... .##.. ..#.. ..#.. ..#.. .###.',
  j: '...#. ..... ..##. ...#. ...#. #..#. .##..',
  k: '#.... #.... #..#. #.#.. ##... #.#.. #..#.',
  l: '.##.. ..#.. ..#.. ..#.. ..#.. ..#.. .###.',
  m: '..... ..... ##.#. #.#.# #.#.# #...# #...#',
  n: '..... ..... #.##. ##..# #...# #...# #...#',
  o: '..... ..... .###. #...# #...# #...# .###.',
  p: '..... ..... ####. #...# ####. #.... #....',
  q: '..... ..... .#### #...# .#### ....# ....#',
  r: '..... ..... #.##. ##..# #.... #.... #....',
  s: '..... ..... .#### #.... .###. ....# ####.',
  t: '.#... .#... ###.. .#... .#... .#..# ..##.',
  u: '..... ..... #...# #...# #...# #..## .##.#',
  v: '..... ..... #...# #...# #...# .#.#. ..#..',
  w: '..... ..... #...# #...# #.#.# #.#.# .#.#.',
  x: '..... ..... #...# .#.#. ..#.. .#.#. #...#',
  y: '..... ..... #...# #...# .#### ....# .###.',
  z: '..... ..... ##### ...#. ..#.. .#... #####',
  0: '.###. #...# #..## #.#.# ##..# #...# .###.',
  1: '..#.. .##.. ..#.. ..#.. ..#.. ..#.. .###.',
  2: '.###. #...# ....# ...#. ..#.. .#... #####',
  3: '##### ...#. ..#.. ...#. ....# #...# .###.',
  4: '...#. ..##. .#.#. #..#. ##### ...#. ...#.',
  5: '##### #.... ####. ....# ....# #...# .###.',
  6: '..##. .#... #.... ####. #...# #...# .###.',
  7: '##### ....# ...#. ..#.. .#... .#... .#...',
  8: '.###. #...# #...# .###. #...# #...# .###.',
  9: '.###. #...# #...# .#### ....# ...#. .##..',
  ' ': '..... ..... ..... ..... ..... ..... .....',
  '.': '..... ..... ..... ..... ..... .##.. .##..',
  ',': '..... ..... ..... ..... .##.. ..#.. .#...',
  ':': '..... .##.. .##.. ..... .##.. .##.. .....',
  ';': '..... .##.. .##.. ..... .##.. ..#.. .#...',
  '!': '..#.. ..#.. ..#.. ..#.. ..#.. ..... ..#..',
  '?': '.###. #...# ....# ...#. ..#.. ..... ..#..',
  "'": '..#.. ..#.. .#... ..... ..... ..... .....',
  '"': '.#.#. .#.#. ..... ..... ..... ..... .....',
  '-': '..... ..... ..... .###. ..... ..... .....',
  _: '..... ..... ..... ..... ..... ..... #####',
  '+': '..... ..#.. ..#.. ##### ..#.. ..#.. .....',
  '=': '..... ..... ##### ..... ##### ..... .....',
  '/': '..... ....# ...#. ..#.. .#... #.... .....',
  '|': '..#.. ..#.. ..#.. ..#.. ..#.. ..#.. ..#..',
  '(': '...#. ..#.. .#... .#... .#... ..#.. ...#.',
  ')': '.#... ..#.. ...#. ...#. ...#. ..#.. .#...',
  '<': '...#. ..#.. .#... #.... .#... ..#.. ...#.',
  '>': '.#... ..#.. ...#. ....# ...#. ..#.. .#...',
  '#': '.#.#. .#.#. ##### .#.#. ##### .#.#. .#.#.',
  '*': '..... ..#.. #.#.# .###. #.#.# ..#.. .....',
  '@': '.###. #...# #.### #.#.# #.### #.... .###.',
  $: '..#.. .#### #.#.. .###. ..#.# ####. ..#..',
  '~': '..... ..... .#... #.#.# ...#. ..... .....',
  [MIDDLE_DOT]: '..... ..... ..... ..#.. ..... ..... .....',
};

const GLYPH_W = 5;
const GLYPH_H = 7;
const ADVANCE = GLYPH_W + 1; // one blank column between characters

/** Parsed font: char -> array of 7 rows, each an array of 5 booleans. */
export const FONT = new Map(
  Object.entries(GLYPHS).map(([ch, spec]) => {
    const rows = spec.split(' ');
    if (rows.length !== GLYPH_H || rows.some((r) => !/^[.#]{5}$/.test(r))) {
      throw new Error(`make-og: glyph ${JSON.stringify(ch)} is not 5x7`);
    }
    return [ch, rows.map((r) => [...r].map((c) => c === '#'))];
  }),
);

/** Width in pixels of `text` drawn at `scale`, from the first to the last inked column. */
export function textWidth(text, scale) {
  const n = [...text].length;
  return n ? (n * ADVANCE - 1) * scale : 0;
}

// ---------------------------------------------------------------------------
// Canvas: 8-bit RGB, integer rectangles plus anti-aliased round shapes.
// ---------------------------------------------------------------------------
function hexToRgb(hex) {
  const m = /^#([0-9a-f]{6})$/i.exec(hex);
  if (!m) throw new Error(`make-og: bad colour ${hex}`);
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export class Canvas {
  constructor(width, height, background) {
    this.width = width;
    this.height = height;
    this.data = new Uint8Array(width * height * 3);
    this.fillRect(0, 0, width, height, background);
  }

  /** Solid rectangle; coordinates are whole pixels and clipped to the canvas. */
  fillRect(x, y, w, h, color) {
    const [r, g, b] = hexToRgb(color);
    const x0 = Math.max(0, x);
    const y0 = Math.max(0, y);
    const x1 = Math.min(this.width, x + w);
    const y1 = Math.min(this.height, y + h);
    for (let py = y0; py < y1; py++) {
      for (let px = x0, i = (py * this.width + x0) * 3; px < x1; px++, i += 3) {
        this.data[i] = r;
        this.data[i + 1] = g;
        this.data[i + 2] = b;
      }
    }
  }

  /**
   * Anti-aliased fill of the pixels in [x0, x1) x [y0, y1): `inside(x, y)` is
   * sampled on a 4x4 grid per pixel and the colour is blended by coverage.
   */
  fillShape(x0, y0, x1, y1, inside, color) {
    const rgb = hexToRgb(color);
    const N = 4;
    for (let py = Math.max(0, y0); py < Math.min(this.height, y1); py++) {
      for (let px = Math.max(0, x0); px < Math.min(this.width, x1); px++) {
        let hits = 0;
        for (let sy = 0; sy < N; sy++) {
          for (let sx = 0; sx < N; sx++) {
            if (inside(px + (sx + 0.5) / N, py + (sy + 0.5) / N)) hits++;
          }
        }
        if (!hits) continue;
        const a = hits / (N * N);
        const i = (py * this.width + px) * 3;
        for (let c = 0; c < 3; c++) {
          this.data[i + c] = Math.round(this.data[i + c] * (1 - a) + rgb[c] * a);
        }
      }
    }
  }

  fillCircle(cx, cy, radius, color) {
    const r2 = radius * radius;
    this.fillShape(
      Math.floor(cx - radius), Math.floor(cy - radius),
      Math.ceil(cx + radius), Math.ceil(cy + radius),
      (x, y) => (x - cx) ** 2 + (y - cy) ** 2 <= r2,
      color,
    );
  }

  /** Rounded rectangle: solid body, anti-aliased quarter circles in the corners. */
  fillRoundRect(x, y, w, h, radius, color) {
    const r = Math.min(radius, Math.floor(w / 2), Math.floor(h / 2));
    this.fillRect(x + r, y, w - 2 * r, h, color);
    this.fillRect(x, y + r, r, h - 2 * r, color);
    this.fillRect(x + w - r, y + r, r, h - 2 * r, color);
    const r2 = r * r;
    for (const [cx, cy, qx, qy] of [
      [x + r, y + r, x, y],
      [x + w - r, y + r, x + w - r, y],
      [x + r, y + h - r, x, y + h - r],
      [x + w - r, y + h - r, x + w - r, y + h - r],
    ]) {
      this.fillShape(qx, qy, qx + r, qy + r, (px, py) => (px - cx) ** 2 + (py - cy) ** 2 <= r2, color);
    }
  }

  /** Draws `text` with its top-left corner at (x, y); returns the x of the next character. */
  drawText(text, x, y, scale, color) {
    for (const ch of text) {
      const glyph = FONT.get(ch);
      if (!glyph) throw new Error(`make-og: no glyph for ${JSON.stringify(ch)}`);
      glyph.forEach((row, gy) => {
        row.forEach((on, gx) => {
          if (on) this.fillRect(x + gx * scale, y + gy * scale, scale, scale, color);
        });
      });
      x += ADVANCE * scale;
    }
    return x;
  }
}

// ---------------------------------------------------------------------------
// The card: a terminal window that has just run `whoami`.
// ---------------------------------------------------------------------------
export function renderCard() {
  const cv = new Canvas(WIDTH, HEIGHT, COLOR.backdrop);
  for (let y = 12; y < HEIGHT; y += 24) {
    for (let x = 12; x < WIDTH; x += 24) cv.fillRect(x, y, 2, 2, COLOR.backdropDot);
  }

  // Window: hard drop shadow, 2px frame, title bar, screen.
  const win = { x: 48, y: 34, w: 1104, h: 548, r: 14 };
  cv.fillRoundRect(win.x, win.y + 12, win.w, win.h, win.r, COLOR.shadow);
  cv.fillRoundRect(win.x, win.y, win.w, win.h, win.r, COLOR.frame);
  const inner = { x: win.x + 2, y: win.y + 2, w: win.w - 4, h: win.h - 4, r: win.r - 2 };
  const barH = 56;
  const bodyTop = inner.y + barH + 2;
  const bodyBottom = inner.y + inner.h;
  cv.fillRoundRect(inner.x, inner.y, inner.w, inner.h, inner.r, COLOR.titlebar);
  cv.fillRoundRect(inner.x, bodyTop, inner.w, bodyBottom - bodyTop, inner.r, COLOR.screen);
  cv.fillRect(inner.x, bodyTop, inner.w, inner.r, COLOR.screen); // square the screen's top corners
  cv.fillRect(inner.x, bodyTop - 2, inner.w, 2, COLOR.frame); // divider under the title bar

  [COLOR.dotRed, COLOR.dotYellow, COLOR.dotGreen].forEach((color, i) => {
    cv.fillCircle(inner.x + 30 + i * 28, inner.y + barH / 2, 8, color);
  });
  const title = 'mei@meiorz: ~';
  const titleScale = 3;
  cv.drawText(
    title,
    inner.x + Math.round((inner.w - textWidth(title, titleScale)) / 2),
    inner.y + Math.round((barH - GLYPH_H * titleScale) / 2),
    titleScale,
    COLOR.muted,
  );

  // Screen contents. `gap` is the space above each line; the block is centred vertically.
  const lines = [
    { scale: 6, gap: 0, spans: [['mei@meiorz:~$', COLOR.prompt], [' whoami', COLOR.fg]] },
    { scale: 16, gap: 36, spans: [['Mei Okubo', COLOR.fg]] },
    { scale: 5, gap: 40, spans: [['CS student', COLOR.fg], [` ${MIDDLE_DOT} `, COLOR.muted], ['SWE intern candidate', COLOR.fg]] },
    { scale: 5, gap: 18, spans: [['www.meiorz.tech', COLOR.accent]] },
    { scale: 6, gap: 40, spans: [['mei@meiorz:~$ ', COLOR.prompt]], cursor: true },
  ];
  const padX = 56;
  const left = inner.x + padX;
  const right = inner.x + inner.w - padX;
  const blockH = lines.reduce((sum, l) => sum + l.gap + GLYPH_H * l.scale, 0);
  let y = bodyTop + Math.round((bodyBottom - bodyTop - blockH) / 2);
  for (const line of lines) {
    y += line.gap;
    let x = left;
    for (const [text, color] of line.spans) x = cv.drawText(text, x, y, line.scale, color);
    let inkRight = x - line.scale;
    if (line.cursor) {
      cv.fillRect(x, y, GLYPH_W * line.scale, GLYPH_H * line.scale, COLOR.fg);
      inkRight = x + GLYPH_W * line.scale;
    }
    if (inkRight > right) throw new Error(`make-og: line ${JSON.stringify(line.spans.map((s) => s[0]).join(''))} overflows`);
    y += GLYPH_H * line.scale;
  }
  return cv;
}

// ---------------------------------------------------------------------------
// PNG encoder: 8-bit truecolour, adaptive per-row filters, zlib-deflated IDAT.
// ---------------------------------------------------------------------------
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function chunk(type, body) {
  if (typeof zlib.crc32 !== 'function') throw new Error('make-og: needs zlib.crc32 (Node 20.15+ or 22.2+)');
  const head = Buffer.alloc(8);
  head.writeUInt32BE(body.length, 0);
  head.write(type, 4, 'latin1');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(zlib.crc32(body, zlib.crc32(head.subarray(4))) >>> 0, 0);
  return Buffer.concat([head, body, crc]);
}

function paeth(a, b, c) {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
}

export function encodePng({ width, height, data }) {
  const bpp = 3;
  const stride = width * bpp;
  const raw = Buffer.alloc((stride + 1) * height);
  const zeros = new Uint8Array(stride);
  const trial = Array.from({ length: 5 }, () => new Uint8Array(stride));
  for (let y = 0; y < height; y++) {
    const row = data.subarray(y * stride, (y + 1) * stride);
    const up = y ? data.subarray((y - 1) * stride, y * stride) : zeros;
    // Try all five filters; keep the one with the smallest sum of |signed bytes| (the libpng heuristic).
    let best = 0;
    let bestScore = Infinity;
    for (let f = 0; f < 5; f++) {
      const out = trial[f];
      let score = 0;
      for (let i = 0; i < stride; i++) {
        const a = i >= bpp ? row[i - bpp] : 0;
        const b = up[i];
        const c = i >= bpp ? up[i - bpp] : 0;
        const pred = f === 0 ? 0 : f === 1 ? a : f === 2 ? b : f === 3 ? (a + b) >> 1 : paeth(a, b, c);
        const v = (row[i] - pred) & 0xff;
        out[i] = v;
        score += v < 128 ? v : 256 - v;
      }
      if (score < bestScore) {
        bestScore = score;
        best = f;
      }
    }
    const at = y * (stride + 1);
    raw[at] = best;
    raw.set(trial[best], at + 1);
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // colour type: truecolour RGB
  ihdr[10] = 0; // compression: deflate
  ihdr[11] = 0; // filter method: adaptive
  ihdr[12] = 0; // no interlace
  return Buffer.concat([
    PNG_SIGNATURE,
    chunk('IHDR', ihdr),
    chunk('sRGB', Buffer.from([0])), // perceptual rendering intent
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

function main() {
  const out = process.argv[2]
    ? resolve(process.argv[2])
    : fileURLToPath(new URL('../site/img/og.png', import.meta.url));
  const png = encodePng(renderCard());
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, png);
  console.log(`make-og: wrote ${out} (${WIDTH}x${HEIGHT}, ${(png.length / 1024).toFixed(1)} KB)`);
  if (png.length > BUDGET_BYTES) {
    console.error(`make-og: ${png.length} bytes is over the ${BUDGET_BYTES}-byte budget`);
    process.exitCode = 1;
  }
}

// Run when executed directly; stay quiet when imported (e.g. to reuse the font).
const isMain = import.meta.main ?? (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href);
if (isMain) main();
