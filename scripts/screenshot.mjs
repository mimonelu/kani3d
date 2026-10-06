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
  /** center: 中心座標 (m)、scale: 基本サイズ 10cm に対する倍率、rotX: X 軸 45° 回転の回数 */
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
  add('cube', 3, [0.05, -0.01, 0.05], null, [9, 0.2, 7])
  // 家
  const house = add('cube', 10, [0, 0.1, 0], null, [2, 2, 2])
  add('prism', 0, [0, 0.25, 0], { sides: 3 }, [2.3, 2.3, 1], 2)
  add('cube', 9, [-0.04, 0.06, 0.1025], null, [0.5, 1.2, 0.05])
  add('cube', 5, [0.045, 0.12, 0.1025], null, [0.45, 0.45, 0.05])
  // 木
  add('prism', 9, [0.3, 0.03, -0.06], { sides: 8 }, [0.4, 0.6, 0.4])
  add('cone', 4, [0.3, 0.14, -0.06], { sides: 8 }, [1.4, 1.6, 1.4])
  add('prism', 9, [0.36, 0.02, 0.16], { sides: 8 }, [0.3, 0.4, 0.3])
  add('sphere', 1, [0.36, 0.085, 0.16], { widthSegments: 10, heightSegments: 6 }, [0.9, 0.9, 0.9])
  // カニ
  add('sphere', 0, [-0.28, 0.025, 0.2], { half: true, widthSegments: 10, heightSegments: 6 }, [1.4, 1, 1])
  for (const x of [-0.305, -0.255]) {
    add('prism', 0, [x, 0.06, 0.225], { sides: 6 }, [0.12, 0.3, 0.12])
    add('sphere', 11, [x, 0.08, 0.225], { widthSegments: 8, heightSegments: 6 }, [0.25, 0.25, 0.25])
  }
  add('cone', 0, [-0.37, 0.025, 0.24], { sides: 6 }, [0.35, 0.5, 0.35])
  add('cone', 0, [-0.19, 0.025, 0.24], { sides: 6 }, [0.35, 0.5, 0.35])
  k.camera.position.set(0.62, 0.42, 0.78)
  k.orbit.target.set(0.03, 0.07, 0.07)
  k.orbit.update()
  k.setSelection([house])
})
await page.waitForTimeout(700)
await page.screenshot({ path: 'docs/images/screenshot.png' })
await browser.close()
