--!strict
-- obbycourse.luau: the course for Mei's Mini Obby.
--
-- A Luau-flavored data module; this site's game parses it at runtime.
-- The website (www.meiorz.tech, command `obby`) fetches this exact file and reads
-- the `course` table with a small JavaScript reader (js/luau-table.js). The game
-- itself is written in JavaScript (js/obby.js); nothing here is executed. So keep
-- the table plain data: tables, strings, numbers, true/false and comments.
--
-- Units are studs and studs per second; the web game converts them to cells and
-- 12 Hz ticks:
--   conveyor  15 studs/s over 2.5-stud cells = 6 cells/s = 1 cell every 2 ticks
--   jumppad   100 studs/s up, gravity 196.2 studs/s^2: apex ~25.5 studs, about 10 cells
--
-- GRID: rows[1] is the top row. One character is one cell; "." is air.
-- Columns are 1-based, as in Luau. The "#" posts above checkpoints 2-4 are gates:
-- the only way into the next stage is through its checkpoint.
--
-- tools/check-obby.mjs (in the site's repository) lints this file's structure and
-- types (a small zero-dependency lint, not a Luau compiler) and proves with a
-- breadth-first search over the game's own physics that the course can be
-- finished, that no checkpoint can be skipped and that no spot leaves a player stuck.

export type TileKind = "solid" | "kill" | "conveyor" | "jumppad" | "checkpoint" | "finish"

export type Tile = {
  char: string, -- the one character used in `rows`
  kind: TileKind,
  color: string, -- "#rrggbb" (the web uses its own theme colors)
  speed: number?, -- conveyor: studs/s along X (negative pushes left); jumppad: launch studs/s up
  stage: number? -- checkpoint: the stage it starts; finish: stage count + 1
}

export type Stage = {
  id: number,
  name: string,
  fromCol: number, -- first column of the stage (inclusive)
  toCol: number, -- last column of the stage (inclusive)
  hint: string
}

export type Course = {
  name: string,
  version: number,
  width: number,
  height: number,
  cellStuds: number, -- studs per cell
  tiles: { Tile },
  stages: { Stage },
  rows: { string }
}

local course: Course = {
  name = "Mei's Mini Obby",
  version = 1,
  width = 60,
  height = 14,
  cellStuds = 2.5,

  tiles = {
    { char = "#", kind = "solid", color = "#8a94a6" },
    { char = "^", kind = "kill", color = "#ff4d4d" },
    { char = "<", kind = "conveyor", color = "#f2b33d", speed = -15 },
    { char = ">", kind = "conveyor", color = "#f2b33d", speed = 15 },
    { char = "J", kind = "jumppad", color = "#3dd6f2", speed = 100 },
    { char = "1", kind = "checkpoint", color = "#4ade80", stage = 1 },
    { char = "2", kind = "checkpoint", color = "#4ade80", stage = 2 },
    { char = "3", kind = "checkpoint", color = "#4ade80", stage = 3 },
    { char = "4", kind = "checkpoint", color = "#4ade80", stage = 4 },
    { char = "F", kind = "finish", color = "#c084fc", stage = 5 },
  },

  stages = {
    { id = 1, name = "Hello, World Hills", fromCol = 1, toCol = 16, hint = "Hop the lava. Every program starts somewhere." },
    { id = 2, name = "Garbage Collector Conveyor", fromCol = 17, toCol = 30, hint = "The belt drags you back. Jump the lava." },
    { id = 3, name = "Jump-And-Link", fromCol = 31, toCol = 41, hint = "Step on J. jal saves a return address; gravity does not." },
    { id = 4, name = "Branch Delay Summit", fromCol = 42, toCol = 60, hint = "Climb to F, the finish. Mind the delay slot." },
  },

  rows = {
    ".........................................#..................", -- 1 (top)
    ".........................................#................F.", -- 2
    ".........................................#..............####", -- 3
    "................#........................#..................", -- 4
    "................#........................#.........>>>......", -- 5
    "................#........................4...^..............", -- 6
    "................#....................###########............", -- 7
    "................#.............#.............................", -- 8
    "................#.............#.............................", -- 9
    "...........##...#.............#.............................", -- 10
    "................#.............#.............................", -- 11
    ".......##.......#.............#.............................", -- 12
    ".1..............2.....^..^....3.............................", -- 13
    "#####^^^^^^^^^#####<<<<<<<<<######J^^^^^^^^^^^^^^^^^^^^^^^^^", -- 14 (bottom)
  },
}

return course
