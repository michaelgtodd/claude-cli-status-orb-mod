// A Larson scanner (the Cylon look) for one row of terminal cells.
//
// Working: a red orb sweeps the full width with a glowing trail behind it. When
// work starts it launches straight into a full sweep, so its first pass reaches
// the edge. Idle: the sweep narrows and slows into the center (each swing falls
// shorter than the last), the color cools through violet to cyan, and once it
// settles the orb breathes.
//
// Pure: no Claude Code imports, so it can be previewed and tested anywhere.

/** Milliseconds per frame. */
export const FRAME_MS = 33

/** One full left-right-left sweep while working. */
const SWEEP_PERIOD_S = 1.8
/** How quickly the sweep narrows once work stops. */
const SETTLE_S = 0.9
/** How quickly the orb gets up to full speed when it launches. */
const LAUNCH_S = 0.2
/** How long the trail glows behind the orb. */
const TRAIL_S = 0.3
/** One breath while resting. */
const PULSE_PERIOD_S = 2.6

/** Hues, in degrees. The cooling runs red, magenta, violet, blue, cyan. */
const HUE_WORKING = 360
const HUE_IDLE = 185

/** The terminal's default color, as a Raster cell takes it. */
export const DEFAULT_COLOR = 0x01000000
const GLYPH = { line: 0x2501, full: 0x2588, left: 0x258c, right: 0x2590 } as const // ━ █ ▌ ▐

type RGB = readonly [number, number, number]

export interface Scanner {
  /** How much of the full sweep the orb covers, 0 to 1. */
  amp: number
  /** Where the orb is in its sweep, radians. */
  phase: number
  /** How fast the phase turns, as a share of full speed. */
  spin: number
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
  return { amp: 0, phase: 0, spin: 0.3, tint: 1, pulse: 1, time: 0, lastX: undefined, heat: [] }
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

/** Advances the scanner by `dt` seconds. */
export function stepScanner(s: Scanner, dt: number, working: boolean, width: number): void {
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
  s.phase = (s.phase + ((dt * 2 * Math.PI) / SWEEP_PERIOD_S) * s.spin) % (2 * Math.PI)

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
    core: hsv(hue, 0.3, 1), // the orb's white-hot center
    hot: hsv(hue, 1, 1), // its edges, and the glow
    track: hsv(hue, 1, 0.32), // the unlit line
  }

  // Breathing: brighter and wider on the in-breath, dimmer and tighter on the out.
  const breath = 0.5 - 0.5 * Math.cos((2 * Math.PI * s.time) / PULSE_PERIOD_S)
  const bright = 1 - s.pulse * 0.5 * (1 - breath)
  const radius = 1.75 + s.pulse * 1 * breath // half-width of the solid orb, in cells
  const sigma = 3 + s.pulse * 4 * breath // the glow around it

  for (let i = 0; i < width; i++) {
    const d = i - x
    const glow = Math.exp(-(d * d) / (2 * sigma * sigma)) * bright
    const trail = (s.heat[i] ?? 0) * 0.85 * (1 - s.pulse)
    const left = Math.abs(i - 0.25 - x) <= radius
    const right = Math.abs(i + 0.25 - x) <= radius

    let glyph: number = GLYPH.line
    let color: RGB
    if (left || right) {
      // The orb: white-hot at its center, its own color at its edges.
      glyph = left && right ? GLYPH.full : left ? GLYPH.left : GLYPH.right
      const heat = Math.max(0, 1 - Math.abs(d) / (radius + 0.5))
      color = scale(mix(palette.hot, palette.core, heat * heat), 0.35 + 0.65 * bright)
    } else {
      color = mix(palette.track, palette.hot, Math.min(1, Math.max(glow, trail)))
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
