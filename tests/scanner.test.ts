import { expect, test } from 'claude-code/testing'

import { createScanner, nextSpeed, renderCells, stepScanner } from '../hooks/scanner'

const WIDTH = 100
const DT = 1 / 30

test('a change of speed is at most 5% either way', () => {
  expect(Math.abs(nextSpeed(1, 0) - 0.95)).toBeLessThan(1e-9)
  expect(Math.abs(nextSpeed(1, 0.5) - 1)).toBeLessThan(1e-9)
  expect(Math.abs(nextSpeed(1, 1) - 1.05)).toBeLessThan(1e-9)
})

test('the speed stays within 30% of the default', () => {
  expect(Math.abs(nextSpeed(1.29, 1) - 1.3)).toBeLessThan(1e-9)
  expect(Math.abs(nextSpeed(0.71, 0) - 0.7)).toBeLessThan(1e-9)
})

test('the default sweep is 2.4 seconds, reaching an edge every 1.2', () => {
  const s = createScanner()
  const edges: number[] = []
  // A draw of 0.5 changes nothing, so this counts edges at the default speed.
  for (let t = 0; t < 30; t += DT) {
    stepScanner(s, DT, true, WIDTH, () => {
      edges.push(t)
      return 0.5
    })
  }
  const gaps = edges.slice(1).map((edge, i) => edge - edges[i]!)
  expect(gaps.length).toBeGreaterThan(20)
  for (const gap of gaps) expect(Math.abs(gap - 1.2)).toBeLessThan(0.05)
  expect(s.speed).toBe(1)
})

test('the speed changes at every edge and never leaves its bounds', () => {
  const s = createScanner()
  let changes = 0
  let previous = s.speed
  for (let t = 0; t < 600; t += DT) {
    stepScanner(s, DT, true, WIDTH, () => {
      changes++
      return Math.random()
    })
    expect(s.speed).toBeGreaterThanOrEqual(0.7)
    expect(s.speed).toBeLessThanOrEqual(1.3)
    expect(Math.abs(s.speed / previous - 1)).toBeLessThanOrEqual(0.0501)
    previous = s.speed
  }
  expect(changes).toBeGreaterThan(300)
})

test('swings that fall short of the edge change nothing', () => {
  const s = createScanner()
  let changes = 0
  for (let t = 0; t < 5; t += DT) stepScanner(s, DT, true, WIDTH)
  const speed = s.speed
  for (let t = 0; t < 10; t += DT) {
    stepScanner(s, DT, false, WIDTH, () => {
      changes++
      return 1
    })
  }
  expect(changes).toBe(0)
  expect(s.speed).toBe(speed)
})

test('the line steps thinner along the trail', () => {
  const s = createScanner()
  for (let t = 0; t < 3.3; t += DT) stepScanner(s, DT, true, WIDTH, () => 0.5)
  const cells = renderCells(s, WIDTH)
  const glyphs = new Set<number>()
  for (let i = 0; i < WIDTH; i++) glyphs.add(cells[i * 3]!)
  for (const glyph of [0x2588, 0x25ac, 0x2501, 0x2500]) expect(glyphs.has(glyph)).toBe(true)
})
