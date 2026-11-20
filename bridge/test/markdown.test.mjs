// Plain-assert checks for the bridge's Markdown nodes and code colours. Run: node bridge/test/markdown.test.mjs
import assert from 'node:assert/strict'
import { highlightLines, highlightRuns, mdNodes } from '../lib/index.js'

const US = '\u001f'
const kinds = (src, o) => mdNodes(src, o).map((n) => n.t).join()
const one = (src) => mdNodes(src)[0]

// lists: the source's own numbers, depth by indentation, nested mixed kinds, task boxes, continuation lines
{
  const l = one('3. third\n4. fourth\n   - sub a\n   - sub b\n5. fifth')
  assert.deepEqual(l.items.map((i) => `${i.mark}${i.d}`), ['3.0', '4.0', '◦1', '◦1', '5.0'])
  const t = one('- [ ] todo\n- [x] done\n- text\n  continued')
  assert.deepEqual(t.items.map((i) => [i.mark, i.sign]), [['☐', 'o'], ['☑', 'x'], ['•', ' ']])
  assert.equal(t.items[2].v, 'text\ncontinued')
  assert.equal(kinds('- a\n\n1. b'), 'ul,ol') // a new kind at the top level is another list
  assert.equal(kinds('text\n- x'), 'p,ul')
  assert.equal(kinds('text\n2. x'), 'p') // only "1." may interrupt a paragraph
}

// tables: cells joined with U+001F, alignment per column, escaped pipes
{
  const t = one('| Name | Qty |\n|:--|--:|\n| a \\| b | 1 |\n| short |')
  assert.equal(t.t, 'table')
  assert.equal(t.align, 'lr')
  assert.equal(t.head, `Name${US}Qty`)
  assert.deepEqual(t.rows.map((r) => r.v), [`a | b${US}1`, `short${US}`])
  assert.equal(kinds('| a | b |\n| c | d |'), 'p') // no delimiter row
}

// headings, math, fences
assert.equal(kinds('Title\n=====\n\nSub\n---'), 'h,h')
assert.deepEqual(mdNodes('$$\nE=mc^2\n$$\n\n$$a+b$$').map((n) => n.v), ['E=mc^2', 'a+b'])
assert.equal(one('a $x^2$ b $5 and $10 \\(y\\)').v, 'a `x^2` b $5 and $10 `y`')
assert.deepEqual(mdNodes('````md\n```js\nx\n```\n````\n\n```\nopen\nrest').map((n) => n.v), ['```js\nx\n```', 'open\nrest'])
assert.equal(one('```json\n{"alpha":1,"beta":[1,2],"gamma":{"x":"yyyyyyyyyyyyyyyyyyyyyy"}}\n```').v.split('\n').length > 8, true)
assert.equal(one('```diff\n-old\n+new\n```').items.map((i) => i.sign).join(''), '-+')

// inline rewrites: a file link goes to the phone's route, a URL stays; a ** CommonMark refuses beside CJK gets a hair space
assert.equal(one('[a](src/a.ts:12) [b](https://x.com) [c](#top)').v, '[a](/file?p=src%2Fa.ts) [b](https://x.com) [c](#top)')
assert.equal(one('**“你好”**世界').v, '**“你好”** 世界')

// code colours: runs rebuild the source; unknown languages and oversized blocks have none
{
  const src = 'const x: Foo = f("a", 1) // c\nreturn true'
  const runs = highlightRuns('ts', src)
  assert.equal(runs.map((r) => r[1]).join(''), src)
  assert.deepEqual(['k', 's', 'n', 'c', 'f', 't', 'l'].filter((m) => !runs.some((r) => r[0] === m)), [])
  assert.equal(highlightRuns('zig', 'x'), null)
  assert.equal(highlightRuns('js', 'x\n'.repeat(200)), null)
  const lines = highlightLines('js', ['const a = 1', '', 'return 2'])
  assert.equal(lines.length, 3)
  assert.equal(lines[1].length, 0)
  assert.equal(one('```js\nconst a = 1\n```').runs.map((r) => r[1]).join(''), 'const a = 1')
  assert.equal(mdNodes('```js\nconst a = 1\n```', { highlight: false })[0].runs, undefined)
}

// hostile input neither throws nor stalls
{
  const t0 = Date.now()
  for (const src of ['`'.repeat(6000), '*'.repeat(20000), '['.repeat(8000), '$a'.repeat(8000), '\\'.repeat(9000), '- '.repeat(5000), '> '.repeat(5000), '![a](b)'.repeat(2000), '```'.repeat(2000)]) mdNodes(src)
  assert.ok(Date.now() - t0 < 4000)
}

console.log('markdown.test.mjs: ok')
