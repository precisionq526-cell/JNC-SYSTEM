import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import ts from 'typescript'

const source = fs.readFileSync('src/lib/kiosk/print-options.ts', 'utf8')
const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText
const { parsePrintPages, validatePrintOptions, restoreConfiguredOptions } = await import('data:text/javascript;base64,' + Buffer.from(code).toString('base64'))

test('page selections accept All and deduplicate ascending comma ranges', () => {
  assert.equal(parsePrintPages(' all '), null)
  assert.deepEqual(parsePrintPages('1-3, 5, 2'), [1, 2, 3, 5])
})
test('invalid and out-of-document pages are rejected before submission', () => {
  for (const value of ['', '0', '3-1', '1,,2', '-1', '1.5', '1-', '1-10001', '1-2,']) assert.throws(() => parsePrintPages(value))
  assert.throws(() => parsePrintPages('1-3', 2), /exceeds/)
  assert.match(validatePrintOptions({ 'Pages to print': '1-3' }, [5, 2]), /exceeds/)
})
test('copy counts must be whole positive numbers; valid print options remain unchanged', () => {
  for (const Copies of [0, -1, 1.5, '', 'x', 10001]) assert.match(validatePrintOptions({ Copies }), /whole number/)
  assert.equal(validatePrintOptions({ Copies: 3, 'Pages to print': '1-2', 'Back to back': 'Yes' }, [2]), null)
})
test('old drafts retain only real configured choices when catalog options change', () => {
  const definitions = [{ name: 'Paper Size', optionType: 'select', choices: ['A4', 'Long'] }, { name: 'Copies', optionType: 'number' }]
  assert.deepEqual(restoreConfiguredOptions(definitions, { 'Paper Size': 'A4', Copies: 2, Fake: 'demo' }), { 'Paper Size': 'A4', Copies: 2 })
  assert.deepEqual(restoreConfiguredOptions(definitions, { 'Paper Size': 'Removed' }), {})
})
