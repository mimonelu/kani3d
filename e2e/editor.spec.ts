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
  expect(data.map((d) => d.position[1])).toEqual([expect.closeTo(0.5, 6), expect.closeTo(1.5, 6)])

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
  expect(data[0].position[1]).toBeCloseTo(0.5)
  expect(data[2].position[1]).toBeCloseTo(1.5) // 立方体の上
})

test('キーボード操作は 5cm 単位、回転は中心が動かない', async ({ page }) => {
  await page.locator('[data-primitive="cube"]').click()
  await page.keyboard.press('ArrowRight')
  await page.keyboard.press('ArrowRight')
  await page.keyboard.press('PageUp')
  let b = await page.evaluate(() => (window as any).__kani.selectionBounds())
  expect(b.min).toEqual([-0.4, 0.05, -0.5])
  await page.keyboard.press('y') // 45° 回転
  b = await page.evaluate(() => (window as any).__kani.selectionBounds())
  expect((b.min[0] + b.max[0]) / 2).toBeCloseTo(0.1, 6)
  expect(b.max[0] - b.min[0]).toBeCloseTo(Math.SQRT2, 3)
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
  expect(cube.position.map((v) => +v.toFixed(4))).toEqual([0, 0.5, 0.2])
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
  expect(+(b.max[2] - b.min[2]).toFixed(4)).toBe(0.5)
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
  expect(data[1]).toMatchObject({ primitive: 'cube', scale: [0.1, 0.2, 0.1] }) // v1（基本 10cm）→ 実寸を保って換算
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
    k.camera.updateMatrixWorld()
    return m.position.clone().setY(0).project(k.camera).toArray()
  })
  expect(Math.abs(p[0])).toBeLessThan(0.1) // 画面中央付近（NDC）
  expect(Math.abs(p[1])).toBeLessThan(0.1)
})

test('ペイント: 分割した立方体のマス 1 つだけを塗り、最適化で面数が減る', async ({ page }) => {
  await page.locator('[data-primitive="cube"]').click()
  for (const k of ['segX', 'segY', 'segZ']) await page.locator(`.shape-options [data-param="${k}"]`).fill('8')
  const tris = () => page.evaluate(() => (window as any).__kani.currentState().triangles)
  expect(await tris()).toBe(6 * 64 * 2)

  await page.locator('[data-color="0"]').click() // 塗る色（ペイント前に選ぶとオブジェクト全体も赤になる）
  await page.getByRole('button', { name: 'ペイント' }).click()
  await page.locator('[data-color="4"]').click() // ペイント中は色の選択のみ
  const canvas = page.locator('canvas')
  const box = (await canvas.boundingBox())!
  await canvas.click({ position: { x: box.width / 2, y: box.height / 2 } }) // 画面中央 = 立方体
  const d = (await page.evaluate(() => (window as any).__kani.toData()[0])) as any
  expect(d.color).toBe(0)
  expect(Object.values(d.faceColors)).toEqual([4]) // 1 マスだけ

  // 形状オプションはロックされ、リセットで解除
  await expect(page.locator('.shape-options .painted')).toBeVisible()
  await page.keyboard.press('Escape') // ペイント終了
  await expect(page.getByRole('button', { name: 'ペイント' })).not.toHaveClass(/active/)

  await page.getByRole('button', { name: '最適化' }).click()
  const after = await tris()
  expect(after).toBeLessThan(60) // 768 → 塗ったマス周辺だけ細かい
  const groups = await page.evaluate(() => (window as any).__kani.toData()[0].mesh.groups.map((g: any) => g.color))
  expect(groups.sort()).toEqual([0, 4])
  await expect(page.locator('.hud')).toContainText('検査: 問題なし')

  await expect(page.locator('.banner.info')).toContainText('面数を最適化しました')
  // 最適化済みを選ぶとボタンは「最適化解除」になり、塗った立方体（分割・塗りそのまま）に戻る
  await page.keyboard.press('ArrowRight') // 最適化後の移動は引き継ぐ
  await page.getByRole('button', { name: '最適化解除' }).click()
  const back = (await page.evaluate(() => (window as any).__kani.toData()[0])) as any
  expect(back).toMatchObject({ kind: 'primitive', primitive: 'cube', params: { segX: 8, segY: 8, segZ: 8 } })
  expect(Object.values(back.faceColors)).toEqual([4])
  expect(back.position[0]).toBeCloseTo(0.05, 6)
  await expect(page.getByRole('button', { name: '最適化', exact: true })).toBeEnabled()
})

test('最適化: 位置・回転・拡縮を保つ（結合物は結合元を保つ）', async ({ page }) => {
  const r = await page.evaluate(() => {
    const k = (window as any).__kani
    k.addPrimitive('cube')
    k.setPrimitiveParams({ segX: 4, segY: 4, segZ: 4 })
    k.rotateSelected('y')
    k.nudge(4, 1, 0)
    const before = k.selectionBounds()
    const tris0 = k.currentState().triangles
    const res = k.optimizeSelected()
    const after = k.selectionBounds()
    // 結合物（結合時に最適化済み）は変化せず、結合解除もできるまま
    k.setSelection([])
    k.addPrimitive('cube')
    k.selectAll()
    k.mergeSelected()
    k.optimizeSelected()
    return { before, after, res, tris0, canUnmerge: k.currentState().canUnmerge }
  })
  expect(r.res.optimized).toBe(1)
  expect(r.res.after).toBe(12)
  expect(r.tris0).toBe(6 * 16 * 2)
  for (let i = 0; i < 3; i++) {
    expect(r.after.min[i]).toBeCloseTo(r.before.min[i], 4)
    expect(r.after.max[i]).toBeCloseTo(r.before.max[i], 4)
  }
  expect(r.canUnmerge).toBe(true)
})

test('最適化のメッセージは左下に出て時間経過で消える（警告は残る）', async ({ page }) => {
  await page.evaluate(() => {
    const k = (window as any).__kani
    k.addPrimitive('cube')
    k.setPrimitiveParams({ segX: 4 })
  })
  await page.getByRole('button', { name: '最適化', exact: true }).click()
  const banner = page.locator('.banner.info')
  await expect(banner).toBeVisible()
  const vp = (await page.locator('.viewport').boundingBox())!
  const b = (await banner.boundingBox())!
  expect(b.x - vp.x).toBeLessThan(20) // 左下
  expect(vp.y + vp.height - (b.y + b.height)).toBeLessThan(30)
  await expect(banner).toBeHidden({ timeout: 8000 })
})

test('ペイント中に E キーでカーソル下のポリゴンの色を消す（Undo 可）', async ({ page }) => {
  await page.evaluate(() => {
    const k = (window as any).__kani
    k.addPrimitive('cube')
    k.setPrimitiveParams({ segX: 4, segY: 4, segZ: 4 })
  })
  await page.getByRole('button', { name: 'ペイント' }).click()
  await page.locator('[data-color="0"]').click()
  const canvas = page.locator('canvas')
  const box = (await canvas.boundingBox())!
  const c = { x: box.x + box.width / 2, y: box.y + box.height / 2 }
  // 押したまま横に動かして数マス塗る
  await page.mouse.move(c.x - 20, c.y)
  await page.mouse.down()
  for (let i = 1; i <= 8; i++) await page.mouse.move(c.x - 20 + i * 5, c.y)
  await page.mouse.up()
  const painted = () => page.evaluate(() => Object.keys((window as any).__kani.toData()[0].faceColors ?? {}).length)
  const n = await painted()
  expect(n).toBeGreaterThan(1)

  // カーソル下を E で消す → 1 マス減る
  await page.keyboard.down('e')
  await page.keyboard.up('e')
  expect(await painted()).toBe(n - 1)
  // E を押したまま動かすと通過したマスも消える
  await page.mouse.move(c.x - 20, c.y)
  await page.keyboard.down('e')
  for (let i = 1; i <= 8; i++) await page.mouse.move(c.x - 20 + i * 5, c.y)
  await page.keyboard.up('e')
  expect(await painted()).toBe(0)
  // 消去は E を離すまでで 1 回分
  await page.keyboard.press('Control+z')
  expect(await painted()).toBe(n - 1)
})

test('画像出力: 背景透過の PNG を指定サイズで保存できる', async ({ page }) => {
  await page.evaluate(() => (window as any).__kani.addPrimitive('cube'))
  await page.getByRole('button', { name: '画像出力' }).click()
  await expect(page.locator('[data-test="render-preview"]')).toBeVisible()
  await page.locator('[data-field="fileName"]').fill('shot')
  await page.locator('[data-field="sizePreset"]').selectOption('1280x720')
  await page.locator('[data-field="opacity"]').fill('0')
  await page.locator('[data-field="cameraPreset"]').selectOption('front')
  const [dl] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'PNG を保存' }).click()])
  expect(dl.suggestedFilename()).toBe('shot.png')
  const buf = await readFile(await dl.path())
  expect(buf.subarray(1, 4).toString()).toBe('PNG')
  expect([buf.readUInt32BE(16), buf.readUInt32BE(20)]).toEqual([1280, 720]) // IHDR
  expect(buf[25]).toBe(6) // RGBA
  // 隅は透明、中央（立方体）は不透明
  const alpha = await page.evaluate(async (b64) => {
    const img = await createImageBitmap(await (await fetch(`data:image/png;base64,${b64}`)).blob())
    const c = new OffscreenCanvas(img.width, img.height)
    const ctx = c.getContext('2d')!
    ctx.drawImage(img, 0, 0)
    return [ctx.getImageData(2, 2, 1, 1).data[3], ctx.getImageData(640, 360, 1, 1).data[3]]
  }, buf.toString('base64'))
  expect(alpha).toEqual([0, 255])
  await expect(page.locator('.dialog[aria-label="画像出力"]')).toHaveCount(0)
})

test('画像出力: 余白どおりに全体を収め、入力内容は閉じても保持される', async ({ page }) => {
  await page.evaluate(() => {
    const k = (window as any).__kani
    k.addPrimitive('cube')
    k.setSelection([])
    k.addPrimitive('sphere')
    k.nudge(3, 0, 1)
  })
  /** 透明背景で描いた画像の不透明ピクセルの外接矩形 [left, top, right, bottom] の余白 */
  const margins = (padding: number, preset: string) =>
    page.evaluate(
      ({ padding, preset }) => {
        const k = (window as any).__kani
        const W = 400, H = 300
        const camera = k.presetCamera(preset, W, H, padding)
        const c: HTMLCanvasElement = k.renderImage({ width: W, height: H, background: '#000000', opacity: 0, grid: false, camera })
        const ctx = new OffscreenCanvas(W, H).getContext('2d')!
        ctx.drawImage(c, 0, 0)
        const d = ctx.getImageData(0, 0, W, H).data
        let l = W, t = H, r = -1, b = -1
        for (let y = 0; y < H; y++)
          for (let x = 0; x < W; x++)
            if (d[(y * W + x) * 4 + 3] > 0) {
              l = Math.min(l, x)
              r = Math.max(r, x)
              t = Math.min(t, y)
              b = Math.max(b, y)
            }
        return [l, t, W - 1 - r, H - 1 - b]
      },
      { padding, preset },
    )
  for (const preset of ['front', 'iso-ru', 'iso-ld', 'top']) {
    const m0 = await margins(0, preset)
    // どちらかの軸で両端ぴったり（±1px）、もう一方の軸は左右・上下が均等
    const tightX = m0[0] <= 1 && m0[2] <= 1
    const tightY = m0[1] <= 1 && m0[3] <= 1
    expect(tightX || tightY, `${preset}: ${m0}`).toBe(true)
    const m20 = await margins(20, preset)
    expect(Math.min(...m20), `${preset}: ${m20}`).toBeGreaterThanOrEqual(19)
    expect(tightX ? Math.min(m20[0], m20[2]) : Math.min(m20[1], m20[3])).toBeLessThanOrEqual(21)
  }

  // 入力内容の保持
  await page.getByRole('button', { name: '画像出力' }).click()
  await page.locator('[data-field="fileName"]').fill('keep-me')
  await page.locator('[data-field="opacity"]').fill('40')
  await page.locator('[data-field="cameraPreset"]').selectOption('iso-ru')
  await page.locator('[data-field="padding"]').fill('10')
  await page.getByRole('button', { name: 'キャンセル' }).click()
  await page.getByRole('button', { name: '画像出力' }).click()
  await expect(page.locator('[data-field="fileName"]')).toHaveValue('keep-me')
  await expect(page.locator('[data-field="opacity"]')).toHaveValue('40')
  await expect(page.locator('[data-field="cameraPreset"]')).toHaveValue('iso-ru')
  await expect(page.locator('[data-field="padding"]')).toHaveValue('10')
})

test('大きな立方体の中のオブジェクト: 選択中なら掴めて、同じ場所の再クリックで奥へ切り替わる', async ({ page }) => {
  const ids = await page.evaluate(() => {
    const k = (window as any).__kani
    const big = k.addPrimitive('cube')
    k.scene.traverse((o: any) => o.isMesh && o.userData.id === big && o.scale.set(3, 3, 3))
    k.setSelection([])
    const small = k.addPrimitive('sphere') // 画面中央の床 = 大きな立方体の中
    return { big, small }
  })
  const pos = (id: string) => page.evaluate((id) => (window as any).__kani.toData().find((d: any) => d.id === id).position, id)
  const screenOf = (id: string) =>
    page.evaluate((id) => {
      const k = (window as any).__kani
      let m: any
      k.scene.traverse((o: any) => o.isMesh && o.userData.id === id && (m = o))
      k.camera.updateMatrixWorld()
      const p = m.getWorldPosition(m.position.clone()).project(k.camera)
      const r = k.renderer.domElement.getBoundingClientRect()
      return { x: r.left + ((p.x + 1) / 2) * r.width, y: r.top + ((1 - p.y) / 2) * r.height }
    }, id)
  const selected = () => page.evaluate(() => (window as any).__kani.currentState().selection)

  // 選択中の小さい球は、手前の大きな立方体越しでも掴んで動かせる
  const bigBefore = await pos(ids.big)
  const smallBefore = await pos(ids.small)
  const c = await screenOf(ids.small)
  await page.mouse.move(c.x, c.y)
  await page.mouse.down()
  for (let i = 1; i <= 8; i++) await page.mouse.move(c.x + i * 10, c.y)
  await page.mouse.up()
  expect(await pos(ids.big)).toEqual(bigBefore)
  expect((await pos(ids.small))[0]).not.toBeCloseTo(smallBefore[0], 3)

  // 未選択から: 1 回目は手前（大きな立方体）、同じ場所の 2 回目で奥（球）、3 回目で手前に戻る
  await page.keyboard.press('Escape')
  const s = await screenOf(ids.small)
  await page.mouse.click(s.x, s.y)
  expect(await selected()).toEqual([ids.big])
  await page.mouse.click(s.x, s.y)
  expect(await selected()).toEqual([ids.small])
  await page.mouse.click(s.x, s.y)
  expect(await selected()).toEqual([ids.big])
})
