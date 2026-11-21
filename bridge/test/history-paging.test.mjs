// Plain-assert checks for history paging: rows split at host Turn starts, and whole Turns kept within a budget.
// Run: node bridge/test/history-paging.test.mjs
import assert from 'node:assert/strict'
import { turnSegments, fitSegments } from '../lib/index.js'

const row = (first) => ({ id: `r${first}`, seq: first })
const ids = (segs) => segs.map((s) => [s.start, s.rows.map((r) => r.seq)])

// Each row joins the Turn whose start is the last one at or before its first event; rows before the first start form the head.
assert.deepEqual(ids(turnSegments([3, 5, 12, 14, 21].map(row), [4, 11, 20])), [[null, [3]], [4, [5]], [11, [12, 14]], [20, [21]]])

// A row whose own seq moved on (it took later steps) is placed by the seq of its first event.
{
  const firstOf = (r) => (r.id === 'a6' ? 6 : r.seq)
  assert.deepEqual(ids(turnSegments([row(5), { id: 'a6', seq: 30 }, row(12)], [4, 11], firstOf)), [[4, [5, 30]], [11, [12]]])
}

// An out-of-order row (an orphan call appended last) stays with the Turn it follows, so the row order never changes.
assert.deepEqual(ids(turnSegments([12, 21, 2].map(row), [11, 20])), [[11, [12]], [20, [21, 2]]])

// No Turn start in the read: everything is the head.
assert.deepEqual(ids(turnSegments([7, 8].map(row), [])), [[null, [7, 8]]])
assert.deepEqual(turnSegments([], [4]), [])

// The newest Turns that fit stay; the newest always stays, even alone over the budget.
assert.equal(fitSegments([100, 50, 70], 130), 1)
assert.equal(fitSegments([100, 50, 70], 220), 0)
assert.equal(fitSegments([100, 50, 70], 10), 2)
assert.equal(fitSegments([], 10), 0)

console.log('history-paging: all assertions passed')
