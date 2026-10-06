import { describe, expect, it } from 'vitest'
import { Vector3 } from 'three'
import { checkMesh } from './meshCheck'
import { PRIMITIVES, buildPrimitiveGeometry, compactParams, polyIdsOf, resolveParams, type PrimitiveParams } from './primitives'

/** 各パラメータを既定・最小・最大・true/false・各選択肢に振った組み合わせ */
function variants(id: string): PrimitiveParams[] {
  const def = PRIMITIVES.find((p) => p.id === id)!
  const out: PrimitiveParams[] = [{}]
  for (const d of def.params) {
    if (d.type === 'bool') out.push({ [d.key]: true })
    else if (d.type === 'enum') for (const o of d.options) out.push({ [d.key]: o.value })
    else out.push({ [d.key]: d.min }, { [d.key]: d.max })
  }
  // 2 つ以上のパラメータを同時に端に寄せた組み合わせも
  if (def.params.length > 1) {
    out.push(Object.fromEntries(def.params.map((d) => [d.key, d.type === 'bool' ? true : d.type === 'enum' ? d.default : d.min])))
    out.push(Object.fromEntries(def.params.map((d) => [d.key, d.type === 'bool' ? true : d.type === 'enum' ? d.default : d.max])))
  }
  return out
}

describe('primitives', () => {
  for (const p of PRIMITIVES) {
    for (const params of variants(p.id)) {
      it(`${p.id} ${JSON.stringify(params)}: 指定サイズに正規化され、閉じた外向きの形状`, () => {
        const g = buildPrimitiveGeometry(p.id, params)
        const size = g.boundingBox!.getSize(new Vector3())
        expect(size.toArray().map((v) => +v.toFixed(5))).toEqual(p.size(resolveParams(p.id, params)))
        const pos = g.getAttribute('position')
        const idx = Array.from(g.index!.array)
        let vol = 0
        for (let i = 0; i < idx.length; i += 3) {
          const a = new Vector3().fromBufferAttribute(pos, idx[i])
          const b = new Vector3().fromBufferAttribute(pos, idx[i + 1])
          const c = new Vector3().fromBufferAttribute(pos, idx[i + 2])
          vol += a.dot(b.cross(c)) / 6
        }
        expect(vol).toBeGreaterThan(0)
        const r = checkMesh({ positions: Array.from(pos.array as ArrayLike<number>), indices: idx })
        expect([r.open, r.nonManifold, r.flipped]).toEqual([0, 0, 0])
        const nor = g.getAttribute('normal')
        for (let i = 0; i < nor.count; i++) expect(new Vector3().fromBufferAttribute(nor, i).length()).toBeCloseTo(1, 3)
        expect(idx.length / 3).toBeLessThanOrEqual(16 * 16 * 6 * 2)
      })
    }
  }

  it('resolveParams は範囲外を丸め、未知キーを捨てる / compactParams は既定値を省く', () => {
    expect(resolveParams('prism', { sides: 99, half: 1 as never, foo: 3 })).toEqual({ sides: 32, half: false })
    expect(resolveParams('pipe', { thickness: 0.43 })).toEqual({ sides: 16, thickness: 0.45 })
    expect(compactParams('prism', resolveParams('prism', { sides: 6 }))).toEqual({ sides: 6 })
    expect(compactParams('prism', resolveParams('prism'))).toBeUndefined()
  })
})

describe('ポリゴン番号（ペイント単位）', () => {
  const polyCount = (id: string, p?: PrimitiveParams) => new Set(polyIdsOf(buildPrimitiveGeometry(id, p))).size
  it('立方体: 分割数どおりのマス目（各 2 三角形）', () => {
    expect(polyCount('cube')).toBe(6)
    expect(polyCount('cube', { segX: 8, segY: 8, segZ: 8 })).toBe(6 * 64)
    expect(polyCount('cube', { segX: 2, segY: 3, segZ: 4 })).toBe(2 * (2 * 3 + 3 * 4 + 2 * 4))
  })
  it('柱: 側面の四角形 + 上下の多角形面', () => {
    expect(polyCount('prism', { sides: 6 })).toBe(6 + 2)
    expect(polyCount('prism', { sides: 16 })).toBe(16 + 2)
  })
  it('多面体: 正十二面体は 12 面（五角形 = 3 三角形）', () => {
    expect(polyCount('polyhedron', { faces: 12 })).toBe(12)
  })
})
