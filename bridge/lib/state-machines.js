export class AttemptBuffers {
  #attempts = new Map()
  #now

  constructor(now = Date.now) {
    this.#now = now
  }

  accept(sessionId, frame) {
    if (!frame) return null
    if (frame.type === 'start') {
      this.#attempts.set(frame.attemptId, {
        sessionId,
        blocks: [],
        startedAt: this.#now(),
        turn: frame.turn,
        step: frame.step,
        revision: frame.revision,
      })
      return 'start'
    }
    if (frame.type === 'chunk') {
      const buf = this.#attempts.get(frame.attemptId)
      const c = frame.chunk
      if (buf && c) {
        const i = typeof c.index === 'number' ? c.index : 0
        if (c.type === 'text-delta' || c.type === 'reasoning-delta') {
          const kind = c.type === 'text-delta' ? 'text' : 'reasoning'
          let block = buf.blocks.find((b) => b.index === i)
          if (!block) {
            block = { index: i, type: kind, text: '' }
            buf.blocks.push(block)
          }
          block.text += c.text ?? ''
        } else if (c.type === 'tool-call-delta') {
          let block = buf.blocks.find((b) => b.index === i)
          if (!block) {
            block = { index: i, type: 'tool-call', name: c.name ?? '', arguments: '' }
            buf.blocks.push(block)
          }
          if (c.name && !block.name) block.name = c.name
          block.arguments += c.argumentsDelta ?? ''
        } else if (c.type === 'block-end') {
          const block = buf.blocks.find((b) => b.index === i)
          if (block && c.block) block.done = true
        }
      }
      return 'chunk'
    }
    if (frame.type === 'end') {
      this.#attempts.delete(frame.attemptId)
      return 'end'
    }
    return null
  }

  latest(sessionId) {
    let latest = null
    for (const attempt of this.#attempts.values()) {
      if (attempt.sessionId === sessionId && (latest === null || attempt.startedAt > latest.startedAt)) latest = attempt
    }
    return latest
  }

  entries(sessionId) {
    return [...this.#attempts].filter(([, attempt]) => sessionId === undefined || attempt.sessionId === sessionId)
  }
}

export class TunnelController {
  #spawn
  #log
  #setTimeout
  #clearTimeout
  #retryMs
  #enabled
  #command
  #phase = 'idle'
  #proc = null
  #url = ''
  #retry = null

  constructor({ port, enabled = true, spawn, log = () => {}, retryMs = 5000, setTimeoutFn = setTimeout, clearTimeoutFn = clearTimeout }) {
    this.#spawn = spawn
    this.#log = log
    this.#setTimeout = setTimeoutFn
    this.#clearTimeout = clearTimeoutFn
    this.#retryMs = retryMs
    this.#enabled = enabled
    this.#command = ['tunnel', '--url', `http://127.0.0.1:${port}`, '--no-autoupdate']
  }

  get phase() { return this.#phase }
  get url() { return this.#url }
  get running() { return this.#proc !== null && this.#phase !== 'stopped' }

  start() {
    if (this.#phase === 'stopped' || this.#proc || !this.#enabled) return
    let child
    try {
      child = this.#spawn('cloudflared', this.#command, { stdio: ['ignore', 'pipe', 'pipe'] })
    } catch (err) {
      this.#log('no cloudflared, staying local:', String(err))
      return
    }
    this.#proc = child
    this.#phase = 'starting'
    const read = (buf) => {
      const match = String(buf).match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/)
      if (match && match[0] !== this.#url) {
        this.#url = match[0]
        this.#phase = 'online'
        this.#log('tunnel:', this.#url)
      }
    }
    child.stdout.on('data', read)
    child.stderr.on('data', read)
    child.on('error', (err) => {
      this.#log('tunnel failed:', String(err))
      if (this.#proc !== child) return
      this.#proc = null
      this.#phase = 'idle'
    })
    child.on('exit', (code) => {
      if (this.#proc !== child) return
      this.#proc = null
      this.#url = ''
      if (this.#phase === 'stopped') return
      this.#log('tunnel exited', code, `- retrying in ${this.#retryMs / 1000}s`)
      this.#phase = 'retry-wait'
      this.#retry = this.#setTimeout(() => {
        this.#retry = null
        if (this.#phase === 'retry-wait') this.#phase = 'idle'
        this.start()
      }, this.#retryMs)
      this.#retry.unref?.()
    })
  }

  stop() {
    if (this.#phase === 'stopped') return
    this.#phase = 'stopped'
    if (this.#retry !== null) this.#clearTimeout(this.#retry)
    this.#retry = null
    try { this.#proc?.kill() } catch {}
    this.#proc = null
    this.#url = ''
  }
}

export class PairingChallenge {
  #now
  #randomCode
  #ttlMs
  #ipWindowMs
  #maxIpFailures
  #maxAttempts
  #pairing = null
  #failures = new Map()

  constructor({ now = Date.now, randomCode, ttlMs = 300000, ipWindowMs = 900000, maxIpFailures = 8, maxAttempts = 3 }) {
    this.#now = now
    this.#randomCode = randomCode
    this.#ttlMs = ttlMs
    this.#ipWindowMs = ipWindowMs
    this.#maxIpFailures = maxIpFailures
    this.#maxAttempts = maxAttempts
  }

  refresh() {
    this.#pairing = { code: this.#randomCode(), expiresAt: this.#now() + this.#ttlMs, attempts: 0 }
    return this.#pairing
  }

  current() {
    return this.#pairing && this.#pairing.expiresAt > this.#now() ? this.#pairing : this.refresh()
  }

  verify(ip, code) {
    const pairing = this.#pairing
    const now = this.#now()
    const bucket = this.#failures.get(ip)
    if (bucket && now - bucket.first < this.#ipWindowMs && bucket.n >= this.#maxIpFailures) return { ok: false, status: 429, error: 'ip_blocked' }
    if (!pairing || pairing.expiresAt < now) return { ok: false, status: 410, error: 'code_expired' }
    if (pairing.attempts >= this.#maxAttempts) return { ok: false, status: 429, error: 'too_many_attempts' }
    if (String(code ?? '') !== pairing.code) {
      pairing.attempts += 1
      const failures = bucket && now - bucket.first < this.#ipWindowMs ? bucket : { first: now, n: 0 }
      failures.n += 1
      this.#failures.set(ip, failures)
      return { ok: false, status: 401, error: 'bad_code', attemptsLeft: Math.max(0, this.#maxAttempts - pairing.attempts) }
    }
    this.#pairing = null
    this.#failures.delete(ip)
    return { ok: true }
  }
}
