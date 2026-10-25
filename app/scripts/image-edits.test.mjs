import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import ts from 'typescript'
const code = ts.transpileModule(fs.readFileSync('src/lib/editor/image-edits.ts', 'utf8'), { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText
const { getEditedImageSize } = await import('data:text/javascript;base64,' + Buffer.from(code).toString('base64'))
test('viewport scaling never shrinks a saved image without an intentional crop or resize', () => {
  assert.deepEqual(getEditedImageSize(480, 320, { shownImageDimensions: { width: 213, height: 142 } }), { width: 480, height: 320 })
  assert.deepEqual(getEditedImageSize(4000, 3000, {}), { width: 4000, height: 3000 })
})
test('crop, rotation and explicit resize determine the output dimensions', () => {
  assert.deepEqual(getEditedImageSize(480, 320, { shownImageDimensions: { width: 240, height: 160 }, adjustments: { crop: { width: 120, height: 80 } } }), { width: 240, height: 160 })
  assert.deepEqual(getEditedImageSize(480, 320, { adjustments: { rotation: 90 } }), { width: 320, height: 480 })
  assert.deepEqual(getEditedImageSize(480, 320, { resize: { width: 240 } }), { width: 240, height: 160 })
})
