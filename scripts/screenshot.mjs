// README 用スクリーンショット（docs/images/screenshot.png）を撮る。
// 事前に `npm run dev`（http://localhost:5183）を起動しておくこと。
import { chromium } from '@playwright/test'

const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1440, height: 860 }, deviceScaleFactor: 2 })
await page.goto('http://localhost:5183/')
await page.evaluate(() => localStorage.clear())
await page.reload()
await page.waitForFunction(() => window.__kani)
await page.evaluate(() => {
  const k = window.__kani
  const meshOf = (id) => {
    let found = null
    k.scene.traverse((o) => {
      if (o.isMesh && o.userData.id === id && !found) found = o
    })
    return found
  }
  /** center: 中心座標 (m)、scale: 基本サイズ 1m に対する倍率、rotX: X 軸 45° 回転の回数 */
  const add = (prim, color, center, params, scale = [1, 1, 1], rotX = 0) => {
    k.setSelection([])
    k.setColor(color)
    k.addPrimitive(prim)
    if (params) k.setPrimitiveParams(params)
    for (let i = 0; i < rotX; i++) k.rotateSelected('x')
    const m = meshOf(k.currentState().selection[0])
    m.scale.set(...scale)
    m.position.set(...center)
    m.updateMatrixWorld()
    return m.userData.id
  }
  // 地面
  add('cube', 3, [0.5, -0.11, 0.5], null, [9, 0.2, 7])
  // 家
  const house = add('cube', 10, [0, 1, 0], null, [2, 2, 2])
  add('prism', 0, [0, 2.5, 0], { sides: 3 }, [2.3, 2.3, 1], 2)
  add('cube', 9, [-0.4, 0.6, 1.025], null, [0.5, 1.2, 0.05])
  add('cube', 5, [0.45, 1.2, 1.025], null, [0.45, 0.45, 0.05])
  // 木
  add('prism', 9, [3, 0.3, -0.6], { sides: 8 }, [0.4, 0.6, 0.4])
  add('cone', 4, [3, 1.4, -0.6], { sides: 8 }, [1.4, 1.6, 1.4])
  add('prism', 9, [3.6, 0.2, 1.6], { sides: 8 }, [0.3, 0.4, 0.3])
  add('sphere', 1, [3.6, 0.85, 1.6], { widthSegments: 10, heightSegments: 6 }, [0.9, 0.9, 0.9])
  // カニ
  add('sphere', 0, [-2.8, 0.25, 2], { half: true, widthSegments: 10, heightSegments: 6 }, [1.4, 1, 1])
  for (const x of [-0.305, -0.255]) {
    add('prism', 0, [x * 10, 0.6, 2.25], { sides: 6 }, [0.12, 0.3, 0.12])
    add('sphere', 11, [x * 10, 0.8, 2.25], { widthSegments: 8, heightSegments: 6 }, [0.25, 0.25, 0.25])
  }
  add('cone', 0, [-3.7, 0.25, 2.4], { sides: 6 }, [0.35, 0.5, 0.35])
  add('cone', 0, [-1.9, 0.25, 2.4], { sides: 6 }, [0.35, 0.5, 0.35])
  k.camera.position.set(6.2, 4.2, 7.8)
  k.orbit.target.set(0.3, 0.7, 0.7)
  k.orbit.update()
  k.setSelection([house])
})
await page.waitForTimeout(700)
await page.screenshot({ path: 'docs/images/screenshot.png' })
await browser.close()
