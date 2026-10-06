import { expect, test, type Page } from '@playwright/test'
import { readFile } from 'node:fs/promises'

/** window.__kani（Editor インスタンス）経由でシーンデータを取得 */
const sceneData = (page: Page) =>
  page.evaluate(() => (window as any).__kani.toData() as { kind: string; position: number[]; color?: number }[])

test.beforeEach(async ({ page }) => {
  await page.goto('/')
  await page.evaluate(() => localStorage.clear())
  await page.reload()
  await page.waitForFunction(() => (window as any).__kani)
})

test('プリミティブ追加・積み上げ・色変更・Undo', async ({ page }) => {
  const cube = page.locator('[data-primitive="cube"]')
  await cube.click()
  await cube.click() // 選択中の上に積まれる
  let data = await sceneData(page)
  expect(data.map((d) => d.position[1])).toEqual([0.1, 0.3])

  await page.locator('[data-color="0"]').click()
  data = await sceneData(page)
  expect(data[1].color).toBe(0)

  await page.getByRole('button', { name: '元に戻す' }).click()
  expect((await sceneData(page))[1].color).not.toBe(0)
})

test('ドラッグ&ドロップで配置（オブジェクト上なら天面に積む）', async ({ page }) => {
  const canvas = page.locator('canvas')
  const box = (await canvas.boundingBox())!
  const center = { x: box.width / 2, y: box.height / 2 }
  await page.locator('[data-primitive="cube"]').dragTo(canvas, { targetPosition: { x: 40, y: box.height - 60 } })
  await page.keyboard.press('Escape')
  await page.locator('[data-primitive="cube"]').click() // 注視点（画面中央）の床に1つ
  await page.locator('[data-primitive="wedge"]').dragTo(canvas, { targetPosition: center })
  const data = await sceneData(page)
  expect(data).toHaveLength(3)
  expect(data[0].position[1]).toBeCloseTo(0.1)
  expect(data[2].position[1]).toBeCloseTo(0.3) // 立方体の上
})

test('キーボード操作はグリッドにスナップする', async ({ page }) => {
  await page.locator('[data-primitive="cube"]').click()
  await page.keyboard.press('ArrowRight')
  await page.keyboard.press('ArrowRight')
  await page.keyboard.press('PageUp')
  let b = await page.evaluate(() => (window as any).__kani.selectionBounds())
  expect(b.min).toEqual([0.1, 0.1, -0.1])
  await page.keyboard.press('y') // 45° 回転してもバウンディングボックス最小点は格子上
  b = await page.evaluate(() => (window as any).__kani.selectionBounds())
  for (const v of b.min) expect(Math.abs(v * 10 - Math.round(v * 10))).toBeLessThan(1e-3)
  expect(b.max[0] - b.min[0]).toBeCloseTo(0.2 * Math.SQRT2, 3)
})

test('クリックで選択解除・全選択・結合', async ({ page }) => {
  await page.evaluate(() => {
    const k = (window as any).__kani
    k.addPrimitive('cube')
    k.setSelection([])
    k.addPrimitive('cylinder')
    k.nudge(1, 0, 0)
    k.setColor(0)
    k.setSelection([])
  })
  // 画面上で全選択して結合
  await page.locator('canvas').click({ position: { x: 20, y: 400 } })
  await page.keyboard.press('Control+a')
  await page.keyboard.press('Control+g')
  const data = await sceneData(page)
  expect(data).toHaveLength(1)
  expect(data[0].kind).toBe('mesh')
  const groups = await page.evaluate(() => (window as any).__kani.toData()[0].mesh.groups.map((g: any) => g.color))
  expect(groups.sort()).toEqual([0, 6])
})

test('保存→読み込み、GLB 出力', async ({ page }) => {
  await page.locator('[data-primitive="sphere"]').click()
  await page.locator('[data-primitive="cone"]').click()

  const [save] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: '保存' }).click()])
  const savedPath = await save.path()
  const saved = JSON.parse(await readFile(savedPath, 'utf8'))
  expect(saved.format).toBe('kani3d')
  expect(saved.objects).toHaveLength(2)

  page.once('dialog', (d) => d.accept())
  await page.getByRole('button', { name: '新規' }).click()
  expect(await sceneData(page)).toHaveLength(0)

  await page.locator('input[type=file]').setInputFiles(savedPath)
  await expect.poll(async () => (await sceneData(page)).length).toBe(2)

  const [glb] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'GLB出力' }).click()])
  expect(glb.suggestedFilename()).toMatch(/\.glb$/)
  const buf = await readFile(await glb.path())
  expect(buf.subarray(0, 4).toString()).toBe('glTF')
})
