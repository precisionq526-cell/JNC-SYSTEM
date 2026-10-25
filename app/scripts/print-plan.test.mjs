import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import ts from 'typescript'

const transpile = file => ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText
const url = code => 'data:text/javascript;base64,' + Buffer.from(code).toString('base64')
const optionsUrl = url(transpile('src/lib/kiosk/print-options.ts'))
const { buildPrintPlan, printerPaperKind, imagePrintDimensions, paperPreviewLayout, PAPER_POINTS } = await import(url(transpile('src/lib/printing/print-plan.ts').replace("'@/lib/kiosk/print-options'", JSON.stringify(optionsUrl))))
const options = { 'Paper Size': 'A4', Copies: 2, 'Print Color': 'B&W', 'Back to back': 'Yes', 'Pages to print': '2-4,6,8' }

test('automatic duplex applies actual selected pages, copies, monochrome and paper', () => {
  const plan = buildPrintPlan(options, 8, true)
  assert.deepEqual(plan.pages, [2,3,4,6,8])
  assert.equal(plan.copies, 2)
  assert.match(plan.settings, /monochrome,duplexlong,paper=9,2x$/)
})
test('manual duplex pairs the selected sequence, including nonconsecutive source pages', () => {
  assert.throws(() => buildPrintPlan(options, 8, false), /manual/)
  assert.deepEqual(buildPrintPlan(options, 8, false, 'front', 2).pages, [2,4,8])
  assert.deepEqual(buildPrintPlan(options, 8, false, 'back', 2).pages, [6,3])
  assert.deepEqual(buildPrintPlan(options, 8, null, 'back', 2, false).pages, [3,6])
  assert.equal(buildPrintPlan(options, 8, false, 'front', 2).copies, 1)
})
test('manual backs reject empty selections and copy numbers outside the customer order', () => {
  assert.throws(() => buildPrintPlan({ ...options, 'Pages to print': '1' }, 8, false, 'back'), /no back pages/)
  assert.throws(() => buildPrintPlan(options, 8, false, 'front', 3), /valid copy/)
  assert.throws(() => buildPrintPlan(options, 8, false, 'front', 1.5), /valid copy/)
})
test('invalid page ranges cannot fall back to printing the whole document', () => {
  for (const value of ['0', '4-2', '9', '1,,2']) assert.throws(() => buildPrintPlan({ ...options, 'Pages to print': value }, 8, true))
})
test('single-sided legacy orders retain their color setting and do not allow manual phases', () => {
  const plan = buildPrintPlan({ 'Color Mode': 'Colored', 'Paper Size': 'Short' }, 3, false)
  assert.match(plan.settings, /color,simplex,paper=1,1x$/)
  assert.throws(() => buildPrintPlan({ 'Back to back': 'No' }, 3, false, 'front'), /does not need/)
})
test('printer paper is matched by physical dimensions, including long bond and rotated driver entries', () => {
  const driver = [{kind:9,width:827,height:1169},{kind:1,width:1100,height:850},{kind:257,width:850,height:1300},{kind:5,width:850,height:1400}]
  assert.equal(printerPaperKind('A4', driver), 9)
  assert.equal(printerPaperKind('Short', driver), 1)
  assert.equal(printerPaperKind('Long', driver), 257)
  assert.equal(printerPaperKind('Legal', driver), 5)
  assert.throws(() => printerPaperKind('Long', driver.filter(row => row.kind !== 257)), /does not offer Long/)
  assert.throws(() => printerPaperKind('A4', []), /does not offer/)
})
test('saved photo sizes use physical inches and preserve the image aspect ratio', () => {
  assert.deepEqual(imagePrintDimensions(600,600,595,842,'2x2'), { width:144, height:144 })
  assert.deepEqual(imagePrintDimensions(600,300,595,842,'2 × 2 inches'), { width:144, height:72 })
  assert.deepEqual(imagePrintDimensions(600,300,612,792), { width:576, height:288 })
})
test('ambiguous or oversized photo sizes stop before a wrong physical print', () => {
  for (const value of ['Passport', '0x2', '2x0', '9x13']) assert.throws(() => imagePrintDimensions(600,600,595,842,value))
})

test('paper previews fit and center the whole source page on each physical sheet without stretching', () => {
  for (const paper of ['A4', 'Short', 'Long', 'Legal']) {
    const layout = paperPreviewLayout(595.28, 841.89, paper)
    assert.deepEqual([layout.width, layout.height], PAPER_POINTS[paper])
    assert.ok(layout.x >= 0 && layout.y >= 0)
    assert.ok(Math.abs(layout.x * 2 + 595.28 * layout.scale - layout.width) < .0001)
    assert.ok(Math.abs(layout.y * 2 + 841.89 * layout.scale - layout.height) < .0001)
    assert.ok(layout.x < .0001 || layout.y < .0001, 'fit should fill one sheet dimension')
  }
  assert.ok(paperPreviewLayout(595.28, 841.89, 'Long').y > paperPreviewLayout(595.28, 841.89, 'Short').y)
})

test('mixed portrait and landscape previews retain the orientation of each source page', () => {
  const portrait = paperPreviewLayout(600, 800, 'Legal')
  const landscape = paperPreviewLayout(800, 600, 'Legal')
  assert.deepEqual([portrait.width, portrait.height], [612, 1008])
  assert.deepEqual([landscape.width, landscape.height], [1008, 612])
  assert.equal(portrait.scale, landscape.scale)
  assert.equal(portrait.x, landscape.y)
  assert.equal(portrait.y, landscape.x)
})

test('editors without a print-paper selection retain their original page layout', () => {
  assert.deepEqual(paperPreviewLayout(720, 540), { width: 720, height: 540, scale: 1, x: 0, y: 0 })
  assert.throws(() => paperPreviewLayout(600, 800, 'Unsupported'), /supported paper/)
})
