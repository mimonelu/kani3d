import { expect, test } from '@playwright/test'

/** 結合 → 移動・回転 → 結合解除 → 再結合で、検査結果が初回より悪化しないこと（回帰テスト） */
test('結合解除して再結合しても結果が壊れない', async ({ page }) => {
  await page.goto('/')
  await page.evaluate(() => localStorage.clear())
  await page.reload()
  await page.waitForFunction(() => (window as any).__kani)
  const regressions = await page.evaluate(() => {
    const k = (window as any).__kani
    const prims = ['cube', 'sphere', 'wedge', 'prism', 'cone', 'pipe', 'torus', 'star', 'polyhedron']
    let seed = 1
    const rnd = (n: number) => (seed = (seed * 16807) % 2147483647) % n
    const count = (r: any) => r.issues.open + r.issues.nonManifold + r.issues.flipped
    const out: string[] = []
    for (let trial = 0; trial < 40; trial++) {
      k.newScene()
      for (let i = 2 + rnd(3); i > 0; i--) {
        k.setSelection([])
        k.addPrimitive(prims[rnd(prims.length)])
        k.nudge(rnd(3) - 1, rnd(2), rnd(3) - 1)
        for (let r = rnd(3); r > 0; r--) k.rotateSelected(['x', 'y', 'z'][rnd(3)])
      }
      k.selectAll()
      const first = count(k.mergeSelected())
      k.nudge(1, 0, 0)
      k.rotateSelected('y')
      k.unmergeSelected()
      k.selectAll()
      const again = count(k.mergeSelected())
      if (again > first) out.push(`trial ${trial}: ${first} -> ${again}`)
    }
    return out
  })
  expect(regressions).toEqual([])
})
