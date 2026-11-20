// Plain-assert checks for the bridge's line diff. Run: node bridge/test/diff.test.mjs
import assert from 'node:assert/strict'
import { diffLines, diffText } from '../lib/index.js'

const sign = (lines) => lines.map((l) => `${l.sign}${l.text}`)
const nums = (n, from = 1) => Array.from({ length: n }, (_, i) => `l${from + i}`).join('\n')

// identical texts have no hunks
assert.deepEqual(diffLines('a\nb\nc', 'a\nb\nc'), [])
assert.deepEqual(diffText('', ''), { lines: [], added: 0, removed: 0 })

// one replaced line: header + 3 lines of context on each side
{
  const old = nums(10)
  const next = old.replace('l5', 'five')
  const r = diffText(old, next)
  assert.deepEqual(sign(r.lines), ['@@@ -2,7 +2,7 @@', ' l2', ' l3', ' l4', '-l5', '+five', ' l6', ' l7', ' l8'])
  assert.deepEqual([r.added, r.removed], [1, 1])
  assert.deepEqual(r.lines.map((l) => l.id), r.lines.map((_, i) => `d${i}`))
}

// a real diff, not a head/tail trim: unchanged lines between two edits stay unchanged
{
  const r = diffText('1\n2\n3\n4\n5', '1\n3\n5\n6')
  assert.deepEqual(sign(r.lines), ['@@@ -1,5 +1,4 @@', ' 1', '-2', ' 3', '-4', ' 5', '+6'])
  assert.deepEqual([r.added, r.removed], [1, 2])
}

// two distant edits are two hunks (headers carry the right line numbers); close edits merge into one
{
  const old = nums(30)
  const far = old.replace('l3\n', 'three\n').replace('l28\n', 'twenty-eight\n')
  const r = diffText(old, far)
  const headers = r.lines.filter((l) => l.sign === '@').map((l) => l.text)
  assert.deepEqual(headers, ['@@ -1,6 +1,6 @@', '@@ -25,6 +25,6 @@'])
  const near = diffText(old, old.replace('l10\n', 'ten\n').replace('l14\n', 'fourteen\n'))
  assert.equal(near.lines.filter((l) => l.sign === '@').length, 1) // 3 unchanged lines between: contexts touch
  const gap = diffText(old, old.replace('l10\n', 'ten\n').replace('l20\n', 'twenty\n'))
  assert.equal(gap.lines.filter((l) => l.sign === '@').length, 2)
}

// creation and deletion: the empty side is `0,0`
{
  const created = diffText(null, 'a\nb\n')
  assert.deepEqual(sign(created.lines), ['@@@ -0,0 +1,2 @@', '+a', '+b'])
  assert.deepEqual([created.added, created.removed], [2, 0])
  const deleted = diffText('a\nb', '')
  assert.deepEqual(sign(deleted.lines), ['@@@ -1,2 +0,0 @@', '-a', '-b'])
  assert.deepEqual([deleted.added, deleted.removed], [0, 2])
}

// the cap trims the rows, never the counts; a marker says rows were dropped
{
  const r = diffText(nums(100), nums(100, 1000), 10)
  assert.equal(r.lines.length, 11)
  assert.deepEqual(r.lines[10], { id: 'd10', sign: '…', text: 'diff truncated' })
  assert.deepEqual([r.added, r.removed], [100, 100])
  // exactly at the cap is not truncated
  const exact = diffText('a', 'b', 3)
  assert.deepEqual(sign(exact.lines), ['@@@ -1,1 +1,1 @@', '-a', '+b'])
}

// bounded input: far past the edit budget the middle reads as one replacement, quickly
{
  const a = Array.from({ length: 3000 }, (_, i) => `a${i}`).join('\n')
  const b = Array.from({ length: 3000 }, (_, i) => `b${i}`).join('\n')
  const t0 = Date.now()
  const r = diffText(a, b, 5)
  assert.deepEqual([r.added, r.removed], [3000, 3000])
  assert.ok(Date.now() - t0 < 2000, 'bounded diff must stay fast')
  const huge = diffText(Array.from({ length: 50000 }, (_, i) => `x${i}`).join('\n'), Array.from({ length: 50000 }, (_, i) => `y${i}`).join('\n'), 5)
  assert.deepEqual([huge.added, huge.removed], [50000, 50000])
}

// property: the script is a shortest edit script (n + m - 2*LCS) and replays to the new text
{
  const lcs = (x, y) => {
    const t = Array.from({ length: x.length + 1 }, () => new Array(y.length + 1).fill(0))
    for (let i = 1; i <= x.length; i += 1) for (let j = 1; j <= y.length; j += 1) t[i][j] = x[i - 1] === y[j - 1] ? t[i - 1][j - 1] + 1 : Math.max(t[i - 1][j], t[i][j - 1])
    return t[x.length][y.length]
  }
  let seed = 7
  const rnd = (n) => { seed = (Math.imul(seed, 1103515245) + 12345) & 0x7fffffff; return (seed >>> 8) % n }
  for (let round = 0; round < 400; round += 1) {
    const x = Array.from({ length: rnd(14) }, () => String.fromCharCode(97 + rnd(4)))
    const y = Array.from({ length: rnd(14) }, () => String.fromCharCode(97 + rnd(4)))
    const r = diffText(x.join('\n'), y.join('\n'), 1e9)
    assert.equal(r.added + r.removed, x.length + y.length - 2 * lcs(x, y), `minimal: ${x.join('')} -> ${y.join('')}`)
    // replay: old lines minus removals plus additions, in hunk order, equals new (context fills the rest)
    const out = []
    let oldIdx = 0
    for (const l of r.lines) {
      if (l.sign === '@') {
        const m = /^@@ -(\d+),(\d+) \+(\d+),(\d+) @@$/.exec(l.text)
        assert.ok(m, `header shape: ${l.text}`)
        const start = Number(m[2]) === 0 ? Number(m[1]) : Number(m[1]) - 1
        while (oldIdx < start) { out.push(x[oldIdx]); oldIdx += 1 } // untouched lines between hunks
        assert.equal(out.length + 1, Number(m[4]) === 0 ? Number(m[3]) + 1 : Number(m[3]), `new-side start: ${x.join('')} -> ${y.join('')}`)
      } else if (l.sign === ' ') { out.push(l.text); oldIdx += 1 } else if (l.sign === '-') oldIdx += 1
      else if (l.sign === '+') out.push(l.text)
    }
    while (oldIdx < x.length) { out.push(x[oldIdx]); oldIdx += 1 }
    assert.deepEqual(out, y, `replay: ${x.join('')} -> ${y.join('')}`)
  }
}

console.log('diff.test.mjs: ok')
