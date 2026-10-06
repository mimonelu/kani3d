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
  // 位置は float32 頂点基準の外枠スナップなので 1e-9 程度の誤差を許容
  expect(data.map((d) => d.position[1])).toEqual([expect.closeTo(0.05, 6), expect.closeTo(0.15, 6)])

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
  expect(data[0].position[1]).toBeCloseTo(0.05)
  expect(data[2].position[1]).toBeCloseTo(0.15) // 立方体の上
})

test('キーボード操作は 5cm 単位、回転は中心が動かない', async ({ page }) => {
  await page.locator('[data-primitive="cube"]').click()
  await page.keyboard.press('ArrowRight')
  await page.keyboard.press('ArrowRight')
  await page.keyboard.press('PageUp')
  let b = await page.evaluate(() => (window as any).__kani.selectionBounds())
  expect(b.min).toEqual([0.05, 0.05, -0.05])
  await page.keyboard.press('y') // 45° 回転
  b = await page.evaluate(() => (window as any).__kani.selectionBounds())
  expect((b.min[0] + b.max[0]) / 2).toBeCloseTo(0.1, 6)
  expect(b.max[0] - b.min[0]).toBeCloseTo(0.1 * Math.SQRT2, 3)
})

test('非対称な形状を何度回転しても回転中心がずれない', async ({ page }) => {
  await page.evaluate(() => (window as any).__kani.addPrimitive('wedge'))
  const center = () => page.evaluate(() => (window as any).__kani.gizmo.rotationCenter().toArray() as number[])
  const c0 = await center()
  for (const k of ['y', 'y', 'x', 'z', 'Shift+Y', 'y', 'y', 'y', 'y', 'y', 'y']) await page.keyboard.press(k)
  const c1 = await center()
  for (let i = 0; i < 3; i++) expect(c1[i]).toBeCloseTo(c0[i], 6)
})

test('フラット表示は全体の見た目のみ切り替え、既定はフラット', async ({ page }) => {
  await page.locator('[data-primitive="prism"]').click()
  const btn = page.getByRole('button', { name: 'フラット表示' })
  const flat = () => page.evaluate(() => (window as any).__kani.scene.getObjectByName('柱').material[0].flatShading)
  await expect(btn).toHaveClass(/active/)
  expect(await flat()).toBe(true)
  const before = JSON.stringify(await sceneData(page))
  await btn.click()
  await expect(btn).not.toHaveClass(/active/)
  expect(await flat()).toBe(false)
  expect(JSON.stringify(await sceneData(page))).toBe(before) // データは変わらない
  await page.reload()
  await expect(page.getByRole('button', { name: 'フラット表示' })).not.toHaveClass(/active/) // 設定は記憶
})

test('結合解除: 結合後の移動・色変更を引き継いで元に戻る', async ({ page }) => {
  await page.evaluate(() => {
    const k = (window as any).__kani
    k.addPrimitive('cube')
    k.setSelection([])
    k.addPrimitive('cone')
    k.nudge(2, 0, 0)
    k.selectAll()
    k.mergeSelected()
    k.nudge(0, 0, 4) // 結合後に 20cm 移動
    k.setColor(0)
  })
  await expect(page.getByRole('button', { name: '結合解除' })).toBeEnabled() // 結合物 1 つ選択 → 結合解除
  await page.getByRole('button', { name: '結合解除' }).click()
  const data = await sceneData(page)
  expect(data.map((d: any) => d.primitive).sort()).toEqual(['cone', 'cube'])
  const cube = data.find((d: any) => d.primitive === 'cube')!
  expect(cube.position.map((v) => +v.toFixed(4))).toEqual([0, 0.05, 0.2])
  expect(data.every((d) => d.color === 0)).toBe(true)
  await expect(page.getByRole('button', { name: '結合', exact: true })).toBeEnabled() // 2 つ選択 → 結合
  await page.keyboard.press('Control+z')
  expect(await sceneData(page)).toHaveLength(1)
})

test('前回の状態から起動するとカメラが全オブジェクトを映す', async ({ page }) => {
  await page.evaluate(() => {
    const k = (window as any).__kani
    k.addPrimitive('cube')
    k.nudge(30, 0, 30) // 1.5m 先
    k.setSelection([])
    k.addPrimitive('prism')
    k.nudge(-10, 0, 0)
  })
  await page.waitForTimeout(400) // 自動保存の待ち
  await page.reload()
  await page.waitForFunction(() => (window as any).__kani)
  const visible = await page.evaluate(() => {
    const k = (window as any).__kani
    const cam = k.camera
    cam.updateMatrixWorld()
    return k.scene.children
      .find((c: any) => c.children.some((m: any) => m.isMesh && m.userData.id))
      .children.every((m: any) => {
        const p = m.position.clone().project(cam)
        return Math.abs(p.x) < 1 && Math.abs(p.y) < 1 && p.z < 1 && cam.position.distanceTo(m.position) > 0.2
      })
  })
  expect(visible).toBe(true)
})

test('クリックで選択解除・全選択・結合', async ({ page }) => {
  await page.evaluate(() => {
    const k = (window as any).__kani
    k.addPrimitive('cube')
    k.setSelection([])
    k.addPrimitive('prism')
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
  expect(groups.sort((a: number, b: number) => a - b)).toEqual([0, 11])
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

test('結合物の検査結果表示と X線表示（GLB には影響しない）', async ({ page }) => {
  await page.evaluate(() => {
    const k = (window as any).__kani
    k.addPrimitive('cube')
    k.setSelection([])
    k.addPrimitive('prism')
    k.nudge(1, 0, 1)
    k.selectAll()
  })
  await page.keyboard.press('Control+g')
  await expect(page.locator('.hud')).toContainText('検査: 問題なし')

  const xray = page.getByRole('button', { name: 'X線表示' })
  await xray.click()
  await expect(xray).toHaveClass(/active/)
  const view = await page.evaluate(() => {
    const m = (window as any).__kani.scene.getObjectByName('結合オブジェクト')
    return { transparent: m.material[0].transparent, overlays: m.children.filter((c: any) => c.name === 'overlay').length }
  })
  expect(view).toEqual({ transparent: true, overlays: 1 })

  const glb = await page.evaluate(async () => {
    const buf: ArrayBuffer = await (window as any).__kani.exportGlb()
    const len = new DataView(buf).getUint32(12, true)
    return JSON.parse(new TextDecoder().decode(new Uint8Array(buf, 20, len)))
  })
  expect(glb.materials.every((m: any) => !m.alphaMode || m.alphaMode === 'OPAQUE')).toBe(true)
  expect(glb.meshes).toHaveLength(1)

  await xray.click()
  expect(await page.evaluate(() => (window as any).__kani.scene.getObjectByName('結合オブジェクト').children.length)).toBe(0)
})

test('形状オプション: 柱の角数・半分を変更でき、Undo できる', async ({ page }) => {
  await page.locator('[data-primitive="prism"]').click()
  const sides = page.locator('.shape-options [data-param="sides"]')
  await expect(sides).toHaveValue('16')
  const tris = () => page.evaluate(() => (window as any).__kani.currentState().triangles)
  const before = await tris()
  await sides.fill('6') // range への fill は input/change を発火
  await expect.poll(tris).toBeLessThan(before)
  expect((await sceneData(page))[0]).toMatchObject({ primitive: 'prism', params: { sides: 6 } })
  await page.locator('.shape-options [data-param="half"]').check()
  const b = await page.evaluate(() => (window as any).__kani.selectionBounds())
  expect(b.min[1]).toBeCloseTo(0) // 底面の高さは保つ
  expect(+(b.max[2] - b.min[2]).toFixed(4)).toBe(0.05)
  await page.keyboard.press('Control+z')
  await page.keyboard.press('Control+z')
  expect((await sceneData(page))[0]).not.toHaveProperty('params')
  // 未選択ならセクション自体を隠す
  await page.keyboard.press('Escape')
  await expect(page.locator('.shape-options')).toHaveCount(0)
})

test('旧形式のプリミティブ ID は読み込み時に変換される', async ({ page }) => {
  const doc = {
    format: 'kani3d',
    version: 1,
    objects: [
      { id: 'a', kind: 'primitive', primitive: 'hex-prism', color: 0, position: [0, 0.05, 0], quaternion: [0, 0, 0, 1], scale: [1, 1, 1] },
      { id: 'b', kind: 'primitive', primitive: 'square-prism', color: 0, position: [0.2, 0.1, 0], quaternion: [0, 0, 0, 1], scale: [1, 1, 1] },
    ],
  }
  await page.locator('input[type=file]').setInputFiles({ name: 'old.kani', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(doc)) })
  await expect.poll(async () => (await sceneData(page)).length).toBe(2)
  const data: any[] = await sceneData(page)
  expect(data[0]).toMatchObject({ primitive: 'prism', params: { sides: 6 } })
  expect(data[1]).toMatchObject({ primitive: 'cube', scale: [1, 2, 1] })
})

test('未選択で追加すると画面中央に見えている床に置かれる', async ({ page }) => {
  await page.evaluate(() => {
    const k = (window as any).__kani
    k.orbit.target.set(0.3, 0.4, -0.2) // 注視点を床から浮かせる
    k.orbit.update()
    k.addPrimitive('cube')
  })
  const p = await page.evaluate(() => {
    const k = (window as any).__kani
    const m = k.scene.getObjectByName('立方体')
    return m.position.clone().setY(0).project(k.camera).toArray()
  })
  expect(Math.abs(p[0])).toBeLessThan(0.1) // 画面中央付近（NDC）
  expect(Math.abs(p[1])).toBeLessThan(0.1)
})
