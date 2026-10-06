import { describe, expect, it } from 'vitest'
import { Vector3 } from 'three'
import { PRIMITIVES, buildPrimitiveGeometry } from './primitives'

describe('primitives', () => {
  for (const p of PRIMITIVES) {
    it(`${p.id}: 指定サイズに正規化され、閉じた外向きの形状`, () => {
      const g = buildPrimitiveGeometry(p.id)
      const size = g.boundingBox!.getSize(new Vector3())
      expect(size.toArray().map((v) => +v.toFixed(5))).toEqual(p.size)
      const pos = g.getAttribute('position')
      const idx = g.index!.array
      let vol = 0
      for (let i = 0; i < idx.length; i += 3) {
        const a = new Vector3().fromBufferAttribute(pos, idx[i])
        const b = new Vector3().fromBufferAttribute(pos, idx[i + 1])
        const c = new Vector3().fromBufferAttribute(pos, idx[i + 2])
        vol += a.dot(b.cross(c)) / 6
      }
      expect(vol).toBeGreaterThan(0)
      const nor = g.getAttribute('normal')
      for (let i = 0; i < nor.count; i++) expect(new Vector3().fromBufferAttribute(nor, i).length()).toBeCloseTo(1, 3)
      expect(idx.length / 3).toBeLessThanOrEqual(400)
    })
  }
})
