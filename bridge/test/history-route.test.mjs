import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import net from 'node:net'

const home = fs.mkdtempSync(path.join(os.tmpdir(), 'bridge-history-'))
process.env.HOME = home
const probe = net.createServer()
await new Promise((resolve) => probe.listen(0, '127.0.0.1', resolve))
const port = probe.address().port
await new Promise((resolve) => probe.close(resolve))

const records = []
for (let turn = 1; turn <= 60; turn += 1) {
  const seq = turn * 4 - 3
  records.push(
    { event: { seq, type: 'turn/start', time: seq * 1000, data: { turn } } },
    { event: { seq: seq + 1, type: 'user/message', time: seq * 1000 + 1, data: { turn, id: `q${turn}`, source: { kind: 'user' }, content: [{ type: 'text', text: `question ${turn}` }] } } },
    { event: { seq: seq + 2, type: 'assistant/message', time: seq * 1000 + 2, data: { turn, step: 1, message: { id: `a${turn}`, content: [{ type: 'text', text: `answer ${turn}\n\n${Array.from({ length: 20 }, () => 'x'.repeat(16000)).join('\n\n')}` }] } } } },
    { event: { seq: seq + 3, type: 'turn/end', time: seq * 1000 + 3, data: { turn, reason: { kind: 'complete' } } } },
  )
}

const session = { sessionId: 's', cwd: home, updatedAt: 1, projections: { values: { title: 'history' } } }
const sessionController = {
  list: async () => ({ items: [session] }),
  state: async () => ({ cursor: records.at(-1).event.seq, running: false, queue: [] }),
  projections: async () => ({ values: { turnOutline: records.filter((r) => r.event.type === 'turn/end').map((r) => ({ turn: r.event.data.turn })) } }),
  events: async (request) => {
    const before = request.beforeSeq ?? Number.POSITIVE_INFINITY
    const available = records.filter((r) => r.event.seq < before)
    const turns = [...new Set(available.map((r) => r.event.data.turn).filter(Boolean))]
    const minTurns = request.turnWindow?.minTurns ?? turns.length
    const minMessages = request.turnWindow?.minMessages ?? 0
    let first = turns.length
    let count = 0
    while (first > 0) {
      const turn = turns[first - 1]
      const size = available.filter((r) => r.event.data.turn === turn).length
      if (count > 0 && count + size > request.maxMessages) break
      if (turns.length - first >= minTurns && count >= minMessages) break
      first -= 1
      count += size
    }
    const oldest = turns[first]
    const page = available.filter((r) => r.event.data.turn >= oldest)
    return { records: page, hasMore: first > 0, cursor: page.at(-1)?.event.seq ?? 0 }
  },
}
const disposers = []
const ctx = {
  get: (name) => name === 'sessionController' ? sessionController : undefined,
  on: () => {},
  effect: (fn) => disposers.push(fn()),
}
const { apply } = await import('../lib/index.js')
apply(ctx, { port, tunnel: false })
const base = `http://127.0.0.1:${port}`
let token = ''
try {
  for (let i = 0; i < 50; i += 1) {
    try { const res = await fetch(`${base}/v1/health`); if (res.ok) break } catch {}
    await new Promise((resolve) => setTimeout(resolve, 20))
  }
  const pairing = await (await fetch(`${base}/v1/pairing`)).json()
  const paired = await (await fetch(`${base}/v1/pair`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ code: pairing.code }) })).json()
  token = paired.token
  const get = async (query) => {
    const res = await fetch(`${base}/v1/transcript?session=s${query}`, { headers: { authorization: `Bearer ${token}` } })
    assert.equal(res.status, 200)
    return res.json()
  }

  const first = await get('&take=8&lang=en')
  assert.ok(first.rows.length < 16, JSON.stringify({ rows: first.rows.length, from: first.from, sizes: first.rows.map((r) => JSON.stringify(r).length) }))
  assert.equal(first.hasMore, true)
  assert.ok(first.from > 0)

  const all = [...first.rows]
  const cursors = [first.from]
  let page = first
  for (let i = 0; i < 5 && page.hasMore; i += 1) {
    page = await get(`&before=${page.from}&lang=en`)
    assert.ok(page.from === 0 || page.from < cursors.at(-1))
    cursors.push(page.from)
    all.push(...page.rows)
  }
  assert.equal(page.hasMore, false)
  assert.equal(all.length, 120)
  assert.equal(new Set(all.map((r) => r.id)).size, 120)
  assert.ok(cursors.length > 2)
  assert.equal(cursors.at(-1), 0)
  for (let turn = 1; turn <= 60; turn += 1) {
    assert.ok(all.some((r) => r.turn === turn && r.role === 'user'))
    assert.ok(all.some((r) => r.turn === turn && r.role === 'assistant'))
  }
  console.log('history-route: all assertions passed')
} finally {
  for (const dispose of disposers) dispose()
  fs.rmSync(home, { recursive: true, force: true })
}
