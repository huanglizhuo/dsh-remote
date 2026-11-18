import http from 'node:http'
import { spawn, spawnSync } from 'node:child_process'
import qrcode from '../vendor/qrcode.js'
import crypto from 'node:crypto'
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'

export const name = 'dsh-remote'

/** An SVG QR for `text`; the page shows it, the phone scans it. */
function qrSvg(text, cellSize = 6, margin = 4) {
  const qr = qrcode(0, 'M')
  qr.addData(text)
  qr.make()
  return qr.createSvgTag({ cellSize, margin })
}


/** Pixel size of a PNG or JPEG on disk, for laying an image out before it loads. */
function imageSize(file) {
  try {
    const fd = fs.openSync(file, 'r')
    const head = Buffer.alloc(32)
    fs.readSync(fd, head, 0, 32, 0)
    fs.closeSync(fd)
    if (head.slice(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
      return { w: head.readUInt32BE(16), h: head.readUInt32BE(20) }
    }
    if (head[0] === 0xff && head[1] === 0xd8) {
      const buf = fs.readFileSync(file)
      let i = 2
      while (i < buf.length - 9) {
        if (buf[i] !== 0xff) { i += 1; continue }
        const marker = buf[i + 1]
        const len = buf.readUInt16BE(i + 2)
        if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
          return { w: buf.readUInt16BE(i + 7), h: buf.readUInt16BE(i + 5) }
        }
        i += 2 + len
      }
    }
  } catch {}
  return null
}

const STATE_FILE = path.join(os.homedir(), '.dsh', 'mobile-bridge.json')
const FEED_MAX = 4000
const SESSION_MAX = 200

const json = (res, status, body) => {
  // A second write after the response started would throw ERR_HTTP_HEADERS_SENT,
  // which — uncaught in the request handler — kills the whole DSH host process.
  if (res.headersSent) return
  const data = JSON.stringify(body)
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(data),
    'cache-control': 'no-store',
    'access-control-allow-origin': '*',
  })
  res.end(data)
}

const readBody = (req, limit = 2 * 1024 * 1024) =>
  new Promise((resolve, reject) => {
    let size = 0
    const chunks = []
    req.on('data', (c) => {
      size += c.length
      if (size > limit) {
        reject(new Error('body_too_large'))
        req.destroy()
        return
      }
      chunks.push(c)
    })
    req.on('end', () => {
      if (!chunks.length) return resolve({})
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')))
      } catch (err) {
        reject(new Error('invalid_json'))
      }
    })
    req.on('error', reject)
  })

const short = (v, n = 400) => {
  const s = typeof v === 'string' ? v : JSON.stringify(v)
  return (s ?? '').slice(0, n)
}

function loadState() {
  try {
    return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'))
  } catch {
    return {}
  }
}

function saveState(state) {
  try {
    fs.mkdirSync(path.dirname(STATE_FILE), { recursive: true })
    fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2), { mode: 0o600 })
  } catch (err) {
    console.log('[mobile-bridge] cannot persist state:', String(err))
  }
}

const permissionCatalog = (ctx) => {
  try {
    const svc = ctx.get('permissionPresets')
    const cat = svc?.catalog?.()
    if (!cat) return null
    return {
      options: (cat.options ?? []).map((o) => ({ value: o.value, name: o.name, description: o.description ?? '' })),
      default: cat.defaultPreset ?? '',
    }
  } catch { return null }
}

export function apply(ctx, config = {}) {
  const port = Number(process.env.DSH_MOBILE_BRIDGE_PORT ?? config.port ?? 8787)
  // Tool calls whose assistant message is not in the page; filled per snapshot and
  // never shared between sessions (a stale entry used to leak rows across transcripts).
  const orphanCalls = new Map()
  // Attachment refs seen in a transcript, so /v1/attachments/<id> can read the bytes back.
  const imageRefs = new Map()
  const log = (...args) => console.log('[mobile-bridge]', ...args)
  const saved = loadState()
  // Older stores kept bare token strings; give them the device-record shape.
  if (Array.isArray(saved.tokens)) saved.tokens = saved.tokens.map((e) => (typeof e === 'string' ? { t: e, name: '未命名设备', at: 0 } : e))

  const state = {
    pairing: null, // { code, expiresAt, attempts }
    tokens: Array.isArray(saved.tokens) ? saved.tokens : saved.token ? [saved.token] : [],
    instanceId: crypto.randomBytes(6).toString('hex'),
  }

  const issuePairingCode = () => {
    state.pairing = {
      code: String(crypto.randomInt(0, 1_000_000)).padStart(6, '0'),
      expiresAt: Date.now() + 5 * 60_000,
      attempts: 0,
    }
    log('pairing code:', state.pairing.code, '(5 min)')
    return state.pairing
  }

  /**
   * The public address. Quick Tunnels cost nothing and need no account, but the
   * hostname changes on every start — so the bridge owns the process and reads
   * the URL out of its log instead of asking the person to copy it.
   */
  const tunnel = { url: '', proc: null, stopped: false }
  const startTunnel = () => {
    if (tunnel.stopped || tunnel.proc || config.tunnel === false) return
    let child
    try {
      child = spawn('cloudflared', ['tunnel', '--url', `http://127.0.0.1:${port}`, '--no-autoupdate'], { stdio: ['ignore', 'pipe', 'pipe'] })
    } catch (err) {
      log('no cloudflared, staying local:', String(err))
      return
    }
    tunnel.proc = child
    const read = (buf) => {
      const m = String(buf).match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/)
      if (m && m[0] !== tunnel.url) {
        tunnel.url = m[0]
        log('tunnel:', tunnel.url)
      }
    }
    child.stdout.on('data', read)
    child.stderr.on('data', read)
    child.on('error', (err) => { log('tunnel failed:', String(err)); tunnel.proc = null })
    child.on('exit', (code) => {
      tunnel.proc = null
      tunnel.url = ''
      if (tunnel.stopped) return
      log('tunnel exited', code, '- retrying in 5s')
      setTimeout(startTunnel, 5000).unref?.()
    })
  }

  /** Feed: one global cursor across every session, so a single poll covers all. */
  let eid = 0
  const feed = []
  const listeners = new Set()
  const sessions = new Map() // sessionId -> { id, status, title?, cwd?, updatedAt, lastSeq }

  const pushFeed = (sessionId, type, data, extra = {}) => {
    const item = { eid: ++eid, sessionId, type, at: Date.now(), data, ...extra }
    feed.push(item)
    if (feed.length > FEED_MAX) feed.splice(0, feed.length - FEED_MAX)
    for (const fn of listeners) fn(item)
    return item
  }

  const touchSession = (sessionId, patch = {}) => {
    if (!sessionId) return null
    const cur = sessions.get(sessionId) ?? { id: sessionId, status: 'idle', updatedAt: 0, lastSeq: null }
    const next = { ...cur, ...patch, updatedAt: Date.now() }
    sessions.set(sessionId, next)
    return next
  }

  /** Per-attempt live buffers, so the phone can render streaming text before it settles. */
  const live = new Map() // attemptId -> { sessionId, blocks: [{index, type, text}], startedAt, turn, step }

  const agentStatus = () => {
    const out = new Map()
    try {
      const agents = ctx.get?.('agents') ?? ctx.agents
      for (const a of agents?.list?.() ?? []) {
        out.set(a?.session?.id ?? a?.id, { status: a?.status ?? null })
      }
    } catch {}
    return out
  }

  // ---- Cordis subscriptions -------------------------------------------------
  ctx.on(
    'agent/assistant-stream',
    ({ agent, frame }) => {
      const sessionId = agent?.session?.id ?? null
      if (!frame) return
      if (frame.type === 'start') {
        live.set(frame.attemptId, { sessionId, blocks: [], startedAt: Date.now(), turn: frame.turn, step: frame.step, revision: frame.revision })
        touchSession(sessionId, { status: 'running' })
        pushFeed(sessionId, 'live/start', { attemptId: frame.attemptId, turn: frame.turn, step: frame.step })
        return
      }
      if (frame.type === 'chunk') {
        const buf = live.get(frame.attemptId)
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
        pushFeed(sessionId, 'live/chunk', { attemptId: frame.attemptId, index: frame.index })
        return
      }
      if (frame.type === 'end') {
        const buf = live.get(frame.attemptId)
        live.delete(frame.attemptId)
        touchSession(sessionId, { status: 'idle' })
        pushFeed(sessionId, 'live/end', { attemptId: frame.attemptId, outcome: frame.outcome })
      }
    },
    { global: true },
  )

  ctx.on(
    'session/event',
    (session, event) => {
      const sessionId = session?.id ?? null
      if (!event) return
      touchSession(sessionId, { lastSeq: typeof event.seq === 'number' ? event.seq : null })
      pushFeed(sessionId, event.type, event.data, { seq: event.seq, time: event.time })
    },
    { global: true },
  )

  // ---- Approvals: the phone is the answerer while it is on screen -----------
  const approvals = new Map() // id -> { sessionId, toolName, reason, callId, expiresAt, settle }
  const pairFails = new Map() // ip -> { first, n }
  // Platform wallet balance for the main screen; refreshed at most every 5 minutes.
  const balanceCache = { at: 0, data: null, busy: false }
  const refreshBalance = () => {
    if (balanceCache.busy || Date.now() - balanceCache.at < 300000) return
    const svc = ctx.get('deepseekAccount')
    if (!svc || typeof svc.getBalance !== 'function') return
    balanceCache.busy = true
    const wallet = (w, i) => ({ id: `w${i}`, currency: String(w?.currency ?? ''), text: String(w?.balance ?? '') })
    svc.getBalance({ version: '0.0.0', locale: 'zh-CN', timezoneOffsetSeconds: -new Date().getTimezoneOffset() * 60 })
      .then((r) => {
        balanceCache.data = r == null
          ? { signedOut: true, wallets: [], bonus: [] }
          : r.status === 'ready'
            ? { signedOut: false, wallets: (r.value ?? []).map(wallet), bonus: (r.bonusWallets ?? []).map(wallet) }
            : { signedOut: false, failed: true, wallets: [], bonus: [] }
        balanceCache.at = Date.now()
      })
      .catch(() => { balanceCache.at = Date.now() })
      .finally(() => { balanceCache.busy = false })
  }
  const phoneSeen = new Map()
  const PHONE_WAIT_MS = 15000
  const PHONE_ACTIVE_MS = 90000

  ctx.on(
    'approval/request',
    (req, next) => {
      const sessionId = req?.agent?.session?.id ?? req?.agent?.id ?? null
      const active = sessionId && Date.now() - (phoneSeen.get(sessionId) ?? 0) < PHONE_ACTIVE_MS
      if (!active) return next() // nobody is holding the phone: the desktop answers
      const approvalId = crypto.randomBytes(4).toString('hex')
      const expiresAt = Date.now() + PHONE_WAIT_MS
      const decision = new Promise((resolve) => {
        const timer = setTimeout(() => {
          approvals.delete(approvalId)
          pushFeed(sessionId, 'approval/timeout', { approvalId })
          resolve(null)
        }, PHONE_WAIT_MS)
        approvals.set(approvalId, {
          sessionId,
          agent: req?.agent ?? null,
          toolName: req?.toolName ?? null,
          callId: req?.callId ?? null,
          reason: req?.displayReason ?? req?.reason ?? null,
          expiresAt,
          settle: (value) => {
            clearTimeout(timer)
            approvals.delete(approvalId)
            resolve(value)
          },
        })
      })
      pushFeed(sessionId, 'approval/request', {
        approvalId,
        toolName: req?.toolName ?? null,
        callId: req?.callId ?? null,
        reason: req?.displayReason ?? req?.reason ?? null,
        expiresAt,
      })
      log('approval on the phone:', approvalId, req?.toolName)
      return decision.then((value) => (value ?? next()))
    },
    { prepend: true },
  )

  // A tool asking the user a question (ask_user_question, or a plan review) is the
  // other half of "answer from the phone": capture the same seam the desktop uses.
  const questions = new Map() // id -> { sessionId, callId, agent, items, expiresAt, settle }
  const QUESTION_WAIT_MS = 120000

  const questionView = (q) => ({
    id: q.id,
    callId: q.callId,
    expiresIn: Math.max(0, Math.round((q.expiresAt - Date.now()) / 1000)),
    questions: (q.items ?? []).map((item, i) => ({
      id: item?.id ?? `q${i}`,
      header: item?.header ?? '',
      question: item?.question ?? '',
      detail: item?.detail ?? '',
      multiSelect: Boolean(item?.multiSelect),
      kind: item?.intent?.kind ?? '',
      options: (Array.isArray(item?.options) ? item.options : []).map((o, k) => ({
        id: `o${k}`,
        label: typeof o === 'string' ? o : (o?.label ?? ''),
        description: typeof o === 'string' ? '' : (o?.description ?? ''),
      })),
    })),
  })

  ctx.on(
    'user-questions/request',
    (request, next) => {
      const sessionId = request?.agent?.session?.id ?? null
      const active = sessionId && Date.now() - (phoneSeen.get(sessionId) ?? 0) < PHONE_ACTIVE_MS
      const items = Array.isArray(request?.questions) ? request.questions : []
      if (!active || items.length === 0) return next()
      const id = crypto.randomBytes(4).toString('hex')
      const expiresAt = Date.now() + QUESTION_WAIT_MS
      const answer = new Promise((resolve) => {
        const timer = setTimeout(() => {
          questions.delete(id)
          pushFeed(sessionId, 'question/timeout', { id })
          resolve(null)
        }, QUESTION_WAIT_MS)
        questions.set(id, {
          sessionId,
          callId: request?.wait?.callId ?? null,
          agent: request?.agent ?? null,
          items,
          expiresAt,
          settle: (value) => {
            clearTimeout(timer)
            questions.delete(id)
            resolve(value)
          },
        })
      })
      pushFeed(sessionId, 'question/request', { id, callId: request?.wait?.callId ?? null })
      log('question on the phone:', id, items.length)
      return answer.then((value) => (value ?? next()))
    },
    { prepend: true },
  )

  // ---- Session reads (Host sessionController service) -----------------------
  const sc = () => ctx.get?.('sessionController') ?? ctx.sessionController

  const planText = (args) => {
  try {
    const v = JSON.parse(args)
    if (typeof v?.plan === 'string') return v.plan.slice(0, 4000)
  } catch {}
  return ''
}

const usageLine = (inTok, outTok, cacheRead) => {
    if (inTok == null && outTok == null) return ''
    const hit = cacheRead > 0 ? Math.round((cacheRead / (cacheRead + (inTok ?? 0) || 1)) * 100) : null
    return `${short(inTok)} in · ${short(outTok)} out${hit == null ? '' : ` · ${hit}% cached`}`
  }

  const truncate = (s, n = 800) => {
    const text = String(s ?? '')
    return text.length > n ? `${text.slice(0, n)}…` : text
  }

  const textOf = (content) => {
    if (typeof content === 'string') return content
    if (!Array.isArray(content)) return ''
    return content.filter((b) => b && b.type === 'text').map((b) => b.text ?? '').join('')
  }


  // ---- markdown -> block nodes -------------------------------------------------
  // The app has no Markdown renderer and no webview, so the bridge hands it a tiny
  // block model instead: paragraphs, headings, lists, code, quotes, rules.
  // Inline marks (code/bold/italic/strikethrough/links) stay in the text: the
  // phone's MdText parses them into styled runs (parity with desktop render.tsx).
  // Only images collapse, because the phone has no inline image run.
  const inline = (s) => String(s)
    .replace(/!\[([^\]]*)\]\(([^)\s]+)[^)]*\)/g, (_, alt, url) => `[image: ${alt || url}]`)

  // Credential masking (parity with ui-secret-mask): a handful of conservative
  // shapes, replaced with a stub that keeps the prefix identifiable.
  const SECRET_PATTERNS = [
    /\bsk-[A-Za-z0-9_-]{12,}/g,
    /\bgh[pousr]_[A-Za-z0-9]{20,}/g,
    /\bAKIA[0-9A-Z]{16}\b/g,
    /\bxox[abprs]-[A-Za-z0-9-]{10,}/g,
    /\bAIza[0-9A-Za-z_-]{30,}/g,
  ]
  const maskSecrets = (s) => {
    const text = String(s ?? '')
    if (!/[A-Za-z0-9_-]{20,}/.test(text)) return text
    let out = text
    for (const re of SECRET_PATTERNS) out = out.replace(re, (m) => `${m.slice(0, 6)}…${m.slice(-2)}（已遮蔽）`)
    return out
  }

  const mdNodes = (src) => {
    const lines = String(src ?? '').replace(/\r\n?/g, '\n').split('\n')
    const nodes = []
    let i = 0
    const push = (node) => { node.id = `n${nodes.length}`; nodes.push(node) }
    // Consecutive images read as one gallery: the phone pages through them sideways.
    const pushImg = (alt, v) => {
      const last = nodes[nodes.length - 1]
      if (last && last.t === 'img') {
        nodes[nodes.length - 1] = { id: last.id, t: 'gallery', items: [{ id: 'g0', alt: last.alt, v: last.v }, { id: 'g1', alt, v }] }
        return
      }
      if (last && last.t === 'gallery') {
        last.items.push({ id: `g${last.items.length}`, alt, v })
        return
      }
      push({ t: 'img', alt, v })
    }
    while (i < lines.length) {
      const line = lines[i]
      const fence = line.match(/^\s*(```|~~~)\s*([\w+-]*)/)
      if (fence) {
        const mark = fence[1]
        const lang = fence[2] || ''
        const body = []
        i += 1
        while (i < lines.length && !lines[i].trim().startsWith(mark)) { body.push(lines[i]); i += 1 }
        i += 1
        // Desktop renders unified diffs in a fence layer; the phone colors the signs.
        if (/^(diff|patch|udiff)$/i.test(lang) || (!lang && body.length > 1 && body.filter((l) => /^[+-]/.test(l)).length > body.length / 2)) {
          const items = body.slice(0, 400).map((l, k) => ({ id: `d${k}`, s: l.startsWith('+') ? '+' : l.startsWith('-') ? '-' : ' ', v: truncate(l.slice(0, 200), 200) }))
          push({ t: 'diff', v: '', items })
          continue
        }
        // Desktop pipes math fences through KaTeX; the phone centers the source.
        if (/^(math|latex|tex|katex)$/i.test(lang)) {
          push({ t: 'math', v: truncate(body.join('\n'), 2000) })
          continue
        }
        push({ t: 'code', lang, v: body.join('\n') })
        continue
      }
      if (/^\s*([-*_])\s*\1\s*\1[\s-*_]*$/.test(line)) { push({ t: 'hr' }); i += 1; continue }
      const heading = line.match(/^(#{1,6})\s+(.*)$/)
      if (heading) { push({ t: 'h', lvl: heading[1].length, v: inline(heading[2].trim()) }); i += 1; continue }
      if (/^\s*>\s?/.test(line)) {
        const body = []
        while (i < lines.length && /^\s*>\s?/.test(lines[i])) { body.push(lines[i].replace(/^\s*>\s?/, '')); i += 1 }
        push({ t: 'quote', v: inline(body.join('\n')) })
        continue
      }
      // GFM table: a header row whose next line is a |-separated alignment rule.
      const tableRule = /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)+\|?\s*$/
      if (line.includes('|') && lines[i + 1] && tableRule.test(lines[i + 1])) {
        const cells = (row) => row.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => inline(c.trim()))
        const head = cells(line)
        i += 2
        const rows = []
        while (i < lines.length && lines[i].includes('|') && lines[i].trim() !== '') {
          const cols = cells(lines[i])
          rows.push({ id: `r${rows.length}`, v: cols.join('  ·  ') })
          i += 1
        }
        push({ t: 'table', head: head.join('  ·  '), rows })
        continue
      }
      const bullet = line.match(/^(\s*)([-*+]|\d+[.)])\s+(.*)$/)
      if (bullet) {
        const ordered = /\d/.test(bullet[2])
        const items = []
        while (i < lines.length) {
          const m = lines[i].match(/^(\s*)([-*+]|\d+[.)])\s+(.*)$/)
          if (!m) break
          if (/\d/.test(m[2]) !== ordered) break
          items.push({
            id: `i${items.length}`,
            v: inline(m[3].trim()),
            mark: ordered ? `${items.length + 1}.` : '•',
            d: Math.min(2, Math.floor(m[1].length / 2)),
          })
          i += 1
        }
        push({ t: ordered ? 'ol' : 'ul', items })
        continue
      }
      if (line.trim() === '') { i += 1; continue }
      const para = []
      while (i < lines.length && lines[i].trim() !== '' && !/^\s*(```|~~~|#{1,6}\s|>|([-*+]|\d+[.)])\s)/.test(lines[i])) { para.push(lines[i]); i += 1 }
      if (para.length === 0) { i += 1; continue }
      // Images can share a paragraph with text (consecutive lines end up in one paragraph),
      // so split line by line: an image-only line becomes an image node, the rest a paragraph.
      const flush = (buf) => {
        if (buf.length) push({ t: 'p', v: inline(buf.join('\n')) })
        buf.length = 0
      }
      const buf = []
      for (const l of para) {
        const only = l.trim().match(/^!\[([^\]]*)\]\(\s*<?([^)>\s]+)>?\s*\)$/)
        if (only) { flush(buf); pushImg(only[1], only[2]) }
        else buf.push(l)
      }
      flush(buf)
    }
    return nodes
  }

  // Per-tool card anatomy: an icon role, a one-line summary of the raw arguments,
  // and the pretty form for the expanded state. Unknown tools keep the generic card.
  const TOOL_LOOKS = {
    bash: { icon: 'play', key: 'command' },
    shell: { icon: 'play', key: 'command' },
    pwsh: { icon: 'play', key: 'command' },
    read: { icon: 'document', key: 'file_path' },
    read_image: { icon: 'photo', key: 'file_path' },
    write: { icon: 'pencil', key: 'file_path' },
    edit: { icon: 'pencil', key: 'file_path' },
    apply_patch: { icon: 'layers', key: 'input' },
    grep: { icon: 'search', key: 'pattern' },
    glob: { icon: 'search', key: 'pattern' },
    web_fetch: { icon: 'link', key: 'url' },
    web_search: { icon: 'search', key: 'query' },
    list_subagent_models: { icon: 'people', key: '' },
    subagent: { icon: 'people', key: 'description' },
    subagent_fork: { icon: 'people', key: 'description' },
    skill: { icon: 'sparkles', key: 'name' },
    todo: { icon: 'checkmark', key: '' },
    todo_write: { icon: 'checkmark', key: '' },
    question: { icon: 'info', key: 'question' },
    ask_user_question: { icon: 'info', key: 'question' },
    exit_plan_mode: { icon: 'layers', key: 'plan' },
    present: { icon: 'square.and.arrow.up', key: '' },
    office_convert: { icon: 'doc.badge.gearshape', key: 'input' },
    office_recalculate: { icon: 'doc.badge.gearshape', key: 'input' },
  }

  // DSH process-activity.ts: tool -> running category, with zh labels.
  const ACTIVITY_LABEL = {
    read: '正在读取文件', readImage: '正在读取图片', write: '正在写入文件', search: '正在搜索代码',
    edit: '正在编辑文件', commands: '正在运行命令', code: '正在运行代码', webSearch: '正在搜索网页',
    webFetch: '正在访问网页', subagents: '正在协调子智能体', plan: '正在更新计划', questions: '等待你的操作',
    tools: '正在调用工具',
  }
  const ACTIVITY = (name) => {
    if (name === 'read') return 'read'
    if (name === 'read_image') return 'readImage'
    if (name === 'grep' || name === 'glob' || name.endsWith('_inspect')) return 'search'
    if (name === 'write') return 'write'
    if (name === 'edit' || name === 'apply_patch') return 'edit'
    if (['bash', 'shell', 'pwsh', 'exec_command', 'write_stdin'].includes(name) || name.startsWith('terminal_')) return 'commands'
    if (name === 'run_code') return 'code'
    if (name === 'web_search') return 'webSearch'
    if (name === 'web_fetch') return 'webFetch'
    if (name === 'subagent' || name.startsWith('subagent_')) return 'subagents'
    if (['todo_write', 'create_goal', 'update_goal', 'get_goal'].includes(name)) return 'plan'
    if (name === 'ask_user_question' || name === 'request_user_input') return 'questions'
    return 'tools'
  }
  // DSH LIVE_TOOL_DETAIL_KEYS: first readable argument wins.
  const DETAIL_KEYS = ['title', 'description', 'objective', 'task', 'task_name', 'name', 'question', 'prompt', 'message', 'command', 'cmd', 'queries', 'query', 'pattern', 'url', 'uri', 'file_path', 'path', 'target', 'action', 'status']

  const parseArgs = (raw) => {
    if (raw == null) return null
    if (typeof raw === 'object') return raw
    try { return JSON.parse(String(raw)) } catch { return null }
  }

  const short = (n) => (n == null ? '?' : n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n))

  const firstLine = (v) => truncate(String(v ?? '').replace(/\r?\n[\s\S]*$/, ''), 160)

  const toolCard = (name, rawArgs) => {
    const look = TOOL_LOOKS[name] ?? { icon: 'circle', key: '' }
    const parsed = parseArgs(rawArgs)
    let summary = ''
    if (parsed && look.key && parsed[look.key] != null) summary = firstLine(parsed[look.key])
    else if (parsed) {
      const first = Object.values(parsed).find((v) => typeof v === 'string' && v !== '')
      summary = first ? firstLine(first) : ''
    }
    if (!summary) summary = firstLine(typeof rawArgs === 'string' ? rawArgs : JSON.stringify(parsed ?? ''))
    let pretty = typeof rawArgs === 'string' ? rawArgs : JSON.stringify(rawArgs ?? {})
    if (parsed) { try { pretty = JSON.stringify(parsed, null, 2) } catch {} }
    if (name === 'bash' || name === 'shell' || name === 'pwsh') pretty = String(parsed?.command ?? pretty)
    const card = { icon: `symbol:${look.icon}`, summary, args: truncate(pretty, 2400) }
    // Structured tools get their own body instead of a JSON dump.
    const list = Array.isArray(parsed?.todos) ? parsed.todos : Array.isArray(parsed?.items) ? parsed.items : null
    if ((name === 'todo' || name === 'todo_write') && list) {
      card.todos = list.slice(0, 24).map((t, i) => ({
        id: `t${i}`,
        text: firstLine(t?.content ?? t?.text ?? t?.title ?? ''),
        state: String(t?.status ?? 'pending'),
      }))
    }
    // Deliverable card: the desktop surfaces present() files as attachment chips.
    const files = Array.isArray(parsed?.files) ? parsed.files : null
    if (name === 'present' && files) {
      card.files = files.slice(0, 8).map((f, i) => ({
        id: `f${i}`,
        path: truncate(String(f?.path ?? ''), 300),
        text: firstLine(f?.description ?? ''),
      }))
    }
    const q = Array.isArray(parsed?.questions) ? parsed.questions[0] : parsed
    if ((name === 'question' || name === 'ask_user_question') && q) {
      card.question = firstLine(q?.question ?? q?.text ?? '')
      const opts = Array.isArray(q?.options) ? q.options : []
      card.options = opts.slice(0, 6).map((o, i) => ({ id: `o${i}`, text: firstLine(typeof o === 'string' ? o : o?.label ?? '') }))
    }
    return card
  }

  // A line diff good enough for a phone: trim the common head and tail, then show the
  // differing middle. Real hunks would be nicer but cost more than the screen shows.
  const diffLines = (oldText, newText, cap = 60) => {
    const a = String(oldText ?? '').split('\n')
    const b = String(newText ?? '').split('\n')
    let head = 0
    while (head < a.length && head < b.length && a[head] === b[head]) head += 1
    let tail = 0
    while (tail < a.length - head && tail < b.length - head && a[a.length - 1 - tail] === b[b.length - 1 - tail]) tail += 1
    const lines = []
    const push = (sign, text) => { if (lines.length < cap) lines.push({ id: `d${lines.length}`, sign, text }) }
    for (let i = Math.max(0, head - 2); i < head; i += 1) push(' ', a[i])
    for (let i = head; i < a.length - tail; i += 1) push('-', a[i])
    for (let i = head; i < b.length - tail; i += 1) push('+', b[i])
    for (let i = b.length - tail; i < Math.min(b.length, b.length - tail + 2); i += 1) push(' ', b[i])
    if (lines.length >= cap) lines.push({ id: `d${lines.length}`, sign: '…', text: 'diff truncated' })
    return lines
  }

  const diffFiles = (diffs) => (Array.isArray(diffs) ? diffs : []).slice(0, 8).map((d, i) => ({
    id: `f${i}`,
    path: String(d?.path ?? ''),
    lines: diffLines(d?.oldText, d?.newText, 120),
    added: diffLines(d?.oldText, d?.newText, 120).filter((l) => l.sign === '+').length,
    removed: diffLines(d?.oldText, d?.newText, 120).filter((l) => l.sign === '-').length,
  }))
  // How many files a card hides, so the phone can say "还有 N 个文件".
  const diffHidden = (diffs) => Math.max(0, (Array.isArray(diffs) ? diffs : []).length - 8)

  const renderEvent = (ev) => {
    const type = ev?.type
    const d = ev?.data ?? {}
    if (type === 'user/message') {
      const kind = d.source?.kind ?? 'user'
      if (kind !== 'user') {
        const full = maskSecrets(truncate(textOf(d.content ?? d.message?.content), 4000))
        // Runtime injections (skill catalogs, goal rounds, schedule fires…): the
        // payload stays on the Mac. A short one is a trigger header (parity with
        // TurnTriggerNodeView); a long injected context is a collapsed
        // disclosure row (parity with ContextInjectionRow).
        const TRIGGER_LABEL = { goal: '目标自动续跑', schedule: '定时任务', subagent: '子代理', webhook: 'Webhook', queue: '队列消息', system: '系统' }
        if (full.length > 500) {
          const label = TRIGGER_LABEL[kind] ?? `由 ${kind} 注入`
          return { id: `g${ev.seq}`, seq: ev.seq, role: 'injection', at: ev.time, turn: d.turn ?? null, text: full, usage: label, tokens: null, blocks: [] }
        }
        return { id: `g${ev.seq}`, seq: ev.seq, role: 'trigger', at: ev.time, turn: d.turn ?? null, text: TRIGGER_LABEL[kind] ?? `由 ${kind} 触发`, usage: '', tokens: null, blocks: [] }
      }
      // Reference chips (parity with FileReference under user-text-rules): the
      // paths and skills the prompt @-names, kept as small markers.
      const raw = textOf(d.content ?? d.message?.content)
      const refs = []
      for (const m of String(raw).matchAll(/@(?:"([^"\n]+)"|([^\s，。,.!?"'()\[\]{}]+))/g)) {
        const p = (m[1] ?? m[2] ?? '').trim()
        if (p !== '' && !refs.some((r) => r.path === p) && p.length <= 300) refs.push({ path: p })
        if (refs.length >= 6) break
      }
      return { id: `u${ev.seq}`, seq: ev.seq, role: 'user', at: ev.time, text: maskSecrets(truncate(raw, 4000)), refs }
    }
    if (type === 'system/message') {
      // The model-visible system prompt: a collapsed disclosure (parity with
      // SystemPromptRow). Later series entries are in-history updates.
      const text = maskSecrets(truncate(textOf(d.content ?? d.message?.content ?? d.text), 4000))
      if (text === '') return null
      return { id: `sp${ev.seq}`, seq: ev.seq, role: 'sysprompt', at: ev.time, turn: null, text, usage: '', tokens: null, blocks: [] }
    }
    if (type === 'assistant/message') {
      const content = d.message?.content ?? []
      const blocks = []
      for (const b of content) {
        if (!b) continue
        const id = `b${blocks.length}`
        if (b.type === 'text') {
          const safe = maskSecrets(b.text ?? '')
          blocks.push({ id, kind: 'md', text: safe, nodes: mdNodes(safe) })
        } else if (b.type === 'reasoning' && (b.text ?? '').trim() !== '') blocks.push({ id, kind: 'reasoning', text: maskSecrets(truncate(b.text, 8000)) })
        else if (b.type === 'tool-call') blocks.push({ id, kind: 'tool', callId: b.id ?? null, name: b.name ?? 'tool', status: 'running', ...toolCard(b.name ?? 'tool', b.arguments) })
        else if (b.type === 'image') {
          const ref = b.attachment ?? null
          if (ref?.attachmentId) imageRefs.set(ref.attachmentId, ref)
          blocks.push({
            id, kind: 'image',
            text: ref?.name ?? 'Image',
            att: ref?.attachmentId ?? '',
            media: ref?.mediaType ?? 'image/png',
            w: ref?.width ?? 0,
            h: ref?.height ?? 0,
          })
        }
      }
      const text = blocks.filter((b) => b.kind === 'md').map((b) => b.text).join('\n')
      const u = d.usage ?? null
      const inTok = u?.inputTokens ?? u?.promptTokens ?? u?.input ?? null
      const outTok = u?.outputTokens ?? u?.completionTokens ?? u?.output ?? null
      const cacheRead = u?.cacheReadTokens ?? u?.cachedTokens ?? 0
      const usage = usageLine(inTok, outTok, cacheRead)
      // Four-bucket detail (parity with TurnUsagePanel): reasoning tokens ride the
      // usage event when the provider reports them.
      const usageTokens = inTok == null && outTok == null ? null : {
        in: inTok ?? 0,
        out: outTok ?? 0,
        cacheRead,
        reasoning: u?.reasoningTokens ?? u?.completionTokensDetails?.reasoningTokens ?? u?.outputTokensDetails?.reasoningTokens ?? null,
      }
      return { id: `a${ev.seq}`, seq: ev.seq, role: 'assistant', at: ev.time, turn: d.turn ?? null, text, usage, tokens: inTok == null && outTok == null ? null : [inTok ?? 0, outTok ?? 0], cache: cacheRead, usageTokens, interrupted: Boolean(d.interrupted), blocks }
    }
    if (type === 'compaction/summary') {
      // Desktop CompactionItem: 已折叠 N 项 · M tokens, expandable summary.
      return {
        id: `cp${ev.seq}`, seq: ev.seq, role: 'compact', at: ev.time, turn: d.turn ?? null,
        text: truncate(textOf(d.summary), 600), folded: Array.isArray(d.shadowedSeqs) ? d.shadowedSeqs.length : 0,
        shadow: Number(d.shadowedTokenCount ?? 0), usage: '', tokens: null, blocks: [],
      }
    }
    if (type === 'turn/end') {
      // Desktop TurnErrorItem: only some endings carry a failure row.
      const r = d.reason ?? {}
      let failure = ''
      if (r.kind === 'error') failure = `回合失败 —— ${truncate(String(r.error?.message ?? '未知错误'), 300)}`
      else if (r.kind === 'max-tokens') failure = '已达到输出上限，本轮被截断。'
      else if (r.kind === 'interrupted') failure = 'DSH 进程退出，本轮未能完成。'
      else if (r.kind === 'aborted' && r.reason?.kind === 'hook' && r.reason?.reason === 'deepseek-account/signed-out') failure = 'DeepSeek 账号已登出，本轮已停止。'
      if (failure === '') return null
      return { id: `e${ev.seq}`, seq: ev.seq, role: 'error', at: ev.time, turn: d.turn ?? null, text: failure, usage: '', tokens: null, blocks: [] }
    }
    if (type === 'llm/retry') {
      // Parity with ModelRetryItem: attempt number, wait, reason.
      const n = Number(d.retry ?? 0)
      const delay = Number(d.retryDelayMs ?? 0)
      const why = truncate(String(d.reason?.message ?? d.error?.message ?? d.reason ?? d.error ?? ''), 160)
      const wait = delay > 0 ? `，${Math.max(1, Math.round(delay / 1000))} 秒后重试` : ''
      return {
        id: `r${ev.seq}`, seq: ev.seq, role: 'retry', at: ev.time, turn: d.turn ?? null,
        text: `模型调用失败${n > 1 ? `，第 ${n} 次重试` : '，即将重试'}${wait}${why ? ` —— ${why}` : ''}`,
        retryIn: delay, usage: '', tokens: null, blocks: [],
      }
    }
    if (type === 'llm/retry-started') return null
    if (type === 'tool/call') {
      // The assistant message already carries the call block; this event is the same
      // call again. Keep it only as a fallback for providers that split calls out.
      orphanCalls.set(d.callId ?? `c${ev.seq}`, {
        id: `c${ev.seq}`, seq: ev.seq, role: 'assistant', at: ev.time, turn: d.turn ?? null, text: '',
        blocks: [{ id: 'b0', kind: 'tool', callId: d.callId ?? null, name: d.name ?? 'tool', status: 'running', ...toolCard(d.name ?? 'tool', d.arguments) }],
      })
      return null
    }
    if (type === 'tool/result') {
      const callId = d.message?.toolCallId ?? d.callId ?? null
      const parts = Array.isArray(d.message?.content) ? d.message.content : []
      const images = []
      for (const part of parts) {
        if (part?.type !== 'image') continue
        const ref = part.attachment ?? null
        if (!ref?.attachmentId) continue
        imageRefs.set(ref.attachmentId, ref)
        images.push({ id: `i${images.length}`, att: ref.attachmentId, media: ref.mediaType ?? 'image/png', w: ref.width ?? 0, h: ref.height ?? 0, text: ref.name ?? 'Image' })
      }
      return {
        id: `t${ev.seq}`, seq: ev.seq, role: 'result', at: ev.time, turn: d.turn ?? null, callId,
        text: maskSecrets(truncate(textOf(d.message?.content), 800)),
        failed: Boolean(d.message?.isError ?? d.error),
        diff: d.meta?.diffs ?? null,
        images,
      }
    }
    return null
  }

  // `take` counts *turns*, not messages: the phone renders one row per turn and a
  // session's turns run 20–40 messages each, so a message window of 200 collapsed to
  // 8 rows and "load earlier" looked like it did nothing.
  // A fat turn is 30+ tool calls ≈ 90 records (call+result+step text). Undershooting
  // here starves the take-window AND flips hasMore while history remains.
  const MESSAGES_PER_TURN = 96
  
// A single long turn can carry megabytes of Markdown; the phone re-reads this
// payload every few seconds, so each row is clipped to something a 700 ms poll
// can afford. The Mac keeps the full transcript; this is the phone's window.
// Keep the newest rows that fit the phone's budget: a 40-step turn with long
// reasoning is easily 300 KB on its own, and the poll cannot carry that.
// Tool arguments and results are the bulk of a turn and the phone shows them
// collapsed by default: the snapshot keeps the shape, the detail comes on demand.
let lastCalls = new Map()

const budget = (rows, maxChars) => {
  let total = 0
  let start = rows.length
  while (start > 0) {
    const size = JSON.stringify(rows[start - 1]).length
    if (total + size > maxChars && start < rows.length) break
    total += size
    start -= 1
  }
  return { rows: rows.slice(start) }
}

const clipRow = (row) => {
  const text = truncate(String(row.text ?? ''), 4000)
  const blocks = (row.blocks ?? []).slice(0, 48).map((b) => {
    const copy = { ...b }
    if (typeof copy.text === 'string') copy.text = truncate(copy.text, 1400)
    if (typeof copy.result === 'string') copy.result = truncate(copy.result, 800)
    if (copy.kind === 'tool') {
      delete copy.args
      delete copy.result
      delete copy.diffs
      copy.lazy = true
    }
    if (Array.isArray(copy.nodes)) {
      copy.nodes = copy.nodes.slice(0, 24).map((n) => {
        const node = { ...n }
        if (typeof node.v === 'string') node.v = truncate(node.v, 700)
        if (Array.isArray(node.items)) node.items = node.items.slice(0, 12).map((it) => ({ ...it, v: truncate(String(it.v ?? ''), 400) }))
        if (Array.isArray(node.rows)) node.rows = node.rows.slice(0, 12).map((r) => ({ ...r, v: truncate(String(r.v ?? ''), 600) }))
        return node
      })
    }
    return copy
  })
  return {
    ...row,
    text,
    blocks,
    tools: blocks.filter((b) => b && b.kind === 'tool').length,
    running: blocks.filter((b) => b && b.kind === 'tool' && b.status === 'running').length,
    thought: blocks.some((b) => b && b.kind === 'reasoning'),
    // Whole-turn duration in seconds (desktop group head: `✓ N steps · 1m 23s`).
    took: Number(row.took ?? 0),
  }
}

// Live activity line: the newest tool the phone should name. Prefers the
// streaming attempt buffer (freshest); falls back to the event log's newest
// running/last tool block, then the latest reasoning paragraph.
const activityFromTool = (name, rawArgs) => {
  const cat = ACTIVITY(name || 'tool')
  const parsed = parseArgs(rawArgs)
  let detail = ''
  if (!parsed && typeof rawArgs === 'string' && rawArgs !== '') detail = truncate(rawArgs.replace(/\s+/g, ' ').trim(), 160)
  if (parsed) {
    for (const key of DETAIL_KEYS) {
      if (parsed[key] == null) continue
      const raw = Array.isArray(parsed[key]) && parsed[key].every((x) => typeof x === 'string') ? parsed[key].join(', ') : typeof parsed[key] === 'string' ? parsed[key] : ''
      if (raw !== '') { detail = truncate(String(raw).replace(/\s+/g, ' ').trim(), 160); break }
    }
  }
  return { label: ACTIVITY_LABEL[cat] ?? ACTIVITY_LABEL.tools, detail }
}

const snapshotSession = async (sessionId, take = 8, showArchived = false) => {
    const rows = await mergeStatus(showArchived)
    const meta = rows.find((r) => r.id === sessionId) ?? null
    // Rows carry the whole projection blob for server-side use; the phone only
    // needs the list fields, and shipping `meta` made every poll ~230 KB.
    const wire = rows.map(({ meta, ...rest }) => rest)
    // A fingerprint of the list; /v1/live omits the rows when the client already has it.
    const listRev = wire.map((r) => `${r.id}:${r.updatedAt ?? 0}:${r.running ? 1 : 0}:${r.pinned ? 1 : 0}:${r.title ?? ''}`).join('|')
    refreshBalance()
    const out = { version: Date.now(), listRev, balance: balanceCache.data, sessions: wire, session: null }
    if (!sessionId) return out
    const signal = () => new AbortController().signal
    const [page, state] = await Promise.all([
      sc().events({ address: { kind: 'session', sessionId }, maxMessages: Math.min(take * MESSAGES_PER_TURN + 40, 6000) }, signal()).catch(() => ({ records: [] })),
      sc().state({ sessionId }, signal()).catch(() => null),
    ])
    const messages = []
    const lastEventSeq = page?.records?.length ? Number(page.records[page.records.length - 1]?.event?.seq ?? 0) : 0
    // A fork child carries an inherited-prefix cut marker (session/end-seed {inherited}).
    const inherited = (page?.records ?? []).some((r) => r?.event?.type === 'session/end-seed' && r?.event?.data?.inherited === true)
    orphanCalls.clear()
    // Workflow orchestration runs (parity with ui-workflow-run): the four
    // tool-workflow events fold into ONE tool card whose member list reuses the
    // todo checklist UI — pending ○, completed ●, failed ◐ with ✗.
    const wfRuns = new Map()
    for (const rec of page?.records ?? []) {
      const ev = rec?.event
      if (ev && typeof ev.type === 'string' && ev.type.startsWith('tool-workflow/')) {
        const d = ev.data ?? {}
        const runId = String(d.runId ?? '')
        if (ev.type === 'tool-workflow/run-start') {
          const block = { kind: 'tool', callId: `wf-${runId}`, name: 'workflow', label: `编排 ${truncate(String(d.name ?? 'workflow'), 60)}`, status: 'running', todos: [] }
          wfRuns.set(runId, { block })
          messages.push({ id: `wf-${runId}`, seq: Number(ev.seq ?? 0), role: 'assistant', at: ev.time, turn: d.turn ?? null, text: '', usage: '', tokens: null, blocks: [block] })
        } else {
          const run = wfRuns.get(runId)
          if (!run) continue
          if (ev.type === 'tool-workflow/agent-start') {
            if (run.block.todos.length < 24) run.block.todos.push({ id: `wfm-${d.seq}`, text: `${d.phase ? `${d.phase} · ` : ''}${truncate(String(d.label ?? 'agent'), 120)}`, state: 'in_progress' })
          } else if (ev.type === 'tool-workflow/agent-end') {
            const t = run.block.todos.find((x) => x.id === `wfm-${d.seq}`)
            if (t) {
              if (d.outcome === 'completed') t.state = 'completed'
              else if (d.outcome === 'failed' || d.outcome === 'cancelled') { t.state = 'in_progress'; t.text += d.outcome === 'failed' ? ' ✗' : ' ⨯' }
            }
          } else if (ev.type === 'tool-workflow/run-end') {
            run.block.status = d.stopReason === 'completed' ? 'ok' : d.stopReason ? 'error' : 'unknown'
            if (d.stopReason && d.stopReason !== 'completed') run.block.label += ` · ${d.stopReason}`
          }
        }
        continue
      }
      const row = renderEvent(rec?.event)
      if (row) messages.push(row)
    }
    // Fold tool results into the call they answer, the way the desktop transcript does.
    const callIndex = new Map()
    const callRow = new Map()
    lastCalls = callIndex
    for (const m of messages) {
      for (const b of m.blocks ?? []) {
        if (b.kind === 'tool' && b.callId) { callIndex.set(b.callId, b); callRow.set(b.callId, m) }
      }
    }
    for (const [callId, row] of orphanCalls) {
      if (!callIndex.has(callId)) messages.push(row)
    }
    for (let i = messages.length - 1; i >= 0; i -= 1) {
      const m = messages[i]
      if (m.role !== 'result' || !m.callId) continue
      const target = callIndex.get(m.callId)
      if (!target) continue
      if (Array.isArray(m.images) && m.images.length > 0) target.images = m.images
      target.result = m.text
      const host = callRow.get(m.callId)
      if (host && Number(m.seq) > Number(host.seq)) host.seq = m.seq
      // A non-zero exit is a failure the transcript should show as one, even though the
      // tool itself returned normally.
      const exit = /\[exit code: (\d+)\]/.exec(m.text || '')
      const badExit = exit && Number(exit[1]) !== 0
      target.status = m.failed || badExit ? 'error' : 'ok'
      if (badExit) target.badge = `exit ${exit[1]}`
      else if (m.failed) target.badge = 'failed'
      if (m.diff) { target.diff = m.diff; target.diffs = diffFiles(m.diff); target.diffHidden = diffHidden(m.diff) }
      messages.splice(i, 1)
    }
    // Assistant messages whose tools all answered are settled; anything still marked
    // running and older than the last message is a call the model never got back to.
    const lastSeq = messages.length > 0 ? messages[messages.length - 1].seq : 0
    for (const m of messages) {
      for (const b of m.blocks ?? []) {
        if (b.kind === 'tool' && b.status === 'running' && m.seq < lastSeq) b.status = 'unknown'
      }
    }
    // One turn is several assistant step-messages; the desktop shows them as one process
    // block. Merge them so the phone does not print a row per step.
    const grouped = []
    for (const m of messages) {
      const prev = grouped[grouped.length - 1]
      if (m.role === 'assistant' && prev && prev.role === 'assistant' && prev.turn === m.turn) {
        prev.blocks.push(...m.blocks)
        prev.text = prev.text !== '' ? prev.text : m.text
        // Copy and find need the whole turn, not the first step's prose.
        prev.fullText = `${prev.fullText ?? prev.text ?? ''}${m.text ? `\n\n${m.text}` : ''}`
        prev.usage = m.usage || prev.usage
        if (m.tokens) prev.tokens = [((prev.tokens ?? [0, 0])[0] + m.tokens[0]), ((prev.tokens ?? [0, 0])[1] + m.tokens[1])]
        if (m.cache) prev.cache = (prev.cache ?? 0) + m.cache
        prev.interrupted = prev.interrupted || m.interrupted
        prev.seq = m.seq
        // Turn duration: desktop's group head shows `✓ N steps · 1m 23s`.
        if (m.at) prev.lastAt = m.at
        continue
      }
      grouped.push(m)
    }
    for (let i = 0; i < grouped.length; i++) {
      const m = grouped[i]
      if (m.role !== 'assistant') continue
      const start = grouped[i - 1]?.role === 'user' ? Number(grouped[i - 1].at ?? 0) : Number(m.at ?? 0)
      const end = Number(m.lastAt ?? m.at ?? 0)
      delete m.lastAt
      m.took = start > 0 && end >= start ? Math.round((end - start) / 1000) : 0
    }
    for (const m of grouped) {
      if (!m.blocks) continue
      m.blocks.forEach((b, i) => { b.id = `b${i}` })
      if (m.tokens) m.usage = usageLine(m.tokens[0], m.tokens[1], m.cache ?? 0)
    }
    // A Markdown image in an answer points at a file on the Mac; tell the app its shape.
    const baseCwd = meta?.cwd ?? process.cwd()
    for (const m of grouped) {
      for (const b of m.blocks ?? []) {
        for (const n of b.nodes ?? []) {
          const items = n.t === 'img' ? [n] : n.t === 'gallery' ? n.items : []
          for (const it of items) {
            if (/^https?:\/\//.test(it.v)) continue
            const size = imageSize(path.isAbsolute(it.v) ? it.v : path.resolve(baseCwd, it.v))
            if (!size) continue
            it.w = size.w; it.h = size.h
            // A gallery card is 240 pt tall; its width follows the aspect ratio.
            it.dh = 240
            it.dw = Math.max(80, Math.min(760, Math.round((240 * size.w) / Math.max(1, size.h))))
          }
        }
      }
    }
    // A "turn" for the phone is everything from one user message to the next: a
    // session's turns run 20–40 step messages each, so trimming by message count made
    // "load earlier" add a row or two. Keep the newest `take` of these segments.
    const segments = []
    for (const m of grouped) {
      if (segments.length === 0 || m.role === 'user') segments.push([])
      segments[segments.length - 1].push(m)
    }
    // The message window can start mid-turn; drop that partial segment so a turn's
    // row id stays the same when the window grows (the phone anchors on it).
    if (segments.length > 0 && segments[0][0]?.role !== 'user') segments.shift()
    const trimmedAny = segments.length > take
    const merged = segments.slice(Math.max(0, segments.length - take)).flat()
    // The phone cannot carry a whole turn of 40 steps every 700 ms: keep the newest
    // rows that fit, and remember that the rest is still there.
    // Newest turns keep their detail (markdown, cards); older ones are text-only so
    // "load earlier" can actually add rows instead of being trimmed away again.
    const FULL_ROWS = 12
    // Projection version: bumped whenever the row PROJECTION changes shape (not just
    // new events). Clients cache rows keyed by rowsRev; a seq-only rev cannot express
    // "same seq, better content", so old caches would survive a fix like this.
    const PROJ = 5
    // A single turn can be huge (48 blocks of tool calls). Keep the shape, but cap the
    // detail a row may carry so one turn cannot eat the whole budget.
    const ROW_CAP = 12000
    // Newest turns: the final answer's markdown is never dropped — degrade detail
    // (reasoning → tool cards), never the answer itself, and only past this cap.
    const ANSWER_CAP = 96000
    const slimNodes = (nodes) => (Array.isArray(nodes) ? nodes.slice(0, 12).map((n) => ({
      ...n,
      v: typeof n.v === 'string' ? truncate(n.v, 320) : n.v,
      head: typeof n.head === 'string' ? truncate(n.head, 200) : n.head,
      items: Array.isArray(n.items) ? n.items.slice(0, 8).map((it) => ({ ...it, v: typeof it.v === 'string' ? truncate(it.v, 200) : it.v })) : n.items,
      rows: Array.isArray(n.rows) ? n.rows.slice(0, 6).map((r2) => ({ ...r2, v: typeof r2.v === 'string' ? truncate(r2.v, 200) : r2.v })) : n.rows,
    })) : nodes)
    const graded = merged.map((row, i) => {
      const full = clipRow(row)
      // Merged turns carry the whole turn in .text only as the FIRST step's preamble;
      // fullText is the concatenated plain text of every step — always the better fallback.
      const flat = String(row.fullText ?? row.text ?? '')
      if (i < merged.length - FULL_ROWS) {
        // Older turns keep their SHAPE (headings, tool cards, code fences) with
        // slimmed detail instead of collapsing to flat text: parity with the
        // desktop's always-rich rendering, at a size "load earlier" can afford.
        return {
          ...full,
          text: truncate(flat, 2400),
          blocks: (full.blocks ?? []).map((b) => {
            if (!b) return b
            if (b.kind === 'reasoning') return { ...b, text: truncate(b.text, 400) }
            if (b.kind === 'md') return { ...b, text: truncate(b.text, 1400), nodes: slimNodes(b.nodes) }
            return { ...b, args: undefined, result: undefined, lazy: true }
          }),
        }
      }
      // Newest turns keep tool-card detail up to a generous cap…
      if (JSON.stringify(full).length <= ANSWER_CAP) return full
      // Stage 1: drop reasoning; md nodes and tool cards stay as clipped.
      const noReasoning = {
        ...full,
        blocks: (full.blocks || []).filter((b) => b && b.kind !== 'reasoning'),
      }
      if (JSON.stringify(noReasoning).length <= ANSWER_CAP) return noReasoning
      // Stage 2: drop tool cards; the ANSWER markdown stays complete.
      const answerOnly = {
        ...full,
        blocks: (full.blocks || []).filter((b) => b && (b.kind === 'md' || b.kind === 'text')),
      }
      if ((answerOnly.blocks || []).length > 0) return answerOnly
      // Stage 3: answer with slimmed nodes — still never dropped.
      const slimAnswer = {
        ...full,
        blocks: (full.blocks || []).map((b) => (b && b.nodes ? { ...b, nodes: slimNodes(b.nodes) } : b)),
      }
      if ((slimAnswer.blocks || []).length > 0) return slimAnswer
      // Last resort (no md/text blocks at all): whole-turn plain text.
      return { ...full, text: truncate(flat, 8000), blocks: [] }
    })
    // Turn-tail deliverables (parity with ui-deliverables): files the turn
    // `present`ed, plus a changed-files count from write-class tools.
    const enriched = graded.map((row) => {
      if (row.role !== 'assistant') return row
      const files = (row.blocks ?? [])
        .filter((b) => b && b.kind === 'tool' && b.name === 'present' && Array.isArray(b.files))
        .flatMap((b) => b.files)
      const changed = (row.blocks ?? [])
        .filter((b) => b && b.kind === 'tool' && /^(write|edit|apply_patch)$/.test(String(b.name)) && b.status === 'ok')
        .length
      if (files.length === 0 && changed === 0) return row
      return { ...row, deliverables: files.slice(0, 8), changedCount: changed }
    })
    // A settled turn whose tail row is an error shows the warning state in its
    // group header (TurnProcessNodeView's "Failed" arm) instead of a checkmark.
    let failedMark = -1
    for (let k = graded.length - 1; k >= 0; k -= 1) {
      const row = graded[k]
      if (row.role === 'error') { failedMark = k; continue }
      if (row.role === 'assistant' && failedMark > k) {
        graded[k] = { ...row, failed: true }
        failedMark = -1
      }
      if (row.role === 'user') failedMark = -1
    }
    // Calendar-day separators (parity with use-calendar-day): one label where
    // the local day changes between chronological rows; the first row stays bare.
    const dayLabel = (ts) => {
      if (!ts) return ''
      const d = new Date(ts)
      const startOf = (x) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime()
      const diffDays = Math.round((startOf(new Date()) - startOf(d)) / 86400000)
      if (diffDays === 0) return '今天'
      if (diffDays === 1) return '昨天'
      if (diffDays === 2) return '前天'
      const sameYear = d.getFullYear() === new Date().getFullYear()
      return `${sameYear ? '' : `${d.getFullYear()}年`}${d.getMonth() + 1}月${d.getDate()}日`
    }
    let prevDay = null
    for (const row of enriched) {
      if (!row || !row.at) continue
      const key = new Date(row.at).toDateString()
      if (key !== prevDay) {
        prevDay = key
        if (row.day === undefined) row.day = dayLabel(row.at)
      }
    }
    // todo diff (parity with todo-diff-model): each todo_write card carries the
    // change of every item against the previous write in the same window. The
    // pass works on copies: rows can be shared with the incremental cache.
    const annotated = enriched.map((row) => (row && Array.isArray(row.blocks) && row.blocks.some((b) => b && b.kind === 'tool' && b.name === 'todo_write' && Array.isArray(b.todos))
      ? { ...row, blocks: row.blocks.map((b) => (b && b.kind === 'tool' && b.name === 'todo_write' && Array.isArray(b.todos) ? { ...b, todos: b.todos.map((t) => ({ ...t })) } : b)) }
      : row))
    let prevTodos = null
    for (const row of annotated) {
      if (!row || !Array.isArray(row.blocks)) continue
      for (const b of row.blocks) {
        if (!b || b.kind !== 'tool' || b.name !== 'todo_write' || !Array.isArray(b.todos)) continue
        const prevByTitle = new Map((prevTodos ?? []).map((t) => [t.text, t]))
        const currentTitles = new Set(b.todos.map((t) => t.text))
        let added = 0
        let updated = 0
        let removed = 0
        b.todos = b.todos.map((t) => {
          const before = prevByTitle.get(t.text)
          prevByTitle.delete(t.text)
          if (before === undefined) {
            added++
            return { ...t, change: 'added' }
          }
          if (before.state !== t.state) {
            updated++
            return { ...t, change: 'updated' }
          }
          return { ...t, change: '' }
        })
        for (const t of prevByTitle.values()) {
          b.todos.push({ id: `${t.id ?? t.text}-rm`, text: t.text, state: t.state, change: 'removed' })
          removed++
        }
        b.todoSummary = (prevTodos === null ? '' : [added > 0 ? `+${added}` : '', updated > 0 ? `改 ${updated}` : '', removed > 0 ? `删 ${removed}` : ''].filter(Boolean).join(' · ') || '无变化')
        prevTodos = b.todos.filter((t) => t.change !== 'removed').map((t) => ({ text: t.text, state: t.state }))
      }
    }
    // Rows leave only on a rev change and arrive as tiny incremental patches
    // afterwards, so the one-shot cold window can afford real depth (newest turns
    // alone can legitimately be ~30 KB each now that answers are never degraded).
    const phoneRows = budget(annotated, 240000)

    let attempt = null
    for (const item of live.values()) {
      if (item.sessionId === sessionId && (attempt === null || item.startedAt > attempt.startedAt)) attempt = item
    }
    let streaming = null
    if (attempt) {
      const text = attempt.blocks.filter((b) => b.type === 'text').map((b) => b.text).join('')
      const reasoning = attempt.blocks.filter((b) => b.type === 'reasoning').map((b) => b.text).join('')
      const tools = attempt.blocks.filter((b) => b.type === 'tool-call').map((b) => ({ name: b.name || 'tool', detail: truncate(b.arguments ?? '', 160), done: Boolean(b.done) }))
      if (text !== '' || reasoning !== '' || tools.length > 0) streaming = { text, reasoning, tools }
    }
    const jobRows = (() => {
      try {
        const all = ctx.get('jobs')?.list?.(sessionId) ?? []
        return all.slice().sort((a, b) => (b.startedAt ?? 0) - (a.startedAt ?? 0)).slice(0, 12).map((j) => ({
          id: String(j.id ?? ''),
          kind: String(j.kind ?? ''),
          label: truncate(String(j.label ?? ''), 120),
          status: String(j.status ?? ''),
          progress: j.progress ? truncate(String(j.progress), 80) : '',
          detail: j.detail ? truncate(String(j.detail), 120) : '',
          startedAt: j.startedAt ?? 0,
          finishedAt: j.finishedAt ?? 0,
          when: ago(j.finishedAt ?? j.startedAt ?? 0),
        }))
      } catch {
        return []
      }
    })()
    const todoBlocks = merged.flatMap((m) => m.blocks ?? []).filter((b) => Array.isArray(b.todos) && b.todos.length > 0)
    const runStartedAt = attempt?.startedAt ?? Number([...merged].reverse().find((m) => m.role === 'user')?.at ?? 0)
    out.session = {
      id: sessionId,
      todos: todoBlocks.length > 0 ? todoBlocks[todoBlocks.length - 1].todos : [],
      jobs: jobRows,
      title: meta?.title ?? null,
      cwd: meta?.cwd ?? null,
      running: Boolean(meta?.running ?? state?.running),
      // When this turn's first stream frame landed: drives the running-status
      // clock (DSH's `深度求索中，用时 …`) on the phone.
      // Fallback for a turn already running when the plugin (re)loaded: the
      // turn's first user message timestamp, same as DSH's Turn start.
      runStartedAt: runStartedAt,
      // DSH RunningStatus copy: `深度求索中，用时 1分23秒 ···`. Precomputed here
      // because data sources on the phone cannot call Date.now().
      runLabel: (() => {
        if (!runStartedAt) return '深度求索中'
        const total = Math.max(0, Math.floor((Date.now() - runStartedAt) / 1000))
        const h = Math.floor(total / 3600)
        const m = Math.floor(total / 60) % 60
        const sec = total % 60
        const parts = []
        if (h > 0) parts.push(`${h}小时`)
        if (total >= 60) parts.push(`${m}分`)
        parts.push(`${sec}秒`)
        return `深度求索中，用时 ${parts.join('')} ···`
      })(),
      // DSH ProcessGroupHeader's one-line live activity: category label + 160-char arg detail.
      runActivity: (() => {
        if (attempt) {
          const calls = attempt.blocks.filter((b) => b.type === 'tool-call')
          const src = [...calls].reverse().find((b) => !b.done) ?? calls[calls.length - 1]
          if (src) return activityFromTool(src.name, src.arguments)
          const rsn = attempt.blocks.filter((b) => b.type === 'reasoning').at(-1)
          if (rsn?.text) return { label: '正在思考', detail: truncate(String(rsn.text).split(/\n/)[0].replace(/\s+/g, ' ').trim(), 160) }
        }
        // No streaming frames for this provider: read the newest blocks off the event log.
        let toolBlock = null
        let rsnBlock = null
        for (let i = grouped.length - 1; i >= 0 && (toolBlock === null || rsnBlock === null); i -= 1) {
          for (const b of grouped[i].blocks ?? []) {
            if (b.kind === 'tool' && toolBlock === null) toolBlock = b
            if (b.kind === 'reasoning' && rsnBlock === null && b.text) rsnBlock = b
          }
          if (toolBlock !== null) break
        }
        if (toolBlock) {
          const act = activityFromTool(toolBlock.name, toolBlock.args)
          // A settled block from the event log is not "running": soften the label.
          if (toolBlock.status === 'running') return act
          return { label: act.label, detail: act.detail }
        }
        if (rsnBlock?.text) return { label: '正在思考', detail: truncate(String(rsnBlock.text).split(/\n/)[0].replace(/\s+/g, ' ').trim(), 160) }
        return null
      })(),
      // Session-wide counters for the stats sheet (desktop StatsPills).
      stats: (() => {
        let turns = 0, steps = 0, tin = 0, tout = 0, tcache = 0
        for (const m of grouped) {
          if (m.role === 'user') turns += 1
          if (m.role === 'assistant') {
            steps += (m.blocks ?? []).filter((b) => b.kind === 'tool').length
            tin += m.tokens?.[0] ?? 0
            tout += m.tokens?.[1] ?? 0
            tcache += m.cache ?? 0
          }
        }
        return { turns, steps, inTok: tin, outTok: tout, cacheRead: tcache }
      })(),
      inherited,
      model: meta?.meta?.model ?? '',
      permission: meta?.permission ?? '',
      permissionOptions: permissionCatalog(ctx),
      hasMore: Boolean(page?.hasMore) || trimmedAny || phoneRows.rows.length < merged.length,
      plan: meta?.plan ?? null,
      goal: meta?.goal ?? null,
      goalId: meta?.goalId ?? null,
      goalPhase: meta?.goalPhase ?? null,
      streaming,
      // Live polls strip the rows; this revision tells the phone when to fetch them.
      rowsRev: `${lastEventSeq}:${take}:${PROJ}`,
      messages: phoneRows.rows,
      queue: (state?.queue ?? []).slice(0, 12).map((q, i) => ({
        id: String(q?.id ?? q?.messageId ?? q?.message?.id ?? `q${i}`),
        text: truncate(String(q?.text ?? q?.content?.[0]?.text ?? q?.message?.content?.[0]?.text ?? ''), 400),
      })),
      question: (() => {
        const entry = [...questions.entries()].find(([, q]) => q.sessionId === sessionId)
        return entry ? questionView({ ...entry[1], id: entry[0] }) : null
      })(),
      approvals: [...approvals.entries()]
        .filter(([, a]) => a.sessionId === sessionId)
        .map(([id, a]) => {
          const call = a.callId ? callIndex.get(a.callId) : null
          // ApprovalCommand parity: the shell command (or terminal text) the
          // correlated call wants to run, shown as a line above the JSON.
          const command = (() => {
            try {
              const args = JSON.parse(call?.args ?? '{}')
              const c = a.toolName === 'terminal_send' ? args.text : args.command
              return typeof c === 'string' && c.length > 0 ? truncate(c, 300) : ''
            } catch { return '' }
          })()
          return {
            id,
            toolName: a.toolName,
            reason: a.reason,
            callId: a.callId,
            command,
            summary: call?.summary ?? '',
            args: call?.args ?? '',
            // exit_plan_mode carries a full markdown plan; show it as prose, not JSON.
            plan: a.toolName === 'exit_plan_mode' ? planText(call?.args) : '',
            diffs: call?.diffs ?? null,
            expiresAt: a.expiresAt,
            expiresIn: Math.max(0, Math.round((a.expiresAt - Date.now()) / 1000)),
          }
        }),
      // Quota notice (parity with QuotaNoticeHost): newest failure that smells like
      // billing/quota, surfaced so the phone can toast it once per rev.
      quota: (() => {
        const err = [...phoneRows.rows].reverse().find((r) => r && r.role === 'error' && /quota|配额|余额|欠费|insufficient|balance|billing/i.test(String(r.text)))
        return err ? String(err.text) : ''
      })(),
    }
    return out
  }

  // `plan` and `goal` are projections; their inner shape is the plugin's, so read it defensively.
  const planOf = (pv) => {
    const p = pv?.plan?.plan ?? pv?.plan
    if (!p) return null
    const raw = Array.isArray(p.steps) ? p.steps : Array.isArray(p.items) ? p.items : Array.isArray(p) ? p : []
    if (raw.length === 0) return null
    return {
      title: typeof p.title === 'string' ? p.title : '',
      steps: raw.slice(0, 24).map((step, i) => ({
        id: `p${i}`,
        text: String(step?.title ?? step?.text ?? step?.step ?? step?.content ?? '').split('\n')[0].slice(0, 160),
        state: String(step?.status ?? step?.state ?? 'pending'),
      })),
    }
  }
  // Relative time, computed here because the phone has no date library.
  const ago = (ms) => {
    if (!ms) return ''
    const d = Date.now() - Number(ms)
    if (!Number.isFinite(d) || d < 0) return ''
    const m = Math.round(d / 60000)
    if (m < 1) return 'now'
    if (m < 60) return `${m}m`
    const h = Math.round(m / 60)
    if (h < 24) return `${h}h`
    return `${Math.round(h / 24)}d`
  }
  const baseName = (p) => (typeof p === 'string' && p !== '' ? p.split('/').filter(Boolean).pop() ?? p : '')

  const registrySets = () => {
    try {
      const reg = ctx.get('workspaceRegistry')
      return { pinned: new Set(reg?.pinnedSessionIds ?? []), archived: new Set(reg?.archivedSessionIds ?? []) }
    } catch {
      return { pinned: new Set(), archived: new Set() }
    }
  }

  const callList = async (showArchived = false) => {
    const { pinned: pinnedIds, archived: archivedIds } = registrySets()
    const page = await sc().list({}, new AbortController().signal)
    const items = page?.items ?? []
    const rows = items.map((r) => {
      const pv = r.projections?.values ?? {}
      return {
        id: r.sessionId,
        title: typeof pv.title === 'string' ? pv.title : (pv.title?.name ?? null),
        cwd: r.cwd ?? null,
        origin: r.origin ?? null,
        archived: archivedIds.has(r.sessionId),
        running: Boolean(r.running),
        blank: Boolean(r.blank),
        available: Boolean(r.agentAvailable),
        projections: pv,
        updatedAt: r.updatedAt ?? null,
        lastPromptAt: pv.sessionListMetadata?.lastPromptAt ?? null,
        model: pv.modelSelection?.next?.model ?? pv.contextTimeline?.model ?? null,
        provider: pv.modelSelection?.next?.provider ?? pv.contextTimeline?.provider ?? null,
        effort: pv.modelSelection?.next?.reasoningEffort ?? pv.contextTimeline?.reasoningEffort ?? null,

        preset: pv.agentPreset?.name ?? null,
        goal: pv.goal?.goal?.objective ?? pv.goal?.objective ?? (typeof pv.goal === 'string' ? pv.goal : null),
        goalId: pv.goal?.goal?.id ?? pv.goal?.id ?? null,
        goalRevision: pv.goal?.goal?.revision ?? pv.goal?.revision ?? null,
        goalPhase: pv.goal?.goal?.phase ?? pv.goal?.phase ?? null,
        plan: planOf(pv),
        permission: pv.permissions?.currentValue ?? null,
        tokens: pv.tokenUsage?.total ?? null,
      }
    })
    // The same order the desktop sidebar shows: workspace registry order, sessions by recency
    // inside a workspace, and everything the registry does not account for under Ungrouped last.
    const workspaces = (() => {
      try {
        return (ctx.get('workspaceRegistry')?.list?.() ?? []).map((w) => ({
          id: w.id ?? w.workspaceId,
          path: w.record?.path ?? w.path ?? '',
          title: w.record?.title ?? w.title ?? '',
          sessionIds: w.record?.sessionIds ?? w.sessionIds ?? [],
        }))
      } catch { return [] }
    })()
    // Desktop sidebar visibility (tree.ts sessionVisible): subagent children and
    // other-workspace blanks never list; archived sessions hide unless the phone
    // asks for them (archived=show mirrors the desktop view-options toggle).
    const visible = rows.filter((r) => !r.blank && r.origin !== 'subagent' && (showArchived || !archivedIds.has(r.id)))
    const byId = new Map(visible.map((r) => [r.id, r]))
    const placed = new Set()
    const ordered = []
    // updatedAt DESC with the Session-id ascending tie-break the desktop uses.
    const byRecency = (a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
    for (const w of workspaces) {
      const rank = (r) => (pinnedIds.has(r.id) ? 1 : 0)
      const members = (w.sessionIds ?? []).map((id) => byId.get(id)).filter(Boolean)
        .sort((a, b) => rank(b) - rank(a) || byRecency(a, b))
      for (const r of members) {
        if (placed.has(r.id)) continue
        placed.add(r.id)
        ordered.push({ row: r, key: w.path || w.id, label: w.title || baseName(w.path) || w.id })
      }
    }
    const stray = visible.filter((r) => !placed.has(r.id))
      .sort((a, b) => (pinnedIds.has(b.id) ? 1 : 0) - (pinnedIds.has(a.id) ? 1 : 0) || byRecency(a, b))
    let prev = null
    for (const entry of ordered) {
      const r = entry.row
      r.group = entry.label
      r.first = entry.key !== prev
      r.when = ago(r.updatedAt ?? r.lastPromptAt)
      prev = entry.key
    }
    // The Ungrouped bucket labels itself client-side (group ''); keep the group
    // key distinct from any workspace path so `first` still flips once.
    for (const r of stray) {
      r.group = ''
      r.first = prev !== '__ungrouped__'
      r.when = ago(r.updatedAt ?? r.lastPromptAt)
      prev = '__ungrouped__'
    }
    return [...ordered.map((e) => e.row), ...stray]
  }

  let catalogAt = 0
  // Uploaded-but-unsent photos: phone-facing id -> {ref, name, at}.
  const attachments = new Map()
  let catalogCache = []

  const mergeStatus = async (showArchived = false) => {
    const { pinned: pinnedIds, archived: archivedIds } = registrySets()
    const rows = await callList(showArchived)
    const st = agentStatus()
    for (const r of rows) {
      const s = sessions.get(r.id)
      const live = st.get(r.id)
      sessions.set(r.id, {
        id: r.id,
        title: r.title ?? s?.title ?? null,
        cwd: r.cwd ?? s?.cwd ?? null,
        status: live?.status ?? (r.running ? 'running' : (s?.status === 'running' ? 'idle' : s?.status ?? 'idle')),
        running: Boolean(r.running || live?.status === 'running'),
        updatedAt: r.updatedAt ?? s?.updatedAt ?? 0,
        createdAt: r.createdAt ?? s?.createdAt ?? null,
        lastSeq: s?.lastSeq ?? null,
        plan: r.plan ?? s?.plan ?? null,
        goal: r.goal ?? s?.goal ?? null,
        goalId: r.goalId ?? s?.goalId ?? null,
        goalRevision: r.goalRevision ?? s?.goalRevision ?? null,
        goalPhase: r.goalPhase ?? s?.goalPhase ?? null,
        pinned: pinnedIds.has(r.id ?? s?.id ?? '') || Boolean(r.pinned) || Boolean(s?.pinned),
        archived: archivedIds.has(r.id ?? s?.id ?? '') || Boolean(r.archived) || Boolean(s?.archived),
        model: r.model ?? null,
        permission: r.permission ?? s?.permission ?? null,
        group: r.group ?? null,
        first: Boolean(r.first),
        when: r.when ?? '',
        meta: r,
      })
    }
    return [...sessions.values()]
  }

  // ---- HTTP -----------------------------------------------------------------
  let seenSavedAt = 0
  const authorized = (req, url = null) => {
    const header = req.headers.authorization ?? ''
    const token = header.startsWith('Bearer ') ? header.slice(7) : (url?.searchParams.get('t') ?? null)
    const me = token ? state.tokens.find((e) => e.t === token) : null
    if (!me) return false
    // Last-activity stamp for the panel's online/offline state; persisted at most
    // once every 30 s so a chatty phone does not hammer the state file.
    const now = Date.now()
    me.seen = now
    if (now - seenSavedAt > 30000) {
      seenSavedAt = now
      saveState({ tokens: state.tokens })
    }
    return true
  }

  // What the pairing panel shows: address, code, deep link, and the current token.
  // Tailscale gives the phone a LAN-like path that survives tunnel restarts; detect
  // the IP once (the CLI answers even while the daemon is stopped, from its cache).
  let tailscaleIp = ''
  try {
    // The App Store Tailscale CLI is a GUI wrapper and fails inside the DSH process
    // (Tailscale.CLIError 3), so read the address straight from the interface table:
    // when the tunnel is up, its utun carries the CGNAT address.
    const ifconfig = spawnSync('/sbin/ifconfig', { timeout: 3000, encoding: 'utf8' })
    const hit = /inet (100\.(?:6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.\d+\.\d+)/.exec(String(ifconfig.stdout ?? ''))
    if (hit) tailscaleIp = hit[1]
  } catch { /* ifconfig missing is not a reason to fail apply() */ }

  const pairingView = (p) => {
    const local = `http://127.0.0.1:${port}`
    const base = tunnel.url || local
    const link = `dshm://pair?u=${encodeURIComponent(tunnel.url || '')}&d=${encodeURIComponent(tailscaleIp ? `http://${tailscaleIp}:${port}` : '')}&c=${p.code}`
    return {
      code: p.code,
      expiresAt: p.expiresAt,
      ttlMinutes: Math.max(1, Math.round((p.expiresAt - Date.now()) / 60000)),
      publicUrl: tunnel.url,
      directUrl: tailscaleIp ? `http://${tailscaleIp}:${port}` : null,
      localUrl: local,
      deepLink: link,
      token: state.tokens.length > 0 ? state.tokens[state.tokens.length - 1].t : null,
      paired: state.tokens.length > 0,
      instanceId: state.instanceId,
      tunnelRunning: Boolean(tunnel.proc && !tunnel.stopped),
    }
  }

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1')
    const parts = url.pathname.split('/').filter(Boolean)
    // Aborted client connections surface as stream errors; unhandled they kill the host.
    res.on('error', (err) => log('response stream error:', url.pathname, String(err)))
    try {
      if (req.method === 'OPTIONS') {
        res.writeHead(204, {
          'access-control-allow-origin': '*',
          'access-control-allow-headers': 'authorization, content-type',
          'access-control-allow-methods': 'GET, POST, DELETE, PUT, OPTIONS',
        })
        return res.end()
      }

      if (url.pathname === '/v1/health') {
        return json(res, 200, { ok: true, name, instanceId: state.instanceId, paired: state.tokens.length > 0, sessions: sessions.size, publicUrl: tunnel.url })
      }

      // A page for the person at the Mac: one QR to scan, the code as a fallback.
      if ((url.pathname === '/pair' || url.pathname === '/') && req.method === 'GET') {
        if (req.headers['cf-connecting-ip'] || req.headers['cf-ray']) {
          return json(res, 403, { error: 'loopback_only' })
        }
        const p = state.pairing && state.pairing.expiresAt > Date.now() ? state.pairing : issuePairingCode()
        const mins = Math.max(1, Math.round((p.expiresAt - Date.now()) / 60000))
        const payload = `dshm://pair?u=${encodeURIComponent(tunnel.url || '')}&d=${encodeURIComponent(tailscaleIp ? `http://${tailscaleIp}:${port}` : '')}&c=${p.code}`
        let svg = ''
        try {
          svg = qrSvg(payload)
        } catch (err) {
          log('qr failed:', String(err))
        }
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' })
        return res.end(`<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1">
<title>远程配对 · dsh-remote</title>
<style>
body{font:16px -apple-system,system-ui;margin:0;display:grid;place-items:center;min-height:100vh;background:#0b0b0c;color:#eee}
main{text-align:center;max-width:420px;padding:24px}
h1{font-size:20px;font-weight:600;margin:0 0 4px}
.sub{color:#8a8a8e;font-size:13px;margin:0 0 20px}
.qr{background:#fff;border-radius:18px;padding:14px;display:inline-block;line-height:0}
.qr svg{width:260px;height:260px}
code{font-size:40px;letter-spacing:10px;font-variant-numeric:tabular-nums;display:block;margin:18px 0 2px}
.note{color:#6e6e73;font-size:12px;margin-top:10px;word-break:break-all}
</style>
<main><h1>远程配对 · dsh-remote</h1><p class="sub">用 dsh-remote App 扫码连接这台 Mac</p>
<div class="qr">${svg}</div>
<code>${p.code}</code>
<p class="note">${base}<br>code expires in ${mins} min · ${state.instanceId}</p>
<p class="note">${state.tokens.length > 0 ? 'This Mac has a paired device.' : 'Not paired yet.'}</p></main>`)
      }

      // Pairing code and token are only readable from the laptop itself (never through the tunnel).
      if (url.pathname === '/v1/pairing' && req.method === 'GET') {
        if (req.headers['cf-connecting-ip'] || req.headers['cf-ray']) {
          return json(res, 403, { error: 'loopback_only' })
        }
        const p = state.pairing && state.pairing.expiresAt > Date.now() ? state.pairing : issuePairingCode()
        return json(res, 200, pairingView(p))
      }

      // Issue a new code on demand: the panel's 刷新二维码 button used to only bust the
      // image cache, so it looked dead while the same five minutes were still running.
      if (url.pathname === '/v1/pairing/refresh' && req.method === 'POST') {
        if (req.headers['cf-connecting-ip'] || req.headers['cf-ray']) {
          return json(res, 403, { error: 'loopback_only' })
        }
        const p = issuePairingCode()
        return json(res, 200, pairingView(p))
      }

      // The same payload as an SVG, for a panel that does not want to draw a QR itself.
      if (url.pathname === '/v1/pairing.svg' && req.method === 'GET') {
        if (req.headers['cf-connecting-ip'] || req.headers['cf-ray']) {
          return json(res, 403, { error: 'loopback_only' })
        }
        const p = state.pairing && state.pairing.expiresAt > Date.now() ? state.pairing : issuePairingCode()
        let svg = ''
        try {
          svg = qrSvg(pairingView(p).deepLink, 5, 3)
        } catch (err) {
          return json(res, 500, { error: 'qr_failed', detail: String(err) })
        }
        res.writeHead(200, {
          'content-type': 'image/svg+xml; charset=utf-8',
          'cache-control': 'no-store',
          'access-control-allow-origin': '*',
        })
        return res.end(svg)
      }

      if (url.pathname === '/v1/pair' && req.method === 'POST') {
        const body = await readBody(req)
        const p = state.pairing
        // Per-IP throttle: 8 bad codes in 15 minutes locks that address out.
        const ip = req.socket.remoteAddress ?? '?'
        const now = Date.now()
        const bucket = pairFails.get(ip)
        if (bucket && now - bucket.first < 900000 && bucket.n >= 8) return json(res, 429, { error: 'ip_blocked' })
        if (!p || p.expiresAt < now) return json(res, 410, { error: 'code_expired' })
        if (p.attempts >= 3) return json(res, 429, { error: 'too_many_attempts' })
        if (String(body.code ?? '') !== p.code) {
          p.attempts += 1
          const b = bucket && now - bucket.first < 900000 ? bucket : { first: now, n: 0 }
          b.n += 1
          pairFails.set(ip, b)
          return json(res, 401, { error: 'bad_code', attemptsLeft: Math.max(0, 3 - p.attempts) })
        }
        const token = crypto.randomBytes(32).toString('hex')
        const name = String(body.name ?? '未命名设备').slice(0, 40)
        state.tokens = [...state.tokens.slice(-5), { t: token, name, at: now }]
        state.pairing = null
        pairFails.delete(ip)
        saveState({ tokens: state.tokens })
        log(`paired with a device: ${name}`)
        return json(res, 200, { token, instanceId: state.instanceId })
      }

      // Paired-device management: list with a self marker, revoke by masked id.
      if (parts[0] === 'v1' && parts[1] === 'devices') {
        // Reachable from the DSH panel on loopback and from any paired device.
        const header = req.headers.authorization ?? ''
        const mine = header.startsWith('Bearer ') ? header.slice(7) : (url.searchParams.get('t') ?? '')
        const isLoop = ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.socket.remoteAddress ?? '')
        const me = state.tokens.find((e) => e.t === mine)
        if (!isLoop && !me) return json(res, 401, { error: 'unauthorized' })
        if (req.method === 'GET') {
          const now = Date.now()
          return json(res, 200, {
            you: me ? me.t.slice(0, 8) : '',
            devices: state.tokens.map((e) => ({
              id: e.t.slice(0, 8),
              name: e.name,
              at: e.at ?? 0,
              seen: e.seen ?? 0,
              online: now - (e.seen ?? 0) < 15000,
            })),
          })
        }
        if (parts[2] && req.method === 'DELETE') {
          const id = decodeURIComponent(parts[2])
          if (me && me.t.startsWith(id)) return json(res, 400, { error: 'cannot revoke the requesting device' })
          const before = state.tokens.length
          state.tokens = state.tokens.filter((e) => !e.t.startsWith(id))
          if (state.tokens.length === before) return json(res, 404, { error: 'no such device' })
          saveState({ tokens: state.tokens })
          log(`revoked device: ${id}`)
          return json(res, 200, { ok: true })
        }
      }

      if (!authorized(req, url)) return json(res, 401, { error: 'unauthorized' })

      // Dev-only: call a sessionController method with raw JSON args.
      const loopback = ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.socket.remoteAddress ?? '')
      if (url.pathname === '/v1/_try' && req.method === 'POST' && loopback) {
        const body = await readBody(req)
        const controller = body.svc ? (ctx.get(body.svc) ?? {}) : sc()
        const args = (body.args ?? []).map((a) => (a === '$signal' ? new AbortController().signal : a))
        try {
          const value = await controller[body.method](...args)
          return json(res, 200, { ok: true, value: JSON.parse(JSON.stringify(value ?? null)) })
        } catch (err) {
          return json(res, 200, { ok: false, error: String(err?.message ?? err) })
        }
      }

      if (parts[0] === 'v1' && parts[1] === 'approvals' && parts[2] && req.method === 'POST') {
        const id = decodeURIComponent(parts[2])
        const body = await readBody(req)
        const pending = approvals.get(id)
        if (!pending) return json(res, 404, { error: 'expired' })
        const decision = body.decision === 'allow' || body.decision === 'always' ? 'allowed-once' : 'rejected'
        if (body.decision === 'always') {
          try { ctx.get('approval')?.setPolicy?.(pending.agent, 'never') } catch {}
        }
        pending.settle(decision)
        pushFeed(pending.sessionId, 'approval/resolved', { approvalId: id, decision })
        return json(res, 200, { ok: true, decision })
      }

      if (parts[0] === 'v1' && parts[1] === 'questions' && parts[2] && req.method === 'POST') {
        const id = decodeURIComponent(parts[2])
        const action = parts[3] ?? ''
        const pending = questions.get(id)
        if (!pending) return json(res, 404, { error: 'expired' })
        if (action === 'skip') {
          pending.settle(null)
          pushFeed(pending.sessionId, 'question/skipped', { id })
          return json(res, 200, { ok: true, skipped: true })
        }
        if (action === 'answer') {
          const body = await readBody(req)
          const answers = Array.isArray(body.answers) ? body.answers : []
          const known = new Set((pending.items ?? []).map((item, i) => String(item?.id ?? `q${i}`)))
          const clean = answers
            .filter((a) => a && known.has(String(a.id)))
            .map((a) => ({
              id: String(a.id),
              selected: Array.isArray(a.selected) ? a.selected.map(String) : [],
              ...(typeof a.custom === 'string' && a.custom !== '' ? { custom: a.custom } : {}),
            }))
          if (clean.length === 0) return json(res, 400, { error: 'no_answers' })
          pending.settle({ answers: clean })
          pushFeed(pending.sessionId, 'question/answered', { id })
          return json(res, 200, { ok: true })
        }
        return json(res, 404, { error: 'not_found' })
      }

      if (parts[0] === 'v1' && parts[1] === 'sessions' && parts[2] && (parts[3] === 'pin' || parts[3] === 'archive') && req.method === 'POST') {
        const sessionId = decodeURIComponent(parts[2])
        const body = await readBody(req)
        const on = body.on !== false
        const registry = ctx.get('workspaceRegistry')
        if (!registry) return json(res, 409, { error: 'workspace registry unavailable' })
        try {
          if (parts[3] === 'pin') {
            if (on) await registry.pinSession(sessionId)
            else await registry.unpinSession(sessionId)
          } else {
            if (on) await registry.archiveSession(sessionId)
            else await registry.unarchiveSession(sessionId)
          }
          return json(res, 200, { ok: true })
        } catch (err) {
          return json(res, 409, { error: String(err?.message ?? err) })
        }
      }

      if (parts[0] === 'v1' && parts[1] === 'sessions' && parts[2] && parts[3] === 'jobs' && parts[5] === 'kill' && req.method === 'POST') {
        const sessionId = decodeURIComponent(parts[2])
        const jobId = decodeURIComponent(parts[4] ?? '')
        try {
          const result = ctx.get('jobs')?.kill?.(jobId, sessionId, 'stopped from the phone')
          return json(res, 200, { ok: true, result: result ?? 'requested' })
        } catch (err) {
          return json(res, 409, { error: String(err?.message ?? err) })
        }
      }

      if (parts[0] === 'v1' && parts[1] === 'sessions' && parts[2] && parts[3] === 'goal' && req.method === 'POST') {
        const sessionId = decodeURIComponent(parts[2])
        const body = await readBody(req)
        const action = String(body.action ?? '')
        const agent = ctx.get('agents')?.get?.(sessionId)
        const goalService = ctx.get('goals')
        if (!agent || !goalService) return json(res, 409, { error: 'goal unavailable' })
        const view = goalService.get?.(agent)
        if (!view?.id) return json(res, 409, { error: 'no goal on this session' })
        const ref = { id: view.id, revision: view.revision }
        try {
          if (action === 'pause') goalService.pause(agent, ref)
          else if (action === 'resume') goalService.resume(agent, ref)
          else if (action === 'clear') goalService.clear(agent, ref)
          else return json(res, 400, { error: 'unknown action' })
          return json(res, 200, { ok: true, phase: goalService.get?.(agent)?.phase ?? null })
        } catch (err) {
          return json(res, 409, { error: String(err?.message ?? err) })
        }
      }

      if (parts[0] === 'v1' && parts[1] === 'sessions' && parts[2] && parts[3] === 'queue' && parts[4] && req.method === 'POST') {
        const sessionId = decodeURIComponent(parts[2])
        const itemId = decodeURIComponent(parts[4])
        // edit rewrites the queued text (DSH QueueAction kind:'edit'), steer
        // injects it into the running turn now, remove drops it.
        let action = { kind: 'remove' }
        if (parts[5] === 'steer') action = { kind: 'steer' }
        if (parts[5] === 'edit') {
          const body = await readBody(req).catch(() => ({}))
          const text = String(body?.text ?? '').slice(0, 4000)
          if (text === '') return json(res, 400, { ok: false, error: 'empty text' })
          action = { kind: 'edit', content: [{ type: 'text', text }] }
        }
        try {
          await sc().updateQueue({ sessionId, itemId, action }, new AbortController().signal)
          return json(res, 200, { ok: true })
        } catch (err) {
          return json(res, 409, { ok: false, error: String(err?.message ?? err) })
        }
      }

      // Dev: ask the approval seam directly, to exercise the phone path.
      if (url.pathname === '/v1/_ask' && req.method === 'POST') {
        const body = await readBody(req)
        const agent = (ctx.get('agents')?.list?.() ?? []).find((a) => a?.session?.id === body.sessionId)
        if (!agent) return json(res, 404, { error: 'no agent' })
        try {
          const outcome = await ctx.get('approval').request({
            agent,
            toolName: body.toolName ?? 'bash',
            callId: body.callId ?? undefined,
            reason: body.reason ?? 'bridge self-test',
            displayReason: body.reason ?? 'bridge self-test',
            signal: new AbortController().signal,
          })
          return json(res, 200, { ok: true, outcome })
        } catch (err) {
          return json(res, 200, { ok: false, error: String(err?.message ?? err) })
        }
      }

      // Dev: inspect a Host service's surface (own + prototype keys).
      if (url.pathname === '/v1/_svc' && req.method === 'GET') {
        const name = url.searchParams.get('name') ?? 'approval'
        const svc = ctx.get?.(name)
        if (!svc) return json(res, 200, { ok: false, error: `no service ${name}` })
        const fn = url.searchParams.get('fn')
        if (fn && typeof svc[fn] === 'function') return json(res, 200, { ok: true, fn, src: String(svc[fn]).slice(0, 4000) })
        const proto = Object.getPrototypeOf(svc) ?? {}
        return json(res, 200, {
          ok: true,
          name,
          own: Object.keys(svc),
          proto: Object.getOwnPropertyNames(proto),
          approval: typeof svc === 'object' ? Object.getOwnPropertyNames(Object.getPrototypeOf(svc) ?? {}).length : null,
        })
      }

      // The poll split: /v1/live is the small always-fetched part (list, queue,
      // approvals, streaming); /v1/transcript carries the rows and is only fetched
      // when the revision below changes.
      if ((url.pathname === '/v1/live' || url.pathname === '/v1/transcript') && req.method === 'GET') {
        const sessionId = url.searchParams.get('session') ?? null
        const take = Math.min(Math.max(Number(url.searchParams.get('take') ?? 8) || 8, 4), 60)
        // The archived filter mirrors the desktop view-options toggle: 'default'
        // hides archived rows, 'show' mixes them back in grayed.
        const showArchived = url.searchParams.get('archived') === 'show'
        if (sessionId) phoneSeen.set(sessionId, Date.now())
        const snapshot = await snapshotSession(sessionId, take, showArchived)
        if (url.pathname === '/v1/transcript') {
          const rowsOut = snapshot.session?.messages ?? []
          const sinceRaw = url.searchParams.get('since')
          const cursor = Number((snapshot.session?.rowsRev ?? '').split(':')[0]) || 0
          if (sinceRaw !== null) {
            const since = Number(sinceRaw) || 0
            // A cursor the server cannot have produced (a fork, a wipe) falls back to a full window.
            if (since >= 0 && since <= cursor) {
              return json(res, 200, {
                rowsRev: snapshot.session?.rowsRev ?? '',
                hasMore: snapshot.session?.hasMore ?? false,
                seq: cursor,
                ids: rowsOut.map((r) => r.id),
                rows: rowsOut.filter((r) => Number(r.seq) > since),
              })
            }
          }
          return json(res, 200, {
            rowsRev: snapshot.session?.rowsRev ?? '',
            hasMore: snapshot.session?.hasMore ?? false,
            seq: cursor,
            ids: rowsOut.map((r) => r.id),
            rows: rowsOut,
          })
        }
        const hasList = url.searchParams.get('listRev') !== snapshot.listRev
        if (!hasList) snapshot.sessions = []
        if (sessionId && snapshot.session) {
          const now = Date.now()
          if (now - catalogAt > 5000) {
            catalogAt = now
            catalogCache = await callList().catch(() => [])
          }
          const pv = catalogCache.find((r) => r.id === sessionId)?.projections ?? {}
          snapshot.session.subagents = (Array.isArray(pv.subagentCatalog) ? pv.subagentCatalog : []).slice(0, 8)
            .map((c) => ({ id: String(c.id ?? ''), label: truncate(String(c.label ?? c.name ?? ''), 80), sessionId: String(c.id ?? '') }))
          // Agent-team board (parity with TeamBoard): tasks of this session's team.
          const teamTasks = pv.agentTeam?.tasks ?? pv.team?.tasks
          if (Array.isArray(teamTasks) && teamTasks.length > 0) {
            snapshot.session.team = teamTasks.slice(0, 20).map((t, k) => ({
              id: `tt${k}`,
              taskId: String(t.id ?? ''),
              subject: truncate(String(t.subject ?? ''), 120),
              status: String(t.status ?? 'pending'),
              owner: truncate(String(t.ownerName ?? t.ownerId ?? ''), 60),
            }))
          }
          // Context occupancy (parity with ContextMeter): the projection carries
          // whichever shape the host version speaks; pick defensively.
          const ct = pv.contextTimeline
          if (ct && typeof ct === 'object') {
            const used = Number(ct.usedTokens ?? ct.used ?? ct.occupied ?? 0)
            const total = Number(ct.totalTokens ?? ct.total ?? ct.capacity ?? 0)
            if (used > 0 || total > 0) snapshot.session.context = { used, total }
          }
        }
        if (snapshot.session) snapshot.session.messages = []
        if (hasList && snapshot.sessions.length > 0) {
          for (const s of snapshot.sessions) {
            const prev = sessions.get(s.id)
            sessions.set(s.id, { ...prev, ...s })
          }
        }
        return json(res, 200, snapshot)
      }


      if (url.pathname === '/v1/sessions' && req.method === 'GET') {
        const rows = await mergeStatus()
        return json(res, 200, { sessions: rows.slice(0, SESSION_MAX) })
      }

      // A file the transcript referenced by path (Markdown image in an answer): the phone
      // cannot read the Mac's disk, so the bridge hands over the bytes.
      if (parts[0] === 'v1' && parts[1] === 'sessions' && parts[2] && parts[3] === 'call' && req.method === 'GET') {
        const callId = url.searchParams.get('callId') ?? ''
        const block = lastCalls.get(callId)
        if (!block) return json(res, 404, { error: 'unknown call' })
        return json(res, 200, {
          callId,
          name: block.name ?? '',
          args: block.args ?? '',
          result: block.result ?? '',
          diffs: block.diffs ?? [],
          todos: block.todos ?? [],
          files: block.files ?? [],
          question: block.question ?? '',
          options: block.options ?? [],
        })
      }

      if (parts[0] === 'v1' && parts[1] === 'file' && req.method === 'GET') {
        if (!authorized(req, url)) return json(res, 401, { error: 'unauthorized' })
        const raw = url.searchParams.get('p') ?? ''
        const sid = url.searchParams.get('s') ?? ''
        let base = process.cwd()
        if (sid) {
          const row = (await mergeStatus()).find((r) => r.id === sid)
          if (row?.cwd) base = row.cwd
        }
        const resolved = path.isAbsolute(raw) ? raw : path.resolve(base, raw)
        // Scoping: serve only the session's own workspace and the system temp dir
        // (charts and scratch images live there). Everything else is off-limits.
        {
          const baseResolved = path.resolve(base)
          const tmp = os.tmpdir()
          const under = (root, target) => target === root || target.startsWith(root + path.sep)
          const ok = under(baseResolved, resolved) || under(tmp, resolved) || under(path.resolve('/private', tmp), resolved)
          if (!ok) return json(res, 403, { error: 'outside workspace' })
        }
        try {
          const stat = fs.statSync(resolved)
          if (!stat.isFile() || stat.size > 24 * 1024 * 1024) return json(res, 404, { error: 'not a file' })
          const ext = path.extname(resolved).toLowerCase()
          const mime = ext === '.png' ? 'image/png' : ext === '.jpg' || ext === '.jpeg' ? 'image/jpeg'
            : ext === '.webp' ? 'image/webp' : ext === '.gif' ? 'image/gif' : 'application/octet-stream'
          const bytes = fs.readFileSync(resolved)
          res.writeHead(200, {
            'content-type': mime,
            'cache-control': 'private, max-age=300',
            'content-length': bytes.length,
            'access-control-allow-origin': '*',
          })
          return res.end(bytes)
        } catch {
          return json(res, 404, { error: 'no such file' })
        }
      }

      // Image bytes for <img>: the query token is allowed because an <img> cannot send headers.
      if (parts[0] === 'v1' && parts[1] === 'attachments' && parts[2] && req.method === 'GET') {
        if (!authorized(req, url)) return json(res, 401, { error: 'unauthorized' })
        const id = decodeURIComponent(parts[2])
        const ref = imageRefs.get(id) ?? null
        try {
          const answered = await sc().attachment({ attachment: ref ?? { attachmentId: id } }, new AbortController().signal)
          const bytes = Buffer.from(answered?.data ?? '', 'base64')
          res.writeHead(200, {
            'content-type': answered?.attachment?.mediaType ?? ref?.mediaType ?? 'image/png',
            'cache-control': 'private, max-age=86400',
            'content-length': bytes.length,
            'access-control-allow-origin': '*',
          })
          return res.end(bytes)
        } catch {
          return json(res, 404, { error: 'unknown attachment' })
        }
      }

      // A new session: same controller the web UI uses, so the Mac sees it too.
      // ---- models and slash commands (the phone's parity with the desktop) ----
      if (parts[0] === 'v1' && parts[1] === 'sessions' && parts[2] && parts[3] === 'models' && req.method === 'GET') {
        try {
          const sig = new AbortController().signal
          const [catalog, live] = await Promise.all([
            sc().modelCatalog({ sessionId: parts[2] }, sig),
            sc().list({}, sig),
          ])
          const row = (live?.items ?? []).find((r) => r.sessionId === parts[2])
          const pv = row?.projections?.values ?? {}
          const next = pv.modelSelection?.next ?? pv.contextTimeline ?? {}
          const groups = (catalog?.groups ?? []).map((g) => ({
            id: String(g.id ?? ''),
            name: String(g.name ?? g.id ?? ''),
            models: (g.models ?? []).map((m) => ({
              id: String(m.id ?? ''),
              name: String(m.name ?? m.id ?? ''),
              efforts: (m.reasoning?.efforts ?? []).map((e) => ({ id: String(e.id ?? ''), name: String(e.name ?? e.id ?? '') })),
            })),
          }))
          return json(res, 200, {
            current: { provider: next.provider ?? null, model: next.model ?? null, effort: next.reasoningEffort ?? null },
            groups,
          })
        } catch (err) {
          return json(res, 409, { error: String(err?.message ?? err) })
        }
      }

      if (parts[0] === 'v1' && parts[1] === 'sessions' && parts[2] && parts[3] === 'model' && req.method === 'POST') {
        const body = await readBody(req)
        try {
          const out = await sc().selectModel(
            {
              sessionId: parts[2],
              provider: body.provider,
              model: body.model,
              ...(typeof body.effort === 'string' && body.effort !== '' ? { reasoningEffort: body.effort } : {}),
            },
            new AbortController().signal,
          )
          return json(res, 200, { ok: true, selected: out?.selected ?? null })
        } catch (err) {
          return json(res, 409, { error: String(err?.message ?? err) })
        }
      }

      if (parts[0] === 'v1' && parts[1] === 'sessions' && parts[2] && parts[3] === 'commands' && req.method === 'GET') {
        try {
          const list = await ctx.get('commands').list({ sessionId: parts[2] }, new AbortController().signal)
          return json(res, 200, {
            commands: (list ?? []).map((c) => ({
              name: String(c.name ?? ''),
              description: String(c.description ?? ''),
              hint: String(c.input?.hint ?? ''),
            })),
          })
        } catch (err) {
          return json(res, 409, { error: String(err?.message ?? err) })
        }
      }

      if (parts[0] === 'v1' && parts[1] === 'sessions' && parts[2] && parts[3] === 'command' && req.method === 'POST') {
        const body = await readBody(req)
        try {
          const args = { sessionId: parts[2], name: String(body.name ?? '') }
          if (typeof body.input === 'string' && body.input !== '') args.input = body.input
          const result = await ctx.get('commands').execute(args, new AbortController().signal)
          // Commands answer with a short receipt when they have one; the desktop
          // UI renders it, so hand the same text back to the phone.
          const text = typeof result === 'string' ? result
            : typeof result?.message === 'string' ? result.message
              : typeof result?.text === 'string' ? result.text : ''
          return json(res, 200, { ok: true, message: text })
        } catch (err) {
          return json(res, 409, { error: String(err?.message ?? err) })
        }
      }

      if (url.pathname === '/v1/sessions' && req.method === 'POST') {
        const body = await readBody(req)
        const request = {}
        if (typeof body.cwd === 'string' && body.cwd !== '') request.cwd = body.cwd
        try {
          const created = await sc().create(request, new AbortController().signal)
          return json(res, 200, { id: created.sessionId })
        } catch (err) {
          return json(res, 409, { error: String(err?.message ?? err) })
        }
      }

      if (parts[0] === 'v1' && parts[1] === 'sessions' && parts[2] && parts[3] === 'permission' && req.method === 'POST') {
        const id = decodeURIComponent(parts[2])
        const body = await readBody(req)
        const value = String(body.value ?? '')
        const agent = ctx.get('agents')?.get?.(id)
        const svc = ctx.get('permissionPresets')
        if (!agent?.session || !svc) return json(res, 409, { error: 'permissions unavailable' })
        try {
          svc.set(agent.session, value)
          return json(res, 200, { ok: true, value, catalog: permissionCatalog(ctx) })
        } catch (err) {
          return json(res, 409, { error: String(err?.message ?? err) })
        }
      }

      // Message feedback (parity with ui-message-feedback): the host owns the
      // compare-and-set; the phone sends seq + rating and optionally a note.
      if (parts[0] === 'v1' && parts[1] === 'sessions' && parts[3] === 'feedback' && (req.method === 'POST' || req.method === 'GET')) {
        const id = decodeURIComponent(parts[2])
        const svc = (() => { try { return ctx.get('messageFeedback') } catch { return undefined } })()
        if (!svc || typeof svc.put !== 'function') return json(res, 409, { error: 'feedback unavailable' })
        try {
          if (req.method === 'GET') {
            const listed = await svc.list({ sessionId: id })
            const items = Array.isArray(listed?.items) ? listed.items : Array.isArray(listed) ? listed : []
            return json(res, 200, { items: items.map((it) => ({ messageId: Number(it?.messageId ?? 0), rating: String(it?.rating ?? '') })) })
          }
          const body = await readBody(req)
          const rating = body.rating === 'negative' ? 'negative' : 'positive'
          const result = await svc.put({
            sessionId: id,
            messageId: Number(body.seq),
            rating,
            ...(typeof body.note === 'string' && body.note.trim() !== '' ? { note: body.note.trim() } : {}),
            ifVersion: null,
          })
          const failure = result && typeof result === 'object' && 'ok' in result && result.ok === false ? result : null
          if (failure) return json(res, 409, { error: String(failure.error?.code ?? failure.error?.message ?? 'feedback rejected') })
          return json(res, 200, { ok: true })
        } catch (err) {
          return json(res, 409, { error: String(err?.message ?? err) })
        }
      }

      // File preview (parity with the desktop document preview): one workspace
      // file for one session. Text comes back as text; images as a data URL.
      if (parts[0] === 'v1' && parts[1] === 'sessions' && parts[3] === 'file' && req.method === 'GET') {
        const id = decodeURIComponent(parts[2])
        const rel = String(url.searchParams.get('p') ?? '')
        if (rel === '') return json(res, 400, { error: 'missing_path' })
        try {
          const rows = await callList(true).catch(() => [])
          const cwd = rows.find((r) => r.id === id)?.cwd
          const target = rel.startsWith('/') ? rel : (cwd ? path.resolve(cwd, rel) : path.resolve(rel))
          const st = await fsp.stat(target)
          if (!st.isFile()) return json(res, 404, { error: 'not_a_file' })
          if (st.size > 2 * 1024 * 1024) return json(res, 413, { error: 'too_large', bytes: st.size })
          const ext = path.extname(target).toLowerCase().replace('.', '')
          const imageMedia = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif', bmp: 'image/bmp', svg: 'image/svg+xml' }[ext]
          if (imageMedia) {
            const buf = await fsp.readFile(target)
            return json(res, 200, { ok: true, kind: 'image', media: imageMedia, name: path.basename(target), bytes: st.size, url: `data:${imageMedia};base64,${buf.toString('base64')}` })
          }
          const buf = await fsp.readFile(target)
          const textExt = ['txt','md','markdown','json','jsonc','ts','tsx','js','jsx','mjs','cjs','py','rb','go','rs','java','kt','kts','c','h','cpp','hpp','cs','swift','m','sh','bash','zsh','fish','yaml','yml','toml','ini','cfg','conf','env','xml','html','htm','css','scss','sass','less','vue','svelte','sql','graphql','gql','lock','gradle','properties','gitignore','editorconfig','diff','patch','log','csv','tsv','proto','tf','hcl','Dockerfile','makefile','cmake','pl','lua','r','dart','ex','exs','erl','hs','ml','clj','cljs','scala','php','asp','aspx','jl','nim','zig','v','sol','move','prisma']
          if (textExt.includes(ext) || ext === '' || st.size < 64 * 1024) {
            return json(res, 200, { ok: true, kind: 'text', media: 'text/plain', name: path.basename(target), bytes: st.size, text: buf.toString('utf8') })
          }
          return json(res, 200, { ok: true, kind: 'binary', media: 'application/octet-stream', name: path.basename(target), bytes: st.size })
        } catch (err) {
          return json(res, 404, { error: String(err?.code ?? err?.message ?? err) })
        }
      }

      // Scheduled tasks (parity with ui-schedule): list, create, edit, delete, run.
      if (parts[0] === 'v1' && parts[1] === 'schedules') {
        const svc = (() => { try { return ctx.get('schedule') } catch { return undefined } })()
        if (!svc || typeof svc.list !== 'function') return json(res, 409, { error: 'schedule unavailable' })
        const timingText = (t) => {
          if (!t) return ''
          if (t.kind === 'cron') return `cron ${t.expression} (${t.timeZone ?? ''})`
          if (t.kind === 'rrule') return String(t.rrule ?? '').split('\n').filter(Boolean).pop() ?? ''
          if (t.kind === 'daily') return `每天 ${t.daily?.time ?? ''} (${t.daily?.time_zone ?? ''})`
          if (t.kind === 'weekly') return `每周 ${t.weekly?.time ?? ''} (${t.weekly?.time_zone ?? ''})`
          if (t.kind === 'every') return `每 ${Math.round(Number(t.every_seconds ?? 0) / 60)} 分钟`
          if (t.kind === 'after') return `${Math.round(Number(t.after_seconds ?? 0) / 60)} 分钟后`
          if (t.kind === 'at') return `at ${typeof t.at === 'string' ? t.at : `${t.at?.date ?? ''} ${t.at?.time ?? ''}`}`
          return t.kind ?? ''
        }
        const mapTask = (t) => ({
          id: String(t?.id ?? ''),
          title: truncate(String(t?.title ?? ''), 120),
          prompt: truncate(String(t?.prompt ?? ''), 400),
          status: String(t?.status ?? 'active'),
          kind: String(t?.kind ?? ''),
          timing: timingText(t),
          nextAt: t?.scheduledAt ?? null,
          updatedAt: t?.updatedAt ?? null,
          targetSessionId: t?.target?.kind === 'session' ? String(t.target.sessionId) : null,
        })
        try {
          if (req.method === 'GET' && parts.length === 2) {
            const listed = await svc.list({ limit: 100 })
            const items = Array.isArray(listed?.items) ? listed.items : []
            return json(res, 200, { items: items.map(mapTask), total: Number(listed?.total ?? items.length) })
          }
          const body = await readBody(req)
          if (req.method === 'POST' && parts.length === 2) {
            const title = String(body.title ?? '').trim()
            const prompt = String(body.prompt ?? '').trim()
            if (title === '' || prompt === '') return json(res, 400, { error: 'title_and_prompt_required' })
            const timing = body.timing && typeof body.timing === 'object' ? body.timing : { kind: 'daily', daily: { time: '09:00:00', time_zone: 'Asia/Shanghai' } }
            const created = await svc.create({ title, prompt, timing })
            return json(res, 200, { ok: true, task: mapTask(created) })
          }
          if (parts.length === 4 && req.method === 'POST') {
            const id = decodeURIComponent(parts[2])
            if (parts[3] === 'run') { await svc.run({ id }); return json(res, 200, { ok: true }) }
            if (parts[3] === 'edit') {
              const patch = {}
              if (typeof body.title === 'string' && body.title.trim() !== '') patch.title = body.title.trim()
              if (typeof body.prompt === 'string' && body.prompt.trim() !== '') patch.prompt = body.prompt.trim()
              if (body.active === true || body.active === false) patch.active = body.active
              if (body.timing && typeof body.timing === 'object') patch.timing = body.timing
              const result = await svc.edit({ id, action: 'update', patch, expectedUpdatedAt: null })
              if (result && typeof result === 'object' && result.code) return json(res, 409, { error: String(result.code) })
              return json(res, 200, { ok: true, task: mapTask(result) })
            }
            if (parts[3] === 'delete') {
              const result = await svc.edit({ id, action: 'delete', expectedUpdatedAt: null })
              if (result && typeof result === 'object' && result.code) return json(res, 409, { error: String(result.code) })
              return json(res, 200, { ok: true })
            }
          }
          return json(res, 404, { error: 'unknown_schedule_route' })
        } catch (err) {
          return json(res, 409, { error: String(err?.message ?? err) })
        }
      }

      if (parts[0] === 'v1' && parts[1] === 'sessions' && parts[3] === 'rename' && req.method === 'POST') {
        const id = decodeURIComponent(parts[2])
        const body = await readBody(req)
        const title = String(body.title ?? '').trim()
        if (title === '') return json(res, 400, { error: 'empty_title' })
        try {
          const renamed = await sc().rename({ sessionId: id, title }, new AbortController().signal)
          return json(res, 200, { ok: true, title: renamed.title })
        } catch (err) {
          return json(res, 409, { error: String(err?.message ?? err) })
        }
      }

      if (parts[0] === 'v1' && parts[1] === 'sessions' && parts[3] === 'fork' && req.method === 'POST') {
        const id = decodeURIComponent(parts[2])
        const body = await readBody(req)
        const atSeq = Number.isFinite(Number(body.atSeq)) ? Number(body.atSeq) : undefined
        try {
          const forked = await sc().fork({ sessionId: id, ...(atSeq ? { atSeq } : {}) }, new AbortController().signal)
          return json(res, 200, { id: forked.sessionId })
        } catch (err) {
          return json(res, 409, { error: String(err?.message ?? err) })
        }
      }

      // One feed request covers every session; long-poll up to 25s.
      if (url.pathname === '/v1/feed' && req.method === 'GET') {
        const after = Number(url.searchParams.get('after') ?? 0)
        const wait = Math.min(Number(url.searchParams.get('wait') ?? 0), 25_000)
        const collect = () => {
          const idx = feed.findIndex((f) => f.eid > after)
          return idx === -1 ? [] : feed.slice(idx)
        }
        let items = collect()
        if (!items.length && wait > 0) {
          items = await new Promise((resolve) => {
            const done = (v) => {
              listeners.delete(fn)
              clearTimeout(timer)
              resolve(v)
            }
            const fn = () => done(collect())
            const timer = setTimeout(() => done([]), wait)
            listeners.add(fn)
          })
        }
        return json(res, 200, { events: items.slice(0, 500), cursor: eid, hasMore: items.length > 500 })
      }

      // Durable transcript page for one session.
      if (parts[0] === 'v1' && parts[1] === 'sessions' && parts[3] === 'events' && req.method === 'GET') {
        const id = decodeURIComponent(parts[2])
        const maxMessages = Math.min(Number(url.searchParams.get('limit') ?? 50), 200)
        const beforeSeq = url.searchParams.get('before')
        const request = { address: { kind: 'session', sessionId: id }, maxMessages }
        if (beforeSeq) request.beforeSeq = Number(beforeSeq)
        const page = await sc().events(request, new AbortController().signal)
        return json(res, 200, { sessionId: id, records: page?.records ?? [], cursor: page?.cursor ?? null })
      }

      if (parts[0] === 'v1' && parts[1] === 'sessions' && parts[3] === 'state' && req.method === 'GET') {
        const id = decodeURIComponent(parts[2])
        const snapshot = await sc().state({ sessionId: id }, new AbortController().signal)
        return json(res, 200, { sessionId: id, state: snapshot })
      }

      if (parts[0] === 'v1' && parts[1] === 'sessions' && parts[3] === 'live' && req.method === 'GET') {
        const id = decodeURIComponent(parts[2])
        const out = []
        for (const [attemptId, buf] of live) if (buf.sessionId === id) out.push({ attemptId, ...buf })
        return json(res, 200, { sessionId: id, attempts: out })
      }

      // A photo from the phone: raw bytes in, an id out. The prompt admission on the
      // DSH side turns the base64 into a durable attachment; the phone's JS heap
      // never sees the bytes (exactBodyFrom streams the file straight to us).
      if (url.pathname === '/v1/attach' && req.method === 'POST') {
        const name = String(url.searchParams.get('name') ?? 'photo')
        const media = String(url.searchParams.get('media') ?? 'image/jpeg')
        const chunks = []
        for await (const chunk of req) chunks.push(chunk)
        const data = Buffer.concat(chunks).toString('base64')
        if (data === '') return json(res, 400, { error: 'empty_body' })
        const id = crypto.randomUUID()
        attachments.set(id, { data, mediaType: media, name, at: Date.now() })
        for (const [k, v] of attachments) if (Date.now() - v.at > 30 * 60_000) attachments.delete(k)
        return json(res, 200, { id, name, bytes: Math.round((data.length * 3) / 4) })
      }

      if (parts[0] === 'v1' && parts[1] === 'sessions' && parts[3] === 'prompt' && req.method === 'POST') {
        const id = decodeURIComponent(parts[2])
        const body = await readBody(req)
        const text = String(body.text ?? '')
        if (!text.trim()) return json(res, 400, { error: 'empty_text' })
        const imageParts = (Array.isArray(body.images) ? body.images : [])
          .map((uid) => attachments.get(String(uid)))
          .filter(Boolean)
          .map(({ data, mediaType, name }) => ({ type: 'image', mediaType, data, name }))
        for (const uid of Array.isArray(body.images) ? body.images : []) attachments.delete(String(uid))
        const request = {
          sessionId: id,
          content: [{ type: 'text', text }, ...imageParts],
          requestId: body.requestId ?? crypto.randomUUID(),
        }
        request.mode = body.mode === 'steer' ? 'steer' : 'queue'
        // A session that never picked a model yet refuses the prompt until one is set.
        await sc().initializeDefaultModel({ sessionId: id }, new AbortController().signal).catch(() => {})
        try {
          const receipt = await sc().prompt(request, new AbortController().signal)
          touchSession(id, { status: 'running' })
          return json(res, 200, { accepted: true, receipt })
        } catch (err) {
          return json(res, 409, { error: String(err?.message ?? err) })
        }
      }

      if (parts[0] === 'v1' && parts[1] === 'sessions' && parts[3] === 'cancel' && req.method === 'POST') {
        const id = decodeURIComponent(parts[2])
        await sc().cancel({ sessionId: id })
        return json(res, 200, { cancelled: true })
      }

      return json(res, 404, { error: 'not_found' })
    } catch (err) {
      const message = String(err?.message ?? err)
      log('request failed:', url.pathname, message)
      // The response may already be on the wire (route answered, then something threw).
      // Trying to answer again would crash the host; json() also guards, this logs the case.
      if (res.headersSent) return
      return json(res, 500, { error: 'internal', message })
    }
  })

  server.on('error', (err) => log('server error', String(err)))
  const bindAll = tailscaleIp !== '' || config.bind === 'all'
  server.listen(port, bindAll ? '0.0.0.0' : '127.0.0.1', () => {
    startTunnel()
    log('pair page: http://127.0.0.1:' + port + '/pair')
    log('listening on http://127.0.0.1:' + port, state.tokens.length > 0 ? '(paired)' : '(pairing required)')
    if (state.tokens.length === 0) issuePairingCode()
  })

  ctx.effect(() => () => {
    tunnel.stopped = true
    try { tunnel.proc?.kill() } catch {}
    for (const fn of listeners) listeners.delete(fn)
    try {
      // A phone polling every 700 ms keeps connections alive; close() alone waits for
      // them and the plugin-manager transaction hangs ("HMR transactions cannot be nested").
      server.closeAllConnections?.()
      server.close()
    } catch {}
  })
}

