/** テスト用のフォント（opentype.js でメモリ上に作る）。vitest からのみ使う */
import { Font, Glyph, Path } from 'opentype.js'
import { registerFont } from './fonts'

/** テスト用フォント: I（長方形）、O（穴あき）、S（曲線）、i（2 つの輪郭）。PostScript 名 TestFont */
export function testFont(cff: boolean): Font {
  const glyph = (name: string, unicode: number | undefined, draw: (p: Path) => void) => {
    const path = new Path()
    draw(path)
    return new Glyph({ name, unicode, advanceWidth: 700, path })
  }
  // CFF と TrueType で外周の巻き方向が逆なので、どちらも同じ形になることを確かめる
  const rect = (p: Path, x0: number, y0: number, x1: number, y1: number, cw: boolean) => {
    const pts = [[x0, y0], [x1, y0], [x1, y1], [x0, y1]]
    if (cw) pts.reverse()
    p.moveTo(pts[0][0], pts[0][1])
    for (const q of pts.slice(1)) p.lineTo(q[0], q[1])
    p.close()
  }
  return new Font({
    familyName: 'TestFont',
    styleName: 'Regular',
    unitsPerEm: 1000,
    ascender: 800,
    descender: -200,
    glyphs: [
      glyph('.notdef', undefined, () => {}),
      glyph('I', 73, (p) => rect(p, 100, 0, 300, 700, cff)),
      glyph('O', 79, (p) => {
        rect(p, 50, 0, 600, 700, cff)
        rect(p, 200, 150, 450, 550, !cff)
      }),
      glyph('S', 83, (p) => {
        p.moveTo(100, 0)
        p.lineTo(400, 0)
        p.quadraticCurveTo(600, 0, 600, 200)
        p.bezierCurveTo(600, 400, 300, 400, 300, 500)
        p.lineTo(300, 700)
        p.lineTo(100, 700)
        p.close()
      }),
      glyph('i', 105, (p) => {
        rect(p, 100, 0, 250, 500, cff)
        rect(p, 100, 600, 250, 750, cff)
      }),
      glyph('space', 32, () => {}),
      // 既定の文字列 Text 用（形は適当な長方形）
      ...[...'Text'].map((c, i) => glyph(c, c.charCodeAt(0), (p) => rect(p, 100, 0, 400 + i * 50, 600, cff))),
    ],
  })
}

/** PostScript 名 TestFont で登録し、自動（font = ''）でも選ばれるようにする */
export function useTestFont(): void {
  registerFont('TestFont', testFont(true))
}
