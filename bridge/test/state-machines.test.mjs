import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { AttemptBuffers, PairingChallenge, TunnelController } from '../lib/state-machines.js'

{
  let now = 100
  const attempts = new AttemptBuffers(() => now)
  assert.equal(attempts.accept('s', { type: 'chunk', attemptId: 'a', chunk: { type: 'text-delta', index: 0, text: 'ignored' } }), 'chunk')
  assert.equal(attempts.latest('s'), null)
  assert.equal(attempts.accept('s', { type: 'start', attemptId: 'a', turn: 1, step: 1 }), 'start')
  attempts.accept('s', { type: 'chunk', attemptId: 'a', chunk: { type: 'text-delta', index: 0, text: 'hel' } })
  attempts.accept('s', { type: 'chunk', attemptId: 'a', chunk: { type: 'text-delta', index: 0, text: 'lo' } })
  attempts.accept('s', { type: 'chunk', attemptId: 'a', chunk: { type: 'tool-call-delta', index: 1, name: 'bash', argumentsDelta: '{"command":' } })
  attempts.accept('s', { type: 'chunk', attemptId: 'a', chunk: { type: 'tool-call-delta', index: 1, argumentsDelta: '"pwd"}' } })
  attempts.accept('s', { type: 'chunk', attemptId: 'a', chunk: { type: 'block-end', index: 1, block: {} } })
  assert.deepEqual(attempts.latest('s').blocks, [
    { index: 0, type: 'text', text: 'hello' },
    { index: 1, type: 'tool-call', name: 'bash', arguments: '{"command":"pwd"}', done: true },
  ])
  now = 200
  attempts.accept('s', { type: 'start', attemptId: 'b', turn: 2, step: 1 })
  assert.equal(attempts.entries('s').length, 2)
  assert.equal(attempts.entries('other').length, 0)
  assert.equal(attempts.latest('s').turn, 2)
  assert.equal(attempts.accept('s', { type: 'end', attemptId: 'b' }), 'end')
  assert.equal(attempts.latest('s').turn, 1)
  assert.equal(attempts.accept('s', { type: 'end', attemptId: 'b' }), 'end')
  assert.equal(attempts.latest('s').turn, 1)
}

{
  const children = []
  const timers = []
  const tunnel = new TunnelController({
    port: 8787,
    spawn: () => {
      const child = new EventEmitter()
      child.stdout = new EventEmitter()
      child.stderr = new EventEmitter()
      child.kill = () => { child.killed = true }
      children.push(child)
      return child
    },
    setTimeoutFn: (fn, ms) => {
      const timer = { fn, ms, unref() {} }
      timers.push(timer)
      return timer
    },
    clearTimeoutFn: (timer) => { timer.cleared = true },
  })
  tunnel.start()
  assert.equal(tunnel.phase, 'starting')
  assert.equal(tunnel.running, true)
  children[0].stderr.emit('data', 'https://one.trycloudflare.com')
  assert.equal(tunnel.phase, 'online')
  assert.equal(tunnel.url, 'https://one.trycloudflare.com')
  children[0].emit('exit', 1)
  assert.equal(tunnel.phase, 'retry-wait')
  assert.equal(tunnel.url, '')
  assert.equal(timers[0].ms, 5000)
  timers[0].fn()
  assert.equal(children.length, 2)
  assert.equal(tunnel.phase, 'starting')
  children[1].stdout.emit('data', 'https://two.trycloudflare.com')
  tunnel.stop()
  assert.equal(tunnel.phase, 'stopped')
  assert.equal(tunnel.running, false)
  assert.equal(children[1].killed, true)
  tunnel.start()
  assert.equal(children.length, 2)

  const retried = new TunnelController({
    port: 8787,
    spawn: () => children[0],
    setTimeoutFn: (fn) => ({ fn, unref() {} }),
    clearTimeoutFn: (timer) => { timer.cleared = true },
  })
  retried.start()
  children[0].emit('exit', 1)
  retried.stop()
}

{
  let now = 1000
  let next = 0
  const pairing = new PairingChallenge({ now: () => now, randomCode: () => String(++next).padStart(6, '0') })
  assert.equal(pairing.current().code, '000001')
  assert.equal(pairing.current().code, '000001')
  assert.deepEqual(pairing.verify('ip', 'bad'), { ok: false, status: 401, error: 'bad_code', attemptsLeft: 2 })
  pairing.verify('ip', 'bad')
  pairing.verify('ip', 'bad')
  assert.deepEqual(pairing.verify('ip', '000001'), { ok: false, status: 429, error: 'too_many_attempts' })
  pairing.refresh()
  for (let i = 0; i < 5; i += 1) {
    pairing.verify('ip', 'bad')
    pairing.refresh()
  }
  assert.deepEqual(pairing.verify('ip', pairing.current().code), { ok: false, status: 429, error: 'ip_blocked' })
  assert.deepEqual(pairing.verify('other', pairing.current().code), { ok: true })
  assert.deepEqual(pairing.verify('other', '000002'), { ok: false, status: 410, error: 'code_expired' })

  now += 300001
  pairing.refresh()
  now += 300001
  assert.deepEqual(pairing.verify('other', '000008'), { ok: false, status: 410, error: 'code_expired' })
  assert.notEqual(pairing.current().code, '000008')
}

console.log('state-machines: all assertions passed')
