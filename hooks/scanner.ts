// A Larson scanner (the Cylon look) for one row of terminal cells.
//
// Working: a red orb sweeps the full width, flared ahead of it and tapering into
// a long trail behind, the line stepping thinner as it cools. Each time it reaches
// an edge its speed drifts a little. When work starts it launches straight into a
// full sweep, so its first pass reaches the edge. Idle: the sweep narrows and slows
// into the center (each swing falls shorter than the last), the color cools through
// violet to cyan, and once it settles the orb breathes.
//
// Pure: no Claude Code imports, so it can be previewed and tested anywhere.

/** Milliseconds per frame. */
export const FRAME_MS = 33

/** One full left-right-left sweep while working, at the default speed. */
const SWEEP_PERIOD_S = 2.4
/** The most the speed may change at an edge, as a share of itself. */
const SPEED_STEP = 0.05
/** How far the speed may drift from the default, as a share of it. */
const SPEED_RANGE = 0.3
/** How quickly the sweep narrows once work stops. */
const SETTLE_S = 0.9
/** How quickly the orb gets up to full speed when it launches. */
const LAUNCH_S = 0.2
/** How long the trail glows behind the orb. */
const TRAIL_S = 0.35
/** One breath while resting. */
const PULSE_PERIOD_S = 2.6

/** Hues, in degrees. The cooling runs red, magenta, violet, blue, cyan. */
const HUE_WORKING = 360
const HUE_IDLE = 185
/** How far toward orange (or, cooled, blue) the core's center leans. */
const CORE_HUE_SHIFT = 20

/** How bright the flare must be for the line to step up to each thickness. */
const FLARE_THICK = 0.55
const FLARE_HEAVY = 0.3

/** The terminal's default color, as a Raster cell takes it. */
export const DEFAULT_COLOR = 0x01000000
// ─ ━ ▬ █ ▌ ▐
const GLYPH = { thin: 0x2500, heavy: 0x2501, thick: 0x25ac, full: 0x2588, left: 0x258c, right: 0x2590 } as const

type RGB = readonly [number, number, number]

export interface Scanner {
  /** How much of the full sweep the orb covers, 0 to 1. */
  amp: number
  /** Where the orb is in its sweep, radians. */
  phase: number
  /** How fast the phase turns, as a share of full speed. */
  spin: number
  /** Full speed, as a share of the default. */
  speed: number
  /** 0 red (working), 1 cyan (idle). */
  tint: number
  /** How much the orb breathes, 0 to 1. */
  pulse: number
  /** Seconds since the scanner started. */
  time: number
  /** The orb's position last frame, in cells. */
  lastX: number | undefined
  /** Trail brightness per cell, 0 to 1. */
  heat: number[]
}

/** A scanner at rest: cyan, centered, breathing (sessions start idle). */
export function createScanner(): Scanner {
  return { amp: 0, phase: 0, spin: 0.3, speed: 1, tint: 1, pulse: 1, time: 0, lastX: undefined, heat: [] }
}

/** Where the orb is, in cells from the left edge. */
export function orbX(s: Scanner, width: number): number {
  const center = (width - 1) / 2
  return center + Math.max(0, center - 1) * s.amp * Math.sin(s.phase)
}

/**
 * Goes straight to a full sweep without moving the orb: same position, same
 * direction (toward the farther edge from rest), so the first pass reaches the edge.
 */
function launch(s: Scanner): void {
  const offset = s.amp * Math.sin(s.phase) // where it is, -1 (left) to 1 (right)
  const velocity = s.amp * Math.cos(s.phase)
  const direction = Math.abs(velocity) > 0.05 ? Math.sign(velocity) : offset <= 0 ? 1 : -1
  const angle = Math.asin(Math.max(-1, Math.min(1, offset)))
  s.phase = direction > 0 ? angle : Math.PI - angle
  s.amp = 1
}

/**
 * The speed after an edge: up to `SPEED_STEP` either way, `random` (0 to 1) saying
 * how far, held within `SPEED_RANGE` of the default.
 */
export function nextSpeed(speed: number, random: number): number {
  const changed = speed * (1 + SPEED_STEP * (2 * random - 1))
  return Math.min(1 + SPEED_RANGE, Math.max(1 - SPEED_RANGE, changed))
}

/** True when a step of the phase crosses an edge, where the sine peaks. */
function reachesEdge(from: number, to: number): boolean {
  return Math.floor(from / Math.PI - 0.5) !== Math.floor(to / Math.PI - 0.5)
}

/** Advances the scanner by `dt` seconds. `random` picks each change of speed. */
export function stepScanner(
  s: Scanner,
  dt: number,
  working: boolean,
  width: number,
  random: () => number = Math.random,
): void {
  dt = Math.min(Math.max(dt, 0), 0.25)
  s.time += dt
  const ease = (tau: number) => 1 - Math.exp(-dt / tau)

  if (working) {
    if (s.amp < 1) launch(s)
    s.spin += (1 - s.spin) * ease(LAUNCH_S)
    s.tint -= s.tint * ease(0.15)
  } else {
    // Each swing falls shorter than the last, and slower: it settles in the middle.
    s.amp -= s.amp * ease(SETTLE_S)
    if (s.amp < 0.002) s.amp = 0
    s.spin = 0.3 + 0.7 * s.amp
    // It cools as it settles, and stays cool while idle.
    s.tint = Math.max(s.tint, 1 - s.amp)
  }
  const resting = !working && s.amp < 0.03
  s.pulse += ((resting ? 1 : 0) - s.pulse) * ease(resting ? 0.6 : 0.12)
  const phase = s.phase + ((dt * 2 * Math.PI) / SWEEP_PERIOD_S) * s.spin * s.speed
  if (working && reachesEdge(s.phase, phase)) s.speed = nextSpeed(s.speed, random())
  s.phase = phase % (2 * Math.PI)

  if (s.heat.length !== width) {
    s.heat = new Array(width).fill(0)
    s.lastX = undefined
  }
  const fade = Math.exp(-dt / TRAIL_S)
  for (let i = 0; i < width; i++) s.heat[i]! *= fade
  // Light every cell the orb crossed since last frame, so a fast sweep leaves no gaps.
  const x = orbX(s, width)
  const from = s.lastX ?? x
  const [lo, hi] = [Math.min(from, x), Math.max(from, x)]
  for (let i = Math.max(0, Math.floor(lo)); i <= Math.min(width - 1, Math.ceil(hi)); i++) s.heat[i] = 1
  s.lastX = x
}

/** The row as Raster cells: `[codePoint, foreground, background]` per cell. */
export function renderCells(s: Scanner, width: number): Uint32Array {
  const cells = new Uint32Array(width * 3)
  const x = orbX(s, width)
  const hue = HUE_WORKING - (HUE_WORKING - HUE_IDLE) * s.tint
  const palette = {
    core: hsv(hue + CORE_HUE_SHIFT, 0.45, 1), // the orb's white-hot center
    hot: hsv(hue, 1, 1), // its edges, and the flare
    track: hsv(hue, 1, 0.22), // the unlit line
  }

  // Breathing: brighter and wider on the in-breath, dimmer and tighter on the out.
  const breath = 0.5 - 0.5 * Math.cos((2 * Math.PI * s.time) / PULSE_PERIOD_S)
  const bright = 1 - s.pulse * 0.5 * (1 - breath)
  const radius = 3 - s.pulse * (1.25 - breath) // half-width of the solid orb, in cells
  const sigma = 4.5 + s.pulse * (4 * breath - 1.5) // the flare around it

  for (let i = 0; i < width; i++) {
    const d = i - x
    const glow = Math.exp(-(d * d) / (2 * sigma * sigma)) * bright
    const trail = (s.heat[i] ?? 0) * (1 - s.pulse)
    const left = Math.abs(i - 0.25 - x) <= radius
    const right = Math.abs(i + 0.25 - x) <= radius

    let glyph: number
    let color: RGB
    if (left || right) {
      // The orb: white-hot at its center, its own color at its edges.
      glyph = left && right ? GLYPH.full : left ? GLYPH.left : GLYPH.right
      const heat = Math.max(0, 1 - Math.abs(d) / (radius + 0.5))
      color = scale(mix(palette.hot, palette.core, heat * heat), 0.35 + 0.65 * bright)
    } else {
      // The flare: the brighter it burns, the thicker the line.
      const flare = Math.min(1, Math.max(glow, trail))
      glyph = flare > FLARE_THICK ? GLYPH.thick : flare > FLARE_HEAVY ? GLYPH.heavy : GLYPH.thin
      color = mix(palette.track, palette.hot, Math.sqrt(flare))
    }
    cells[i * 3] = glyph
    cells[i * 3 + 1] = (Math.round(color[0]) << 16) | (Math.round(color[1]) << 8) | Math.round(color[2])
    cells[i * 3 + 2] = DEFAULT_COLOR
  }
  return cells
}

function mix(a: RGB, b: RGB, t: number): RGB {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]
}

function scale(c: RGB, k: number): RGB {
  return [c[0] * k, c[1] * k, c[2] * k]
}

/** A color from hue (degrees), saturation and value (0 to 1). */
function hsv(h: number, s: number, v: number): RGB {
  const f = (n: number) => {
    const k = (n + h / 60) % 6
    return 255 * (v - v * s * Math.max(0, Math.min(k, 4 - k, 1)))
  }
  return [f(5), f(3), f(1)]
}
