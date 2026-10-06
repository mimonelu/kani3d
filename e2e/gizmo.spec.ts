import { expect, test, type Page } from '@playwright/test'

type Pt = { x: number; y: number }
const handles = (page: Page) => page.evaluate(() => (window as any).__kani.debugHandleScreen() as Record<string, Pt>)
const bounds = (page: Page) =>
  page.evaluate(() => (window as any).__kani.selectionBounds() as { min: number[]; max: number[] })
const quat = (page: Page) => page.evaluate(() => (window as any).__kani.toData()[0].quaternion as number[])

async function drag(page: Page, from: Pt, to: Pt, shift = false) {
  await page.mouse.move(from.x, from.y)
  if (shift) await page.keyboard.down('Shift')
  await page.mouse.down()
  for (let i = 1; i <= 10; i++) await page.mouse.move(from.x + ((to.x - from.x) * i) / 10, from.y + ((to.y - from.y) * i) / 10)
  await page.mouse.up()
  if (shift) await page.keyboard.up('Shift')
}

/** 5cm スナップ単位に乗っているか */
const onGrid = (v: number) => Math.abs(v * 20 - Math.round(v * 20)) < 1e-3

test.beforeEach(async ({ page }) => {
  await page.goto('/')
  await page.evaluate(() => localStorage.clear())
  await page.reload()
  await page.waitForFunction(() => (window as any).__kani)
  await page.evaluate(() => (window as any).__kani.addPrimitive('cube'))
})

test('天面ハンドルで高さだけ伸び、底面は固定', async ({ page }) => {
  const h = (await handles(page))['scale:0,1,0']
  await drag(page, h, { x: h.x, y: h.y - 120 })
  const b = await bounds(page)
  expect(b.min).toEqual([-0.05, 0, -0.05])
  expect(b.max[1]).toBeGreaterThan(0.12)
  expect(onGrid(b.max[1])).toBe(true)
  expect(b.max[0]).toBeCloseTo(0.05)
})

test('角ハンドルは反対の角を固定して X/Z を伸縮', async ({ page }) => {
  const hs = await handles(page)
  const h = hs['scale:1,-1,1']
  const away = { x: h.x + (h.x - hs['scale:-1,-1,-1'].x) * 0.6, y: h.y + (h.y - hs['scale:-1,-1,-1'].y) * 0.6 }
  await drag(page, h, away)
  const b = await bounds(page)
  expect(b.min).toEqual([-0.05, 0, -0.05]) // 反対角は動かない
  expect(b.max[0]).toBeGreaterThan(0.08)
  expect(b.max[2]).toBeGreaterThan(0.08)
  expect(b.max[1]).toBeCloseTo(0.1) // 高さは不変
  for (const v of [...b.min, ...b.max]) expect(onGrid(v)).toBe(true)
})

test('Shift+角ハンドルで等倍拡大（接地を保つ）', async ({ page }) => {
  const hs = await handles(page)
  const h = hs['scale:1,-1,1']
  const away = { x: h.x + (h.x - hs['scale:-1,-1,-1'].x) * 0.6, y: h.y + (h.y - hs['scale:-1,-1,-1'].y) * 0.6 }
  await drag(page, h, away, true)
  const b = await bounds(page)
  const size = b.max.map((v, i) => v - b.min[i])
  expect(size[0]).toBeCloseTo(size[1], 3)
  expect(size[1]).toBeCloseTo(size[2], 3)
  expect(b.min[1]).toBeCloseTo(0)
})

test('本体ドラッグで床と平行に移動しスナップ', async ({ page }) => {
  const box = (await page.locator('canvas').boundingBox())!
  const hs = await handles(page)
  // 天面中央と底面中央の中点 = 本体の中心
  const bottom = { x: (hs['scale:1,-1,1'].x + hs['scale:-1,-1,-1'].x) / 2, y: (hs['scale:1,-1,1'].y + hs['scale:-1,-1,-1'].y) / 2 }
  const c = { x: (hs['scale:0,1,0'].x + bottom.x) / 2, y: (hs['scale:0,1,0'].y + bottom.y) / 2 }
  await drag(page, c, { x: c.x + box.width * 0.15, y: c.y })
  const b = await bounds(page)
  expect(b.min[0]).toBeGreaterThan(0)
  expect(b.min[1]).toBeCloseTo(0)
  for (const v of b.min) expect(onGrid(v)).toBe(true)
})

test('持ち上げハンドルで上下移動', async ({ page }) => {
  const h = (await handles(page))['lift']
  await drag(page, h, { x: h.x, y: h.y - 100 })
  const b = await bounds(page)
  expect(b.min[1]).toBeGreaterThan(0.02)
  expect(onGrid(b.min[1])).toBe(true)
})

test('回転円弧で 45° 刻みに回転', async ({ page }) => {
  const h = (await handles(page))['rotate:y']
  await drag(page, h, { x: h.x + 150, y: h.y - 60 })
  const q = await quat(page)
  const angle = 2 * Math.acos(Math.min(1, Math.abs(q[3])))
  expect(angle).toBeGreaterThan(0.1)
  expect(Math.abs(angle / (Math.PI / 4) - Math.round(angle / (Math.PI / 4)))).toBeLessThan(1e-3)
  expect(Math.abs(q[0]) + Math.abs(q[2])).toBeLessThan(1e-6) // Y 軸まわりのみ
})

test('回転円弧のドラッグでも回転中心は動かない', async ({ page }) => {
  await page.evaluate(() => {
    const k = (window as any).__kani
    k.newScene()
    k.addPrimitive('wedge')
  })
  const center = () => page.evaluate(() => (window as any).__kani.gizmo.rotationCenter().toArray() as number[])
  const c0 = await center()
  for (const axis of ['y', 'x', 'z', 'y']) {
    const h = (await handles(page))[`rotate:${axis}`]
    await drag(page, h, { x: h.x + 120, y: h.y - 70 })
  }
  const c1 = await center()
  for (let i = 0; i < 3; i++) expect(c1[i]).toBeCloseTo(c0[i], 6)
})
