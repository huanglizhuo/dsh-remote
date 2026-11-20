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


/** Pixel size of a PNG or JPEG on disk, for laying an image out before it loads. The path is whatever a reply's Markdown image names: a regular
 * file only (opening a FIFO would block the host) and, for a JPEG, only its first MiB (the size sits in the header). */
function imageSize(file) {
  try {
    if (!fs.statSync(file).isFile()) return null
    const fd = fs.openSync(file, 'r')
    try {
      const head = Buffer.alloc(32)
      fs.readSync(fd, head, 0, 32, 0)
      if (head.slice(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
        return { w: head.readUInt32BE(16), h: head.readUInt32BE(20) }
      }
      if (head[0] === 0xff && head[1] === 0xd8) {
        const whole = Buffer.alloc(1 << 20)
        const buf = whole.subarray(0, fs.readSync(fd, whole, 0, whole.length, 0))
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
    } finally { fs.closeSync(fd) }
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

// The fixed feedback taxonomy (command-feedback FEEDBACK_CATEGORIES; the ids are durable log vocabulary).
const FEEDBACK_CATEGORIES = ['task-result', 'instruction-following', 'product-interaction', 'service-stability', 'resource-cost', 'security-privacy-permission', 'other']

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

// ---- line diff -------------------------------------------------------------------
// Real hunks, the way the desktop DiffBlock derives them: a Myers edit script over the
// fragment's lines, cut into hunks with 3 lines of context. Bounded: past DIFF_MAX_EDITS
// edits (or DIFF_MAX_LINES lines) the middle reads as one replacement, as on the desktop.
const DIFF_CONTEXT = 3
const DIFF_MAX_EDITS = 256
const DIFF_MAX_LINES = 20000

/** Content lines of one side: empty text is no lines, one trailing newline is a terminator. */
const contentLines = (text) => {
  const s = String(text ?? '')
  return s === '' ? [] : (s.endsWith('\n') ? s.slice(0, -1) : s).split('\n')
}

/** Myers' O(ND) shortest edit script as [' ' | '-' | '+', line] pairs, or null when it needs more than `maxD` edits. */
const myers = (a, b, maxD) => {
  const n = a.length
  const m = b.length
  const max = Math.min(n + m, maxD)
  const off = max + 1
  const v = new Int32Array(2 * max + 3)
  const trace = []
  let found = -1
  for (let d = 0; d <= max && found < 0; d += 1) {
    trace.push(v.slice())
    for (let k = -d; k <= d; k += 2) {
      let x = k === -d || (k !== d && v[off + k - 1] < v[off + k + 1]) ? v[off + k + 1] : v[off + k - 1] + 1
      let y = x - k
      while (x < n && y < m && a[x] === b[y]) { x += 1; y += 1 }
      v[off + k] = x
      if (x >= n && y >= m) { found = d; break }
    }
  }
  if (found < 0) return null
  const out = []
  let x = n
  let y = m
  for (let d = found; d >= 0; d -= 1) {
    const vd = trace[d]
    const k = x - y
    const prevK = k === -d || (k !== d && vd[off + k - 1] < vd[off + k + 1]) ? k + 1 : k - 1
    const prevX = vd[off + prevK]
    const prevY = prevX - prevK
    while (x > prevX && y > prevY) { out.push([' ', a[x - 1]]); x -= 1; y -= 1 }
    if (d > 0) out.push(x === prevX ? ['+', b[prevY]] : ['-', a[prevX]])
    x = prevX
    y = prevY
  }
  return out.reverse()
}

/** Edit script of two line lists: the common head and tail are free, Myers (or one replacement) does the middle. */
const editScript = (a, b) => {
  let head = 0
  while (head < a.length && head < b.length && a[head] === b[head]) head += 1
  let tail = 0
  while (tail < a.length - head && tail < b.length - head && a[a.length - 1 - tail] === b[b.length - 1 - tail]) tail += 1
  const x = a.slice(head, a.length - tail)
  const y = b.slice(head, b.length - tail)
  const mid = (x.length > 0 && y.length > 0 && x.length + y.length <= DIFF_MAX_LINES ? myers(x, y, DIFF_MAX_EDITS) : null)
    ?? [...x.map((l) => ['-', l]), ...y.map((l) => ['+', l])]
  return [...a.slice(0, head).map((l) => [' ', l]), ...mid, ...a.slice(a.length - tail).map((l) => [' ', l])]
}

/**
 * Hunk rows [sign, text] for old -> new text, at most `cap` of them (`cut` says some were dropped);
 * each hunk opens with an ['@', '@@ -a,b +c,d @@'] header. added/removed always count the whole diff.
 */
const diffRows = (oldText, newText, cap) => {
  const ops = editScript(contentLines(oldText), contentLines(newText))
  let added = 0
  let removed = 0
  const spans = []
  ops.forEach(([sign], i) => {
    if (sign === ' ') return
    if (sign === '+') added += 1
    else removed += 1
    const from = Math.max(0, i - DIFF_CONTEXT)
    const to = Math.min(ops.length - 1, i + DIFF_CONTEXT)
    const last = spans[spans.length - 1]
    if (last && from <= last[1] + 1) last[1] = to
    else spans.push([from, to])
  })
  const rows = []
  let cut = false
  let pos = 0
  let a = 0 // old lines before ops[pos]
  let b = 0 // new lines before ops[pos]
  const skipTo = (to) => {
    for (; pos < to; pos += 1) {
      if (ops[pos][0] !== '+') a += 1
      if (ops[pos][0] !== '-') b += 1
    }
  }
  for (const [from, to] of spans) {
    skipTo(from)
    const body = ops.slice(from, to + 1)
    const ac = body.filter(([s]) => s !== '+').length
    const bc = body.filter(([s]) => s !== '-').length
    for (const row of [['@', `@@ -${ac === 0 ? a : a + 1},${ac} +${bc === 0 ? b : b + 1},${bc} @@`], ...body]) {
      if (rows.length >= cap) { cut = true; break }
      rows.push(row)
    }
    if (cut) break
    skipTo(to + 1)
  }
  return { rows, added, removed, cut }
}

/** Rows as the phone's {id, sign, text} lines, plus the truncation marker when rows were dropped. */
const diffWire = (rows, cut) => {
  const lines = rows.map(([sign, text], i) => ({ id: `d${i}`, sign, text }))
  if (cut) lines.push({ id: `d${lines.length}`, sign: '…', text: 'diff truncated' })
  return lines
}

/** Line diff of two texts: {lines, added, removed}; `lines` holds at most `cap` hunk rows (+ a marker). Exported for bridge/test/diff.test.mjs. */
export const diffText = (oldText, newText, cap = 60) => {
  const { rows, added, removed, cut } = diffRows(oldText, newText, cap)
  return { lines: diffWire(rows, cut), added, removed }
}
export const diffLines = (oldText, newText, cap = 60) => diffText(oldText, newText, cap).lines

/** Per-file cards for a result's meta.diffs (one entry per applied hunk, so a file's hunks fold into one card). */
const diffFiles = (diffs) => {
  const byPath = new Map()
  for (const d of Array.isArray(diffs) ? diffs : []) {
    const p = String(d?.path ?? '')
    if (!byPath.has(p)) byPath.set(p, [])
    byPath.get(p).push(d)
  }
  return [...byPath].slice(0, 8).map(([p, hunks], i) => {
    const rows = []
    let added = 0
    let removed = 0
    let cut = false
    for (const h of hunks) {
      const r = diffRows(h?.oldText, h?.newText, 120 - rows.length)
      rows.push(...r.rows)
      added += r.added
      removed += r.removed
      cut = cut || r.cut
    }
    return { id: `f${i}`, path: p, lines: diffWire(rows, cut), added, removed }
  })
}
// How many files a card hides, so the phone can say "还有 N 个文件".
const diffHidden = (diffs) => Math.max(0, new Set((Array.isArray(diffs) ? diffs : []).map((d) => String(d?.path ?? ''))).size - 8)
/** path -> {added, removed} summed over every hunk of meta.diffs. */
const diffStats = (diffs) => {
  const stats = new Map()
  for (const d of Array.isArray(diffs) ? diffs : []) {
    const p = String(d?.path ?? '')
    if (p === '') continue
    const { added, removed } = diffRows(d?.oldText, d?.newText, 0)
    const s = stats.get(p) ?? { added: 0, removed: 0 }
    s.added += added
    s.removed += removed
    stats.set(p, s)
  }
  return stats
}

// ---- small pure helpers ----------------------------------------------------------
// A tool card's full arguments / result ride this symbol: object spread keeps it, JSON.stringify
// never ships it, so rows stay clipped while GET /v1/sessions/:id/call can hand out the whole text.
const FULL = Symbol('full')
const FULL_CAP = 65536
// The turn a tool block belongs to, for the per-turn changes route (a symbol like FULL: spread keeps it, JSON never ships it).
const TURN = Symbol('turn')
// How much of a job's output the phone reads (its tail), and how long a file's changes page may grow.
const JOB_TAIL_BYTES = 40_000
const JOB_TAIL_CHARS = 24_000
const DIFF_PAGE_LINES = 1500
// What the system RUNS when it is told to open it (a script, an app, an installer): such a file is only ever revealed from the phone.
const RUNS_WHEN_OPENED = /\.(command|tool|app|pkg|dmg|scpt|workflow|action|terminal|sh|zsh|bash|csh|ksh|bat|cmd|exe|msi|jar)$/i

/** The text of a localized {en, zh?, …} map (or a plain string): Chinese first, then English, then any entry. */
const locText = (v) => {
  if (typeof v === 'string') return v
  if (v && typeof v === 'object') {
    for (const k of ['zh', 'zh-CN', 'zh-Hans', 'en']) if (typeof v[k] === 'string' && v[k] !== '') return v[k]
    for (const x of Object.values(v)) if (typeof x === 'string' && x !== '') return x
  }
  return ''
}

/** An approval's reason as one string: displayReason is {en, zh?, …}; prefer Chinese, then English, then the plain reason. */
const reasonText = (req) => {
  const t = locText(req?.displayReason)
  if (t !== '') return t
  return typeof req?.reason === 'string' && req.reason !== '' ? req.reason : null
}

// ---- questions: option marks, plan summaries, the desktop's own rules ------------------------
// The asker's convention for a recommended option is a suffix on its label; the answer keeps the
// whole label, only the display drops the suffix (QuestionComposer.parseRecommendedLabel).
const RECOMMENDED = /\s*(?:\((?:recommended|推荐)\)|（(?:recommended|推荐)）)\s*$/i
const optionText = (label) => (RECOMMENDED.test(label) ? { text: label.replace(RECOMMENDED, ''), recommended: true } : { text: label, recommended: false })

/** One Markdown line as plain text (marks dropped, like extractMarkdownPlainText). */
const mdPlain = (s) => String(s ?? '')
  .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
  .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
  .replace(/(\*\*|__|~~)(.+?)\1/g, '$2')
  .replace(/(^|[^\w*])[*_]([^*_\n]+)[*_]/g, '$1$2')
  .replace(/`([^`]*)`/g, '$1')
  .replace(/^\s{0,3}(?:#{1,6}\s+|>\s?|[-*+]\s+|\d+[.)]\s+)/, '')
  .replace(/\s+/g, ' ')
  .trim()

/** A plan's card text: the first visible line and the first paragraph after it (plan-review's title / description). */
const planSummary = (md) => {
  const lines = String(md ?? '').replace(/\r\n?/g, '\n').split('\n')
  let title = ''
  let description = ''
  let fence = false
  let run = []
  for (const raw of lines) {
    if (/^\s*(```|~~~)/.test(raw)) { fence = !fence; continue }
    if (fence) continue
    const line = raw.trim()
    if (line === '') {
      if (run.length > 0 && description === '') description = run.join(' ')
      run = []
      continue
    }
    if (title === '') {
      title = mdPlain(line)
      // A first line that is plain prose opens the first paragraph too (a heading does not).
      if (!/^(#{1,6}\s|>|[-*+]\s|\d+[.)]\s|\|)/.test(line)) run = [title]
      continue
    }
    // Headings, quotes, lists, tables and rules are not the first paragraph.
    if (/^(#{1,6}\s|>|[-*+]\s|\d+[.)]\s|\||([-*_])\s*\2\s*\2)/.test(line)) { run = []; continue }
    if (description === '') run.push(mdPlain(line))
  }
  if (description === '' && run.length > 0) description = run.join(' ')
  return { title: title.slice(0, 200), description: description === title ? '' : description.slice(0, 600) }
}

/** planReviewOf (ui-user-questions contract): one question, the plan as its detail, the named approve option, at most one other. */
const planReviewOf = (questions) => {
  if (!Array.isArray(questions) || questions.length !== 1) return null
  const q = questions[0]
  if (q?.intent?.kind !== 'plan-review' || typeof q.detail !== 'string' || q.multiSelect === true) return null
  const options = q.options ?? []
  if (options.length > 2) return null
  const approve = options.find((o) => o.label === q.intent.approve)
  if (!approve) return null
  return { id: q.id, question: q.question, plan: q.detail, approve, decline: options.find((o) => o.label !== q.intent.approve) ?? null }
}

/** A rejection the host's user-questions service restores into its own UserQuestionError (name + code are all it reads). */
const questionError = (code) => Object.assign(new Error({
  ASK_CANCELLED: 'the user cancelled ask_user_question',
  ASK_ABORTED: 'ask_user_question was aborted before the user answered',
  ASK_TIMED_OUT: 'ask_user_question timed out before the user answered',
}[code] ?? code), { name: 'UserQuestionError', code })

const clipStr = (v, n) => (typeof v === 'string' ? v.slice(0, n) : '')
/** A {en, zh?, …} map made safe to keep (bounded keys and sizes), or undefined. */
const cleanLoc = (v) => {
  if (typeof v === 'string') return v === '' ? undefined : { en: clipStr(v, 4000) }
  if (!v || typeof v !== 'object' || Array.isArray(v)) return undefined
  const out = {}
  for (const [k, x] of Object.entries(v).slice(0, 12)) if (typeof x === 'string' && x !== '') out[clipStr(k, 20)] = clipStr(x, 4000)
  return Object.keys(out).length > 0 ? out : undefined
}
/** One asked question as the bridge keeps it, bounded: whatever the desktop mirrored or the host handed us. */
const cleanQuestion = (q, i) => {
  const intent = q?.intent
  const kept = intent?.kind === 'plan-review' || intent?.kind === 'approval'
    ? {
      kind: intent.kind,
      approve: clipStr(intent.approve, 500),
      ...(intent.kind === 'approval' ? { reject: clipStr(intent.reject, 500) } : {}),
      ...(intent.kind === 'approval' && typeof intent.always === 'string' && intent.always !== '' ? { always: clipStr(intent.always, 500) } : {}),
      ...(intent.kind === 'approval' && typeof intent.subject?.name === 'string' ? { subject: { name: clipStr(intent.subject.name, 200) } } : {}),
      ...(intent.kind === 'approval' && intent.display && typeof intent.display === 'object' ? { display: { question: cleanLoc(intent.display.question), detail: cleanLoc(intent.display.detail), approve: cleanLoc(intent.display.approve) } } : {}),
    }
    : undefined
  return {
    id: clipStr(q?.id, 200) || `q${i}`,
    question: clipStr(q?.question, 4000),
    header: clipStr(q?.header, 400),
    ...(typeof q?.detail === 'string' ? { detail: q.detail.slice(0, 60000) } : {}),
    multiSelect: q?.multiSelect === true,
    options: (Array.isArray(q?.options) ? q.options : []).slice(0, 40).map((o) => ({ label: clipStr(typeof o === 'string' ? o : o?.label, 500), description: clipStr(typeof o === 'string' ? '' : o?.description, 2000) })),
    ...(kept ? { intent: kept } : {}),
  }
}

/** The host parses a mention as dsh-session:<base64url(JSON id)> and fails the turn on anything else; a bare id (what the phone has) is encoded here. */
const sessionUri = (id) => `dsh-session:${Buffer.from(JSON.stringify(id), 'utf8').toString('base64url')}`
const canonSessionMentions = (text) => String(text).replace(/(@\[(?:\\.|[^\\\]])*\]\()dsh-session:([^\s)]*)\)/gu, (whole, head, payload) => {
  if (payload === '') return whole
  try {
    const id = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'))
    if (/^[A-Za-z0-9_-]+$/.test(payload) && typeof id === 'string' && sessionUri(id) === `dsh-session:${payload}`) return whole
  } catch {}
  return `${head}${sessionUri(payload)})`
})
/** Official escapeLabel (context/session-reference uri.ts): `\` and `]` are escaped inside the label of `@[label](uri)`. */
const escapeLabel = (label) => String(label).replace(/[\\\]]/gu, (m) => `\\${m}`)
/** A mention label as typed on the phone: one line (the host's label scan cannot cross a newline), at most 200 characters, never empty. */
const mentionLabel = (label, fallback) => {
  const t = String(label ?? '').replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]+/gu, ' ').trim()
  return (t === '' ? String(fallback) : t).slice(0, 200)
}
/** formatSessionReferenceMention: the canonical wire mention the host resolves into cross-session recall. */
const sessionMention = (id, label) => `@[${escapeLabel(mentionLabel(label, id))}](${sessionUri(id)})`

/** Files the phone may read: the session's workspace and the system temp dir (charts and scratch
 * images live there), judged on the real path so `..` and symlinks cannot walk out of it. */
const inScope = (base, target) => {
  const tmp = os.tmpdir()
  const roots = [path.resolve(base), tmp, path.join('/private', tmp)]
  const under = (root, p) => p === root || p.startsWith(root + path.sep)
  if (!roots.some((r) => under(r, target))) return false
  const real = (p) => { try { return fs.realpathSync(p) } catch { return null } }
  const there = real(target)
  return there === null || roots.some((r) => { const rr = real(r); return rr !== null && under(rr, there) })
}

// ---- copy the bridge words itself ------------------------------------------------------------------
// The phone sends `lang` ('zh-Hans' or 'en': its effective locale) on /v1/live and /v1/transcript. Every row
// the bridge titles or summarizes for this wave (steering, triggers, context, compaction, commands, retries,
// failures) is worded here from the official ui-chat dictionaries (packages/client/ui-chat/src/client/locale.ts,
// rc.3), zh and en alike. An absent or unknown `lang` reads as zh-Hans, the bridge's older behaviour.
const COPY = {
  zh: {
    steer: '插话',
    'trigger.request': '收到执行请求',
    'trigger.goal': '继续执行目标',
    'trigger.agent': '收到任务消息',
    'trigger.team': '收到团队消息',
    'trigger.subagent': '子任务状态更新',
    'trigger.subagent.completed': '子智能体已完成任务',
    'trigger.subagent.aborted': '子智能体任务已停止',
    'trigger.subagent.error': '子智能体执行失败',
    'trigger.subagent.maxTokens': '子智能体已达 token 上限',
    'trigger.subagent.refusal': '子智能体拒绝执行',
    'trigger.subagent.unknown': '子智能体异常结束',
    'trigger.github': '收到 GitHub 事件',
    'trigger.webhook': '收到外部事件',
    'trigger.schedule': '自动化任务',
    'trigger.job': '后台任务状态更新',
    'trigger.plugin': '插件状态更新',
    'trigger.explanation': '这条通知触发了本轮回复。',
    'trigger.continuation': '已请求继续生成',
    'tool.added': '已添加工具：{name}',
    'tool.removed': '已移除工具：{name}',
    'tool.addedNames': '新增：{names}',
    'tool.addedCount': '新增 {count} 个',
    'tool.changed': '新增 {added} 个，移除 {removed} 个',
    'tool.removedNames': '移除：{names}',
    'tool.removedCount': '移除 {count} 个',
    'tool.updated': '工具已更新',
    'context.injection': '上下文注入',
    'context.recall': '跨会话召回',
    'context.instructions.loaded': '已载入',
    'context.instructions.added': '已新增',
    'context.instructions.updated': '已更新',
    'context.instructions.removed': '已移除',
    'context.catalog.replaced': '替换目录',
    'context.catalog.more': '…还有 {count} 条',
    'context.snapshot.supersedes': '取代先前的快照',
    'context.relay.from': '来自会话 {session}',
    'context.recall.counts': '保留 {retained} 条 · 省略 {omitted} 条',
    'context.recall.truncated': '已截断',
    'json.truncated': '… 已截断，共 {total} 字符',
    'compaction.title': '上下文已压缩',
    'compaction.running': '正在压缩…',
    'compaction.completed': '已压缩 {items} 条历史记录（约 {tokens} tokens）',
    'compaction.expand': '点击查看压缩摘要',
    'compaction.unavailable': '压缩摘要不可用',
    'compaction.commandTitle': 'compact',
    'command.running': '执行中…',
    'command.failed': '指令失败',
    'command.done': '已完成',
    'command.title': '指令',
    'retry.active': '正在重试模型请求',
    'retry.cancelled': '模型请求重试已取消',
    'retry.started': '已重试模型请求',
    'retry.scheduled': '等待重试模型请求',
    'retry.status': '{label}（{retry}/{maximum}） · {seconds}s',
    'retry.delay': '重试延迟：',
    'retry.failure': '失败原因：',
    'duration.milliseconds': '{milliseconds}毫秒',
    'failure.auth': 'API 密钥无效',
    'failure.taskStopped': '任务已停止',
    'failure.accountSignedOut': '任务已因退出 DeepSeek 登录而停止。',
    'failure.interrupted': 'DSH 进程在本轮完成前退出（例如被强制结束、崩溃或关闭超时），重新启动后本轮已中止。未完成的工具调用结果未知。',
    'failure.accountSignInRequired': '请先登录 DeepSeek，并确认请求地址支持账号认证。',
    'failure.quota': '当前请求的额度已用尽',
    'failure.turnError': '本轮运行失败',
    'failure.maxTokens': '已达到输出 token 上限',
    'failure.maxTokens.hint': '回答被截断，已有输出保留在对话中。发送“继续”可让模型接着输出。',
    // Process groups (chat/step-process.ts, locale.ts message.stepProcess.*): the live title, the 准备 title, the closed title.
    'step.thinking': '正在分析请求',
    'step.read': '正在读取文件', 'step.readImage': '正在读取图片', 'step.write': '正在写入文件', 'step.search': '正在搜索代码', 'step.edit': '正在编辑文件',
    'step.commands': '正在运行命令', 'step.code': '正在运行代码', 'step.webSearch': '正在搜索网页', 'step.webFetch': '正在访问网页',
    'step.subagents': '正在协调子智能体', 'step.plan': '正在更新计划', 'step.questions': '等待你的操作', 'step.tools': '正在调用工具',
    'step.prepare.read': '准备读取文件', 'step.prepare.readImage': '准备读取图片', 'step.prepare.write': '准备写入文件', 'step.prepare.search': '准备搜索代码',
    'step.prepare.edit': '准备编辑文件', 'step.prepare.commands': '准备运行命令', 'step.prepare.code': '准备运行代码', 'step.prepare.webSearch': '准备搜索网页',
    'step.prepare.webFetch': '准备访问网页', 'step.prepare.subagents': '准备协调子智能体', 'step.prepare.plan': '准备更新计划',
    'step.prepare.questions': '准备提问', 'step.prepare.tools': '准备调用工具',
    'step.done.thinking': '已完成分析', 'step.done.read': '已读取文件', 'step.done.readImage': '已读取图片', 'step.done.write': '已写入文件',
    'step.done.search': '已搜索代码', 'step.done.edit': '修改了文件', 'step.done.commands': '执行了命令', 'step.done.code': '运行了代码',
    'step.done.webSearch': '已搜索网页', 'step.done.webFetch': '已访问网页', 'step.done.subagents': '已协调子智能体', 'step.done.plan': '更新了计划',
    'step.done.questions': '向用户提出了问题', 'step.done.tools': '已调用工具', 'step.done.context': '已注入上下文',
    'step.joinTwo': '{first}并{second}', 'step.comma': '，', 'step.sharedPrefix': '已', 'step.more': '{title}等',
    // The turn control (TurnProcessNodeView) and its counts.
    'turn.worked': '已完成', 'turn.took': '已完成，用时 ', 'turn.failed': '处理失败', 'turn.stopped': '已停止',
    'turn.toolCalls': '{count} 次工具调用', 'turn.messages': '{count} 条消息', 'turn.subagents': '{count} 个 subagent', 'turn.thought': '已思考', 'turn.separator': ' · ',
    'duration.secondUnit': '秒', 'duration.minuteUnit': '分', 'duration.hourUnit': '小时',
    'chat.deepDiving': '深度求索中', 'chat.deepDivingFor': '深度求索中，用时 {duration} ···',
    // Turn usage (TurnUsagePanel) and the number formats it uses.
    'usage.consumed': '用量 {total}', 'usage.model': '提供方 / 模型', 'usage.cacheHit': '缓存命中', 'usage.input': '未缓存输入', 'usage.cacheRead': '缓存读取',
    'usage.cacheWrite': '缓存写入', 'usage.output': '输出', 'usage.reasoning': '（其中推理 {tokens}）', 'usage.count': '{count} tok', 'usage.speed': '输出速度', 'usage.tps': '{tps} tok/s',
    'number.thousand': '{value}K', 'number.million': '{value}M',
    'day.today': '今天', 'day.yesterday': '昨天', 'day.before': '前天', 'clock.md': '{m}月{d}日', 'clock.ymd': '{y}年{m}月{d}日',
    // Tool cards (ui-conversation locales: tool.title.*, terminal.*, read.*, search.*, web.*, row.*, todo.diff.*, detail.*).
    'todo.rowTitle': '更新任务清单', 'tool.title.createGoal': '创建目标', 'tool.title.getGoal': '查看目标', 'tool.title.updateGoal': '更新目标', 'tool.preparing.content': '{kilobytes}KB', 'tool.title.createSchedule': '创建自动化任务',
    'tool.title.listSchedules': '查看自动化任务', 'tool.title.viewSchedule': '查看自动化任务详情', 'tool.title.editSchedule': '编辑自动化任务', 'tool.title.deleteSchedule': '删除自动化任务', 'tool.title.updateSchedule': '修改自动化任务', 'detail.state': '状态',
    'detail.todo.completed': '已完成', 'detail.todo.in_progress': '进行中', 'detail.todo.pending': '待处理', 'detail.todo.empty': '任务清单为空', 'todo.diff.initial': '首次记录', 'todo.diff.compare': '与上次清单相比', 'todo.diff.unavailable': '旧清单不可用',
    'todo.diff.noChanges': '清单没有变化', 'todo.diff.added': '新增 {count}', 'todo.diff.updated': '更新 {count}', 'todo.diff.removed': '移除 {count}', 'todo.diff.unchanged': '{count} 项未变化', 'todo.diff.addedItem': '新增',
    'todo.diff.updatedItem': '状态变化', 'todo.diff.movedItem': '顺序调整', 'todo.diff.removedItem': '移除', 'detail.goal.empty': '没有目标', 'detail.goal.active': '进行中', 'detail.goal.disarmed': '等待继续', 'detail.goal.paused': '已暂停',
    'detail.goal.blocked': '受阻', 'detail.goal.complete': '已完成', 'detail.goal.rounds': '执行轮次', 'detail.goal.reason': '受阻原因', 'detail.days': '{count} 天', 'detail.hours': '{count} 小时', 'detail.minutes': '{count} 分钟',
    'detail.seconds': '{count} 秒', 'detail.schedule.once': '单次', 'detail.schedule.every': '每 {interval}', 'detail.schedule.when': '计划时间', 'detail.schedule.frequency': '重复', 'detail.schedule.scheduled': '等待触发',
    'detail.schedule.overdue': '已到期，等待会话恢复', 'detail.schedule.active': '已开启', 'detail.schedule.paused': '已暂停', 'detail.schedule.ended': '已结束', 'detail.schedule.empty': '没有自动化任务', 'detail.schedule.deleted': '已删除',
    'detail.schedule.count': '{count} 个自动化任务', 'detail.schedule.daily': '每天 {time}（{zone}）', 'detail.schedule.weekly': '每周 {days} {time}（{zone}）', 'detail.schedule.cron': 'Cron {expression}（{zone}）',
    'detail.schedule.custom': '自定义', 'detail.schedule.monthly': '每月', 'detail.weekday.1': '周一', 'detail.weekday.2': '周二', 'detail.weekday.3': '周三', 'detail.weekday.4': '周四', 'detail.weekday.5': '周五', 'detail.weekday.6': '周六', 'detail.weekday.7': '周日',
    'detail.weekday.join': '、', 'tool.title.inspectProviders': '检查提供方', 'tool.title.queryRuntime': '查询运行时', 'tool.title.inspectPlugins': '检查动态插件', 'tool.title.workflow': '运行工作流', 'tool.title.ralph': '运行循环工作流',
    'tool.title.readEvent': '读取事件', 'tool.title.searchEvents': '搜索事件', 'tool.title.traceEvent': '追踪事件', 'tool.title.searchSessions': '搜索会话', 'tool.title.traceSession': '追踪会话', 'tool.title.listModels': '查看可用模型',
    'tool.title.subagent': '创建子智能体', 'tool.title.subagentFork': '派生子智能体', 'tool.title.listAgents': '查看子智能体', 'tool.title.sendMessage': '发送消息', 'tool.title.interruptAgent': '中断智能体', 'tool.title.listJobs': '查看后台任务',
    'tool.title.readJob': '读取任务输出', 'tool.title.killJob': '取消后台任务', 'tool.title.openTerminal': '创建终端', 'tool.title.readTerminal': '读取终端', 'tool.title.listTerminals': '查看终端', 'tool.title.signalTerminal': '发送终端信号',
    'tool.title.closeTerminal': '关闭终端', 'tool.title.lsp': '查询代码符号', 'tool.title.findDefinition': '查找定义', 'tool.title.findReferences': '查找引用', 'tool.title.findImplementation': '查找实现', 'tool.title.hoverSymbol': '查看符号信息',
    'tool.title.spawnTeammate': '创建队友', 'tool.title.createTeamTask': '创建团队任务', 'tool.title.getTeamTask': '读取团队任务', 'tool.title.updateTeamTask': '更新团队任务', 'tool.title.listTeamTasks': '查看团队任务', 'tool.title.waitAgent': '等待消息…',
    'detail.recordedResult': '调用结果', 'detail.empty': '暂无结果', 'detail.none': '无', 'detail.yes': '是', 'detail.no': '否', 'detail.moreInInspect': '另有 {count} 项，可在「查看」中读取', 'detail.status.running': '运行中', 'detail.status.idle': '空闲',
    'detail.status.ready': '就绪', 'detail.status.inactive': '未运行', 'detail.status.provisioning': '准备中', 'detail.status.failed': '失败', 'detail.status.corrupt': '已损坏', 'detail.status.unsupported': '不支持',
    'detail.status.unavailable': '不可用', 'detail.status.completed': '已完成', 'detail.status.deleted': '已删除', 'detail.status.killed': '已取消', 'detail.status.accepted': '已接收', 'detail.status.queued': '已入队',
    'detail.status.exited': '已退出', 'detail.field.id': 'ID', 'detail.field.revision': '版本', 'detail.field.platform': '平台', 'detail.field.provider': '提供方', 'detail.field.model': '模型', 'detail.field.role': '角色',
    'detail.field.context': '上下文', 'detail.field.owner': '负责人', 'detail.field.ready': '可开始', 'detail.field.dependencies': '前置任务', 'detail.field.writeScopes': '文件范围', 'detail.field.warnings': '提示',
    'detail.field.diagnostics': '诊断', 'detail.field.methods': '方法', 'detail.field.inputSchema': '输入 Schema', 'detail.field.outputSchema': '输出 Schema', 'detail.field.currentPackage': '当前包', 'detail.field.nextPackage': '待运行的包',
    'detail.field.latestRun': '最近运行', 'detail.field.packages': '版本包', 'detail.field.registrations': '注册项', 'detail.field.props': '属性', 'detail.field.data': '数据', 'detail.field.source': '来源', 'detail.field.content': '内容',
    'detail.field.message': '消息', 'detail.field.messageId': '消息 ID', 'detail.field.root': '根节点', 'detail.field.pid': '进程 ID', 'detail.field.type': '类型', 'detail.field.time': '时间', 'detail.field.seq': '事件序号',
    'detail.field.turn': '轮次', 'detail.field.step': '步骤', 'detail.field.callId': '调用 ID', 'detail.field.agents': '启动智能体数', 'detail.field.result': '结果', 'detail.field.parent': '父级', 'detail.field.exitCode': '退出码',
    'detail.field.signal': '信号', 'detail.field.previousStatus': '中断前状态', 'detail.field.agent': '智能体 ID', 'detail.field.agentName': '智能体名称', 'detail.field.agentDescription': '智能体任务描述', 'detail.field.job': '任务 ID',
    'detail.field.task': '任务内容', 'detail.field.processGroup': '进程组', 'detail.field.availability': '可用状态', 'detail.agents.count': '{count} 个智能体', 'detail.jobs.count': '{count} 个后台任务', 'detail.terminals.count': '{count} 个终端',
    'detail.tasks.count': '{count} 个团队任务', 'detail.tasks.nextPage': '后面还有任务；下一页位置为 {cursor}', 'detail.locations.count': '{count} 个位置', 'detail.location': '第 {line} 行，第 {column} 列', 'detail.receipt.delivered': '消息已送达',
    'detail.receipt.interrupt': '已请求中断', 'detail.receipt.started': '已启动', 'detail.receipt.cancel': '已请求取消', 'detail.receipt.alreadyFinished': '任务已结束', 'detail.receipt.signal': '信号已发送', 'detail.receipt.closed': '已关闭',
    'detail.receipt.closing': '关闭中', 'detail.wait.noProgress': '没有正在运行的子智能体', 'detail.wait.title': '等待结果', 'detail.wait.timeout': '等待已超时', 'detail.wait.ended': '等待已结束', 'detail.agent.reply': '智能体回复',
    'detail.models.title': '可用模型', 'detail.output.lines': '第 {begin}–{end} 行，共 {total} 行', 'detail.output.truncated': '输出已截断', 'todo.completed': '{done}/{total} 已完成', 'ask.rowTitle': '提问', 'row.running': '运行中',
    'row.preparing': '正在准备调用', 'row.failed': '失败', 'row.stopped': '已停止', 'row.input': '输入', 'row.output': '输出', 'row.imageSize': '{width}x{height}px，{bytes} 字节',
    'row.imageSizeDownscaled': '{width}x{height}px（由 {originalWidth}x{originalHeight}px 缩小），{bytes} 字节', 'tool.title.search': '搜索', 'tool.title.read': '读取', 'tool.title.bash': '运行命令', 'tool.title.write': '写入',
    'tool.title.edit': '编辑', 'tool.title.applyPatch': '编辑', 'tool.title.code': '代码', 'tool.title.generic': '工具调用', 'tool.title.inspect': '查询 Cordis 环境', 'tool.title.runCordis': '运行 Cordis 插件',
    'tool.title.stopCordis': '停止 Cordis 插件', 'tool.title.removeCordis': '移除 Cordis 插件', 'tool.title.pwsh': '运行命令', 'tool.title.readImage': '读取图片', 'tool.title.officeRender': '渲染文档', 'tool.title.officeConvert': '转换文档',
    'tool.title.officeRecalculate': '重算工作簿', 'tool.title.grep': '搜索文件内容', 'tool.title.glob': '查找文件', 'tool.title.webSearch': '网页搜索', 'tool.title.webFetch': '网页获取', 'tool.webFetch.failure.dns': '无法解析域名，请检查网络、代理或 DNS 设置',
    'tool.webFetch.failure.refused': '连接被拒绝，请检查地址、端口或代理', 'tool.webFetch.failure.connectionTimeout': '连接超时，请检查网络或代理后重试', 'tool.webFetch.failure.certificate': '安全证书校验失败，请检查系统时间、代理或证书配置',
    'tool.webFetch.failure.interrupted': '连接中断，请稍后重试', 'tool.webFetch.failure.unreachable': '网络或主机不可达，请检查网络连接或代理', 'tool.webFetch.failure.network': '网络请求失败，详情见输出', 'tool.autoReviewRejected': 'Auto review 已拒绝',
    'tool.autoReviewNotExecuted': '工具未执行。原因：{reason}', 'tool.autoReviewReasonFallback': 'Auto review 未授权此次操作', 'diff.expandRest': '… 其余 {count} 行', 'read.window': '显示 {shown} / {total} 行', 'read.expandRest': '… 其余 {count} 行',
    'search.paths': '{shown} 个路径', 'search.paths.truncated': '显示 {shown} / 共 {total} 个路径', 'search.matches': '{shown} 处匹配 · {files} 个文件', 'search.matches.truncated': '显示 {shown} / 共 {total} 处匹配 · {files} 个文件',
    'search.noResults': '无结果', 'search.collapseAria': '收起结果', 'search.expandAria': '展开其余 {count} 行结果', 'search.expandRest': '… 其余 {count} 行', 'web.noResults': '未找到结果', 'web.sourcesTruncated': '来源列表已截断', 'web.http': 'HTTP',
    'web.contentTruncated': '内容已截断', 'terminal.signal': '信号 {signal}', 'terminal.exitCode': '退出码 {code}', 'terminal.noExitCode': '未正常退出', 'terminal.commandLine': '命令第 {n} 行', 'terminal.running': '运行中', 'terminal.failed': '失败',
    'terminal.done': '已完成', 'terminal.noOutput': '无输出', 'terminal.collapseAria': '收起输出', 'terminal.expandAria': '展开其余 {n} 行输出', 'terminal.expandRest': '… 其余 {n} 行', 'terminal.sendInput': '（发送输入）',
    'terminal.session': '终端 {sessionId}',
    // The composer: the @ menu's sections and the attachment / continuation refusals (official ui-reference + ui-conversation copy, rc.3).
    'ref.section.files': '文件与文件夹', 'ref.section.subagents': '子智能体', 'ref.section.sessions': '对话', 'ref.noCwd': '（无工作目录）',
    'image.unsupportedType': '仅支持 PNG、JPG、WebP、GIF 格式的图片', 'image.tooMany': '一条消息最多添加 {count} 张图片', 'image.fileTooLarge': '单张图片不能超过 {size}', 'image.totalTooLarge': '图片总大小超过 {size}，请移除部分图片',
    'image.tooManyPixels': '图片分辨率过大，请压缩后重试', 'image.dimensionTooLarge': '图片宽高不能超过 {size}px，请缩小后重试', 'image.modelUnsupported': '当前模型不支持图片，请切换支持图片的模型', 'image.sendFailed': '图片发送失败（{reason}），请重新添加图片后再试',
    'file.notStaged': '文件尚未上传成功，请重新添加后再试', 'file.sessionUnavailable': '会话不可用，无法上传文件', 'file.tooLarge': '文件不能超过 {size}', 'file.noService': 'Mac 上的文件上传服务不可用', 'file.subagent': '子智能体会话不接受文件上传',
    'prompt.noContinuation': '现在没有可以继续生成的内容。', 'prompt.attachmentExpired': '附件已过期，请重新添加。',
    // Round 9, wave 6: relative ages (ui-workspace time.*), the workflow card, the Mac's pairing page, subagent messaging and open-on-Mac refusals.
    'time.now': '刚刚', 'time.minutes': '{n}分钟', 'time.hours': '{n}小时', 'time.days': '{n}天', 'time.months': '{n}个月', 'time.years': '{n}年',
    'workflow.label': '编排 {name}',
    'page.title': '远程配对 · dsh-remote', 'page.sub': '用 dsh-remote App 扫码连接这台 Mac', 'page.expires': '配对码 {mins} 分钟内有效 · {id}',
    'page.paired': '这台 Mac 已有配对的设备。', 'page.unpaired': '还没有配对。',
    'subagent.notResumable': '这个子智能体无法继续对话。', 'subagent.unavailable': '子智能体暂时无法接收消息，请稍后再试。',
    // The subagent tree (ui-subagent progress.* / mode.* / activity.*) and the job list's states (ui-jobs status.*).
    'subagent.progress.completed': '{count} 已完成', 'subagent.progress.active': '{count} 进行中', 'subagent.progress.inactive': '{count} 未运行', 'subagent.progress.external': '{count} 外部任务',
    'subagent.mode.oneShot': '一次性', 'subagent.mode.continuable': '可继续', 'subagent.mode.external': '外部任务', 'subagent.mode.unknown': '模式未知',
    'subagent.activity.running': '正在运行', 'subagent.activity.completed': '已完成', 'subagent.activity.inactive': '当前未运行',
    'job.status.running': '运行中', 'job.status.stopping': '正在停止', 'job.status.completed': '已完成', 'job.status.killed': '已取消', 'job.status.failed': '已失败',
    'open.unavailable': '这台 Mac 没有可用的桌面，无法用外部程序打开。', 'open.notAllowed': '出于安全，不能在 Mac 上直接打开这类文件，可以在访达中显示。', 'open.failed': '无法在 Mac 上打开，请重试。',
  },
  en: {
    steer: 'Steer',
    'trigger.request': 'Execution requested',
    'trigger.goal': 'Continuing goal',
    'trigger.agent': 'Task message received',
    'trigger.team': 'Team message received',
    'trigger.subagent': 'Subtask status updated',
    'trigger.subagent.completed': 'Subagent run completed',
    'trigger.subagent.aborted': 'Subagent run stopped',
    'trigger.subagent.error': 'Subagent run failed',
    'trigger.subagent.maxTokens': 'Subagent reached the token limit',
    'trigger.subagent.refusal': 'Subagent declined the task',
    'trigger.subagent.unknown': 'Subagent run ended unexpectedly',
    'trigger.github': 'GitHub event received',
    'trigger.webhook': 'External event received',
    'trigger.schedule': 'Automation task',
    'trigger.job': 'Background task updated',
    'trigger.plugin': 'Plugin status updated',
    'trigger.explanation': 'This notification triggered this response.',
    'trigger.continuation': 'Requested to continue generation',
    'tool.added': 'Tool added: {name}',
    'tool.removed': 'Tool removed: {name}',
    'tool.addedNames': 'Added: {names}',
    'tool.addedCount': '{count} added',
    'tool.changed': '{added} added, {removed} removed',
    'tool.removedNames': 'Removed: {names}',
    'tool.removedCount': '{count} removed',
    'tool.updated': 'Tools updated',
    'context.injection': 'Context injection',
    'context.recall': 'Session recall',
    'context.instructions.loaded': 'loaded',
    'context.instructions.added': 'added',
    'context.instructions.updated': 'updated',
    'context.instructions.removed': 'removed',
    'context.catalog.replaced': 'Replacement catalog',
    'context.catalog.more': '… {count} more',
    'context.snapshot.supersedes': 'Supersedes earlier snapshots',
    'context.relay.from': 'From session {session}',
    'context.recall.counts': '{retained} kept · {omitted} omitted',
    'context.recall.truncated': 'truncated',
    'json.truncated': '… truncated, {total} characters total',
    'compaction.title': 'Context compacted',
    'compaction.running': 'Compacting context…',
    'compaction.completed': 'Compacted {items} history items (~{tokens} tokens)',
    'compaction.expand': 'View compaction summary',
    'compaction.unavailable': 'Compaction summary unavailable',
    'compaction.commandTitle': 'compact',
    'command.running': 'Running…',
    'command.failed': 'Command failed',
    'command.done': 'Completed',
    'command.title': 'Command',
    'retry.active': 'Retrying model request',
    'retry.cancelled': 'Model request retry cancelled',
    'retry.started': 'Retried model request',
    'retry.scheduled': 'Waiting to retry model request',
    'retry.status': '{label} ({retry}/{maximum}) · {seconds}s',
    'retry.delay': 'Retry delay: ',
    'retry.failure': 'Failure reason: ',
    'duration.milliseconds': '{milliseconds}ms',
    'failure.auth': 'API key is invalid',
    'failure.taskStopped': 'Task stopped',
    'failure.accountSignedOut': 'Stopped because you signed out of DeepSeek.',
    'failure.interrupted': 'The DSH process exited before this turn finished (for example, it was killed, crashed, or timed out while shutting down), so the turn was closed when DSH restarted. Unfinished tool calls have unknown outcomes.',
    'failure.accountSignInRequired': 'Sign in to DeepSeek and ensure the request destination supports account authentication.',
    'failure.quota': 'Request quota exhausted.',
    'failure.turnError': 'This turn failed',
    'failure.maxTokens': 'Output token limit reached',
    'failure.maxTokens.hint': 'The reply was cut off; earlier output is preserved in the conversation. Send "continue" to let the model resume.',
    'step.thinking': 'Analyzing the request',
    'step.read': 'Reading files', 'step.readImage': 'Reading images', 'step.write': 'Writing files', 'step.search': 'Searching code', 'step.edit': 'Editing files',
    'step.commands': 'Running commands', 'step.code': 'Running code', 'step.webSearch': 'Searching the web', 'step.webFetch': 'Visiting web pages',
    'step.subagents': 'Coordinating subagents', 'step.plan': 'Updating the plan', 'step.questions': 'Waiting for your action', 'step.tools': 'Calling tools',
    'step.prepare.read': 'Preparing to read files', 'step.prepare.readImage': 'Preparing to read images', 'step.prepare.write': 'Preparing to write files',
    'step.prepare.search': 'Preparing to search code', 'step.prepare.edit': 'Preparing to edit files', 'step.prepare.commands': 'Preparing to run commands',
    'step.prepare.code': 'Preparing to run code', 'step.prepare.webSearch': 'Preparing to search the web', 'step.prepare.webFetch': 'Preparing to visit web pages',
    'step.prepare.subagents': 'Preparing to coordinate subagents', 'step.prepare.plan': 'Preparing to update the plan',
    'step.prepare.questions': 'Preparing questions', 'step.prepare.tools': 'Preparing tool calls',
    'step.done.thinking': 'Analysis completed', 'step.done.read': 'Read files', 'step.done.readImage': 'Read images', 'step.done.write': 'Wrote files',
    'step.done.search': 'Searched code', 'step.done.edit': 'Edited files', 'step.done.commands': 'Ran commands', 'step.done.code': 'Ran code',
    'step.done.webSearch': 'Searched the web', 'step.done.webFetch': 'Visited web pages', 'step.done.subagents': 'Coordinated subagents', 'step.done.plan': 'Updated the plan',
    'step.done.questions': 'Asked questions', 'step.done.tools': 'Called tools', 'step.done.context': 'Injected context',
    'step.joinTwo': '{first} and {second}', 'step.comma': ', ', 'step.sharedPrefix': '', 'step.more': '{title}, etc.',
    'turn.worked': 'Completed', 'turn.took': 'Completed in ', 'turn.failed': 'Failed', 'turn.stopped': 'Stopped',
    'turn.toolCalls': '{count} tool calls', 'turn.toolCalls.one': '{count} tool call', 'turn.messages': '{count} messages', 'turn.messages.one': '{count} message',
    'turn.subagents': '{count} subagents', 'turn.subagents.one': '{count} subagent', 'turn.thought': 'Thought for a while', 'turn.separator': ' · ',
    'duration.secondUnit': 's', 'duration.minuteUnit': 'm ', 'duration.hourUnit': 'h ',
    'chat.deepDiving': 'Deep diving', 'chat.deepDivingFor': 'Deep diving for {duration} ···',
    'usage.consumed': 'Usage {total}', 'usage.model': 'Provider / model', 'usage.cacheHit': 'Cache hit', 'usage.input': 'Uncached input', 'usage.cacheRead': 'Cached input',
    'usage.cacheWrite': 'Cache write', 'usage.output': 'Output', 'usage.reasoning': ' ({tokens} reasoning)', 'usage.count': '{count} tok', 'usage.speed': 'Output speed', 'usage.tps': '{tps} tok/s',
    'number.thousand': '{value}K', 'number.million': '{value}M',
    'day.today': 'Today', 'day.yesterday': 'Yesterday', 'day.before': '2 days ago', 'clock.md': '{m}/{d}', 'clock.ymd': '{y}-{m}-{d}',
    'todo.rowTitle': 'Update to-do list', 'tool.title.createGoal': 'Create goal', 'tool.title.getGoal': 'View goal', 'tool.title.updateGoal': 'Update goal', 'tool.preparing.content': '{kilobytes}KB',
    'tool.title.createSchedule': 'Create automation task', 'tool.title.listSchedules': 'List automation tasks', 'tool.title.viewSchedule': 'View automation task', 'tool.title.editSchedule': 'Edit automation task',
    'tool.title.deleteSchedule': 'Delete automation task', 'tool.title.updateSchedule': 'Update automation task', 'detail.state': 'Status', 'detail.todo.completed': 'Completed', 'detail.todo.in_progress': 'In progress',
    'detail.todo.pending': 'Pending', 'detail.todo.empty': 'The to-do list is empty', 'todo.diff.initial': 'Initial list', 'todo.diff.compare': 'Changes since the previous list',
    'todo.diff.unavailable': 'Previous list unavailable', 'todo.diff.noChanges': 'No changes to the list', 'todo.diff.added': '{count} added', 'todo.diff.updated': '{count} updated', 'todo.diff.removed': '{count} removed',
    'todo.diff.unchanged': '{count} unchanged', 'todo.diff.addedItem': 'Added', 'todo.diff.updatedItem': 'Status changed', 'todo.diff.movedItem': 'Reordered', 'todo.diff.removedItem': 'Removed', 'detail.goal.empty': 'No goal',
    'detail.goal.active': 'Active', 'detail.goal.disarmed': 'Awaiting continuation', 'detail.goal.paused': 'Paused', 'detail.goal.blocked': 'Blocked', 'detail.goal.complete': 'Completed', 'detail.goal.rounds': 'Rounds',
    'detail.goal.reason': 'Blocker', 'detail.days': '{count} d', 'detail.hours': '{count} h', 'detail.minutes': '{count} min', 'detail.seconds': '{count} s', 'detail.schedule.once': 'Once',
    'detail.schedule.every': 'Every {interval}', 'detail.schedule.when': 'Scheduled for', 'detail.schedule.frequency': 'Repeat', 'detail.schedule.scheduled': 'Scheduled',
    'detail.schedule.overdue': 'Overdue, awaiting session resume', 'detail.schedule.active': 'Enabled', 'detail.schedule.paused': 'Paused', 'detail.schedule.ended': 'Ended', 'detail.schedule.empty': 'No automation tasks',
    'detail.schedule.deleted': 'Deleted', 'detail.schedule.count': '{count} automation tasks', 'detail.schedule.daily': 'Every day at {time} ({zone})', 'detail.schedule.weekly': 'Weekly on {days} at {time} ({zone})',
    'detail.schedule.cron': 'Cron {expression} ({zone})', 'detail.schedule.custom': 'Custom', 'detail.schedule.monthly': 'Every month', 'detail.weekday.1': 'Mon', 'detail.weekday.2': 'Tue', 'detail.weekday.3': 'Wed', 'detail.weekday.4': 'Thu', 'detail.weekday.5': 'Fri',
    'detail.weekday.6': 'Sat', 'detail.weekday.7': 'Sun', 'detail.weekday.join': ', ', 'tool.title.inspectProviders': 'Inspect providers', 'tool.title.queryRuntime': 'Query runtime',
    'tool.title.inspectPlugins': 'Inspect plugins', 'tool.title.workflow': 'Run workflow', 'tool.title.ralph': 'Run ralph loop', 'tool.title.readEvent': 'Read event', 'tool.title.searchEvents': 'Search events',
    'tool.title.traceEvent': 'Trace event', 'tool.title.searchSessions': 'Search sessions', 'tool.title.traceSession': 'Trace session', 'tool.title.listModels': 'List models', 'tool.title.subagent': 'Create subagent',
    'tool.title.subagentFork': 'Fork subagent', 'tool.title.listAgents': 'List subagents', 'tool.title.sendMessage': 'Send message', 'tool.title.interruptAgent': 'Interrupt agent', 'tool.title.listJobs': 'List background jobs',
    'tool.title.readJob': 'Read job output', 'tool.title.killJob': 'Cancel background job', 'tool.title.openTerminal': 'Open terminal', 'tool.title.readTerminal': 'Read terminal', 'tool.title.listTerminals': 'List terminals',
    'tool.title.signalTerminal': 'Signal terminal', 'tool.title.closeTerminal': 'Close terminal', 'tool.title.lsp': 'Query code symbols', 'tool.title.findDefinition': 'Find definition',
    'tool.title.findReferences': 'Find references', 'tool.title.findImplementation': 'Find implementation', 'tool.title.hoverSymbol': 'Inspect symbol', 'tool.title.spawnTeammate': 'Create teammate',
    'tool.title.createTeamTask': 'Create team task', 'tool.title.getTeamTask': 'Read team task', 'tool.title.updateTeamTask': 'Update team task', 'tool.title.listTeamTasks': 'List team tasks',
    'tool.title.waitAgent': 'Waiting for messages…', 'detail.recordedResult': 'Recorded result', 'detail.empty': 'No results', 'detail.none': 'None', 'detail.yes': 'Yes', 'detail.no': 'No',
    'detail.moreInInspect': '{count} more items available in Inspect', 'detail.status.running': 'Running', 'detail.status.idle': 'Idle', 'detail.status.ready': 'Ready', 'detail.status.inactive': 'Inactive',
    'detail.status.provisioning': 'Provisioning', 'detail.status.failed': 'Failed', 'detail.status.corrupt': 'Corrupt', 'detail.status.unsupported': 'Unsupported', 'detail.status.unavailable': 'Unavailable',
    'detail.status.completed': 'Completed', 'detail.status.deleted': 'Deleted', 'detail.status.killed': 'Cancelled', 'detail.status.accepted': 'Accepted', 'detail.status.queued': 'Queued', 'detail.status.exited': 'Exited',
    'detail.field.id': 'ID', 'detail.field.revision': 'Revision', 'detail.field.platform': 'Platform', 'detail.field.provider': 'Provider', 'detail.field.model': 'Model', 'detail.field.role': 'Role',
    'detail.field.context': 'Context', 'detail.field.owner': 'Owner', 'detail.field.ready': 'Ready', 'detail.field.dependencies': 'Dependencies', 'detail.field.writeScopes': 'Write scopes', 'detail.field.warnings': 'Warnings',
    'detail.field.diagnostics': 'Diagnostics', 'detail.field.methods': 'Methods', 'detail.field.inputSchema': 'Input schema', 'detail.field.outputSchema': 'Output schema', 'detail.field.currentPackage': 'Current package',
    'detail.field.nextPackage': 'Next package', 'detail.field.latestRun': 'Latest run', 'detail.field.packages': 'Packages', 'detail.field.registrations': 'Registrations', 'detail.field.props': 'Props',
    'detail.field.data': 'Data', 'detail.field.source': 'Source', 'detail.field.content': 'Content', 'detail.field.message': 'Message', 'detail.field.messageId': 'Message ID', 'detail.field.root': 'Root',
    'detail.field.pid': 'Process ID', 'detail.field.type': 'Type', 'detail.field.time': 'Time', 'detail.field.seq': 'Event sequence', 'detail.field.turn': 'Turn', 'detail.field.step': 'Step', 'detail.field.callId': 'Call ID',
    'detail.field.agents': 'Agents started', 'detail.field.result': 'Result', 'detail.field.parent': 'Parent', 'detail.field.exitCode': 'Exit code', 'detail.field.signal': 'Signal',
    'detail.field.previousStatus': 'Previous status', 'detail.field.agent': 'Agent ID', 'detail.field.agentName': 'Agent name', 'detail.field.agentDescription': 'Agent task description', 'detail.field.job': 'Job ID',
    'detail.field.task': 'Task', 'detail.field.processGroup': 'Process group', 'detail.field.availability': 'Availability', 'detail.agents.count': '{count} agents', 'detail.jobs.count': '{count} background jobs',
    'detail.terminals.count': '{count} terminals', 'detail.tasks.count': '{count} team tasks', 'detail.tasks.nextPage': 'More tasks available; next cursor is {cursor}', 'detail.locations.count': '{count} locations',
    'detail.location': 'Line {line}, column {column}', 'detail.receipt.delivered': 'Message delivered', 'detail.receipt.interrupt': 'Interrupt requested', 'detail.receipt.started': 'Started',
    'detail.receipt.cancel': 'Cancellation requested', 'detail.receipt.alreadyFinished': 'Already finished', 'detail.receipt.signal': 'Signal delivered', 'detail.receipt.closed': 'Closed', 'detail.receipt.closing': 'Closing',
    'detail.wait.noProgress': 'No active subagents', 'detail.wait.title': 'Wait result', 'detail.wait.timeout': 'Wait timed out', 'detail.wait.ended': 'Wait ended', 'detail.agent.reply': 'Agent response',
    'detail.models.title': 'Available models', 'detail.output.lines': 'Lines {begin}–{end} of {total}', 'detail.output.truncated': 'Output truncated', 'todo.completed': '{done}/{total} completed', 'ask.rowTitle': 'Ask question',
    'row.running': 'Running', 'row.preparing': 'Preparing tool call', 'row.failed': 'Failed', 'row.stopped': 'Stopped', 'row.input': 'IN', 'row.output': 'OUT', 'row.imageSize': '{width}x{height}px, {bytes} bytes',
    'row.imageSizeDownscaled': '{width}x{height}px (downscaled from {originalWidth}x{originalHeight}px), {bytes} bytes', 'tool.title.search': 'Search', 'tool.title.read': 'Read', 'tool.title.bash': 'Bash',
    'tool.title.write': 'Write', 'tool.title.edit': 'Edit', 'tool.title.applyPatch': 'Edit', 'tool.title.code': 'Code', 'tool.title.generic': 'Tool call', 'tool.title.inspect': 'Query Cordis environment',
    'tool.title.runCordis': 'Run Cordis Plugin', 'tool.title.stopCordis': 'Stop Cordis Plugin', 'tool.title.removeCordis': 'Remove Cordis Plugin', 'tool.title.pwsh': 'Pwsh', 'tool.title.readImage': 'Read image',
    'tool.title.officeRender': 'Render document', 'tool.title.officeConvert': 'Convert document', 'tool.title.officeRecalculate': 'Recalculate workbook', 'tool.title.grep': 'Grep', 'tool.title.glob': 'Glob',
    'tool.title.webSearch': 'Search', 'tool.title.webFetch': 'Fetch', 'tool.webFetch.failure.dns': 'Couldn\'t resolve the host name. Check your network, proxy, or DNS settings.',
    'tool.webFetch.failure.refused': 'Connection refused. Check the address, port, or proxy.', 'tool.webFetch.failure.connectionTimeout': 'Connection timed out. Check your network or proxy, then retry.',
    'tool.webFetch.failure.certificate': 'Certificate verification failed. Check the system clock, proxy, or certificates.', 'tool.webFetch.failure.interrupted': 'Connection interrupted. Try again later.',
    'tool.webFetch.failure.unreachable': 'Network or host unreachable. Check your network connection or proxy.', 'tool.webFetch.failure.network': 'Network request failed. See the output for details.',
    'tool.autoReviewRejected': 'Rejected by Auto review', 'tool.autoReviewNotExecuted': 'Tool was not executed. Reason: {reason}', 'tool.autoReviewReasonFallback': 'Auto review did not authorize this action',
    'diff.expandRest': '… {count} more lines', 'read.window': 'Showing {shown} of {total} lines', 'read.expandRest': '… {count} more lines', 'search.paths': '{shown} paths',
    'search.paths.truncated': 'Showing {shown} of {total} paths', 'search.matches': '{shown} matches · {files} files', 'search.matches.truncated': 'Showing {shown} of {total} matches · {files} files',
    'search.noResults': 'No results', 'search.collapseAria': 'Collapse results', 'search.expandAria': 'Expand {count} more result lines', 'search.expandRest': '… {count} more lines', 'web.noResults': 'No results found',
    'web.sourcesTruncated': 'Source list truncated', 'web.http': 'HTTP', 'web.contentTruncated': 'Content truncated', 'terminal.signal': 'signal {signal}', 'terminal.exitCode': 'exit code {code}',
    'terminal.noExitCode': 'no exit code', 'terminal.commandLine': 'Command line {n}', 'terminal.running': 'Running', 'terminal.failed': 'Failed', 'terminal.done': 'Done', 'terminal.noOutput': 'No output',
    'terminal.collapseAria': 'Collapse output', 'terminal.expandAria': 'Expand the remaining {n} output lines', 'terminal.expandRest': '… {n} more lines', 'terminal.sendInput': '(send input)',
    'terminal.session': 'Terminal {sessionId}',
    'ref.section.files': 'Files & folders', 'ref.section.subagents': 'Subagents', 'ref.section.sessions': 'Sessions', 'ref.noCwd': '(no cwd)',
    'image.unsupportedType': 'Only PNG, JPG, WebP, and GIF images are supported', 'image.tooMany': 'A message can include up to {count} images', 'image.fileTooLarge': 'Each image must be smaller than {size}', 'image.totalTooLarge': 'Images exceed {size} in total; remove some and try again',
    'image.tooManyPixels': 'Image resolution is too high; compress it and try again', 'image.dimensionTooLarge': 'Image sides must be at most {size}px; downscale it and try again', 'image.modelUnsupported': 'The current model does not support images; switch to a model that does', 'image.sendFailed': 'Sending images failed ({reason}); re-add them and try again',
    'file.notStaged': 'The file has not finished uploading; re-add it and try again', 'file.sessionUnavailable': 'Session unavailable; files cannot be uploaded', 'file.tooLarge': 'Each file must be smaller than {size}', 'file.noService': 'File upload is not available on this Mac', 'file.subagent': 'Subagent conversations do not accept file uploads',
    'prompt.noContinuation': 'There is nothing to continue generating right now.', 'prompt.attachmentExpired': 'The attachment expired; add it again.',
    'time.now': 'now', 'time.minutes': '{n}min', 'time.hours': '{n}h', 'time.days': '{n}d', 'time.months': '{n}mo', 'time.years': '{n}y',
    'workflow.label': 'Workflow {name}',
    'page.title': 'Remote pairing · dsh-remote', 'page.sub': 'Scan with the dsh-remote app to connect this Mac', 'page.expires': 'code expires in {mins} min · {id}',
    'page.paired': 'This Mac has a paired device.', 'page.unpaired': 'Not paired yet.',
    'subagent.notResumable': 'This subagent cannot be continued.', 'subagent.unavailable': 'The subagent cannot take messages right now; try again shortly.',
    'subagent.progress.completed': '{count} completed', 'subagent.progress.active': '{count} in progress', 'subagent.progress.inactive': '{count} not running', 'subagent.progress.external': '{count} external',
    'subagent.mode.oneShot': 'one-shot', 'subagent.mode.continuable': 'continuable', 'subagent.mode.external': 'External task', 'subagent.mode.unknown': 'unknown mode',
    'subagent.activity.running': 'running', 'subagent.activity.completed': 'completed', 'subagent.activity.inactive': 'not running',
    'job.status.running': 'running', 'job.status.stopping': 'stopping', 'job.status.completed': 'completed', 'job.status.killed': 'cancelled', 'job.status.failed': 'failed',
    'open.unavailable': 'This Mac has no desktop available to open files in an external app.', 'open.notAllowed': 'For safety, this kind of file cannot be opened on the Mac directly; show it in Finder instead.', 'open.failed': 'Could not open it on the Mac. Try again.',
  },
}
/** 'en' or 'zh-Hans' (the default), from the phone's `lang` parameter. */
const langOf = (v) => (/^en(?:[-_]|$)/i.test(String(v ?? '')) ? 'en' : 'zh-Hans')
const copy = (lang, key, vars) => String(COPY[lang === 'en' ? 'en' : 'zh'][key] ?? COPY.zh[key] ?? key)
  .replace(/\{(\w+)\}/g, (_, k) => String(vars?.[k] ?? ''))
/** A counted phrase: `key.one` for exactly one where the language has it, else `key`. */
const copyCount = (lang, key, count) => copy(lang, count === 1 && COPY[lang === 'en' ? 'en' : 'zh'][`${key}.one`] !== undefined ? `${key}.one` : key, { count })

// ---- process groups, the turn control and the turn usage panel ----------------------------------------------------
// (ui-chat conversation-nodes/{process-groups,process-activity,turn-process}.ts, chat/{step-process.ts,TurnProcessNodeView.tsx,
// TurnUsagePanel.tsx,message-chrome.ts,token-format.ts}, llm/token-meter/src/turn-usage.ts; rc.3.)
/** formatRunDuration: `1h 2m 5s` / `1小时2分5秒` (the seconds always, minutes from 60 s, hours from 60 min). */
const runDuration = (lang, ms) => {
  const total = Math.max(0, Math.floor(ms / 1000))
  const hours = Math.floor(total / 3600)
  const minutes = Math.floor(total / 60) % 60
  return `${hours > 0 ? `${hours}${copy(lang, 'duration.hourUnit')}` : ''}${total >= 60 ? `${minutes}${copy(lang, 'duration.minuteUnit')}` : ''}${total % 60}${copy(lang, 'duration.secondUnit')}`
}
/** Tool name -> the process category the group titles count (process-activity.ts activity()). */
const activityKind = (name) => {
  if (name === 'read') return 'read'
  if (name === 'read_image') return 'readImage'
  if (name === 'grep' || name === 'glob' || name.endsWith('_inspect')) return 'search'
  if (name === 'write') return 'write'
  if (name === 'edit' || name === 'apply_patch') return 'edit'
  if (['bash', 'shell', 'pwsh', 'exec_command', 'write_stdin'].includes(name) || name.startsWith('terminal_')) return 'commands'
  if (name === 'run_code' || name === 'cua_run_code') return 'code'
  if (name === 'web_search') return 'webSearch'
  if (name === 'web_fetch') return 'webFetch'
  if (name === 'subagent' || name.startsWith('subagent_')) return 'subagents'
  if (['todo_write', 'create_goal', 'update_goal', 'get_goal'].includes(name)) return 'plan'
  if (name === 'ask_user_question' || name === 'request_user_input') return 'questions'
  return 'tools'
}
const GROUP_ICON = { thinking: 'sparkles', read: 'document', readImage: 'photo', search: 'search', edit: 'pencil', write: 'pencil', commands: 'play', code: 'layers', webSearch: 'search', webFetch: 'link', subagents: 'people', plan: 'list', questions: 'info', tools: 'sparkles', context: 'document' }
/** Categories ranked by distinct calls, ties by first appearance; a group of only contexts is one `context` category (processActivity()). */
const groupCounts = (members) => {
  const counts = new Map()
  const seen = new Set()
  for (const b of members) {
    if (b.kind !== 'tool') continue
    const key = b.callId ?? b
    if (seen.has(key)) continue
    seen.add(key)
    const kind = activityKind(String(b.name ?? ''))
    counts.set(kind, (counts.get(kind) ?? 0) + 1)
  }
  if (members.length > 0 && members.every((b) => b.kind === 'ctx')) counts.set('context', members.length)
  return [...counts].map(([kind, count]) => ({ kind, count })).sort((a, b) => b.count - a.count)
}
/** processTitle(): a closed group's title from its top three categories, joined 并 / ， / 等. */
const processTitle = (lang, counts) => {
  const labels = counts.slice(0, 3).map(({ kind }) => copy(lang, `step.done.${kind}`))
  const [first, second] = labels
  if (first === undefined) return copy(lang, 'step.done.thinking')
  if (second === undefined) return first
  const lower = (s) => s.charAt(0).toLowerCase() + s.slice(1)
  if (labels.length === 2) {
    const prefix = copy(lang, 'step.sharedPrefix')
    const shared = prefix !== '' && first.startsWith(prefix) && second.startsWith(prefix)
    return copy(lang, 'step.joinTwo', { first, second: lower(shared ? second.slice(prefix.length) : second) })
  }
  const title = [first, ...labels.slice(1).map(lower)].join(copy(lang, 'step.comma'))
  return counts.length > 3 ? copy(lang, 'step.more', { title }) : title
}

// Token and cache figures, as chat/token-format.ts words them.
const fmtTokens = (lang, n) => {
  const scaled = (c) => (c >= 100 ? String(Math.round(c)) : String(Math.round(c * 10) / 10))
  if (n < 1000) return String(n)
  return n < 1_000_000 ? copy(lang, 'number.thousand', { value: scaled(n / 1000) }) : copy(lang, 'number.million', { value: scaled(n / 1_000_000) })
}
const fmtExact = (n) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ',')
/** Whole percent units (tenths when `places` is 1) of read / denom, positive ties rounded up (roundedPercentUnits). */
const percentUnits = (read, denom, places) => {
  const scale = (places === 0 ? 1 : 10) * 100
  const doubled = scale * 2
  const q = Math.floor(denom / doubled)
  const r = denom % doubled
  let lower = 0
  let upper = scale
  while (lower < upper) {
    const cand = Math.floor((lower + upper + 1) / 2)
    const factor = cand * 2 - 1
    if (read >= factor * q + Math.ceil(factor * r / doubled)) lower = cand
    else upper = cand - 1
  }
  return lower
}
/** formatCacheHitPercent(): text without the % sign, never rounding a partial hit up to 100; null with no prompt input. */
const cacheHitText = (read, prompt, places = 1) => {
  if (prompt === 0) return null
  const missed = prompt - read
  if (missed === 0) return '100'
  const units = percentUnits(read, prompt, places)
  if (units < (places === 0 ? 100 : 1000)) {
    if (places === 0) return String(units)
    return units % 10 === 0 ? String(Math.floor(units / 10)) : `${Math.floor(units / 10)}.${units % 10}`
  }
  let digits = 1
  let gap = missed * 200
  const tens = Math.floor(prompt / 10)
  while (gap <= tens) { gap *= 10; digits += 1 }
  const ones = prompt % 10
  let loss = 5
  for (let l = 1; l < 5; l += 1) {
    if (gap <= (l * 2 + 1) * tens + Math.floor((l * 2 + 1) * ones / 10)) { loss = l; break }
  }
  return `99.${'9'.repeat(digits - 1)}${10 - loss}`
}
/** formatTokensPerSecond(): whole tokens from ten up, one decimal below. */
const fmtTps = (tps) => (tps >= 10 ? String(Math.round(tps)) : String(Math.round(Math.max(0, tps) * 10) / 10))

/** The time of a stream's first token (assistantStreamFirstTokenTime): the first non-empty delta, or a name-bearing tool call. */
const streamFirstToken = (stream) => {
  for (const r of Array.isArray(stream) ? stream : []) {
    if (r?.type === 'chunk') {
      const c = r.chunk
      if (((c?.type === 'text-delta' || c?.type === 'reasoning-delta') && c.text !== '') || (c?.type === 'tool-call-delta' && (c.argumentsDelta !== '' || c.name !== undefined))) return r.time
      continue
    }
    const frags = r?.type === 'tool-call-chunks' ? r.args : r?.texts
    if (!Array.isArray(frags) || !Array.isArray(r.dt)) continue
    if (r.type === 'tool-call-chunks' && r.name !== undefined) return r.time0
    let at = r.time0
    for (let i = 0; i < frags.length; i += 1) {
      if (i > 0) at += r.dt[i - 1]
      if (frags[i] !== '') return at
    }
  }
  return undefined
}
/** The usage sample the attempt's stream recorded (lastAssistantStreamChunk(stream, 'usage')). */
const streamUsage = (stream) => {
  const list = Array.isArray(stream) ? stream : []
  for (let i = list.length - 1; i >= 0; i -= 1) if (list[i]?.type === 'chunk' && list[i].chunk?.type === 'usage') return list[i].chunk.usage
  return undefined
}

const isCount = (v) => Number.isSafeInteger(v) && v >= 0
const safeSum = (values) => {
  let total = 0
  for (const v of values) { total += v; if (!Number.isSafeInteger(total)) return undefined }
  return total
}
/** One attempt's usage, or undefined when it contradicts itself (normalizeUsage()). */
const normalizeUsage = (u, route) => {
  if (!u || typeof u !== 'object') return undefined
  const { inputTokens, outputTokens, cacheReadTokens, cacheWriteTokens, reasoningTokens, totalTokens } = u
  if (!isCount(inputTokens) || !isCount(outputTokens)) return undefined
  if (cacheReadTokens !== undefined && !isCount(cacheReadTokens)) return undefined
  if (cacheWriteTokens !== undefined && !isCount(cacheWriteTokens)) return undefined
  if (reasoningTokens !== undefined && (!isCount(reasoningTokens) || reasoningTokens > outputTokens)) return undefined
  const knownPrompt = safeSum([inputTokens, ...(cacheReadTokens === undefined ? [] : [cacheReadTokens]), ...(cacheWriteTokens === undefined ? [] : [cacheWriteTokens])])
  if (knownPrompt === undefined) return undefined
  let exactTotal
  if (totalTokens !== undefined) {
    if (!isCount(totalTokens)) return undefined
    const exactPrompt = totalTokens - outputTokens
    if (!isCount(exactPrompt) || exactPrompt < knownPrompt) return undefined
    if (cacheReadTokens !== undefined && cacheWriteTokens !== undefined && exactPrompt !== knownPrompt) return undefined
    exactTotal = totalTokens
  } else {
    if (cacheReadTokens === undefined || cacheWriteTokens === undefined) return undefined
    exactTotal = safeSum([knownPrompt, outputTokens])
    if (exactTotal === undefined) return undefined
  }
  return { inputTokens, outputTokens, totalTokens: exactTotal, cacheReadTokens, cacheWriteTokens, reasoningTokens, route }
}
/**
 * deriveTurnTokenUsage(): one completed turn's exact accounting from its durable attempt lifecycle (turn/start, step/start,
 * assistant/attempt, assistant/message, llm/retry, llm/retry-started, step/end, turn/end). Any missing boundary or incomplete
 * attempt makes the whole disclosure unavailable (undefined). `events` are compact {type, turn, step, usage?, route?}.
 */
const deriveTurnUsage = (events) => {
  let state = { kind: 'idle' }
  const attempts = []
  let turn
  let sawEnd = false
  let invalid = false
  const same = (s, t, st) => s.turn === t && s.step === st
  const closeOpen = (route) => {
    if (state.kind !== 'open' || state.sample === undefined) return false
    const n = normalizeUsage(state.sample, route)
    if (n === undefined) return false
    attempts.push(n)
    return true
  }
  for (const e of events) {
    if (invalid) break
    if (e.type === 'turn/start') { if (turn !== undefined || state.kind !== 'idle') invalid = true; else turn = e.turn; continue }
    if (turn === undefined) { invalid = true; break }
    if (e.type === 'turn/end') { if (e.turn !== turn || state.kind !== 'idle' || sawEnd) invalid = true; else sawEnd = true; continue }
    if (sawEnd) { invalid = true; break }
    if (e.type === 'step/start') { if (e.turn !== turn || state.kind !== 'idle') invalid = true; else state = { kind: 'open', turn, step: e.step }; continue }
    if (e.type === 'llm/retry-started') {
      if (e.turn !== turn || state.kind !== 'settled' || state.by !== 'retry' || !same(state, e.turn, e.step)) invalid = true
      else state = { kind: 'open', turn, step: e.step }
      continue
    }
    if (e.type === 'assistant/attempt') {
      if (e.turn !== turn || state.kind !== 'open' || !same(state, e.turn, e.step)) { invalid = true; continue }
      state = { kind: 'open', turn, step: e.step, sample: e.usage ?? state.sample }
      if (!closeOpen()) invalid = true
      else state = { kind: 'finishClosed', turn, step: e.step }
      continue
    }
    if (e.type === 'assistant/message') {
      if (e.turn !== turn || state.kind !== 'open' || !same(state, e.turn, e.step)) { invalid = true; continue }
      if (e.usage !== undefined) state = { ...state, sample: e.usage }
      if (!closeOpen(e.route)) invalid = true
      else state = { kind: 'settled', turn, step: e.step, by: 'message' }
      continue
    }
    if (e.type === 'llm/retry') {
      if (e.turn !== turn || state.kind === 'idle' || !same(state, e.turn, e.step)) { invalid = true; continue }
      if (state.kind === 'settled' || (state.kind === 'open' && !closeOpen())) invalid = true
      if (!invalid) state = { kind: 'settled', turn, step: e.step, by: 'retry' }
      continue
    }
    if (e.type === 'step/end') {
      if (e.turn !== turn || state.kind === 'idle' || !same(state, e.turn, e.step)) { invalid = true; continue }
      if (state.kind === 'open' && !closeOpen()) invalid = true
      if (!invalid) state = { kind: 'idle' }
    }
  }
  if (invalid || !sawEnd || state.kind !== 'idle' || attempts.length === 0) return undefined
  const input = safeSum(attempts.map((a) => a.inputTokens))
  const output = safeSum(attempts.map((a) => a.outputTokens))
  const total = safeSum(attempts.map((a) => a.totalTokens))
  if (input === undefined || output === undefined || total === undefined) return undefined
  // A bucket is present only when every attempt reported it (cache reads / writes / reasoning).
  const every = (key) => attempts.every((a) => isCount(a[key])) ? safeSum(attempts.map((a) => a[key])) : undefined
  const routes = new Map()
  const attributed = attempts.every((a) => a.route !== undefined)
  if (attributed) for (const a of attempts) routes.set(`${a.route.provider}\0${a.route.model}`, a.route)
  return { uncachedInputTokens: input, outputTokens: output, totalTokens: total, cacheReadTokens: every('cacheReadTokens'), cacheWriteTokens: every('cacheWriteTokens'), reasoningTokens: every('reasoningTokens'), routes: attributed ? [...routes.values()] : undefined }
}
/** The turn usage panel as the phone shows it: the `用量 X` line and the label / value rows (TurnUsagePanel.tsx). */
const usageView = (lang, usage, tps) => {
  const exact = (n) => copy(lang, 'usage.count', { count: fmtExact(n) })
  const rows = []
  const routes = usage.routes?.map((r) => `${r.provider}/${r.model}`).join(', ') ?? ''
  if (routes !== '') rows.push({ id: 'model', label: copy(lang, 'usage.model'), value: routes })
  const hit = usage.cacheReadTokens === undefined ? null : cacheHitText(usage.cacheReadTokens, usage.totalTokens - usage.outputTokens, 1)
  if (hit !== null) rows.push({ id: 'hit', label: copy(lang, 'usage.cacheHit'), value: `${hit}%` })
  rows.push({ id: 'in', label: copy(lang, 'usage.input'), value: exact(usage.uncachedInputTokens) })
  if (usage.cacheReadTokens !== undefined) rows.push({ id: 'cr', label: copy(lang, 'usage.cacheRead'), value: exact(usage.cacheReadTokens) })
  if (usage.cacheWriteTokens !== undefined) rows.push({ id: 'cw', label: copy(lang, 'usage.cacheWrite'), value: exact(usage.cacheWriteTokens) })
  rows.push({ id: 'out', label: copy(lang, 'usage.output'), value: `${exact(usage.outputTokens)}${usage.reasoningTokens !== undefined ? copy(lang, 'usage.reasoning', { tokens: exact(usage.reasoningTokens) }) : ''}` })
  if (tps !== null) rows.push({ id: 'tps', label: copy(lang, 'usage.speed'), value: copy(lang, 'usage.tps', { tps: fmtTps(tps) }) })
  return { line: copy(lang, 'usage.consumed', { total: copy(lang, 'usage.count', { count: fmtTokens(lang, usage.totalTokens) }) }), rows }
}

// A tool call's one-line live detail while its arguments are still streaming (process-activity.ts liveToolDetail): the first
// detail key present, its text so far or its closed value; a string array joins with commas.
const LIVE_DETAIL_KEYS = ['title', 'description', 'objective', 'task', 'task_name', 'name', 'question', 'questions', 'prompt', 'message', 'command', 'cmd', 'queries', 'query', 'pattern', 'url', 'uri', 'file_path', 'path', 'target', 'action', 'status']
const liveDetailText = (text, max = 160) => {
  const s = String(text).replace(/\s+/g, ' ').trim()
  return s.length <= max ? s : `${s.slice(0, max - 1).trimEnd()}…`
}
const unescapeJson = (raw) => {
  const body = raw.replace(/\\(?:u[0-9a-fA-F]{0,3})?$/, '') // an escape the stream has not finished
  try { return JSON.parse(`"${body}"`) } catch { return body }
}
const partialDetail = (rawArgs) => {
  const s = String(rawArgs ?? '')
  if (s === '') return ''
  for (const key of LIVE_DETAIL_KEYS) {
    if (!s.includes(`"${key}"`)) continue
    const str = new RegExp(`"${key}"\\s*:\\s*"((?:[^"\\\\]|\\\\.)*)`).exec(s)
    if (str) { const t = liveDetailText(unescapeJson(str[1])); if (t !== '') return t }
    const arr = new RegExp(`"${key}"\\s*:\\s*\\[\\s*"((?:[^"\\\\]|\\\\.)*)`).exec(s)
    if (arr) {
      const items = [...s.slice(arr.index).matchAll(/"((?:[^"\\]|\\.)*)"/g)].slice(1).map((m) => unescapeJson(m[1]))
      const t = liveDetailText(items.join(', '))
      if (t !== '') return t
    }
  }
  return ''
}
/** The preview of a reasoning that is still streaming: the first line of its latest completed paragraph, `**` dropped (ReasoningRow.tsx). */
const reasoningPreview = (text) => {
  const t = String(text ?? '')
  let first = ''
  let start = 0
  const sep = /\r?\n(?:[\t ]*\r?\n)+/g
  for (;;) {
    const next = sep.exec(t)
    const end = next === null ? t.length : next.index + next[0].indexOf('\n')
    const nl = t.indexOf('\n', start)
    if (nl !== -1 && nl <= end) { const cand = t.slice(start, nl).trim(); if (cand !== '') first = cand }
    if (next === null) break
    start = next.index + next[0].length
  }
  return first.replaceAll('**', '').trim().slice(0, 160)
}
/** The last non-empty paragraph of a running reasoning, whitespace collapsed (liveReasoningDetail). */
const reasoningDetail = (text) => {
  const paras = String(text ?? '').split(/\r?\n[\t ]*\r?\n/)
  for (let i = paras.length - 1; i >= 0; i -= 1) { const d = liveDetailText(paras[i].replaceAll('**', '')); if (d !== '') return d }
  return ''
}

// ---- what a logged message source says (ui-chat conversation-nodes/event-projection.ts, chat/turn-trigger.ts) ----
const asRecord = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? v : null)
const readStr = (r, k) => (r && typeof r[k] === 'string' && r[k] !== '' ? r[k] : null)
/** Distinct non-empty `field` values of the `member` list of a source, first-seen order. */
const collect = (source, member, field) => {
  const out = []
  for (const entry of Array.isArray(source?.[member]) ? source[member] : []) {
    const v = readStr(asRecord(entry), field)
    if (v !== null && !out.includes(v)) out.push(v)
  }
  return out
}
const KNOWN_FORMS = ['instructions', 'catalog', 'snapshot', 'notice', 'relay', 'recall']
const contextForm = (source) => (KNOWN_FORMS.includes(asRecord(source)?.form) ? source.form : null)
/** The row's role (inject | recall) and producer label: a skill name, instruction paths, recalled sessions, else the durable kind. */
const contextProducer = (source) => {
  const rec = asRecord(source)
  const kind = readStr(rec, 'kind')
  if (kind === null) return { role: 'inject', label: null }
  if (kind === 'session-reference') return { role: 'recall', label: collect(rec, 'references', 'label').join(', ') || kind }
  if (kind === 'agent-instructions') return { role: 'inject', label: collect(rec, 'changes', 'path').join(', ') || kind }
  if (kind === 'skill-invocation') return { role: 'inject', label: readStr(rec, 'name') ?? kind }
  return { role: 'inject', label: kind }
}
/** Title key, `symbol:` icon role and compactness of the Turn trigger a waking message is. */
const triggerDetails = (source, content) => {
  const rec = asRecord(source) ?? {}
  switch (readStr(rec, 'kind')) {
    case 'retry':
      if (content.length === 0) return { title: 'trigger.continuation', icon: 'symbol:play', compact: true }
      break
    case 'goal': return { title: 'trigger.goal', icon: 'symbol:star' }
    case 'agent-message': return { title: 'trigger.agent', icon: 'symbol:send' }
    case 'team-message': return { title: 'trigger.team', icon: 'symbol:person' }
    case 'subagent-settled': {
      const why = readStr(rec, 'stopReason')
      const title = why === null ? 'trigger.subagent'
        : { completed: 'trigger.subagent.completed', aborted: 'trigger.subagent.aborted', error: 'trigger.subagent.error', 'max-tokens': 'trigger.subagent.maxTokens', refusal: 'trigger.subagent.refusal' }[why] ?? 'trigger.subagent.unknown'
      return { title, icon: 'symbol:people' }
    }
    case 'webhook': return readStr(rec, 'provider') === 'github' ? { title: 'trigger.github', icon: 'symbol:layers' } : { title: 'trigger.webhook', icon: 'symbol:link' }
    case 'schedule': return { title: 'trigger.schedule', icon: 'symbol:calendar' }
    case 'tool-jobs': return { title: 'trigger.job', icon: 'symbol:list' }
    case 'cordis-host-runner': return { title: 'trigger.plugin', icon: 'symbol:package' }
    default: break
  }
  return { title: 'trigger.request', icon: 'symbol:download' }
}
const retrySeconds = (ms) => Math.max(1, Math.ceil(Number(ms) / 1000) || 1)

// The structured fields each context form reads off its durable source (chat/ContextBody.tsx). Every reader is
// all-or-nothing: a source it cannot read completely falls back to the opaque body, never a partial list.
const instructionChanges = (source) => {
  const list = asRecord(source)?.changes
  if (!Array.isArray(list)) return null
  const out = []
  for (const entry of list) {
    const c = asRecord(entry)
    if (c === null || typeof c.path !== 'string' || c.path === '' || !['set', 'replace', 'remove'].includes(c.action)) return null
    if (!out.some((x) => x.path === c.path)) out.push({ path: c.path, action: c.action })
  }
  return out.length === 0 ? null : out
}
const catalogEntries = (source) => {
  const list = asRecord(source)?.entries
  if (!Array.isArray(list)) return null
  const out = []
  for (const entry of list) {
    const e = asRecord(entry)
    if (e === null || typeof e.name !== 'string' || e.name === '' || typeof e.description !== 'string') return null
    out.push({ name: e.name, description: e.description })
  }
  return out
}
const snapshotSections = (source) => {
  const list = asRecord(source)?.sections
  if (!Array.isArray(list)) return null
  const out = []
  for (const entry of list) {
    const s = asRecord(entry)
    if (s === null || typeof s.name !== 'string' || s.name === '' || typeof s.text !== 'string') return null
    out.push({ name: s.name, text: s.text })
  }
  return out.length === 0 ? null : out
}
const relaySender = (source) => readStr(asRecord(source), 'senderSessionId')
const recalledSessions = (source) => {
  const list = asRecord(source)?.references
  if (!Array.isArray(list)) return null
  const out = []
  for (const entry of list) {
    const r = asRecord(entry)
    if (r === null || typeof r.label !== 'string' || r.label === '' || typeof r.retainedMessages !== 'number' || typeof r.omittedMessages !== 'number' || typeof r.truncated !== 'boolean') return null
    out.push({ label: r.label, retained: r.retainedMessages, omitted: r.omittedMessages, truncated: r.truncated })
  }
  return out.length === 0 ? null : out
}

// ---- Markdown -> phone nodes ---------------------------------------------------------------------------------------
// The phone draws blocks (paragraph, heading, list, quote, code, math, table, rule, image); inline marks stay Markdown
// source that its `text markup="markdown"` reader paints. The bridge splits the source into blocks the way CommonMark /
// GFM do for what LLM answers contain (ATX + setext headings, fences of any length, tables with alignment, task and
// nested mixed lists, $$ / \[ blocks, indented code) and rewrites the inline forms the reader lacks: inline math
// becomes a code span (the TeX source stays), a file link's destination becomes the phone's /file route, a CJK-adjacent
// ** that CommonMark's flanking rules refuse gets a hair space (what cjkFriendlyStrong does in the official parser).
const US = '\u001f' // table cells are joined with this
const truncate = (s, n = 800) => {
  const text = String(s ?? '')
  return text.length > n ? `${text.slice(0, n)}…` : text
}

const canParseUrl = (v) => { try { return Boolean(new URL(v)) } catch { return false } }
/** The workspace path a Markdown link destination names (file-link.ts parseFileLink), or null for URLs, anchors and queries. */
const fileLinkPath = (dest) => {
  const hash = dest.indexOf('#')
  const base = hash < 0 ? dest : dest.slice(0, hash)
  if (base === '' || base.includes('?')) return null
  let p
  try { p = decodeURIComponent(base) } catch { return null }
  if (p === '' || /[\u0000-\u001f\u007f]/.test(p)) return null
  const explicit = /^(?:[\\/]|\.{1,2}[\\/]|[a-z]:[\\/])/i.test(p)
  if (!explicit && canParseUrl(p)) return null
  const suffix = hash < 0 ? /:(\d+)(?::\d+|-(\d+))?$/.exec(p) : null
  if (suffix !== null) p = p.slice(0, -suffix[0].length)
  return p === '' ? null : p
}

const CJK_CHAR = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}\p{Script=Bopomofo}]/u
const PUNCT_CHAR = /[\p{P}\p{S}]/u
const HAIR = ' '
/** `**“引用”**文字`: CommonMark refuses to open / close a ** beside punctuation when CJK prose touches it; a hair space (Unicode white space) makes it flank. */
const cjkStrong = (s) => (s.includes('**') ? s.replace(/\*\*(?=\S)([^*\n]+?)\*\*/g, (whole, inner, at, all) => {
  const before = all[at - 1]
  const after = all[at + whole.length]
  const open = before !== undefined && CJK_CHAR.test(before) && PUNCT_CHAR.test(inner[0]) ? `${HAIR}**` : '**'
  const close = after !== undefined && CJK_CHAR.test(after) && PUNCT_CHAR.test(inner[inner.length - 1]) ? `**${HAIR}` : '**'
  return `${open}${inner}${close}`
}) : s)

/** A TeX source as an inline code span (the fence is longer than any backtick run inside). */
const mathSpan = (tex) => {
  const ticks = '`'.repeat(Math.max(0, ...[...tex.matchAll(/`+/g)].map((m) => m[0].length)) + 1)
  return `${ticks}${/^`|`$/.test(tex) ? ` ${tex} ` : tex}${ticks}`
}
const LINK_RE = /(?<!!)\[((?:\\.|[^\]\\])*)\]\(\s*<?([^)\s>]+)>?((?:\s+(?:"[^"]*"|'[^']*'))?)\s*\)/g
const textInline = (s) => {
  let t = s
  if (t.includes('![')) t = t.replace(/!\[([^\]]*)\]\(([^)\s]+)[^)]*\)/g, (_, alt, url) => `[image: ${alt || url}]`)
  if (t.includes('\\(')) t = t.replace(/\\\((.+?)\\\)/g, (_, tex) => mathSpan(tex.trim()))
  // `$x^2$`, not `$5 and $10`: no white space inside the delimiters, no digit or letter glued outside.
  if (t.includes('$')) t = t.replace(/(?<![\\$\w])\$(?![\s$])([^$\n]*?[^\s$\\])\$(?![$\d\w])/g, (_, tex) => mathSpan(tex))
  if (t.includes('](')) {
    t = t.replace(LINK_RE, (whole, label, dest) => {
      const p = fileLinkPath(dest)
      return p === null ? whole : `[${label}](/file?p=${encodeURIComponent(p)})`
    })
  }
  if (t.includes('\\\n')) t = t.replace(/(?<!\\)\\(?=\n)/g, '') // a backslash hard break: the newline stays
  return cjkStrong(t)
}
/** The inline pass over one block's text: code spans stay as written, everything else is rewritten by textInline. */
const inlineMd = (s) => {
  const src = String(s)
  if (!/[`$\\*\[!]/.test(src)) return src
  let out = ''
  let last = 0
  for (const m of src.matchAll(/(`+)(?!`)[\s\S]*?[^`]\1(?!`)/g)) {
    out += textInline(src.slice(last, m.index)) + m[0]
    last = m.index + m[0].length
  }
  return out + textInline(src.slice(last))
}

// ---- code highlighting: a small scanner per language family ----------------------------------------------------------
// Runs are {v, mark}: mark k keyword, s string, n number, c comment, f call, t type, l literal, p JSON key, v shell variable.
const HL_LANG = {
  js: 'js', javascript: 'js', jsx: 'js', mjs: 'js', cjs: 'js', ts: 'js', tsx: 'js', typescript: 'js',
  py: 'py', python: 'py', sh: 'sh', bash: 'sh', zsh: 'sh', shell: 'sh', json: 'json', jsonc: 'json', json5: 'json',
  go: 'go', golang: 'go', rs: 'rs', rust: 'rs', swift: 'swift', java: 'java', kotlin: 'java', kt: 'java', cs: 'java', csharp: 'java',
  c: 'c', h: 'c', cpp: 'c', 'c++': 'c', hpp: 'c', cc: 'c',
}
const HL_KW = {
  js: 'as async await break case catch class const continue debugger declare default delete do else enum export extends finally for from function get if implements import in instanceof interface let namespace new of private protected public readonly return set static super switch this throw try type typeof var void while with yield abstract',
  py: 'and as assert async await break case class continue def del elif else except finally for from global if import in is lambda match nonlocal not or pass raise return try while with yield',
  sh: 'if then else elif fi for while until do done case esac in function select time export local readonly declare unset return exit break continue source alias set',
  go: 'break case chan const continue default defer else fallthrough for func go goto if import interface map package range return select struct switch type var',
  rs: 'as async await break const continue crate dyn else enum extern fn for if impl in let loop match mod move mut pub ref return self Self static struct super trait type unsafe use where while',
  swift: 'actor as associatedtype async await break case catch class continue default defer deinit do else enum extension fallthrough fileprivate for func guard if import in indirect init inout internal is let nonisolated open operator override private protocol public repeat rethrows return self Self static struct subscript super switch throw throws try typealias var where while',
  java: 'abstract assert boolean break byte case catch char class const continue default do double else enum extends final finally float for goto if implements import instanceof int interface long native new package private protected public record return sealed short static super switch synchronized this throw throws transient try var void volatile while fun val when object is in out override open data',
  c: 'auto break case char class const constexpr continue default delete do double else enum explicit extern float for friend goto if inline int long namespace new nullptr operator private protected public register return short signed sizeof static struct switch template this typedef typename union unsigned using virtual void volatile while bool',
}
const HL_LIT = { js: 'true false null undefined NaN Infinity', py: 'True False None', sh: 'true false', go: 'true false nil iota', rs: 'true false', swift: 'true false nil', java: 'true false null', c: 'true false NULL', json: 'true false null' }
const hlCache = new Map()
const hlSpec = (family) => {
  let spec = hlCache.get(family)
  if (spec) return spec
  const line = family === 'py' || family === 'sh' ? '(?:^|(?<=\\s))#[^\\n]*' : family === 'json' ? '//[^\\n]*' : '//[^\\n]*'
  const comment = family === 'py' || family === 'sh' ? line : `${line}|/\\*[\\s\\S]*?(?:\\*/|$)`
  const dq = '"(?:[^"\\\\\\n]|\\\\.)*"?'
  const sq = family === 'sh' ? "'[^'\\n]*'?" : "'(?:[^'\\\\\\n]|\\\\.)*'?"
  const charLit = "'(?:\\\\.[^'\\n]*|[^'\\\\\\n])'" // rust / go / c / java / swift: 'x' or '\n', never a lifetime
  const string = family === 'py' ? `"""[\\s\\S]*?(?:"""|$)|'''[\\s\\S]*?(?:'''|$)|${dq}|${sq}`
    : family === 'js' ? `${dq}|${sq}|\`(?:[^\`\\\\]|\\\\[\\s\\S])*\`?`
      : family === 'go' ? `${dq}|${charLit}|\`[^\`]*\`?`
        : family === 'sh' ? `${dq}|${sq}`
          : family === 'json' ? '' : `${dq}|${charLit}`
  const parts = []
  if (family !== 'json') parts.push(`(?<c>${comment})`)
  else parts.push(`(?<c>${comment})`, '(?<p>"(?:[^"\\\\\\n]|\\\\.)*"(?=\\s*:))')
  if (string !== '') parts.push(`(?<s>${string})`)
  else parts.push(`(?<s>${dq})`)
  if (family === 'sh') parts.push('(?<v>\\$\\{[^}\\n]*\\}|\\$[A-Za-z_]\\w*|\\$[0-9@#?$!*-])')
  parts.push('(?<n>\\b(?:0[xX][\\da-fA-F_]+|0[bBoO][01_]+|\\d[\\d_]*(?:\\.\\d[\\d_]*)?(?:[eE][+-]?\\d+)?)\\b)')
  parts.push('(?<w>[A-Za-z_$][\\w$]*)')
  spec = { re: new RegExp(parts.join('|'), 'gm'), kw: new Set((HL_KW[family] ?? '').split(' ')), lit: new Set((HL_LIT[family] ?? '').split(' ')) }
  hlCache.set(family, spec)
  return spec
}
const HL_MAX_CHARS = 6000
const HL_MAX_LINES = 150
/** Colored runs [mark, text] (what the wire carries; the phone numbers them) for source in a language the scanner knows; null for any other, or a block too long to color. */
const scanRuns = (lang, code) => {
  const family = HL_LANG[String(lang ?? '').toLowerCase()]
  if (family === undefined || code.length > HL_MAX_CHARS || code.split('\n').length > HL_MAX_LINES) return null
  const { re, kw, lit } = hlSpec(family)
  const runs = []
  const add = (mark, v) => {
    if (v === '') return
    const last = runs[runs.length - 1]
    if (last && last.mark === mark) last.v += v
    else runs.push({ v, mark })
  }
  let pos = 0
  re.lastIndex = 0
  for (let m = re.exec(code); m !== null; m = re.exec(code)) {
    if (m[0] === '') { re.lastIndex += 1; continue }
    add('', code.slice(pos, m.index))
    pos = m.index + m[0].length
    const g = m.groups
    if (g.c !== undefined) add('c', m[0])
    else if (g.p !== undefined) add('p', m[0])
    else if (g.s !== undefined) add('s', m[0])
    else if (g.v !== undefined) add('v', m[0])
    else if (g.n !== undefined) add('n', m[0])
    else {
      const w = m[0]
      if (kw.has(w)) add('k', w)
      else if (lit.has(w)) add('l', w)
      else if (/^\s*\(/.test(code.slice(pos, pos + 8))) add('f', w)
      else if (/^[A-Z][A-Za-z0-9]*[a-z]/.test(w)) add('t', w)
      else add('', w)
    }
  }
  add('', code.slice(pos))
  return runs
}
export const highlightRuns = (lang, code) => scanRuns(lang, code)?.map((r) => [r.mark, r.v]) ?? null
/** The same [mark, text] runs split per line (a read card's numbered rows); null when the language is unknown or the block too long. */
export const highlightLines = (lang, lines) => {
  const runs = scanRuns(lang, lines.join('\n'))
  if (runs === null) return null
  const out = lines.map(() => [])
  let li = 0
  for (const r of runs) {
    r.v.split('\n').forEach((piece, k) => {
      if (k > 0) li += 1
      if (piece !== '' && out[li] !== undefined) out[li].push([r.mark, piece])
    })
  }
  return out
}

// ---- block parser ---------------------------------------------------------------------------------------------------
const indentOf = (line) => /^[ \t]*/.exec(line)[0].replace(/\t/g, '    ').length
const RE_FENCE = /^( {0,3})(`{3,}|~{3,})[ \t]*(.*?)[ \t]*$/
const RE_ATX = /^ {0,3}(#{1,6})(?:[ \t]+(.*?))?(?:[ \t]+#+)?[ \t]*$/
const RE_HR = /^ {0,3}([-*_])(?:[ \t]*\1){2,}[ \t]*$/
const RE_QUOTE = /^ {0,3}>/
const RE_ITEM = /^([ \t]*)([-*+]|\d{1,9}[.)])(?:[ \t]+(.*)|$)/
const RE_SETEXT = /^ {0,3}(=+|-+)[ \t]*$/
const RE_TABLE_RULE = /^[ \t]*\|?[ \t]*:?-+:?[ \t]*(?:\|[ \t]*:?-+:?[ \t]*)*\|?[ \t]*$/
const RE_MATH_DOLLAR = /^[ \t]*\$\$/
const RE_MATH_BRACKET = /^[ \t]*\\\[/
const BULLETS = ['•', '◦', '▪']
/** The cells of a table row: a pipe splits unless escaped; the outer pipes are optional. */
const tableCells = (row) => {
  let s = row.trim()
  if (s.startsWith('|')) s = s.slice(1)
  if (s.endsWith('|') && !s.endsWith('\\|')) s = s.slice(0, -1)
  const cells = []
  let cur = ''
  for (let i = 0; i < s.length; i += 1) {
    if (s[i] === '\\' && s[i + 1] === '|') { cur += '|'; i += 1 } else if (s[i] === '|') { cells.push(cur.trim()); cur = '' } else cur += s[i]
  }
  cells.push(cur.trim())
  return cells
}
const startsFence = (line) => { const m = RE_FENCE.exec(line); return m !== null && !(m[2][0] === '`' && m[3].includes('`')) }
/** A line that opens a block of its own (it ends a paragraph, a quote, a list item's lazy continuation). */
const opensBlock = (line) => startsFence(line) || RE_ATX.test(line) || RE_HR.test(line) || RE_QUOTE.test(line) || RE_MATH_DOLLAR.test(line)
/** A list item that may cut a paragraph short: a bullet, or an ordered item numbered 1 (CommonMark). */
const interruptsParagraph = (line) => { const m = RE_ITEM.exec(line); return m !== null && !RE_HR.test(line) && (m[3] ?? '') !== '' && (!/\d/.test(m[2]) || Number.parseInt(m[2], 10) === 1) }
const PRETTY_JSON_MAX = 20000

export const mdNodes = (src, opts = {}) => {
  const lines = String(src ?? '').replace(/\r\n?/g, '\n').split('\n')
  const nodes = []
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
  const pushCode = (info, body) => {
    const lang = (/^[^\s{]+/.exec(info) ?? [''])[0]
    let text = body.join('\n')
    // Desktop renders unified diffs in a fence layer; the phone colors the signs.
    if (/^(diff|patch|udiff)$/i.test(lang) || (lang === '' && body.length > 1 && body.filter((l) => /^[+-]/.test(l)).length > body.length / 2)) {
      push({ t: 'diff', v: '', items: body.slice(0, 400).map((l, k) => ({ id: `d${k}`, sign: l.startsWith('+') ? '+' : l.startsWith('-') ? '-' : ' ', v: truncate(l.slice(0, 200), 200) })) })
      return
    }
    // Desktop pipes math fences through KaTeX; the phone shows the TeX source as a display block.
    if (/^(math|latex|tex|katex)$/i.test(lang)) { push({ t: 'math', v: text }); return }
    // A minified JSON fence reads as an indented block (hand-formatted JSON is left as written).
    if (/^json[c5]?$/i.test(lang) && body.length === 1 && text.length > 40 && text.length <= PRETTY_JSON_MAX) {
      try { text = JSON.stringify(JSON.parse(text), null, 2) } catch { /* not JSON: shown as written */ }
    }
    const runs = opts.highlight === false ? null : highlightRuns(lang, text)
    push({ t: 'code', lang, v: text, ...(runs ? { runs } : {}) })
  }
  /** A list: items carry their depth, marker (bullet by depth, the source's own ordered number, a task box) and continuation lines. */
  const parseList = (start) => {
    const items = []
    const levels = []
    const counters = []
    let i = start
    let cur = null
    let rootKind = null
    for (; i < lines.length;) {
      const line = lines[i]
      if (line.trim() === '') {
        let j = i + 1
        while (j < lines.length && lines[j].trim() === '') j += 1
        if (j >= lines.length || cur === null) break
        const next = lines[j]
        if (RE_ITEM.test(next) && !RE_HR.test(next)) { i = j; continue }
        if (indentOf(next) > cur.indent && !opensBlock(next) && !startsFence(next.trim())) { cur.raw += `\n\n${next.trim()}`; i = j + 1; continue }
        break
      }
      const m = RE_ITEM.exec(line)
      if (m !== null && !RE_HR.test(line) && indentOf(line) < 4 * (levels.length + 1)) {
        const indent = indentOf(m[1])
        while (levels.length > 0 && indent < levels[levels.length - 1]) levels.pop()
        if (levels.length === 0 || indent >= levels[levels.length - 1] + 2) levels.push(indent)
        const d = Math.min(levels.length - 1, 5)
        counters.length = Math.min(counters.length, d + 1)
        const ordered = /\d/.test(m[2])
        // a new kind of list at the top level (bullets after numbers, or the reverse) is another list
        if (d === 0) {
          if (rootKind === null) rootKind = ordered
          else if (rootKind !== ordered) break
        }
        let mark
        if (ordered) {
          counters[d] = counters[d] === undefined ? Number.parseInt(m[2], 10) : counters[d] + 1
          mark = `${counters[d]}.`
        } else {
          counters[d] = undefined
          mark = BULLETS[Math.min(d, 2)]
        }
        let text = m[3] ?? ''
        let sign = ' '
        const task = /^\[([ xX])\][ \t]+(.*)$/.exec(text)
        if (task !== null) { sign = task[1] === ' ' ? 'o' : 'x'; mark = sign === 'x' ? '☑' : '☐'; text = task[2] }
        cur = { id: `i${items.length}`, raw: text, mark, d, sign, indent }
        items.push(cur)
        i += 1
        continue
      }
      if (cur === null || opensBlock(line) || RE_ATX.test(line)) break
      // A continuation line: indented under the item, or a lazy line right after it.
      if (indentOf(line) > cur.indent || lines[i - 1].trim() !== '') { cur.raw += `\n${line.trim()}`; i += 1; continue }
      break
    }
    return { items: items.map(({ id, raw, mark, d, sign }) => ({ id, v: inlineMd(raw), mark, d, sign })), end: i, ordered: items.length > 0 && /\d/.test(/^[ \t]*(\S+)/.exec(lines[start])[1]) }
  }
  let i = 0
  while (i < lines.length) {
    const line = lines[i]
    if (line.trim() === '') { i += 1; continue }
    // fenced code: any length, closed by a fence of the same character at least as long; unclosed runs to the end
    const fence = RE_FENCE.exec(line)
    if (fence !== null && !(fence[2][0] === '`' && fence[3].includes('`'))) {
      const body = []
      const close = new RegExp(`^ {0,3}${fence[2][0] === '`' ? '`' : '~'}{${fence[2].length},}[ \\t]*$`)
      const strip = fence[1].length
      i += 1
      while (i < lines.length && !close.test(lines[i])) { body.push(strip > 0 ? lines[i].replace(new RegExp(`^ {0,${strip}}`), '') : lines[i]); i += 1 }
      i += 1
      pushCode(fence[3], body)
      continue
    }
    // display math: $$ … $$ or \[ … \], on one line or over several
    if (RE_MATH_DOLLAR.test(line) || RE_MATH_BRACKET.test(line)) {
      const open = line.trim().startsWith('$$') ? '$$' : '\\['
      const close = open === '$$' ? '$$' : '\\]'
      const first = line.trim().slice(2)
      const at = first.indexOf(close)
      if (at >= 0) { if (first.slice(at + 2).trim() === '') { push({ t: 'math', v: first.slice(0, at).trim() }); i += 1; continue } } else {
        const body = [first]
        let j = i + 1
        while (j < lines.length && !lines[j].includes(close)) { body.push(lines[j]); j += 1 }
        if (j < lines.length) {
          body.push(lines[j].slice(0, lines[j].indexOf(close)))
          push({ t: 'math', v: body.join('\n').trim() })
          i = j + 1
          continue
        }
      }
    }
    const atx = RE_ATX.exec(line)
    if (atx !== null) { push({ t: 'h', lvl: atx[1].length, v: inlineMd((atx[2] ?? '').trim()) }); i += 1; continue }
    if (RE_HR.test(line)) { push({ t: 'hr' }); i += 1; continue }
    if (RE_QUOTE.test(line)) {
      const body = []
      while (i < lines.length && lines[i].trim() !== '' && (RE_QUOTE.test(lines[i]) || (body.length > 0 && !opensBlock(lines[i]) && !RE_ITEM.test(lines[i])))) {
        body.push(lines[i].replace(/^ {0,3}> ?/, ''))
        i += 1
      }
      push({ t: 'quote', v: inlineMd(body.join('\n')) })
      continue
    }
    // GFM table: a header row, then a delimiter row with as many cells
    if (line.includes('|') && lines[i + 1] !== undefined && RE_TABLE_RULE.test(lines[i + 1]) && lines[i + 1].includes('-')) {
      const head = tableCells(line)
      const rule = tableCells(lines[i + 1])
      if (head.length === rule.length && rule.every((c) => /^:?-+:?$/.test(c))) {
        const cols = head.length
        const align = rule.map((c) => (c.startsWith(':') ? (c.endsWith(':') ? 'c' : 'l') : c.endsWith(':') ? 'r' : '-')).join('')
        const rows = []
        i += 2
        while (i < lines.length && lines[i].trim() !== '' && lines[i].includes('|') && !opensBlock(lines[i])) {
          const cells = tableCells(lines[i])
          cells.length = cols
          rows.push({ id: `r${rows.length}`, v: Array.from(cells, (c) => inlineMd(c ?? '')).join(US) })
          i += 1
        }
        push({ t: 'table', cols, align, head: head.map(inlineMd).join(US), rows })
        continue
      }
    }
    const item = RE_ITEM.exec(line)
    if (item !== null && indentOf(line) < 4) {
      const list = parseList(i)
      if (list.items.length > 0) { push({ t: list.ordered ? 'ol' : 'ul', items: list.items }); i = Math.max(list.end, i + 1); continue }
    }
    if (indentOf(line) >= 4) {
      const body = []
      while (i < lines.length && (lines[i].trim() === '' ? (lines[i + 1] !== undefined && indentOf(lines[i + 1]) >= 4 && lines[i + 1].trim() !== '') : indentOf(lines[i]) >= 4)) {
        body.push(lines[i].replace(/^(?: {1,4}|\t)/, ''))
        i += 1
      }
      pushCode('', body)
      continue
    }
    // a paragraph (a setext underline makes it a heading); image-only lines become image nodes
    const para = []
    let setext = 0
    while (i < lines.length && lines[i].trim() !== '') {
      const l = lines[i]
      if (para.length > 0 && RE_SETEXT.test(l)) { setext = l.trim()[0] === '=' ? 1 : 2; i += 1; break }
      if (para.length > 0 && (opensBlock(l) || interruptsParagraph(l) || (l.includes('|') && lines[i + 1] !== undefined && RE_TABLE_RULE.test(lines[i + 1]) && lines[i + 1].includes('-') && tableCells(l).length === tableCells(lines[i + 1]).length))) break
      para.push(l)
      i += 1
    }
    if (para.length === 0) { i += 1; continue }
    if (setext > 0) { push({ t: 'h', lvl: setext, v: inlineMd(para.map((l) => l.trim()).join(' ')) }); continue }
    const buf = []
    const flush = () => {
      if (buf.length > 0) push({ t: 'p', v: inlineMd(buf.join('\n')) })
      buf.length = 0
    }
    for (const l of para) {
      const only = l.trim().match(/^!\[([^\]]*)\]\(\s*<?([^)>\s]+)>?\s*\)$/)
      if (only) { flush(); pushImg(only[1], only[2]) } else buf.push(l)
    }
    flush()
  }
  return nodes
}

// Credential masking (parity with ui-secret-mask): a value is recognised by its published
// format alone (provider key prefixes, JWTs, private key blocks, the password of a URL that
// carries credentials); free-form passwords and name=value text stay plain. A masked range is
// the official MASK character (`*`), one per hidden character (at most MASK_MAX), so the stub
// says nothing in any language; a prefixed key keeps its first VISIBLE_PREFIX characters.
const MASK_MAX = 64
const VISIBLE_PREFIX = 8
const stars = (n) => '*'.repeat(Math.max(0, Math.min(n, MASK_MAX)))
const SECRET_PATTERNS = [
  /\bsk-[A-Za-z0-9_-]{12,}/g,
  /\bgh[pousr]_[A-Za-z0-9]{20,}/g,
  /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g,
  /\bxox[abprs]-[A-Za-z0-9-]{10,}/g,
  /\bAIza[0-9A-Za-z_-]{30,}/g,
  /\bgithub_pat_[A-Za-z0-9_]{22,}/g,
  /\bglpat-[A-Za-z0-9_-]{20,}/g,
  /\bnpm_[A-Za-z0-9]{36,}/g,
  /\bhf_[A-Za-z0-9]{30,}/g,
  /\bLTAI[A-Za-z0-9]{12,20}\b/g,
  /\bAKID[A-Za-z0-9]{28,36}\b/g,
  /\b(?:sk|rk)_(?:live|test)_[A-Za-z0-9]{16,}/g,
  /\bwhsec_[A-Za-z0-9]{24,}/g,
  /\beyJ[A-Za-z0-9_-]{8,2048}\.eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g,
]
const PRIVATE_KEY = /-----BEGIN [A-Z0-9 ]{0,40}PRIVATE KEY-----[\s\S]*?(?:-----END [A-Z0-9 ]{0,40}PRIVATE KEY-----|$)/g
const URL_PASSWORD = /(\b[a-z][a-z0-9+.-]{1,15}:\/\/[^\s/:@?#]{0,256}:)[^\s/@?#]+(?=@)/g
const maskSecrets = (s) => {
  const text = String(s ?? '')
  const keyBlock = text.includes('-----BEGIN ')
  const address = text.includes('://')
  if (!keyBlock && !address && !/[A-Za-z0-9_-]{16,}/.test(text)) return text
  let out = text
  if (keyBlock) {
    // Keep the BEGIN and END lines, mask the body.
    out = out.replace(PRIVATE_KEY, (m) => {
      const body = m.indexOf('\n') + 1
      const end = m.lastIndexOf('\n-----END')
      const to = end < body ? m.length : end
      return `${m.slice(0, body)}${stars(to - body)}${m.slice(to)}`
    })
  }
  if (address) out = out.replace(URL_PASSWORD, (whole, head) => `${head}${stars(whole.length - head.length)}`)
  for (const re of SECRET_PATTERNS) out = out.replace(re, (m) => `${m.slice(0, VISIBLE_PREFIX)}${stars(m.length - VISIBLE_PREFIX)}`)
  return out
}


// ---- tool cards -----------------------------------------------------------------------------------------------------
// (ui-tool tool/models/{tool-call-model,terminal-card-model,read-card-model,search-card-model,web-card-model,diff-card-model,
// image-card-model,todo-diff-model,details-card-model,control-details-model,auto-review-denial}.ts and toolviews/*, rc.3.)
// Rows carry a localized title, a one-line summary and the settled facts of the collapsed row (exit label, +/- totals, KB);
// the card a tap opens is `toolView`, built from the call index at request time (GET /v1/sessions/:id/call) so a poll never pays for it.
const VARIANT = {
  bash: 'bash', pwsh: 'bash', read: 'read', read_image: 'read', web_fetch: 'read', web_search: 'search', grep: 'search', glob: 'search',
  write: 'write', edit: 'edit', apply_patch: 'edit', run_code: 'code', cua_run_code: 'code', cordis_package_inspect: 'read', cordis_runtime_inspect: 'read',
}
const VARIANT_TITLE = { search: 'tool.title.search', read: 'tool.title.read', bash: 'tool.title.bash', write: 'tool.title.write', edit: 'tool.title.edit', code: 'tool.title.code', others: 'tool.title.generic' }
const TOOL_TITLE = {
  apply_patch: 'tool.title.applyPatch', cordis_package_inspect: 'tool.title.inspect', cordis_runtime_inspect: 'tool.title.inspect', cordis_run: 'tool.title.runCordis',
  cordis_stop: 'tool.title.stopCordis', cordis_undefine: 'tool.title.removeCordis', pwsh: 'tool.title.pwsh', read_image: 'tool.title.readImage', todo_write: 'todo.rowTitle',
  todo: 'todo.rowTitle', ask_user_question: 'ask.rowTitle', create_goal: 'tool.title.createGoal', get_goal: 'tool.title.getGoal', update_goal: 'tool.title.updateGoal',
  schedule_create: 'tool.title.createSchedule', schedule_list: 'tool.title.listSchedules', schedule_view: 'tool.title.viewSchedule', schedule_edit: 'tool.title.editSchedule',
  schedule_delete: 'tool.title.deleteSchedule', schedule_update: 'tool.title.updateSchedule', cordis_inspect_list: 'tool.title.inspectProviders',
  cordis_inspect_query: 'tool.title.queryRuntime', cordis_inspect_self: 'tool.title.inspectPlugins', workflow: 'tool.title.workflow', ralph: 'tool.title.ralph',
  session_event_read: 'tool.title.readEvent', session_event_search: 'tool.title.searchEvents', session_event_trace: 'tool.title.traceEvent', session_search: 'tool.title.searchSessions',
  session_trace: 'tool.title.traceSession', list_subagent_models: 'tool.title.listModels', subagent: 'tool.title.subagent', subagent_fork: 'tool.title.subagentFork',
  list_agents: 'tool.title.listAgents', send_message: 'tool.title.sendMessage', interrupt_agent: 'tool.title.interruptAgent', job_list: 'tool.title.listJobs',
  job_output: 'tool.title.readJob', job_kill: 'tool.title.killJob', terminal_open: 'tool.title.openTerminal', terminal_read: 'tool.title.readTerminal',
  terminal_list: 'tool.title.listTerminals', terminal_signal: 'tool.title.signalTerminal', terminal_close: 'tool.title.closeTerminal', lsp: 'tool.title.lsp',
  spawn_teammate: 'tool.title.spawnTeammate', team_task_create: 'tool.title.createTeamTask', team_task_get: 'tool.title.getTeamTask', team_task_update: 'tool.title.updateTeamTask',
  team_task_list: 'tool.title.listTeamTasks', wait_agent: 'tool.title.waitAgent',
  // the toolview rows' own titles (search-row, web-row, office-row)
  grep: 'tool.title.grep', glob: 'tool.title.glob', web_search: 'tool.title.webSearch', web_fetch: 'tool.title.webFetch', office_render: 'tool.title.officeRender',
  office_convert: 'tool.title.officeConvert', office_recalculate: 'tool.title.officeRecalculate',
}
const LSP_TITLE = { goToDefinition: 'tool.title.findDefinition', findReferences: 'tool.title.findReferences', goToImplementation: 'tool.title.findImplementation', hover: 'tool.title.hoverSymbol' }
const SUMMARY_KEYS = { bash: ['description', 'command'], read: ['path', 'file_path', 'url'], search: ['query', 'pattern', 'url'], write: ['path', 'file_path'], edit: ['path', 'file_path'], code: ['description'], others: [] }
const toolVariant = (name) => VARIANT[name] ?? 'others'
const toolTitleKey = (name, parsed) => (name === 'lsp' && typeof parsed?.operation === 'string' && LSP_TITLE[parsed.operation]) || TOOL_TITLE[name] || VARIANT_TITLE[toolVariant(name)]
const toolTitle = (lang, name, parsed) => copy(lang, toolTitleKey(name, parsed))

const oneLine = (s) => { const t = String(s ?? ''); const nl = t.indexOf('\n'); return nl === -1 ? t : t.slice(0, nl) }
/** relativizeToCwd + abbreviateHomePath: a workspace path shows relative, the home directory as ~. */
const displayPath = (p, env) => {
  let out = String(p)
  const cwd = env?.cwd ? String(env.cwd).replace(/[/\\]+$/, '') : ''
  if (cwd !== '' && (out.startsWith(`${cwd}/`) || out.startsWith(`${cwd}\\`))) out = out.slice(cwd.length + 1)
  const home = env?.home ? String(env.home).replace(/\/+$/, '') : ''
  if (home !== '' && home !== '/' && !/^[a-zA-Z]:|\\/.test(out)) {
    if (out.replace(/\/+$/, '') === home) return '~'
    if (out.startsWith(`${home}/`)) return `~${out.slice(home.length)}`
  }
  return out
}
const parseArgsObject = (raw) => {
  if (raw !== null && typeof raw === 'object') return raw
  try { const v = JSON.parse(String(raw)); return v !== null && typeof v === 'object' && !Array.isArray(v) ? v : null } catch { return null }
}
/** The files a patch's headers name (`*** Add File: p`, `*** Update File: p` + `*** Move to: q`, `*** Delete File: p`). */
const patchTargets = (input) => {
  const out = []
  for (const line of String(input ?? '').split('\n')) {
    const m = /^\*\*\* (Add File|Update File|Delete File|Move to):\s*(\S.*?)\s*$/.exec(line)
    if (!m) continue
    if (m[1] === 'Move to' && out.length > 0) out[out.length - 1].to = m[2]
    else out.push({ path: m[2] })
  }
  return out
}
/** The row's one-line summary (tool-call-model.ts toolRowModel): a path for file tools, the description, else the first readable argument. */
const toolSummary = (lang, name, parsed, rawArgs, env, callId) => {
  const variant = toolVariant(name)
  const generic = toolTitleKey(name, parsed) === 'tool.title.generic'
  let base = ''
  if (name === 'apply_patch') {
    base = patchTargets(parsed?.input).map((t) => (t.to ? `${displayPath(t.path, env)} → ${displayPath(t.to, env)}` : displayPath(t.path, env))).join(', ')
  } else if (name === 'terminal_send' && typeof parsed?.sessionId === 'string' && parsed.sessionId !== '' && typeof parsed.text === 'string') {
    base = copy(lang, 'terminal.session', { sessionId: parsed.sessionId })
  } else if (parsed && (variant === 'read' || variant === 'write' || variant === 'edit') && typeof parsed.file_path === 'string' && parsed.file_path !== '') {
    base = displayPath(oneLine(parsed.file_path), env)
  } else if (parsed && typeof parsed.description === 'string' && parsed.description !== '') {
    base = oneLine(parsed.description)
  } else if (rawArgs === '' || rawArgs == null) {
    base = String(callId ?? '')
  } else if (parsed === null) {
    base = displayPath(oneLine(rawArgs), env)
  } else {
    let picked
    if (variant === 'search' && Array.isArray(parsed.queries)) {
      const qs = parsed.queries.filter((q) => typeof q === 'string' && q !== '')
      if (qs.length > 0) picked = qs.map(oneLine).join(', ')
    }
    if (picked === undefined) for (const k of SUMMARY_KEYS[variant]) if (typeof parsed[k] === 'string' && parsed[k] !== '') { picked = oneLine(parsed[k]); break }
    if (picked === undefined) { const first = Object.values(parsed).find((v) => typeof v === 'string' && v !== ''); picked = first ? oneLine(first) : oneLine(JSON.stringify(parsed)) }
    base = displayPath(picked, env)
  }
  // The official row reads `工具调用 · name · base` for a generic tool; the phone shows the wire name beside the title, so the summary is the base alone.
  return truncate(generic && base === '' ? name : base, 160)
}

// ---- the card's wire shapes -------------------------------------------------------------------------------------------
// view {kind, head, tone, parts[]}; part {id, kind: cmd | lines | items | text | note, label, badge, tone, text, fold, lines[], items[]};
// line {id, n (gutter number, 0 none), sign (' ' '+' '-' '@' '#' header, '…' marker), text, runs?}; item {id, title, subtitle, badge, tone, text, link, group, fields[], lines[]}.
const FOLD = 40
const LINES_CAP = 400
const LINE_CHARS = 700
// eslint-disable-next-line no-control-regex
const ANSI_RE = /\u001b(?:\[[0-?]*[ -/]*[@-~]|\][^\u0007\u001b]*(?:\u0007|\u001b\\)|[@-Z\\-_])/g
const plainText = (s) => String(s ?? '').replace(ANSI_RE, '').replace(/[^\n]*\r(?!\n)/g, '')
const splitLines = (text) => {
  const s = String(text ?? '')
  return s === '' ? [] : (s.endsWith('\n') ? s.slice(0, -1) : s).split('\n')
}
/** Numbered or plain lines, capped: past LINES_CAP the rest is one marker line saying how many were left out. */
const lineList = (lang, rows, markerKey) => {
  const out = rows.slice(0, LINES_CAP).map((l, i) => ({ id: `l${i}`, n: l.n ?? 0, sign: l.sign ?? ' ', text: truncate(l.text, LINE_CHARS), ...(l.runs ? { runs: l.runs } : {}) }))
  if (rows.length > LINES_CAP) out.push({ id: `l${out.length}`, n: 0, sign: '…', text: copy(lang, markerKey ?? 'terminal.expandRest', { n: rows.length - LINES_CAP }) })
  return out
}
const part = (kind, id, o = {}) => ({ id, kind, ...o })
const linesPart = (lang, id, label, rows, o = {}) => part('lines', id, { label, ...(o.badge ? { badge: o.badge } : {}), ...(o.tone ? { tone: o.tone } : {}), ...(o.link ? { link: o.link } : {}), fold: o.fold ?? FOLD, lines: lineList(lang, rows, o.markerKey) })

const EXIT_RE = /\n\[exit code: (-?\d+|null)\]$/
const SIGNAL_RE = /\n\[killed by signal: ([^\]\n]+)\]$/
/** A shell result split into output and exit status (terminal-card-model.ts parseExitStatus): no marker reads as exit 0. */
const exitStatus = (text) => {
  const sig = SIGNAL_RE.exec(text)
  if (sig) return { output: text.slice(0, sig.index), signal: sig[1] }
  const ex = EXIT_RE.exec(text)
  if (ex) return { output: text.slice(0, ex.index), exitCode: ex[1] === 'null' ? null : Number(ex[1]) }
  return { output: text, exitCode: 0 }
}
const exitLabel = (lang, st) => (st.signal !== undefined ? copy(lang, 'terminal.signal', { signal: st.signal })
  : st.exitCode === null || st.exitCode === undefined ? copy(lang, 'terminal.noExitCode')
    : st.exitCode !== 0 ? copy(lang, 'terminal.exitCode', { code: st.exitCode }) : null)

const SHELLS = new Set(['bash', 'pwsh', 'shell'])
/** The shell call a terminal card can show: the command, whether it is a persistent shell (no description) or a background launch. */
const shellCall = (name, parsed) => {
  if (!SHELLS.has(name) || !parsed || typeof parsed.command !== 'string' || parsed.command.trim() === '') return null
  const persistent = parsed.description === undefined && name !== 'shell'
  return { command: parsed.command, persistent, background: !persistent && parsed.run_in_background === true, workdir: typeof parsed.workdir === 'string' ? parsed.workdir : undefined }
}
const promptLabel = (cwd, home) => {
  const trimmed = String(cwd).replace(/[/\\]+$/, '')
  if (home && trimmed === String(home).replace(/[/\\]+$/, '')) return '~'
  const seg = trimmed.split(/[/\\]/).pop()
  return seg === undefined || seg === '' ? String(cwd) : seg
}
/** terminal_send: the text sent (or （发送输入）), no exit status (terminalCardModel's terminal-send kind); a background send is the generic card. */
const terminalSendView = (lang, F, st) => {
  const p = F.parsed
  if (!p || typeof p.sessionId !== 'string' || p.sessionId === '' || typeof p.text !== 'string' || p.run_in_background === true) return null
  const settled = F.result !== undefined
  if (settled && st.isError) return null
  const cmd = part('cmd', 'c', { label: '', text: maskSecrets(p.text === '' ? copy(lang, 'terminal.sendInput') : p.text) })
  if (!settled) return { kind: 'terminal', head: '', tone: '', parts: [{ ...cmd, badge: copy(lang, 'terminal.running') }] }
  const out = splitLines(maskSecrets(plainText(F.result)))
  return { kind: 'terminal', head: '', tone: '', parts: [cmd, out.length === 0 ? part('note', 'o', { text: copy(lang, 'terminal.noOutput') }) : linesPart(lang, 'o', '', out.map((text) => ({ text })))] }
}
/** The terminal view of a bash / pwsh call: the command with its working directory and status, then the output; null for the generic card. */
const terminalView = (lang, name, F, st) => {
  if (name === 'terminal_send') return terminalSendView(lang, F, st)
  const call = shellCall(name, F.parsed)
  if (call === null) return null
  const settled = F.result !== undefined
  if (settled && (st.isError || call.persistent)) return null
  const cwd = (typeof F.meta?.cwd === 'string' && F.meta.cwd !== '' ? F.meta.cwd : undefined) ?? (call.workdir && !/^[\\/]/.test(call.workdir) && F.env?.cwd ? `${F.env.cwd}/${call.workdir}` : call.workdir) ?? F.env?.cwd
  const parts = [part('cmd', 'c', { label: cwd ? promptLabel(cwd, F.env?.home) : '', text: maskSecrets(call.command) })]
  if (!settled) return { kind: 'terminal', head: '', tone: '', parts: [{ ...parts[0], badge: copy(lang, 'terminal.running') }] }
  if (call.background) return { kind: 'terminal', head: '', tone: '', parts }
  const status = exitStatus(String(F.result))
  const label = exitLabel(lang, status)
  if (label !== null) { parts[0].badge = label; parts[0].tone = 'error' }
  const out = splitLines(maskSecrets(plainText(status.output)))
  parts.push(out.length === 0 ? part('note', 'o', { text: copy(lang, 'terminal.noOutput') }) : linesPart(lang, 'o', '', out.map((text) => ({ text }))))
  return { kind: 'terminal', head: '', tone: label === null ? '' : 'error', parts }
}

const validLines = (lines, total, offset) => {
  if (!Array.isArray(lines)) return null
  let prev = offset - 1
  const out = []
  for (const l of lines) {
    if (!l || !Number.isInteger(l.number) || l.number < 1 || l.number <= prev || l.number > total || typeof l.text !== 'string') return null
    prev = l.number
    out.push(l)
  }
  return out
}
/** The read view (read-card-model.ts): the file's window with line numbers, "显示 X / Y 行" when it is only part of the file. */
const readView = (lang, F) => {
  const meta = F.meta
  const call = F.parsed
  if (!call || typeof call.file_path !== 'string' || call.file_path.trim() === '' || F.result === undefined || F.isError) return null
  if (!meta || typeof meta.path !== 'string' || !Number.isInteger(meta.offset) || meta.offset < 1 || !Number.isInteger(meta.totalLines) || meta.totalLines < 0) return null
  const lines = validLines(meta.lines, meta.totalLines, meta.offset)
  if (lines === null) return null
  const runs = typeof meta.lang === 'string' && lines.length > 0 ? highlightLines(meta.lang, lines.map((l) => maskSecrets(l.text))) : null
  const rows = lines.map((l, i) => ({ n: l.number, text: maskSecrets(l.text), ...(runs ? { runs: runs[i] } : {}) }))
  const badge = lines.length < meta.totalLines ? copy(lang, 'read.window', { shown: lines.length, total: meta.totalLines }) : ''
  return { kind: 'read', head: '', tone: '', parts: [linesPart(lang, 'r', displayPath(meta.path, F.env), rows, { badge, link: meta.path, markerKey: 'read.expandRest' })] }
}

/** The search view (search-card-model.ts): grep matches grouped by file, glob paths, with the truncation and empty states. */
const searchView = (lang, name, F) => {
  const meta = F.meta
  if (F.result === undefined || F.isError || !F.parsed || !meta || typeof meta !== 'object' || typeof meta.truncated !== 'boolean' || !Number.isInteger(meta.total) || meta.total < 0) return null
  let rows
  let head
  if (name === 'grep' && meta.shape === 'matches' && Array.isArray(meta.files)) {
    rows = []
    let shown = 0
    for (const f of meta.files) {
      if (!f || typeof f.path !== 'string' || !Array.isArray(f.matches)) return null
      rows.push({ sign: '#', text: displayPath(f.path, F.env) })
      for (const m of f.matches) { rows.push({ n: Number(m?.lineNumber) || 0, text: maskSecrets(String(m?.line ?? '')) }); shown += 1 }
    }
    head = meta.truncated ? copy(lang, 'search.matches.truncated', { shown, total: meta.total, files: meta.files.length }) : copy(lang, 'search.matches', { shown, files: meta.files.length })
  } else if (name === 'glob' && meta.shape === 'paths' && Array.isArray(meta.paths) && meta.paths.every((p) => typeof p === 'string')) {
    rows = meta.paths.map((p) => ({ text: displayPath(p, F.env) }))
    head = meta.truncated ? copy(lang, 'search.paths.truncated', { shown: rows.length, total: meta.total }) : copy(lang, 'search.paths', { shown: rows.length })
  } else return null
  const parts = rows.length === 0 ? [part('note', 'n', { text: copy(lang, 'search.noResults') })] : [linesPart(lang, 's', '', rows, { markerKey: 'search.expandRest' })]
  // a capped search's locator lives only in the result text
  if (meta.truncated && typeof F.result === 'string') parts.push(part('text', 'z', { text: truncate(maskSecrets(F.result), 1500) }))
  return { kind: 'search', head, tone: '', parts }
}

/** The web view (web-card-model.ts + WebBlock): a search's answer and sources, a fetch's URL, HTTP status and truncation. */
const webView = (lang, name, F) => {
  const meta = F.meta
  if (F.result === undefined || F.isError || !F.parsed || !meta || typeof meta !== 'object' || typeof meta.truncated !== 'boolean') return null
  if (name === 'web_search') {
    if (!Array.isArray(meta.sources) || !meta.sources.every((s) => s && typeof s.url === 'string')) return null
    const parts = []
    if (typeof meta.answer === 'string' && meta.answer !== '') parts.push(part('text', 'a', { text: maskSecrets(truncate(meta.answer, 4000)), md: true }))
    const items = meta.sources.slice(0, 40).map((s, i) => ({
      id: `s${i}`, title: s.title ? String(s.title) : (() => { try { return new URL(s.url).hostname || s.url } catch { return s.url } })(),
      subtitle: typeof s.publishedAt === 'string' ? s.publishedAt : '', text: typeof s.snippet === 'string' ? truncate(s.snippet, 400) : '', link: /^https?:\/\//i.test(s.url) ? s.url : '',
    }))
    if (items.length > 0) parts.push(part('items', 'i', { items }))
    if (meta.truncated) parts.push(part('note', 't', { text: copy(lang, 'web.sourcesTruncated') }))
    if (parts.length === 0) parts.push(part('note', 'n', { text: copy(lang, 'web.noResults') }))
    return { kind: 'web', head: '', tone: '', parts }
  }
  if (name === 'web_fetch') {
    if (typeof meta.url !== 'string' || !Number.isInteger(meta.statusCode)) return null
    const parts = [part('text', 'u', { text: meta.url, label: `${copy(lang, 'web.http')} ${meta.statusCode}`, link: /^https?:\/\//i.test(meta.url) ? meta.url : '' })]
    if (meta.truncated) parts.push(part('note', 't', { text: copy(lang, 'web.contentTruncated') }))
    return { kind: 'web', head: '', tone: '', parts }
  }
  return null
}

/** The diff view (diff-card-model.ts): the applied hunks of the result, or what a write / edit call intends while it runs. */
const diffHunks = (name, F) => {
  const p = F.parsed
  const applied = Array.isArray(F.diff) && F.diff.length > 0 && F.diff.every((d) => d && typeof d.path === 'string' && typeof d.newText === 'string') ? F.diff : null
  if (F.result !== undefined && F.isError) return null
  if (applied !== null) return applied
  if (!p || typeof p.file_path !== 'string' || p.file_path.trim() === '') return null
  if (name === 'write' && typeof p.content === 'string') return [{ path: p.file_path, oldText: null, newText: p.content }]
  if (name === 'edit' && typeof p.old_string === 'string' && typeof p.new_string === 'string') return [{ path: p.file_path, oldText: p.old_string || null, newText: p.new_string }]
  return null
}
const diffView = (lang, name, F) => {
  const hunks = diffHunks(name, F)
  if (hunks === null) return null
  const files = diffFiles(hunks)
  const parts = files.map((f, i) => linesPart(lang, `d${i}`, displayPath(f.path, F.env), f.lines.map((l) => ({ sign: l.sign, text: maskSecrets(l.text) })), { badge: `+${f.added} −${f.removed}`, link: f.path, markerKey: 'diff.expandRest' }))
  const more = diffHidden(hunks)
  return { kind: 'diff', head: '', tone: '', parts, more }
}

/** The input / output card of every call no richer view claims (row.input / row.output). */
const ioView = (lang, name, F, st) => {
  const parts = []
  const call = F.parsed
  const single = ['read', 'write', 'edit'].includes(toolVariant(name)) && typeof call?.file_path === 'string'
  if (!single) {
    const code = toolVariant(name) === 'code' && typeof call?.code === 'string' && call.code !== '' ? call.code : null
    const body = code ?? F.args
    if (body !== undefined && body !== '') {
      const runs = code !== null ? highlightLines('ts', splitLines(code).map(maskSecrets)) : null
      parts.push(linesPart(lang, 'in', code !== null ? '' : copy(lang, 'row.input'), splitLines(maskSecrets(body)).map((text, i) => ({ text, ...(runs ? { runs: runs[i] } : {}) }))))
    }
  }
  if (F.result !== undefined && F.result !== '') parts.push(linesPart(lang, 'out', copy(lang, 'row.output'), splitLines(maskSecrets(plainText(F.result))).map((text) => ({ text })), { tone: st.status === 'error' ? 'error' : '' }))
  return { kind: 'io', head: '', tone: '', parts }
}
const autoReviewView = (lang, F) => {
  const reason = typeof F.err?.reason === 'string' && F.err.reason.trim() !== '' ? F.err.reason.trim().replace(/[\r\n\u2028\u2029]+/g, ' ') : copy(lang, 'tool.autoReviewReasonFallback')
  return { kind: 'io', head: '', tone: 'error', parts: [linesPart(lang, 'out', copy(lang, 'row.output'), [{ text: copy(lang, 'tool.autoReviewNotExecuted', { reason }) }], { tone: 'error' })] }
}

/** The image card (image-card-model.ts): the path, each image's size (and the size it was downscaled from), any extra text; the pictures are the row's `images`. */
const imageView = (lang, F) => {
  if (F.result === undefined || F.isError || !Array.isArray(F.imageRefs) || F.imageRefs.length === 0) return null
  const sizes = F.imageRefs.map((r) => (r.originalWidth ? copy(lang, 'row.imageSizeDownscaled', { width: r.width, height: r.height, originalWidth: r.originalWidth, originalHeight: r.originalHeight, bytes: r.bytes })
    : copy(lang, 'row.imageSize', { width: r.width, height: r.height, bytes: r.bytes })))
  const path = typeof F.meta?.path === 'string' ? F.meta.path : typeof F.parsed?.file_path === 'string' ? F.parsed.file_path : ''
  const parts = [part('text', 'p', { text: [path, ...sizes].filter(Boolean).join('\n') })]
  const extra = String(F.result ?? '').replace(/^<path>[^\n]*<\/path>\n<type>image<\/type>\n<content>\n[\s\S]*?\n<\/content>/, '').trim()
  if (extra !== '') parts.push(part('text', 'x', { text: truncate(maskSecrets(extra), 800) }))
  return { kind: 'image', head: '', tone: '', parts }
}

// ---- structured detail cards (details-card-model, control-details-model) -------------------------------------------------
const dRec = (v) => v !== null && typeof v === 'object' && !Array.isArray(v)
const dStr = (v) => typeof v === 'string' && v.trim() !== ''
const dCount = (v) => Number.isSafeInteger(v) && v >= 0
const dJson = (text) => { try { return JSON.parse(text) } catch { return undefined } }
const BADGE_KEY = {
  corrupt: 'detail.status.corrupt', unsupported: 'detail.status.unsupported', unavailable: 'detail.status.unavailable', running: 'detail.status.running', idle: 'detail.status.idle',
  ready: 'detail.status.ready', inactive: 'detail.status.inactive', provisioning: 'detail.status.provisioning', failed: 'detail.status.failed', error: 'detail.status.failed',
  completed: 'detail.status.completed', complete: 'detail.status.completed', done: 'detail.status.completed', pending: 'detail.todo.pending', in_progress: 'detail.todo.in_progress',
  deleted: 'detail.status.deleted', killed: 'detail.status.killed', blocked: 'detail.goal.blocked', accepted: 'detail.status.accepted', queued: 'detail.status.queued',
}
const badgeOf = (lang, status) => ({
  label: Object.hasOwn(BADGE_KEY, status) ? copy(lang, BADGE_KEY[status]) : String(status),
  tone: ['completed', 'complete', 'done', 'accepted'].includes(status) ? 'success' : ['failed', 'error'].includes(status) ? 'error'
    : ['blocked', 'killed', 'pending', 'queued', 'inactive'].includes(status) ? 'warning' : ['running', 'in_progress', 'provisioning'].includes(status) ? 'info' : 'neutral',
})
const FIELD_KEY = {
  id: 'detail.field.id', revision: 'detail.field.revision', platform: 'detail.field.platform', provider: 'detail.field.provider', model: 'detail.field.model', role: 'detail.field.role',
  context: 'detail.field.context', ownerId: 'detail.field.owner', ready: 'detail.field.ready', blockedBy: 'detail.field.dependencies', writeScopes: 'detail.field.writeScopes',
  writeScopeWarnings: 'detail.field.warnings', diagnostics: 'detail.field.diagnostics', methods: 'detail.field.methods', inputSchema: 'detail.field.inputSchema', outputSchema: 'detail.field.outputSchema',
  currentPackageId: 'detail.field.currentPackage', nextPackageId: 'detail.field.nextPackage', latestRun: 'detail.field.latestRun', packages: 'detail.field.packages', registrations: 'detail.field.registrations',
  props: 'detail.field.props', data: 'detail.field.data', source: 'detail.field.source', arguments: 'row.input', content: 'detail.field.content', message: 'detail.field.message',
  messageId: 'detail.field.messageId', status: 'detail.state', root: 'detail.field.root', pid: 'detail.field.pid', type: 'detail.field.type', time: 'detail.field.time', seq: 'detail.field.seq',
  turn: 'detail.field.turn', step: 'detail.field.step', callId: 'detail.field.callId', agentsStarted: 'detail.field.agents', output: 'row.output', result: 'detail.field.result',
}
const fieldLabel = (lang, key) => (Object.hasOwn(FIELD_KEY, key) ? copy(lang, FIELD_KEY[key]) : key)
const scalarText = (lang, v) => (v === null ? copy(lang, 'detail.none') : typeof v === 'boolean' ? copy(lang, v ? 'detail.yes' : 'detail.no') : typeof v === 'string' ? v : JSON.stringify(v))
const INSPECT_TITLE_KEYS = ['subject', 'title', 'name', 'pluginId', 'packageId', 'id', 'summary']
/** Open records as readable items (inspectionItems): scalar fields, nested records flattened into groups (the group label rides the items under it). */
const inspectionItems = (lang, value, depth = 0, group = '') => {
  const tag = (items) => (group === '' ? items : items.map((it) => ({ ...it, group: it.group ? `${group} › ${it.group}` : group })))
  if (depth > 3 && value !== null && typeof value === 'object') return tag([{ lines: splitLines(JSON.stringify(value, null, 2)).slice(0, 40).map((text) => ({ text })) }])
  if (Array.isArray(value)) {
    const items = value.slice(0, 40).flatMap((e) => inspectionItems(lang, e, depth + 1))
    if (value.length > 40) items.push({ text: copy(lang, 'detail.moreInInspect', { count: value.length - 40 }) })
    return tag(items.length === 0 ? [{ text: copy(lang, 'detail.empty') }] : items)
  }
  if (!dRec(value)) return tag([{ text: scalarText(lang, value) }])
  const titleKey = INSPECT_TITLE_KEYS.find((k) => typeof value[k] === 'string' && value[k] !== '')
  const descKey = ['description', 'purpose'].find((k) => typeof value[k] === 'string' && value[k] !== '')
  const fields = []
  const nested = []
  for (const [key, field] of Object.entries(value)) {
    if (key === titleKey || key === descKey || (key === 'status' && typeof field === 'string')) continue
    if (key === 'inputSchema' || key === 'outputSchema') { nested.push({ group: fieldLabel(lang, key), lines: splitLines(JSON.stringify(field, null, 2)).slice(0, 40).map((text) => ({ text })) }); continue }
    if (Array.isArray(field) && field.length === 0) continue
    if (field !== null && typeof field === 'object') nested.push(...inspectionItems(lang, field, depth + 1, fieldLabel(lang, key)))
    else fields.push({ label: fieldLabel(lang, key), value: scalarText(lang, field) })
  }
  const head = { ...(titleKey !== undefined || typeof value.status === 'string' ? { title: titleKey !== undefined ? String(value[titleKey]) : copy(lang, 'detail.field.result') } : {}),
    ...(descKey !== undefined ? { text: String(value[descKey]) } : {}), ...(typeof value.status === 'string' ? (() => { const b = badgeOf(lang, value.status); return { badge: b.label, tone: b.tone } })() : {}), fields }
  return tag([head, ...nested])
}
const intervalText = (lang, s) => (s % 86400 === 0 ? copy(lang, 'detail.days', { count: s / 86400 }) : s % 3600 === 0 ? copy(lang, 'detail.hours', { count: s / 3600 })
  : s % 60 === 0 ? copy(lang, 'detail.minutes', { count: s / 60 }) : copy(lang, 'detail.seconds', { count: s }))
const shortClock = (t) => String(t).replace(/:00\.000$/, '').replace(/\.000$/, '')
const scheduleItem = (lang, v) => {
  if (!dRec(v) || !dStr(v.id) || typeof v.scheduledAt !== 'string') return null
  const title = dStr(v.title) ? v.title : v.prompt
  if (!dStr(title)) return null
  const state = v.status ?? v.state
  if (v.status === undefined) { if (!dStr(v.prompt) || (v.deliveryMode !== 'host' && v.deliveryMode !== 'session-local') || (state !== 'scheduled' && state !== 'overdue')) return null }
  else if (!dStr(v.title) || !['active', 'paused', 'ended'].includes(state)) return null
  const date = new Date(v.scheduledAt)
  if (!Number.isFinite(date.getTime())) return null
  let frequency
  switch (v.kind) {
    case 'rrule': frequency = copy(lang, 'detail.schedule.custom'); break
    case 'at': frequency = copy(lang, 'detail.schedule.once'); break
    case 'after': if (!dCount(v.afterSeconds) || v.afterSeconds === 0) return null; frequency = copy(lang, 'detail.schedule.once'); break
    case 'every': if (!dCount(v.everySeconds) || v.everySeconds === 0) return null; frequency = copy(lang, 'detail.schedule.every', { interval: intervalText(lang, v.everySeconds) }); break
    case 'daily': if (!dStr(v.time) || !dStr(v.timeZone)) return null; frequency = copy(lang, 'detail.schedule.daily', { time: shortClock(v.time), zone: v.timeZone }); break
    case 'weekly': {
      const days = Array.isArray(v.weekdays) && v.weekdays.length > 0 && v.weekdays.every((d) => Number.isInteger(d) && d >= 1 && d <= 7) ? v.weekdays.map((d) => copy(lang, `detail.weekday.${d}`)).join(copy(lang, 'detail.weekday.join')) : null
      if (!dStr(v.time) || !dStr(v.timeZone) || days === null) return null
      frequency = copy(lang, 'detail.schedule.weekly', { days, time: shortClock(v.time), zone: v.timeZone })
      break
    }
    case 'cron': if (!dStr(v.expression) || !dStr(v.timeZone)) return null; frequency = copy(lang, 'detail.schedule.cron', { expression: v.expression, zone: v.timeZone }); break
    default: return null
  }
  let when = v.scheduledAt
  try { when = new Intl.DateTimeFormat(lang === 'en' ? 'en' : 'zh-CN', { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit', timeZoneName: 'short' }).format(date) } catch { /* keep the ISO text */ }
  return { title, fields: [{ label: copy(lang, 'detail.schedule.when'), value: when }, { label: copy(lang, 'detail.schedule.frequency'), value: frequency }, { label: copy(lang, 'detail.state'), value: copy(lang, `detail.schedule.${state}`) }] }
}
// ---- the task manager's rows (ui-schedule task-record.ts / editor-timing.ts, rc.3) -------------------------------------------------------
// A host task is a flat record by kind: at / after (scheduledAt), every (everySeconds), daily (time, timeZone), weekly (+ weekdays 1-7),
// cron (expression, timeZone) or rrule (DTSTART + RRULE lines). The row carries its timing worded in `lang` and, for the phone's editor,
// the same timing as plain fields (mode, date, time, zone, interval, unit, days) -- no JSON on the phone.
const systemZone = () => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC' } catch { return 'UTC' } }
const zoneOk = (z) => { try { new Intl.DateTimeFormat('en', { timeZone: z }); return typeof z === 'string' && z !== '' } catch { return false } }
const whenText = (lang, iso, zone) => {
  const date = new Date(iso)
  if (!Number.isFinite(date.getTime())) return ''
  try { return new Intl.DateTimeFormat(lang === 'en' ? 'en' : 'zh-CN', { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', ...(zoneOk(zone) ? { timeZone: zone } : {}) }).format(date) } catch { return String(iso) }
}
/** The zone-local calendar date (YYYY-MM-DD) and clock (HH:mm) of an instant. */
const localParts = (iso, zone) => {
  const date = new Date(iso)
  if (!Number.isFinite(date.getTime())) return { date: '', time: '' }
  try {
    const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: zoneOk(zone) ? zone : systemZone(), year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(date).map((x) => [x.type, x.value]))
    return { date: `${p.year}-${p.month}-${p.day}`, time: `${p.hour}:${p.minute}` }
  } catch { return { date: '', time: '' } }
}
const RRULE_DAYS = ['MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU']
const rruleOf = (rrule) => {
  const lines = String(rrule ?? '').split('\n')
  const fields = new Map((lines.find((l) => l.startsWith('RRULE:')) ?? '').slice(6).split(';').filter(Boolean).map((f) => f.split('=')))
  const start = /^DTSTART(?:;TZID=([^:]+))?:\d{8}T(\d{2})(\d{2})\d{2}/.exec(lines.find((l) => l.startsWith('DTSTART')) ?? '')
  return { fields, zone: start?.[1] ?? 'UTC', clock: start ? `${start[2]}:${start[3]}` : '' }
}
const weekdayList = (lang, days) => days.map((d) => copy(lang, `detail.weekday.${d}`)).join(copy(lang, 'detail.weekday.join'))
/** The plain-field form of a task's timing, for the phone's editor; a rule the editor cannot express (cron, an unusual RRULE) is `custom` and stays as it is. */
const scheduleDraft = (t) => {
  const zone = typeof t.timeZone === 'string' && t.timeZone !== '' ? t.timeZone : systemZone()
  const base = { mode: 'custom', date: '', time: '', zone, interval: 1, unit: 'minutes', days: '' }
  switch (t.kind) {
    case 'at': case 'after': { const l = localParts(t.scheduledAt, systemZone()); return { ...base, mode: 'once', date: l.date, time: l.time, zone: systemZone() } }
    case 'every': { const s = Number(t.everySeconds) || 0; return { ...base, mode: 'every', unit: s % 3600 === 0 ? 'hours' : 'minutes', interval: Math.max(1, s % 3600 === 0 ? s / 3600 : Math.ceil(s / 60)) } }
    case 'daily': return { ...base, mode: 'daily', time: String(t.time ?? '').slice(0, 5) }
    case 'weekly': return { ...base, mode: 'weekly', time: String(t.time ?? '').slice(0, 5), days: (Array.isArray(t.weekdays) ? t.weekdays : []).join(',') }
    default: return base
  }
}
/** A task's timing in words (the manager's frequency line). */
const scheduleTiming = (lang, t) => {
  switch (t.kind) {
    case 'at': case 'after': return `${copy(lang, 'detail.schedule.once')} · ${whenText(lang, t.scheduledAt, systemZone())}`
    case 'every': return copy(lang, 'detail.schedule.every', { interval: intervalText(lang, Number(t.everySeconds) || 0) })
    case 'daily': return copy(lang, 'detail.schedule.daily', { time: shortClock(t.time ?? ''), zone: t.timeZone ?? '' })
    case 'weekly': return copy(lang, 'detail.schedule.weekly', { days: weekdayList(lang, Array.isArray(t.weekdays) ? t.weekdays : []), time: shortClock(t.time ?? ''), zone: t.timeZone ?? '' })
    case 'cron': return copy(lang, 'detail.schedule.cron', { expression: t.expression ?? '', zone: t.timeZone ?? '' })
    case 'rrule': {
      const { fields, zone, clock } = rruleOf(t.rrule)
      const n = Number(fields.get('INTERVAL') ?? 1) || 1
      if (fields.get('COUNT') === '1') return `${copy(lang, 'detail.schedule.once')} · ${whenText(lang, t.scheduledAt, zone)}`
      switch (fields.get('FREQ')) {
        case 'MINUTELY': return copy(lang, 'detail.schedule.every', { interval: intervalText(lang, n * 60) })
        case 'HOURLY': return copy(lang, 'detail.schedule.every', { interval: intervalText(lang, n * 3600) })
        case 'DAILY': return n === 1 ? copy(lang, 'detail.schedule.daily', { time: fields.has('BYHOUR') ? `${String(fields.get('BYHOUR')).padStart(2, '0')}:${String(fields.get('BYMINUTE') ?? 0).padStart(2, '0')}` : clock, zone }) : copy(lang, 'detail.schedule.every', { interval: intervalText(lang, n * 86400) })
        case 'WEEKLY': {
          const days = (fields.get('BYDAY') ?? '').split(',').map((d) => RRULE_DAYS.indexOf(d) + 1).filter((d) => d > 0)
          return n === 1 && days.length > 0 ? copy(lang, 'detail.schedule.weekly', { days: weekdayList(lang, days), time: clock, zone }) : copy(lang, 'detail.schedule.custom')
        }
        case 'MONTHLY': return copy(lang, 'detail.schedule.monthly')
        default: return copy(lang, 'detail.schedule.custom')
      }
    }
    default: return copy(lang, 'detail.schedule.custom')
  }
}
/** One task as the phone's row: its state in the manager's words, the next run, and its editable fields. */
const scheduleView = (lang, t) => {
  const status = ['active', 'paused', 'ended'].includes(t?.status) ? t.status : 'active'
  const zone = typeof t?.timeZone === 'string' ? t.timeZone : systemZone()
  // The next run is the later of the scheduled occurrence and the end of the delivery floor (taskNextRunAt); an enabled task whose
  // occurrence is already past and that is not delivering now is overdue (the session it waits for has not resumed).
  const at = typeof t?.scheduledAt === 'string' ? t.scheduledAt : ''
  const floor = typeof t?.deliveryFloorEndsAt === 'string' && Date.parse(t.deliveryFloorEndsAt) > Date.parse(at) ? t.deliveryFloorEndsAt : at
  const overdue = status === 'active' && t?.executionActive !== true && Number.isFinite(Date.parse(floor)) && Date.parse(floor) < Date.now() - 60_000
  return {
    id: String(t?.id ?? ''),
    title: truncate(String(t?.title ?? ''), 120),
    prompt: truncate(String(t?.prompt ?? ''), 4000),
    status,
    state: copy(lang, overdue ? 'detail.schedule.overdue' : `detail.schedule.${status}`),
    overdue,
    kind: String(t?.kind ?? ''),
    timing: scheduleTiming(lang, t ?? {}),
    nextAt: floor,
    next: status === 'active' && !overdue && floor !== '' ? whenText(lang, floor, zone) : '',
    updatedAt: typeof t?.updatedAt === 'string' ? t.updatedAt : '',
    targetSessionId: t?.target?.kind === 'session' ? String(t.target.sessionId) : '',
    running: t?.executionActive === true,
    ...scheduleDraft(t ?? {}),
  }
}
/** The phone's structured timing (`when`) as the host's typed ScheduleTiming; null when it is not a well-formed one. */
const timingFromWhen = (w) => {
  if (!w || typeof w !== 'object') return null
  const zone = typeof w.zone === 'string' && zoneOk(w.zone) ? w.zone : null
  const clock = typeof w.time === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(w.time) ? `${w.time}:00` : null
  switch (w.mode) {
    case 'once': return clock && zone && /^\d{4}-\d{2}-\d{2}$/.test(String(w.date ?? '')) ? { kind: 'at', at: { date: w.date, time: clock, time_zone: zone } } : null
    case 'every': { const n = Number(w.interval); const unit = w.unit === 'hours' ? 3600 : w.unit === 'minutes' ? 60 : 0; return Number.isSafeInteger(n) && n >= 1 && n <= 100000 && unit > 0 ? { kind: 'every', every_seconds: n * unit } : null }
    case 'daily': return clock && zone ? { kind: 'daily', daily: { time: clock, time_zone: zone } } : null
    case 'weekly': {
      const days = [...new Set((Array.isArray(w.days) ? w.days : String(w.days ?? '').split(',')).map(Number).filter((d) => Number.isInteger(d) && d >= 1 && d <= 7))].sort((a, b) => a - b)
      return clock && zone && days.length > 0 ? { kind: 'weekly', weekly: { time: clock, time_zone: zone, weekdays: days } } : null
    }
    default: return null
  }
}
const goalDetails = (lang, v) => {
  if (!dRec(v)) return null
  if (v.goal === null) return { items: [], empty: copy(lang, 'detail.goal.empty') }
  const g = v.goal
  if (!dRec(g) || !dStr(g.id) || !dStr(g.objective) || !dCount(g.revision) || !dCount(g.roundsStarted) || !dCount(g.maxGoalRounds)) return null
  if (!['active', 'paused', 'blocked', 'complete'].includes(g.phase) || (v.activation !== 'armed' && v.activation !== 'disarmed')) return null
  const fields = [{ label: copy(lang, 'detail.state'), value: copy(lang, g.phase === 'active' && v.activation === 'disarmed' ? 'detail.goal.disarmed' : `detail.goal.${g.phase}`) },
    { label: copy(lang, 'detail.goal.rounds'), value: `${g.roundsStarted} / ${g.maxGoalRounds}` }]
  if (g.blockedReason !== undefined) {
    if (!dRec(g.blockedReason) || !dStr(g.blockedReason.code) || !dStr(g.blockedReason.message)) return null
    fields.push({ label: copy(lang, 'detail.goal.reason'), value: g.blockedReason.message })
  }
  return { items: [{ title: g.objective, fields }] }
}
const listDetails = (lang, items, summary, extra = {}) => ({ items, summary, caption: copy(lang, 'detail.recordedResult'), empty: copy(lang, 'detail.empty'), ...extra })
const receiptDetails = (lang, title, badge, fields = [], description) => ({
  ...listDetails(lang, [{ title, badge: badge.label, tone: badge.tone, fields, ...(description ? { text: description } : {}) }], `${title} · ${badge.label}`), expandedSummary: title,
})
const agentList = (lang, text, json) => {
  if (Array.isArray(json)) {
    const items = inspectionItems(lang, json).map((it) => (it.title !== undefined && it.text !== undefined ? { ...it, title: it.text, subtitle: it.title, text: undefined } : it))
    return listDetails(lang, items, copy(lang, 'detail.agents.count', { count: json.length }))
  }
  if (text === '(no subagents)') return listDetails(lang, [], copy(lang, 'detail.agents.count', { count: 0 }))
  const items = []
  for (const line of text.split('\n')) {
    const m = /^(\S+) \[([^\]]+)\](?: parent=\S+ depth=\d+)?(?: — (.*))?$/u.exec(line)
    if (m === null) return null
    const b = badgeOf(lang, m[2])
    items.push({ title: m[3] || m[1], ...(m[3] ? { subtitle: m[1] } : {}), badge: b.label, tone: b.tone, fields: [] })
  }
  return listDetails(lang, items, copy(lang, 'detail.agents.count', { count: items.length }))
}
const jobList = (lang, text) => {
  if (text === '(no background jobs)') return listDetails(lang, [], copy(lang, 'detail.jobs.count', { count: 0 }))
  const items = []
  for (const line of text.split('\n')) {
    const m = /^(\S+) \[([^\]]+)\] (\S+) — (.*)$/u.exec(line)
    if (m === null) return null
    const b = badgeOf(lang, m[3])
    items.push({ title: m[4], subtitle: m[1], badge: b.label, tone: b.tone, fields: [{ label: copy(lang, 'detail.field.type'), value: m[2] }] })
  }
  return listDetails(lang, items, copy(lang, 'detail.jobs.count', { count: items.length }))
}
const terminalList = (lang, text) => {
  if (text === '(no terminal sessions)') return listDetails(lang, [], copy(lang, 'detail.terminals.count', { count: 0 }))
  const items = []
  for (const line of text.split('\n')) {
    const m = /^(\S+)(?: \((.*?)\))? \[([^\]]+)\] (running|exited code=(\S+) signal=(\S+))(?: pid=(\d+))?$/u.exec(line)
    if (m === null) return null
    const fields = [{ label: copy(lang, 'detail.field.type'), value: m[3] }]
    if (m[7] !== undefined) fields.push({ label: copy(lang, 'detail.field.pid'), value: m[7] })
    if (m[5] !== undefined) fields.push({ label: copy(lang, 'detail.field.exitCode'), value: m[5] })
    if (m[6] !== undefined && m[6] !== 'null') fields.push({ label: copy(lang, 'detail.field.signal'), value: m[6] })
    items.push({ title: m[2] ?? m[1], ...(m[2] === undefined ? {} : { subtitle: m[1] }), ...(m[4] === 'running' ? (() => { const b = badgeOf(lang, 'running'); return { badge: b.label, tone: b.tone } })() : { badge: copy(lang, 'detail.status.exited'), tone: m[5] === '0' ? 'success' : 'neutral' }), fields })
  }
  return listDetails(lang, items, copy(lang, 'detail.terminals.count', { count: items.length }))
}
/** Team tasks as items, task ownership localized (without touching an inspection provider's own `owner`). */
const teamTaskItems = (lang, value) => inspectionItems(lang, value).map((it) => ({ ...it, fields: (it.fields ?? []).map((f) => (f.label === 'owner' ? { ...f, label: copy(lang, 'detail.field.owner') } : f)) }))
const argText = (args, key) => (typeof args?.[key] === 'string' ? args[key] : '')
/** Entity lists and receipts of the agent, job, terminal and team tools; null for output the card does not recognise (the input / output card shows it). */
const controlDetails = (lang, name, args, text, json) => {
  const target = argText(args, 'target') || argText(args, 'agent') || argText(args, 'agent_id') || argText(args, 'sessionId') || argText(args, 'job_id')
  const rec = (key, tone) => ({ label: copy(lang, key), tone })
  switch (name) {
    case 'list_agents': return agentList(lang, text, json)
    case 'job_list': return jobList(lang, text)
    case 'terminal_list': return terminalList(lang, text)
    case 'spawn_teammate': return dRec(json) && dRec(json.member) ? listDetails(lang, inspectionItems(lang, json.member), argText(args, 'name')) : null
    case 'team_task_create': case 'team_task_get': case 'team_task_update':
      return dRec(json) && typeof json.subject === 'string' ? listDetails(lang, teamTaskItems(lang, json), json.subject) : null
    case 'team_task_list':
      if (!dRec(json) || !Array.isArray(json.tasks)) return null
      return listDetails(lang, teamTaskItems(lang, json.tasks), copy(lang, 'detail.tasks.count', { count: json.tasks.length }), json.nextCursor === undefined ? {} : { caption: copy(lang, 'detail.tasks.nextPage', { cursor: String(json.nextCursor) }) })
    case 'send_message': {
      const status = dRec(json) ? json.status : undefined
      if (status === 'accepted' || status === 'queued') return receiptDetails(lang, target, rec(status === 'queued' ? 'detail.status.queued' : 'detail.receipt.delivered', status === 'queued' ? 'warning' : 'success'), [], argText(args, 'message'))
      return text === `message delivered to agent ${target}` ? receiptDetails(lang, target, rec('detail.receipt.delivered', 'success'), [], argText(args, 'message')) : null
    }
    case 'interrupt_agent':
      if (dRec(json) && typeof json.previousStatus === 'string') return receiptDetails(lang, target, rec('detail.receipt.interrupt', 'warning'), [{ label: copy(lang, 'detail.field.previousStatus'), value: badgeOf(lang, json.previousStatus).label }])
      return text === `interrupt requested for agent ${target}` ? receiptDetails(lang, target, rec('detail.receipt.interrupt', 'warning')) : null
    case 'wait_agent': {
      if (!dRec(json) || typeof json.timedOut !== 'boolean') return null
      if (dRec(json.noProgress) && typeof json.noProgress.message === 'string') return listDetails(lang, [{ title: copy(lang, 'detail.wait.noProgress'), text: json.noProgress.message }], copy(lang, 'detail.wait.noProgress'))
      const label = copy(lang, json.timedOut ? 'detail.wait.timeout' : 'detail.wait.ended')
      return { ...receiptDetails(lang, copy(lang, 'detail.wait.title'), { label, tone: 'neutral' }), summary: label, expandedSummary: '' }
    }
    case 'list_subagent_models': {
      const items = text.split('\n').map((line) => { const at = line.indexOf(' — '); return at < 0 ? { text: line } : { title: line.slice(0, at), text: line.slice(at + 3) } })
      return listDetails(lang, items, argText(args, 'model') || argText(args, 'provider') || copy(lang, 'detail.models.title'))
    }
    case 'job_output': {
      const m = /\n\[status: ([^,\]\n]+)(?:, ([^\]\n]+))?\]$/u.exec(text)
      if (m === null) return null
      const output = text.slice(0, m.index)
      const cut = output.endsWith('\n[output truncated]')
      const code = cut ? output.slice(0, -'\n[output truncated]'.length) : output
      const b = badgeOf(lang, m[1])
      const description = [m[2], cut ? copy(lang, 'detail.output.truncated') : undefined].filter((v) => v !== undefined).join(' · ')
      return { ...listDetails(lang, [{ title: target, badge: b.label, tone: b.tone, ...(description === '' ? {} : { text: description }), lines: splitLines(code).map((t) => ({ text: t })) }], `${target} · ${b.label}`), expandedSummary: target }
    }
    case 'job_kill':
      if (text === `requested cancellation of job ${target}`) return receiptDetails(lang, target, rec('detail.receipt.cancel', 'warning'), [], argText(args, 'reason'))
      return text.startsWith(`job ${target} had already finished `) ? receiptDetails(lang, target, rec('detail.receipt.alreadyFinished', 'neutral')) : null
    case 'terminal_open': {
      const m = /^started terminal session (\S+)(?: \((.*?)\))? \[type: ([^\]]+)\]\n([\s\S]*)$/u.exec(text)
      return m === null ? null : listDetails(lang, [{ title: m[2] ?? m[1], ...(m[2] === undefined ? {} : { subtitle: m[1] }), badge: copy(lang, 'detail.receipt.started'), tone: 'info', fields: [{ label: copy(lang, 'detail.field.type'), value: m[3] }], lines: splitLines(m[4]).map((t) => ({ text: t })) }], m[2] ?? m[1])
    }
    case 'terminal_read': {
      const m = /\n\[lines: (\d+)-(\d+) of (\d+)\](\n\[output truncated\])?$/u.exec(text)
      return m === null ? null : listDetails(lang, [{ title: target, subtitle: copy(lang, 'detail.output.lines', { begin: m[1], end: m[2], total: m[3] }), lines: splitLines(text.slice(0, m.index)).map((t) => ({ text: t })), ...(m[4] === undefined ? {} : { text: copy(lang, 'detail.output.truncated') }) }], target)
    }
    case 'terminal_signal': {
      const m = /^delivered (\S+) to foreground process group (\d+)$/u.exec(text)
      return m === null ? null : receiptDetails(lang, target, rec('detail.receipt.signal', 'success'), [{ label: copy(lang, 'detail.field.signal'), value: m[1] }, { label: copy(lang, 'detail.field.processGroup'), value: m[2] }])
    }
    case 'terminal_close':
      if (text === `closed terminal session ${target}`) return receiptDetails(lang, target, rec('detail.receipt.closed', 'neutral'))
      return text === `terminal session ${target} was already closing` ? receiptDetails(lang, target, rec('detail.receipt.closing', 'neutral')) : null
    default: return null
  }
}
/** A delegation receipt (subagentDetails): the task, the child's name / id; a historical synchronous reply shows as the agent's reply. */
const subagentDetails = (lang, args, text, meta) => {
  const fields = []
  const description = argText(args, 'description')
  if (dStr(description)) fields.push({ label: copy(lang, 'detail.field.agentDescription'), value: description })
  if (meta !== undefined) {
    if (!dRec(meta) || meta.kind !== 'activation' || (meta.name !== undefined && !dStr(meta.name)) || (meta.subagentId !== undefined && !dStr(meta.subagentId)) || (meta.name === undefined && meta.subagentId === undefined)) return null
    if (meta.name !== undefined) fields.push({ label: copy(lang, 'detail.field.agentName'), value: meta.name })
    if (meta.subagentId !== undefined) fields.push({ label: copy(lang, 'detail.field.id'), value: meta.subagentId })
  } else {
    if (text === undefined) return null
    const started = /^started (background subagent job|subagent) (\S+)$/u.exec(text)
    if (started === null) return listDetails(lang, [{ title: copy(lang, 'detail.agent.reply'), text: truncate(maskSecrets(text), 4000), md: true, group: copy(lang, 'detail.field.task'), lines: splitLines(maskSecrets(argText(args, 'prompt'))).slice(0, 40).map((t) => ({ text: t })) }], copy(lang, 'detail.agent.reply'))
    fields.push({ label: copy(lang, started[1] === 'background subagent job' ? 'detail.field.job' : 'detail.field.id'), value: started[2] })
  }
  return listDetails(lang, [{ title: copy(lang, 'detail.receipt.started'), fields, group: '', lines: splitLines(maskSecrets(argText(args, 'prompt'))).slice(0, 40).map((t) => ({ text: t })) }], description || argText(args, 'prompt'))
}
const DETAIL_TOOLS = new Set(['create_goal', 'get_goal', 'update_goal', 'schedule_create', 'schedule_list', 'schedule_view', 'schedule_edit', 'schedule_delete', 'schedule_update', 'list_subagent_models',
  'subagent', 'subagent_fork', 'list_agents', 'send_message', 'interrupt_agent', 'job_list', 'job_output', 'job_kill', 'terminal_open', 'terminal_read', 'terminal_list', 'terminal_signal', 'terminal_close',
  'spawn_teammate', 'team_task_create', 'team_task_get', 'team_task_update', 'team_task_list', 'wait_agent'])
/** Details of a settled call (detailsCardModel): {items, summary?, caption?, empty?, expandedSummary?}, or null for the input / output card. */
const detailsOf = (lang, name, F) => {
  if (!DETAIL_TOOLS.has(name) || F.result === undefined || F.isError || !F.parsed) return null
  const text = String(F.result)
  if (name === 'subagent' || name === 'subagent_fork') return subagentDetails(lang, F.parsed, text, F.meta === null ? undefined : F.meta)
  const json = dJson(text)
  const control = controlDetails(lang, name, F.parsed, text, json)
  if (control !== null || json === undefined) return control
  switch (name) {
    case 'create_goal': case 'get_goal': case 'update_goal': return goalDetails(lang, json)
    case 'schedule_create': case 'schedule_update': case 'schedule_view': { const it = scheduleItem(lang, json); return it === null ? null : { items: [it] } }
    case 'schedule_edit': {
      if (dRec(json) && dStr(json.id) && json.deleted === true) return { items: [{ title: json.id, fields: [{ label: copy(lang, 'detail.state'), value: copy(lang, 'detail.schedule.deleted') }] }] }
      const it = scheduleItem(lang, json)
      return it === null ? null : { items: [it] }
    }
    case 'schedule_delete': return dRec(json) && dStr(json.id) && json.deleted === true ? { items: [{ title: json.id, fields: [{ label: copy(lang, 'detail.state'), value: copy(lang, 'detail.schedule.deleted') }] }] } : null
    case 'schedule_list': {
      const entries = Array.isArray(json) ? json : dRec(json) ? json.items : undefined
      if (!Array.isArray(entries)) return null
      const items = []
      for (const e of entries) { const it = scheduleItem(lang, e); if (it === null) return null; items.push(it) }
      return { items, summary: copy(lang, 'detail.schedule.count', { count: items.length }), empty: copy(lang, 'detail.schedule.empty') }
    }
    default: return null
  }
}
const detailsView = (lang, d) => {
  const parts = []
  if (d.caption) parts.push(part('note', 'cap', { text: d.caption }))
  const items = (d.items ?? []).slice(0, 60).map((it, i) => {
    const o = { id: `i${i}` }
    for (const k of ['title', 'subtitle', 'badge', 'tone', 'text', 'group']) if (it[k] !== undefined && it[k] !== '') o[k] = maskSecrets(String(it[k]))
    if (it.md) o.md = true
    o.fields = (it.fields ?? []).slice(0, 20).map((f, j) => ({ id: `f${j}`, label: String(f.label), value: maskSecrets(truncate(String(f.value), 400)) }))
    if (Array.isArray(it.lines)) o.lines = lineList(lang, it.lines.map((l) => ({ text: maskSecrets(String(l.text ?? '')) })))
    return o
  })
  if (items.length > 0) parts.push(part('items', 'items', { items }))
  else parts.push(part('note', 'empty', { text: d.empty ?? copy(lang, 'detail.empty') }))
  return { kind: 'details', head: d.summary ?? '', tone: '', parts }
}

// ---- row facts and the card ----------------------------------------------------------------------------------------------
const WEB_FAILURE_KEY = {
  WEB_FETCH_DNS_FAILED: 'tool.webFetch.failure.dns', WEB_FETCH_CONNECTION_REFUSED: 'tool.webFetch.failure.refused', WEB_FETCH_CONNECTION_TIMEOUT: 'tool.webFetch.failure.connectionTimeout',
  WEB_FETCH_CERTIFICATE_INVALID: 'tool.webFetch.failure.certificate', WEB_FETCH_CONNECTION_INTERRUPTED: 'tool.webFetch.failure.interrupted', WEB_FETCH_NETWORK_UNREACHABLE: 'tool.webFetch.failure.unreachable',
  WEB_FETCH_NETWORK_ERROR: 'tool.webFetch.failure.network',
}
const KB = 1024
/** Kilobytes of decoded content a write / edit call carries (content, old_string, new_string), or null when it carries none yet. */
const contentKilobytes = (parsed, rawArgs) => {
  const keys = ['content', 'old_string', 'new_string']
  if (parsed) { if (!keys.some((k) => typeof parsed[k] === 'string')) return null; return Math.ceil(keys.reduce((n, k) => n + (typeof parsed[k] === 'string' ? parsed[k].length : 0), 0) / KB) }
  const raw = String(rawArgs ?? '')
  return keys.some((k) => raw.includes(`"${k}"`)) ? Math.max(1, Math.ceil(raw.length / KB)) : null
}
const diffTotals = (hunks) => { let added = 0; let removed = 0; for (const s of diffStats(hunks).values()) { added += s.added; removed += s.removed } return { added, removed } }

/**
 * Settle a tool block's collapsed-row facts from its call and result (called once the result is folded in): status, the exit /
 * failure badge, the summary an error replaces (its first output line, or the localized reason), the +/- totals and the KB suffix.
 */
const settleTool = (lang, b) => {
  const F = b[FULL] ?? {}
  const name = String(b.name ?? '')
  const text = typeof F.result === 'string' ? F.result : ''
  const stopped = F.errCode === 'interrupted'
  b.status = stopped ? 'stopped' : F.isError ? 'error' : 'ok'
  b.badge = ''
  const call = shellCall(name, F.parsed)
  if (call !== null && !call.background && !call.persistent && !F.isError && !stopped) {
    const label = exitLabel(lang, exitStatus(text))
    if (label !== null) { b.status = 'error'; b.badge = label }
  } else if ((call === null || call.persistent) && !F.isError && !stopped && Number.isInteger(F.exit) && F.exit !== 0) {
    // any other call whose output ends in the shell footer (exec_command, a persistent shell, a plugin's shell) is a failure too
    b.status = 'error'
    b.badge = copy(lang, 'terminal.exitCode', { code: F.exit })
  }
  if (F.err?.name === 'AutoReviewDeniedError' && F.err?.code === 'AUTO_REVIEW_DENIED') b.summary = copy(lang, 'tool.autoReviewRejected')
  else if (stopped) b.summary = copy(lang, 'row.stopped')
  else if (b.status === 'error' && b.badge === '') {
    const failure = name === 'web_fetch' && F.errCode !== undefined && Object.hasOwn(WEB_FAILURE_KEY, F.errCode) ? copy(lang, WEB_FAILURE_KEY[F.errCode]) : null
    const line = oneLine(text.trim())
    if (failure !== null) b.summary = failure
    else if (line !== '') b.summary = truncate(maskSecrets(line), 160)
    if (b.badge === '' && F.isError) b.badge = copy(lang, 'row.failed')
  }
  if (name === 'wait_agent' || DETAIL_TOOLS.has(name)) {
    const d = detailsOf(lang, name, F)
    if (d !== null) {
      const sub = name === 'subagent' || name === 'subagent_fork' ? oneLine(F.parsed?.description ?? '').trimStart() || oneLine(F.parsed?.prompt ?? '').trimStart() : ''
      if (name === 'wait_agent') { b.title = d.summary ?? b.title; b.summary = '' } else b.summary = truncate(sub || d.summary || d.items?.[0]?.title || d.empty || b.summary, 160)
    }
  }
  if (name === 'write' || name === 'edit' || name === 'apply_patch') {
    const hunks = Array.isArray(b.diff) ? b.diff : null
    if (hunks && b.status === 'ok') { const t = diffTotals(hunks); b.added = t.added; b.removed = t.removed }
  }
}

/** A result's metadata as the call index keeps it: what a card shows, bounded (a read's 2000 lines are cut where the card cuts them; the diffs live on the block). */
const keepMeta = (m) => {
  if (m === null || typeof m !== 'object' || Array.isArray(m)) return null
  const out = { ...m }
  delete out.diffs
  if (Array.isArray(m.lines)) out.lines = m.lines.slice(0, LINES_CAP).map((l) => (l && typeof l.text === 'string' ? { number: l.number, text: l.text.slice(0, LINE_CHARS) } : l))
  if (Array.isArray(m.paths)) out.paths = m.paths.slice(0, LINES_CAP)
  if (Array.isArray(m.files)) {
    let rows = 0
    out.files = []
    for (const f of m.files) {
      if (rows >= LINES_CAP) break
      const matches = Array.isArray(f?.matches) ? f.matches.slice(0, LINES_CAP - rows) : []
      rows += matches.length + 1
      out.files.push({ path: f?.path, matches })
    }
  }
  if (Array.isArray(m.sources)) out.sources = m.sources.slice(0, 40)
  if (typeof m.answer === 'string') out.answer = m.answer.slice(0, 4000)
  return out
}

/** The card a tap on a tool row opens; {kind: '', parts: []} when there is nothing to show. */
const toolView = (lang, b, env) => {
  const F = { ...(b[FULL] ?? {}), env: env ?? b[FULL]?.env, diff: b.diff }
  const name = String(b.name ?? '')
  const st = { status: b.status, isError: F.isError }
  let view = null
  try {
    if (F.err?.name === 'AutoReviewDeniedError' && F.err?.code === 'AUTO_REVIEW_DENIED') view = autoReviewView(lang, F)
    else if (b.status === 'stopped' && F.result === undefined) view = null
    else if (SHELLS.has(name) || name === 'terminal_send') view = terminalView(lang, name, F, st)
    else if (name === 'read') view = readView(lang, F)
    else if (name === 'grep' || name === 'glob') view = searchView(lang, name, F)
    else if (name === 'web_search' || name === 'web_fetch') view = webView(lang, name, F)
    else if (name === 'write' || name === 'edit' || name === 'apply_patch') view = diffView(lang, name, F)
    else if (name === 'read_image') view = imageView(lang, F)
    else if (DETAIL_TOOLS.has(name)) { const d = detailsOf(lang, name, F); view = d === null ? null : detailsView(lang, d) }
    if (view === null) view = ioView(lang, name, F, st)
  } catch { view = { kind: '', head: '', tone: '', parts: [] } }
  return view
}

/**
 * The registered workspace owning a directory, or null. The desktop groups
 * sessions by the workspace registry alone, and the Host attaches a created
 * session to its workspace only when the create request names workspaceId
 * (session-controller commands.create; a cwd-only create stays Ungrouped).
 * So the phone's directory-shaped choice must resolve to a registry workspace
 * before creating: the record path is stored canonical (realpath), so compare
 * canonical spellings and accept both entity shapes (`w.path` / `w.record.path`).
 */
export const workspaceForCwd = (cwd, workspaces) => {
  let canonical = ''
  try { canonical = fs.realpathSync(cwd) } catch { canonical = path.resolve(cwd) }
  return (workspaces ?? []).find((w) => (w.record?.path ?? w.path ?? '') === canonical) ?? null
}

export function apply(ctx, config = {}) {
  const port = Number(process.env.DSH_MOBILE_BRIDGE_PORT ?? config.port ?? 8787)
  // Tool calls whose assistant message is not in the page; filled per snapshot and
  // never shared between sessions (a stale entry used to leak rows across transcripts).
  const orphanCalls = new Map()
  // Attachment refs seen in a transcript, so /v1/attachments/<id> can read the bytes back (bounded: the oldest fall out, and the host
  // still serves an unremembered id).
  const imageRefs = Object.assign(new Map(), { set(k, v) { this.delete(k); Map.prototype.set.call(this, k, v); if (this.size > 2000) this.delete(this.keys().next().value); return this } })
  const log = (...args) => console.log('[mobile-bridge]', ...args)
  const saved = loadState()
  // Older stores kept bare token strings; give them the device-record shape.
  if (Array.isArray(saved.tokens)) saved.tokens = saved.tokens.map((e) => (typeof e === 'string' ? { t: e, name: 'device', at: 0 } : e))

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
      if (event.type === 'turn/end') noteTurnEnd(sessionId, event.data)
      pushFeed(sessionId, event.type, event.data, { seq: event.seq, time: event.time })
    },
    { global: true },
  )

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
  // ---- Pending interactions: approvals, questions, plan reviews ---------------------------------
  //
  // Who answers is decided per request, never per session:
  //  * a desktop client is attached (client.js heartbeat / open long-poll) -> the request goes straight to
  //    next(): the desktop's own approval / question UI owns it exactly as officially, and client.js mirrors
  //    that UI's pending objects here (POST /v1/desktop/state), so the phone shows and answers the very same
  //    objects (a phone answer is queued for the client, which calls the object's own answer()/dismiss());
  //  * no desktop client but a paired phone was seen recently -> the bridge answers itself: the request is
  //    held until the phone answers or the host aborts it (request.signal) -- never handed back on a timer;
  //  * neither -> next() at once (the official fail-closed path).
  const PHONE_RECENT_MS = Number(config.phoneRecentMs ?? 5 * 60_000) // a paired phone counts as "around" this long after its last request
  const DESKTOP_GRACE_MS = 6000 // a desktop client stays attached this long after its last sign of life
  const COMMAND_ACK_MS = 8000 // how long a phone answer waits for the desktop client to apply it
  const POLL_MAX_MS = 25000

  const desktop = new Map() // clientId -> { id, seenAt, polls, items, queue, wakers, firstSeen }
  const commands = new Map() // commandId -> { clientId, done }
  const held = new Map() // alias -> item the bridge itself holds (no desktop client was attached)
  const hiddenCalls = new Set() // `${sessionId}\n${callId}`: questions the phone collapsed; the tool row reopens them

  const phoneRecent = () => {
    const now = Date.now()
    return state.tokens.some((e) => now - (e.seen ?? 0) < PHONE_RECENT_MS)
  }
  const aliasOf = (clientId, key) => `d${crypto.createHash('sha1').update(`${clientId}\n${key}`).digest('hex').slice(0, 10)}`

  const touchDesktop = (id) => {
    let c = desktop.get(id)
    if (!c) {
      c = { id, seenAt: 0, polls: 0, items: [], queue: [], wakers: new Set(), firstSeen: new Map() }
      desktop.set(id, c)
    }
    c.seenAt = Date.now()
    return c
  }
  const desktopLive = (c) => c.polls > 0 || Date.now() - c.seenAt < DESKTOP_GRACE_MS
  const desktopAttached = () => {
    for (const c of desktop.values()) if (desktopLive(c)) return true
    return false
  }
  const dropDesktop = (id) => {
    const c = desktop.get(id)
    if (!c) return
    desktop.delete(id)
    for (const wake of [...c.wakers]) wake()
    for (const cmd of [...commands.values()]) if (cmd.clientId === id) cmd.done({ ok: false, error: 'undelivered' })
  }
  const sweepDesktop = () => {
    for (const [id, c] of desktop) if (!desktopLive(c) && Date.now() - c.seenAt > 60_000) dropDesktop(id)
  }

  /** Queue one command for a desktop client and wait for its ack: {ok, error?, value?}. */
  const sendCommand = (clientId, cmd) => new Promise((resolve) => {
    const c = desktop.get(clientId)
    if (!c || !desktopLive(c)) return resolve({ ok: false, error: 'undelivered' })
    const id = crypto.randomBytes(6).toString('hex')
    const done = (result) => {
      if (!commands.delete(id)) return
      clearTimeout(timer)
      resolve(result)
    }
    const timer = setTimeout(() => done({ ok: false, error: 'undelivered' }), COMMAND_ACK_MS)
    commands.set(id, { clientId, done })
    c.queue.push({ id, ...cmd })
    for (const wake of [...c.wakers]) wake()
  })

  /** What a desktop client mirrored, kept bounded: one record per pending object of that renderer. */
  const cleanDesktopItems = (clientId, raw) => {
    const out = []
    for (const it of (Array.isArray(raw) ? raw : []).slice(0, 40)) {
      const key = clipStr(it?.key, 300)
      const sessionId = clipStr(it?.sessionId, 200)
      if (key === '' || sessionId === '') continue
      const kind = it.kind === 'approval' || it.kind === 'plan-review' ? it.kind : 'question'
      const base = { key, id: aliasOf(clientId, key), source: 'desktop', clientId, sessionId, kind, callId: clipStr(it.callId, 200) || null, at: Date.now() }
      if (kind === 'approval') {
        out.push({ ...base, toolName: clipStr(it.toolName, 200) || 'tool', reason: clipStr(it.reason, 4000), displayReason: cleanLoc(it.displayReason) })
        continue
      }
      const card = it.card && typeof it.card === 'object' ? it.card : {}
      const cd = card.countdown && Number.isFinite(card.countdown.remainingMs) ? { remainingMs: Math.max(0, card.countdown.remainingMs), running: card.countdown.running === true, at: Date.now() } : null
      out.push({
        ...base,
        questions: (Array.isArray(it.questions) ? it.questions : []).slice(0, 24).map(cleanQuestion),
        dismissal: it.dismissal === 'hide' ? 'hide' : 'cancel',
        state: card.state === 'continued' ? 'continued' : 'open',
        card: { waitState: clipStr(card.waitState, 20), countdown: cd },
      })
    }
    return out
  }

  /** Everything the phone can answer right now (desktop mirrors, then the bridge's own holds). */
  const pendingItems = () => {
    const out = []
    for (const c of desktop.values()) {
      if (!desktopLive(c)) continue
      for (const it of c.items) out.push(it)
    }
    for (const it of held.values()) if (!it.hidden) out.push(it)
    return out
  }

  /** A timed question the host moved past (continued, still answerable through the projection) that nobody else shows: only without a desktop client. */
  const continuedRows = (sessionId, uq) => (desktopAttached() ? [] : (Array.isArray(uq?.active) ? uq.active : []).filter((row) => row?.state === 'continued'
    && typeof row.callId === 'string'
    && !hiddenCalls.has(`${sessionId}\n${row.callId}`)
    && ![...held.values()].some((h) => h.sessionId === sessionId && h.callId === row.callId)))
  const continuedItems = (sessionId, uq) => {
    const out = []
    for (const row of continuedRows(sessionId, uq)) {
      out.push({
        id: `c.${Buffer.from(JSON.stringify([sessionId, row.callId]), 'utf8').toString('base64url')}`,
        source: 'projection', sessionId, callId: row.callId, kind: planReviewOf(row.questions) ? 'plan-review' : 'question',
        questions: (Array.isArray(row.questions) ? row.questions : []).slice(0, 24).map(cleanQuestion),
        dismissal: 'hide', state: 'continued', card: null, at: 0,
      })
    }
    return out
  }

  const RANK = { approval: 0, question: 1, 'plan-review': 2 }
  /** A question whose only item is an approval intent reads as an approval (asker's labels), not a question. */
  const intentApproval = (item) => (item.kind === 'question' && item.questions?.length === 1 && item.questions[0].intent?.kind === 'approval' ? item.questions[0] : null)
  const attentionKind = (item) => (item.kind === 'approval' || intentApproval(item) ? 'approval' : item.kind)

  /** session id -> the pending kind that wins on the desktop (plan review > question > approval); children bubble to their parent. */
  const attentionMap = (rows, parentOf) => {
    const out = new Map()
    const bump = (id, kind) => { if (id && (RANK[kind] ?? -1) > (RANK[out.get(id)] ?? -1)) out.set(id, kind) }
    const seen = pendingItems()
    for (const it of seen) {
      const kind = attentionKind(it)
      bump(it.sessionId, kind)
      const parent = parentOf(it.sessionId)
      if (parent) bump(parent, kind)
    }
    if (!desktopAttached()) {
      for (const r of rows) {
        if (continuedRows(r.id, r.projections?.userQuestions).length === 0) continue
        bump(r.id, 'question')
        const parent = parentOf(r.id)
        if (parent) bump(parent, 'question')
      }
    }
    return out
  }

  // A local reverse proxy (cloudflared, but also ngrok / nginx) reaches us from 127.0.0.1 too; it always stamps its own headers.
  // The Host must name the loopback too: a web page of another site whose DNS name was rebound to 127.0.0.1 arrives from it with its own Host.
  const isLoopback = (req) => ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.socket.remoteAddress ?? '')
    && /^(?:127\.0\.0\.1|localhost|\[::1\])(?::\d+)?$/i.test(req.headers.host ?? '')
    && !req.headers['cf-connecting-ip'] && !req.headers['cf-ray']
    && !req.headers['x-forwarded-for'] && !req.headers['x-forwarded-host'] && !req.headers.forwarded && !req.headers['x-real-ip']
  // Browsers stamp cross-origin requests; a page of another site is not the DSH renderer.
  const originOk = (req) => {
    const o = req.headers.origin
    if (!o || o === 'null') return true
    try {
      const u = new URL(o)
      return u.protocol !== 'http:' && u.protocol !== 'https:' ? true : ['127.0.0.1', 'localhost', '[::1]'].includes(u.hostname)
    } catch { return false }
  }

  /** A pending interaction by its phone-facing id: a mirrored / held one, or a continued question rebuilt from the projection. */
  const findQuestion = async (id) => {
    const hit = pendingItems().find((x) => x.id === id)
    if (hit) return hit
    if (!id.startsWith('c.')) return null
    try {
      const [sessionId, callId] = JSON.parse(Buffer.from(id.slice(2), 'base64url').toString('utf8'))
      const uq = (await readProjections(String(sessionId)))?.userQuestions
      return continuedItems(String(sessionId), uq).find((x) => x.callId === callId) ?? null
    } catch { return null }
  }

  // ---- the fallback: the bridge answers while no desktop client is attached ---------------------
  ctx.on(
    'approval/request',
    (req, next) => {
      try {
        if (desktopAttached() || !phoneRecent()) return next()
        const sessionId = req?.agent?.session?.id ?? req?.agent?.id ?? null
        if (!sessionId) return next()
        const signal = req?.signal
        if (signal?.aborted) return 'cancelled'
        const id = `b${crypto.randomBytes(5).toString('hex')}`
        const reason = reasonText(req)
        return new Promise((resolve) => {
          const finish = (value) => {
            if (!held.delete(id)) return
            signal?.removeEventListener('abort', onAbort)
            resolve(value)
          }
          const onAbort = () => { pushFeed(sessionId, 'approval/withdrawn', { approvalId: id }); finish('cancelled') }
          held.set(id, { id, source: 'bridge', kind: 'approval', sessionId, toolName: req?.toolName ?? 'tool', callId: req?.callId ?? null, reason: reason ?? '', displayReason: undefined, at: Date.now(), settle: finish, drop: () => finish('unavailable') })
          signal?.addEventListener('abort', onAbort, { once: true })
          pushFeed(sessionId, 'approval/request', { approvalId: id, toolName: req?.toolName ?? null, callId: req?.callId ?? null, reason })
          log('approval held for the phone:', id, req?.toolName)
        })
      } catch (err) {
        log('approval fallback failed, handing to the desktop:', String(err))
        return next()
      }
    },
    { prepend: true },
  )

  ctx.on(
    'user-questions/request',
    (request, next) => {
      try {
        const asked = Array.isArray(request?.questions) ? request.questions : []
        if (desktopAttached() || !phoneRecent() || asked.length === 0) return next()
        const sessionId = request?.agent?.session?.id ?? request?.agent?.id ?? null
        if (!sessionId) return next()
        const signal = request.signal
        if (signal?.aborted) return next()
        const id = `b${crypto.randomBytes(5).toString('hex')}`
        const callId = typeof request?.wait?.callId === 'string' ? request.wait.callId : null
        const questions = asked.slice(0, 24).map(cleanQuestion)
        return new Promise((resolve, reject) => {
          const finish = (fn) => {
            if (!held.delete(id)) return
            signal?.removeEventListener('abort', onAbort)
            fn()
          }
          // The host aborted the request: the turn stopped, or its timed wait ended (the question is then
          // `continued` and the projection, not this hold, keeps it answerable).
          const onAbort = () => { pushFeed(sessionId, 'question/withdrawn', { id }); finish(() => reject(questionError('ASK_ABORTED'))) }
          held.set(id, {
            id, source: 'bridge', kind: planReviewOf(questions) ? 'plan-review' : 'question', sessionId, callId, questions,
            dismissal: callId ? 'hide' : 'cancel', state: 'open', card: null, at: Date.now(), hidden: false,
            settle: (answer) => finish(() => resolve(answer)),
            cancel: () => finish(() => reject(questionError('ASK_CANCELLED'))),
            drop: () => finish(() => reject(questionError('ASK_ABORTED'))),
          })
          signal?.addEventListener('abort', onAbort, { once: true })
          pushFeed(sessionId, 'question/request', { id, callId })
          log('question held for the phone:', id, questions.length)
        })
      } catch (err) {
        log('question fallback failed, handing to the desktop:', String(err))
        return next()
      }
    },
    { prepend: true },
  )

  // ---- answering --------------------------------------------------------------------------------
  /** A phone answer as the host expects it: one item per question (a missing one is a skip), bounded. */
  const normalizeAnswers = (item, raw) => {
    const given = new Map()
    for (const a of Array.isArray(raw) ? raw : []) if (a && typeof a.id === 'string') given.set(a.id, a)
    return item.questions.map((q) => {
      const a = given.get(q.id)
      const selected = (Array.isArray(a?.selected) ? a.selected : []).filter((s) => typeof s === 'string').slice(0, 64).map((s) => s.slice(0, 2000))
      const custom = typeof a?.custom === 'string' ? a.custom.slice(0, 20000) : ''
      return { id: q.id, selected, ...(custom.trim() === '' ? {} : { custom }) }
    })
  }

  /** The agent a continued question belongs to, and the answer through the host service. */
  const answerContinued = async (sessionId, callId, answers) => {
    const svc = ctx.get('userQuestions')
    const agent = ctx.get('agents')?.get?.(sessionId)
    if (!svc || typeof svc.answer !== 'function' || !agent) return { ok: false, error: 'unavailable' }
    try {
      const accepted = await svc.answer(agent, callId, { answers })
      return accepted ? { ok: true } : { ok: false, error: 'expired' }
    } catch (err) {
      const code = String(err?.code ?? '')
      return { ok: false, error: code === 'REPLY_QUEUED' ? 'expired' : String(err?.message ?? err).slice(0, 300) }
    }
  }

  const answerQuestionItem = async (item, raw) => {
    const answers = normalizeAnswers(item, raw)
    if (item.source === 'bridge') {
      item.settle({ answers })
      return { ok: true }
    }
    if (item.source === 'projection') return answerContinued(item.sessionId, item.callId, answers)
    return sendCommand(item.clientId, { op: 'answer', key: item.key, answers })
  }

  /** The phone's verdict on an approval: allow / deny / always (a tool approval has no persistent grant, so always = allow once). */
  const decideItem = async (item, decision) => {
    if (item.kind === 'approval') {
      const outcome = decision === 'allow' || decision === 'always' ? 'allowed-once' : 'rejected'
      if (item.source === 'bridge') {
        item.settle(outcome)
        return { ok: true, decision: outcome }
      }
      const r = await sendCommand(item.clientId, { op: 'answer', key: item.key, decision: outcome })
      return { ...r, decision: outcome }
    }
    const q = intentApproval(item)
    if (!q) return { ok: false, error: 'not_an_approval' }
    const intent = q.intent
    const label = decision === 'deny' ? intent.reject : decision === 'always' && intent.always ? intent.always : intent.approve
    const r = await answerQuestionItem(item, [{ id: q.id, selected: [label] }])
    return { ...r, decision }
  }

  const dismissItem = async (item) => {
    if (item.source === 'bridge') {
      if (item.dismissal === 'hide') item.hidden = true
      else item.cancel()
      return { ok: true }
    }
    if (item.source === 'projection') {
      hiddenCalls.add(`${item.sessionId}\n${item.callId}`)
      return { ok: true }
    }
    return sendCommand(item.clientId, { op: 'dismiss', key: item.key })
  }

  /** Put a collapsed question back: in every attached desktop client, and in the bridge's own hide set. */
  const revealQuestion = async (sessionId, callId) => {
    hiddenCalls.delete(`${sessionId}\n${callId}`)
    let shown = false
    for (const it of held.values()) if (it.sessionId === sessionId && it.callId === callId && it.hidden) { it.hidden = false; shown = true }
    const results = await Promise.all([...desktop.values()].filter(desktopLive).map((c) => sendCommand(c.id, { op: 'reveal', sessionId, callId })))
    // Without a desktop client the card is rebuilt from the projection; with one, some renderer must hold it.
    return { ok: shown || !desktopAttached() || results.some((r) => r.ok && r.value === true), error: 'expired' }
  }

  const reply = (res, r) => {
    if (r.ok) return json(res, 200, { ok: true, ...(r.decision ? { decision: r.decision } : {}) })
    const msg = String(r.error ?? 'undelivered')
    // A desktop object that already settled says so in its own words; the phone only needs "gone".
    const gone = msg === 'expired' || /already settled|no longer answerable|not answerable/i.test(msg)
    // A card that has no channel yet (its claim is still opening) will take the answer in a moment.
    if (!gone && /no channel accepts/i.test(msg)) return json(res, 409, { error: 'unavailable' })
    return json(res, gone ? 404 : 409, { error: gone ? 'expired' : msg })
  }

  // ---- the phone's view of the pending interactions ---------------------------------------------
  const SHELL_TOOLS = new Set(['bash', 'shell', 'pwsh'])
  /** The command (or terminal text) the correlated call wants to run. For a shell tool the card's `args` already IS the command, not JSON. */
  const approvalCommand = (toolName, call) => {
    if (!call) return ''
    const name = String(call.name ?? toolName ?? '')
    const text = String(call[FULL]?.args ?? call.args ?? '')
    if (SHELL_TOOLS.has(name)) return truncate(text, 2000)
    try {
      const a = JSON.parse(text)
      const c = name === 'terminal_send' ? a?.text : (a?.command ?? a?.cmd)
      return typeof c === 'string' ? truncate(c, 2000) : ''
    } catch { return '' }
  }

  /** One approval card: a tool approval (reason, correlated command) or a question-intent approval (the asker's labels). */
  const approvalRow = (item, call) => {
    const q = intentApproval(item)
    if (q) {
      const intent = q.intent
      return {
        id: item.id,
        toolName: '',
        reason: locText(intent.display?.question) || q.question,
        callId: item.callId ?? '',
        command: '',
        summary: '',
        args: '',
        subject: intent.subject?.name ?? '',
        detail: locText(intent.display?.detail) || q.detail || '',
        approveLabel: locText(intent.display?.approve) || intent.approve,
        alwaysLabel: intent.always ?? '',
      }
    }
    return {
      id: item.id,
      toolName: item.toolName ?? 'tool',
      reason: locText(item.displayReason) || item.reason || '',
      callId: item.callId ?? '',
      command: approvalCommand(item.toolName, call),
      summary: call?.summary ?? '',
      args: call?.args ?? '',
      subject: '',
      detail: '',
      approveLabel: '',
      alwaysLabel: '',
    }
  }

  const planViews = new Map()
  /** The plan card's data: title, first paragraph, and the full plan as Markdown nodes (cached: the phone polls this). */
  const planView = (review) => {
    const key = `${review.plan.length}:${review.plan.slice(0, 200)}:${review.plan.slice(-200)}`
    let v = planViews.get(key)
    if (!v) {
      const { title, description } = planSummary(review.plan)
      const nodes = streamNodes(review.plan).slice(0, 60)
      // The phone polls this every 0.7 s while the card is up: keep the nodes inside a budget (the full text stays on the Mac).
      while (nodes.length > 8 && JSON.stringify(nodes).length > 32000) nodes.pop()
      v = { title, description, nodes, chars: review.plan.length, approve: review.approve.label }
      planViews.set(key, v)
      while (planViews.size > 6) planViews.delete(planViews.keys().next().value)
    }
    return v
  }

  /** One question card (or plan review): the items, the desktop's own wait state (countdown / held / continued) and what closing it does. */
  const questionRow = (item) => {
    const review = item.kind === 'plan-review' ? planReviewOf(item.questions) : null
    const cd = item.card?.countdown ?? null
    const left = cd ? (cd.running ? cd.at + cd.remainingMs - Date.now() : cd.remainingMs) : -1000
    return {
      id: item.id,
      callId: item.callId ?? '',
      kind: review ? 'plan-review' : 'question',
      state: item.state === 'continued' ? 'continued' : 'open',
      dismissal: item.dismissal === 'hide' ? 'hide' : 'cancel',
      // Seconds the desktop's own countdown has left; -1 for a question that carries none.
      countdown: cd ? Math.max(0, Math.ceil(left / 1000)) : -1,
      running: Boolean(cd?.running),
      held: cd !== null && (item.card?.waitState === 'waiting' || item.card?.waitState === 'editing'),
      questions: item.questions.map((q) => ({
        id: q.id,
        header: q.header ?? '',
        question: q.question,
        // A plan review's detail IS the plan (shipped once, as plan.nodes); a question's is capped: this rides every poll.
        detail: review ? '' : truncate(q.detail ?? '', 8000),
        multiSelect: q.multiSelect === true,
        options: q.options.map((o, k) => {
          const shown = optionText(o.label)
          return { id: `o${k}`, label: o.label, text: shown.text, recommended: shown.recommended, description: o.description ?? '' }
        }),
      })),
      plan: review ? planView(review) : null,
    }
  }

  /** What the phone shows for one session: approval cards, the one question / plan review that owns the composer. */
  const interactionsFor = (sessionId, uq, callIndex) => {
    // Never let a malformed mirror take the whole poll down: the phone then simply shows nothing pending.
    try {
      const mine = [...pendingItems(), ...continuedItems(sessionId, uq)].filter((it) => it.sessionId === sessionId)
      const lookup = (it) => (it.callId ? (callIndex?.get(it.callId) ?? callIndexes.get(sessionId)?.get(it.callId) ?? null) : null)
      const approvals = mine.filter((it) => attentionKind(it) === 'approval').sort((a, b) => a.at - b.at).map((it) => approvalRow(it, lookup(it)))
      const asks = mine.filter((it) => attentionKind(it) !== 'approval').sort((a, b) => RANK[b.kind] - RANK[a.kind] || a.at - b.at)
      return { approvals, question: asks.length > 0 ? questionRow(asks[0]) : null }
    } catch (err) {
      log('interactions view failed:', String(err))
      return { approvals: [], question: null }
    }
  }

  // ---- Session reads (Host sessionController service) -----------------------
  const sc = () => ctx.get?.('sessionController') ?? ctx.sessionController

  // ---- the composer's host services (Wave 5) ---------------------------------------------------------------------------
  // commands, fileReferences and fileUploads take an Agent, not a session id: the live one, or (resume) for a cold session the one the
  // host's own `agent` lookup resumes (what the Remote wire does to turn a sessionId into an Agent).
  const agentFor = async (sessionId, resume = true) => {
    try {
      const live = ctx.get('agents')?.get?.(sessionId)
      if (live || !resume) return live ?? null
      return (await ctx.get('typert')?.lookups?.get?.('agent')?.resolve?.(sessionId)) ?? null
    } catch { return null }
  }
  const sizeText = (n) => {
    const b = Number(n)
    if (!Number.isFinite(b) || b < 0) return ''
    return b < 1024 ? `${b} B` : b < 1048576 ? `${(b / 1024).toFixed(1)} KB` : `${(b / 1048576).toFixed(1)} MB`
  }
  const LATER = Symbol('later') // a command still running when its answer is due
  // What the phone may attach: the host's image count (a message's images), and whether staged files can be taken at all.
  // The host stores a file verbatim and limits nothing, so the phone's per-file cap is this bridge's.
  const FILE_CAP = 32 * 1024 * 1024
  const readLimits = () => {
    let images = 20
    let files = false
    try {
      const n = ctx.get('attachments')?.imageLimits?.maxImagesPerMessage
      if (Number.isSafeInteger(n) && n > 0) images = n
      files = typeof ctx.get('fileUploads')?.uploadStream === 'function'
    } catch { /* the defaults stand */ }
    return { images, files, fileBytes: FILE_CAP }
  }
  // ---- version and capabilities (O7) ----------------------------------------------------------------------------------------------------
  // BRIDGE_API is this bridge's wire revision: the phone shows a hint when the bridge it talks to is older than what it needs. The host's
  // own version (rc.3 vs rc.4 differ in what they serve) is read from its package manifest when the package service can say, and the
  // capabilities are what this process can actually do right now: every feature that needs a host service or projection checks for it,
  // so an older or leaner host degrades to "not offered" instead of throwing.
  const BRIDGE_API = 11
  let dshVersionCache = null
  const dshVersion = () => {
    if (dshVersionCache !== null) return dshVersionCache
    let v = ''
    try {
      const packages = ctx.get('pluginPackages')
      for (const name of ['@deepseek-ai/dsh-app-boot', '@deepseek-ai/dsh-api-session-controller']) {
        const found = packages?.packageOf?.(name, import.meta.url)?.version
        if (typeof found === 'string' && found !== '') { v = found; break }
      }
    } catch { /* unknown stays '' */ }
    if (v !== '') dshVersionCache = v // an unknown version is asked again (the package service may not have been ready)
    return v
  }
  const has = (service, fn) => { try { return typeof ctx.get(service)?.[fn] === 'function' } catch { return false } }
  const capabilities = () => {
    let open = false
    try { const c = sc(); open = typeof c?.openWorkspacePath === 'function' && c.canOpenWorkspacePath?.() === true } catch { /* no desktop to open on */ }
    return {
      open, feedback: has('messageFeedback', 'put'), schedules: has('schedule', 'list'), changes: has('workspaceChanges', 'diff'),
      readMarks: hostReads() !== null, subagentSend: has('subagents', 'prompt'), jobOutput: has('jobs', 'readAt'), files: has('fileUploads', 'uploadStream'),
      commands: has('commands', 'execute'), settings: has('settings', 'describe'),
    }
  }
  let bridgeInfoCache = { at: 0, value: null }
  // What the live poll carries (a few bytes): the wire revision and the one capability the phone reads on every screen.
  const bridgeInfo = () => {
    if (bridgeInfoCache.value === null || Date.now() - bridgeInfoCache.at > 30_000) bridgeInfoCache = { at: Date.now(), value: { api: BRIDGE_API, open: capabilities().open } }
    return bridgeInfoCache.value
  }
  /** attachmentErrorText (ui-conversation image-labels.ts): the official wording of a host attachment refusal, null for a reason it has none for. */
  const attachmentText = (lang, reason) => {
    let lim = null
    try { lim = ctx.get('attachments')?.imageLimits ?? null } catch { /* no limits: the generic line */ }
    const mb = (b) => { const m = b / 1048576; return `${Number.isInteger(m) ? m : m.toFixed(1)}MB` }
    switch (reason) {
      case 'MODEL_DOES_NOT_SUPPORT_IMAGES': return copy(lang, 'image.modelUnsupported')
      case 'FILE_NOT_STAGED': return copy(lang, 'file.notStaged')
      case 'IMAGE_TOO_MANY_PIXELS': return copy(lang, 'image.tooManyPixels')
      case 'IMAGE_DIMENSION_TOO_LARGE': return lim ? copy(lang, 'image.dimensionTooLarge', { size: lim.maxImageDimension }) : null
      case 'INVALID_IMAGE': case 'IMAGE_TYPE_MISMATCH': case 'UNSUPPORTED_IMAGE_TYPE': return copy(lang, 'image.unsupportedType')
      case 'TOO_MANY_IMAGES': return lim ? copy(lang, 'image.tooMany', { count: lim.maxImagesPerMessage }) : null
      case 'IMAGE_TOO_LARGE': return lim ? copy(lang, 'image.fileTooLarge', { size: mb(lim.maxImageBytes) }) : null
      case 'IMAGES_TOO_LARGE': return lim ? copy(lang, 'image.totalTooLarge', { size: mb(lim.maxMessageImageBytes) }) : null
      case 'SUBAGENT_FILE_UNSUPPORTED': return copy(lang, 'file.subagent')
      default: return null
    }
  }
  /** A host refusal as the phone words it: an attachment reason in the official copy, anything else the host's own message. */
  const promptFailure = (lang, err) => {
    const code = String(err?.code ?? '')
    if (code === 'session/attachment-invalid' || code === 'subagent/attachment-invalid') {
      const reason = String(err?.details?.reason ?? '')
      return attachmentText(lang, reason) ?? (reason !== '' ? copy(lang, 'image.sendFailed', { reason }) : String(err?.message ?? err))
    }
    return String(err?.message ?? err)
  }
  /** One queued inbox item as the phone's queue dock shows it (ui-conversation QueueDock): its text, its images and files, and whether it can be edited (text only). */
  const queueRow = (q, i) => {
    const content = Array.isArray(q?.content) ? q.content : Array.isArray(q?.message?.content) ? q.message.content : null
    const images = []
    const files = []
    for (const b of content ?? []) {
      const ref = b?.attachment
      if (b?.type === 'image' && ref?.attachmentId) {
        imageRefs.set(ref.attachmentId, ref)
        if (images.length < 20) images.push({ id: `i${images.length}`, att: ref.attachmentId, media: ref.mediaType ?? 'image/png', w: ref.width ?? 0, h: ref.height ?? 0, text: ref.name ?? 'Image' })
      } else if (b?.type === 'file' && ref && files.length < 20) files.push({ id: `f${files.length}`, path: truncate(String(ref.name ?? 'file'), 120), text: sizeText(ref.bytes) })
    }
    const text = content === null ? String(q?.text ?? '') : content.filter((b) => b?.type === 'text').map((b) => b.text ?? '').join('')
    return { id: String(q?.id ?? q?.messageId ?? q?.message?.id ?? `q${i}`), text: truncate(text, 400), images, files, editable: content === null || content.every((b) => b?.type === 'text') }
  }
  /** formatFileMention (file-reference grammar.ts): `@path`, or `@"path"` for a path with whitespace; a directory keeps its trailing slash and, when quoted, its open quote (`close` ends it). undefined for a path the grammar cannot carry. */
  const fileMention = (c, preserveQuote, close = false) => {
    const p = c.kind === 'directory' ? `${c.path}/` : c.path
    if (/[\u0000-\u001f\u007f-\u009f"]/u.test(p)) return undefined
    if (!(preserveQuote || /\s/u.test(p))) return `@${p}`
    return c.kind === 'directory' && !close ? `@"${p}` : `@"${p}"`
  }
  /** The @ menu's candidates (ui-reference): files and folders from the host's fileReferences discovery, the session's own subagents, then other sessions; each carries the text the draft shows and, for a session, the wire mention sent in its place. */
  const refCandidates = async (sessionId, query, quoted, lang) => {
    const rows = []
    const add = (kind, section, row) => { rows.push({ kind, section, ...row }) }
    const drilled = query.includes('/')
    try {
      const agent = await agentFor(sessionId)
      const svc = ctx.get('fileReferences')
      if (agent && typeof svc?.list === 'function') {
        for (const c of (await svc.list(agent, query, AbortSignal.timeout(5000))).slice(0, 20)) {
          if (!c || typeof c.path !== 'string' || (c.kind !== 'file' && c.kind !== 'directory')) continue
          const text = fileMention(c, quoted)
          if (text === undefined) continue
          const slash = c.path.lastIndexOf('/')
          const dir = c.kind === 'directory'
          add(dir ? 'dir' : 'file', 'files', { name: `${c.path.slice(slash + 1)}${dir ? '/' : ''}`, detail: !drilled && slash > 0 ? c.path.slice(0, slash) : '', text, done: dir ? fileMention(c, quoted, true) : text, wire: '' })
        }
      }
    } catch (err) { log('file references failed:', String(err?.message ?? err)) }
    if (!quoted && !drilled) {
      try {
        const q = query.toLowerCase()
        const listing = await mergeStatus(false, lang)
        const me = listing.find(sessionId)
        const here = me?.meta?.cwd ?? me?.cwd ?? null
        const hit = (label, cwd, id) => q === '' || `${label}\n${cwd ?? ''}\n${id}`.toLowerCase().includes(q)
        const kids = new Set()
        for (const c of (Array.isArray(me?.meta?.projections?.subagentCatalog) ? me.meta.projections.subagentCatalog : []).slice(0, 12)) {
          const id = String(c?.id ?? '')
          const label = String(c?.label ?? c?.name ?? '')
          if (id === '' || id === sessionId || !hit(label, null, id)) continue
          kids.add(id)
          const l = mentionLabel(label, id)
          add('subagent', 'subagents', { name: l, detail: '', text: `@${l}`, done: '', wire: sessionMention(id, l) })
        }
        const others = listing.rows.filter((r) => r.id !== sessionId && !kids.has(r.id) && hit(r.title ?? '', r.cwd, r.id))
        const near = others.filter((r) => here !== null && r.cwd === here)
        for (const r of [...near, ...others.filter((r) => !near.includes(r))].slice(0, 12)) {
          const l = mentionLabel(r.title, r.id)
          const age = ago(lang, r.updatedAt) || ''
          add('session', 'sessions', { name: l, detail: r.cwd === here ? age : [r.cwd ? displayPath(r.cwd, { cwd: '', home: os.homedir() }) : copy(lang, 'ref.noCwd'), age].filter((s) => s !== '').join(' · '), text: `@${l}`, done: '', wire: sessionMention(r.id, l) })
        }
      } catch (err) { log('session references failed:', String(err?.message ?? err)) }
    }
    const seen = new Set()
    return rows.map((r, i) => {
      const first = !seen.has(r.section)
      seen.add(r.section)
      return { id: `${r.kind}${i}`, kind: r.kind, name: r.name, detail: r.detail, text: r.text, done: r.done, wire: r.wire, section: copy(lang, `ref.section.${r.section}`), first }
    })
  }
  /** The skills the composer's slash menu lists next to the commands (ui-skill): user-invocable ones from the host's session skill catalog. */
  const skillRows = async (sessionId) => {
    try {
      const svc = ctx.get('sessionSkillCatalog')
      if (typeof svc?.list !== 'function') return []
      const out = await svc.list({ sessionId }, AbortSignal.timeout(5000))
      return (Array.isArray(out?.skills) ? out.skills : []).slice(0, 200)
        .map((s) => ({ name: String(s?.name ?? ''), description: truncate(String(s?.description ?? ''), 200), userOnly: s?.modelInvocable === false }))
        .filter((s) => s.name !== '')
    } catch (err) { log('skill catalog failed:', String(err?.message ?? err)); return [] }
  }

  const textOf = (content) => {
    if (typeof content === 'string') return content
    if (!Array.isArray(content)) return ''
    return content.filter((b) => b && b.type === 'text').map((b) => b.text ?? '').join('')
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

  // process-activity.ts: a tool's running category (module-level activityKind) and the first readable argument as its live detail.
  const ACTIVITY = activityKind

  const parseArgs = (raw) => {
    if (raw == null) return null
    if (typeof raw === 'object') return raw
    try { return JSON.parse(String(raw)) } catch { return null }
  }

  const firstLine = (v) => truncate(String(v ?? '').replace(/\r?\n[\s\S]*$/, ''), 160)

  // Files a write-class call names, with the line counts its own text gives (write: its content;
  // apply_patch: the +/- lines of each section). The fallback when the result carries no diff.
  const callFiles = (name, p) => {
    if (!p || typeof p !== 'object') return []
    if ((name === 'write' || name === 'edit') && typeof p.file_path === 'string' && p.file_path.trim() !== '') {
      return [{ path: p.file_path, added: name === 'write' && typeof p.content === 'string' ? contentLines(p.content).length : 0, removed: 0 }]
    }
    const files = []
    if (name === 'apply_patch' && typeof p.input === 'string') {
      for (const line of p.input.split('\n')) {
        const m = /^\*\*\* (?:Add File|Update File|Delete File|Move to):\s*(\S.*?)\s*$/.exec(line)
        if (m) files.push({ path: m[1], added: 0, removed: 0 })
        else if (files.length > 0 && line[0] === '+') files[files.length - 1].added += 1
        else if (files.length > 0 && line[0] === '-') files[files.length - 1].removed += 1
      }
    }
    return files
  }

  // ---- ask_user_question rows (parity with ui-tool's AskQuestionRow) -----------------------------
  /** The recorded answer batch of a tool result / late reply text, or null when the text carries none. */
  const answerEntries = (text) => {
    try {
      const v = JSON.parse(text)
      if (!Array.isArray(v?.answers)) return null
      const out = []
      for (const a of v.answers) {
        if (!a || typeof a.id !== 'string' || !Array.isArray(a.selected) || !a.selected.every((x) => typeof x === 'string')) return null
        out.push({ id: a.id, selected: a.selected, ...(typeof a.custom === 'string' && a.custom !== '' ? { custom: a.custom } : {}) })
      }
      return out
    } catch { return null }
  }
  const isPendingText = (text) => {
    try {
      const v = JSON.parse(text)
      return v?.pending === true && typeof v.callId === 'string'
    } catch { return false }
  }
  /** One asked question with the answers recorded for it (selected labels, then a custom answer); none = skipped. */
  const askItems = (questions, answers) => {
    const byId = new Map((answers ?? []).map((a) => [a.id, a]))
    return questions.map((q) => {
      const a = byId.get(q.id)
      const values = a ? [...a.selected, ...(a.custom ? [a.custom] : [])] : []
      return { id: q.id, header: q.header ?? '', question: q.question, answers: values.map((v) => truncate(maskSecrets(v), 400)), skipped: answers !== null && values.length === 0 }
    })
  }
  const askCard = (b, uq) => {
    const questions = b[FULL]?.askQuestions
    if (!Array.isArray(questions) || questions.length === 0) return null
    const callId = b.callId ?? ''
    const active = (Array.isArray(uq?.active) ? uq.active : []).find((r) => r?.callId === callId)
    const settled = (Array.isArray(uq?.settled) ? uq.settled : []).find((r) => r?.callId === callId)
    const base = (state, extra = {}) => ({ state, answered: 0, total: questions.length, answerable: false, callId, items: askItems(questions, null), ...extra })
    const answered = (answers) => ({
      state: 'answered',
      answered: answers.filter((a) => a.selected.length > 0 || (a.custom ?? '') !== '').length,
      total: answers.length,
      answerable: false,
      callId,
      items: answers.length === questions.length && questions.every((q) => answers.some((a) => a.id === q.id)) ? askItems(questions, answers) : [],
    })
    const code = b[FULL]?.errCode ?? ''
    if (code === 'ASK_CANCELLED') return base('cancelled')
    if (code === 'ASK_ABORTED') return base('interrupted')
    if (b.status === 'running') return base('waiting', { answerable: Boolean(active) })
    if (code === 'TOOL_OUTCOME_UNKNOWN' && (active || settled)) {
      if (active) return base('pending', { answerable: true })
      return settled.answers.length === 0 ? base('closed') : answered(settled.answers)
    }
    if (b.status !== 'ok') return null
    const text = String(b[FULL]?.result ?? '')
    if (isPendingText(text)) {
      if (active) return base('pending', { answerable: true })
      if (!settled || settled.answers.length === 0) return base('closed')
    }
    const answers = settled?.answers ?? answerEntries(text)
    return answers === null ? null : answered(answers)
  }
  /** A late reply message (the steered answer_to_pending_question JSON) as an answered card, or null when unreadable. */
  const parseQuestionReply = (text) => {
    try {
      const v = JSON.parse(text)
      if (!Array.isArray(v?.questions)) return null
      const questions = v.questions.filter((q) => q && typeof q.id === 'string' && typeof q.question === 'string')
        .slice(0, 24).map((q) => ({ id: q.id, header: truncate(String(q.header ?? ''), 200), question: truncate(q.question, 600) }))
      const answers = answerEntries(JSON.stringify({ answers: v.answers }))
      if (questions.length === 0 || answers === null) return null
      return { state: 'answered', answered: answers.filter((a) => a.selected.length > 0 || (a.custom ?? '') !== '').length, total: questions.length, answerable: false, callId: String(v.callId ?? ''), items: askItems(questions, answers) }
    } catch { return null }
  }

  /** The call's arguments kept for the card at request time: long strings cut at FULL_CAP, nothing nested copied. */
  const keepArgs = (p) => {
    if (!p || typeof p !== 'object' || Array.isArray(p)) return null
    const out = {}
    for (const [k, v] of Object.entries(p)) out[k] = typeof v === 'string' && v.length > FULL_CAP ? v.slice(0, FULL_CAP) : v
    return out
  }
  const toolCard = (lang, name, rawArgs, env, callId) => {
    const look = TOOL_LOOKS[name] ?? { icon: 'circle', key: '' }
    const parsed = parseArgs(rawArgs)
    let pretty = typeof rawArgs === 'string' ? rawArgs : JSON.stringify(rawArgs ?? {})
    if (parsed) { try { pretty = JSON.stringify(parsed, null, 2) } catch {} }
    if (name === 'bash' || name === 'shell' || name === 'pwsh') pretty = String(parsed?.command ?? pretty)
    const card = { icon: `symbol:${look.icon}`, title: toolTitle(lang, name, parsed), summary: toolSummary(lang, name, parsed, rawArgs, env, callId), args: truncate(pretty, 2400) }
    // write / edit rows show the size of the content they carry (FileMutationRow); the collapsed row's right-hand text.
    const kb = name === 'write' || name === 'edit' ? contentKilobytes(parsed, rawArgs) : null
    if (kb !== null) card.suffix = copy(lang, 'tool.preparing.content', { kilobytes: kb })
    card[FULL] = { name, parsed: keepArgs(parsed), args: truncate(pretty, FULL_CAP), argsChars: pretty.length, files: callFiles(name, parsed), live: toolDetail(name, rawArgs, false, parsed), env }
    // Structured tools get their own body instead of a JSON dump.
    const list = Array.isArray(parsed?.todos) ? parsed.todos : Array.isArray(parsed?.items) ? parsed.items : null
    if ((name === 'todo' || name === 'todo_write') && list) {
      card.todos = list.slice(0, 24).map((t, i) => ({
        id: `t${i}`,
        text: firstLine(t?.content ?? t?.text ?? t?.title ?? ''),
        state: String(t?.status ?? 'pending'),
      }))
      // TodoRow's summary: `n/m 已完成 · <the first task in progress>` and `+k` for the others running beside it.
      const done = list.filter((t) => t?.status === 'completed').length
      const active = list.filter((t) => t?.status === 'in_progress' && typeof (t?.content ?? t?.text) === 'string' && String(t.content ?? t.text).trim() !== '')
      const head = copy(lang, 'todo.completed', { done, total: list.length })
      card.summary = active.length > 0 ? `${head} · ${firstLine(String(active[0].content ?? active[0].text).trim())}` : head
      if (active.length > 1) card.suffix = `+${active.length - 1}`
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
    if (name === 'ask_user_question' && Array.isArray(parsed?.questions)) {
      // The row's states (waiting / answered 2/3 / cancelled…) pair these with the recorded answers.
      card[FULL].askQuestions = parsed.questions.slice(0, 24).map((x, i) => ({
        id: String(x?.id ?? `q${i}`),
        header: truncate(String(x?.header ?? ''), 200),
        question: truncate(String(x?.question ?? ''), 600),
      }))
    }
    const q = Array.isArray(parsed?.questions) ? parsed.questions[0] : parsed
    if ((name === 'question' || name === 'ask_user_question') && q) {
      card.question = firstLine(q?.question ?? q?.text ?? '')
      const opts = Array.isArray(q?.options) ? q.options : []
      card.options = opts.slice(0, 6).map((o, i) => ({ id: `o${i}`, text: firstLine(typeof o === 'string' ? o : o?.label ?? '') }))
      if (name === 'ask_user_question') card.summary = card.question
    }
    return card
  }

  // ---- one transcript scan: turn / step coordinates and the Inbox claims ----------------------------------------
  // (ui-chat conversation-nodes/inbox.ts + message.ts.) A `user/message` is classified against the claim that
  // admitted it: a human message in the current next-step claim is steering (inside the running turn); a non-user
  // one in the current next-turn claim, or in an idle steer's claim, woke the turn.
  const inboxBox = () => ({ pending: [], claimed: new Set(), claimSeq: -1, firstHuman: undefined })
  const newScan = (lang, env) => ({
    lang, env, turn: null, step: null, turnStart: null, lastTurn: null,
    next: { 'next-step': inboxBox(), 'next-turn': inboxBox() },
    batch: null, humans: new Map(), commands: new Map(), summaries: new Map(), retries: new Map(),
    ended: new Map(), stepEnded: new Map(), failed: new Set(), stopped: new Set(), quota: null, retryLive: null,
    // turn -> seq of its latest `workspace/changes` event (the host serves that summary by this sequence while the session lives).
    changes: new Map(),
    // Per turn: when it started / ended, how, and the compact lifecycle events its usage is derived from.
    turns: new Map(),
  })
  const turnInfo = (st, turn) => {
    let t = st.turns.get(turn)
    if (t === undefined) { t = { startAt: undefined, endAt: undefined, endSeq: undefined, endKind: undefined, events: [] }; st.turns.set(turn, t) }
    return t
  }
  const TURN_EVENTS = new Set(['turn/start', 'step/start', 'step/end', 'turn/end', 'assistant/attempt', 'assistant/message', 'llm/retry', 'llm/retry-started'])
  /** Record one lifecycle event of a turn: its times, how it ended, and the compact entry deriveTurnUsage folds. */
  const trackTurn = (st, ev) => {
    const d = ev.data ?? {}
    const t = turnInfo(st, d.turn)
    if (ev.type === 'turn/start') t.startAt = ev.time
    if (ev.type === 'turn/end') { t.endAt = ev.time; t.endSeq = ev.seq; t.endKind = d.reason?.kind }
    const entry = { type: ev.type, turn: d.turn, step: d.step }
    if (ev.type === 'assistant/attempt') entry.usage = streamUsage(d.stream)
    if (ev.type === 'assistant/message') {
      const src = d.message?.source
      entry.usage = d.usage ?? streamUsage(d.stream)
      entry.route = typeof src?.provider === 'string' && src.provider !== '' && typeof src?.model === 'string' && src.model !== '' ? { provider: src.provider, model: src.model } : undefined
      entry.time = ev.time
      entry.firstToken = streamFirstToken(d.stream)
    }
    t.events.push(entry)
  }
  /** One `agent/inbox/spliced`: a claim empties the front of a pending list; the ids it removed are what the next user/message events classify against. */
  const spliceInbox = (st, d, seq) => {
    const box = d?.target === 'next-step' || d?.target === 'next-turn' ? st.next[d.target] : null
    if (!box) return
    const start = Number.isSafeInteger(d.start) && d.start >= 0 ? d.start : 0
    const removedCount = Number.isSafeInteger(d.removedCount) && d.removedCount > 0 ? d.removedCount : 0
    // A real pending list holds a handful of messages; the caps only keep a corrupt log from growing memory or the spread's arguments.
    const inserted = (Array.isArray(d.inserted) ? d.inserted.slice(0, 500) : []).map((m) => ({ id: String(m?.id ?? ''), human: (m?.source?.kind ?? 'user') === 'user' }))
    const removed = box.pending.splice(start, removedCount, ...inserted)
    if (box.pending.length > 1000) box.pending.length = 1000
    if (removedCount > 0 && d.outcome !== 'canceled') {
      box.claimed = new Set(removed.map((m) => m.id))
      box.claimSeq = seq
      box.firstHuman = removed.find((m) => m.human)?.id
      return
    }
    for (const m of inserted) box.claimed.delete(m.id)
  }
  /** Whether this non-user message woke its turn: it is in the next-turn claim, or it is an idle steer's notice (Step 1, a next-step claim of this turn that holds no human message). */
  const wakesTurn = (st, id) => {
    const turnBox = st.next['next-turn']
    const stepBox = st.next['next-step']
    if (turnBox.claimed.has(id)) return true
    return st.step === 1 && st.turnStart !== null && stepBox.claimSeq > st.turnStart && turnBox.claimSeq < st.turnStart
      && stepBox.firstHuman === undefined && stepBox.claimed.has(id)
  }
  /** A human message claimed into a RUNNING turn is steering; one claimed at Step 1 is that turn's own opening input (an idle steer). */
  const isSteering = (st, id) => st.next['next-step'].claimed.has(id) && st.step !== 1

  // Below the row text cap (clipRow, 4000) with room for the cut mark, so the mark is never itself cut off.
  const BODY_MAX = 3900
  /** A body for the phone: secrets masked, bounded, and told when it was cut. */
  const bodyText = (lang, text) => {
    // Cut before masking (an injected context can be megabytes), with headroom so the mask stubs never shorten the visible part.
    const raw = String(text ?? '')
    const s = maskSecrets(raw.length > BODY_MAX * 2 ? raw.slice(0, BODY_MAX * 2) : raw)
    return s.length > BODY_MAX || raw.length > BODY_MAX * 2 ? `${s.slice(0, BODY_MAX)}\n${copy(lang, 'json.truncated', { total: raw.length })}` : s
  }
  /** The model-facing text of a content list: adjacent text blocks, no separator (ContextBody's rule). */
  const modelText = (content) => content.filter((b) => b && b.type === 'text').map((b) => String(b.text ?? '')).join('')
  const addRef = (row, path, kind) => {
    if (path !== '' && path.length <= 300 && row.refs.length < 8 && !row.refs.some((r) => r.path === path && r.kind === kind)) row.refs.push({ path, kind })
  }

  /** The expanded body of a context row, by the form its producer declared (chat/ContextBody.tsx). */
  const contextBody = (lang, form, source, content) => {
    const text = modelText(content)
    const lines = []
    if (form === 'instructions') {
      const changes = instructionChanges(source)
      const baseline = asRecord(source)?.baseline === true
      for (const c of changes ?? []) {
        const word = c.action === 'remove' ? 'removed' : baseline ? 'loaded' : c.action === 'set' ? 'added' : 'updated'
        lines.push(`${c.path}  ${copy(lang, `context.instructions.${word}`)}`)
      }
    } else if (form === 'catalog') {
      const entries = catalogEntries(source)
      if (entries !== null) {
        if (asRecord(source)?.update === true) lines.push(copy(lang, 'context.catalog.replaced'))
        for (const e of entries.slice(0, 200)) lines.push(`${e.name}  ${e.description}`)
        if (entries.length > 200) lines.push(copy(lang, 'context.catalog.more', { count: entries.length - 200 }))
        return bodyText(lang, lines.join('\n')) // the entry list replaces the model-facing text
      }
    } else if (form === 'snapshot') {
      const sections = snapshotSections(source)
      if (sections !== null) return bodyText(lang, [copy(lang, 'context.snapshot.supersedes'), ...sections.map((s) => `${s.name}\n${s.text}`)].join('\n\n'))
    } else if (form === 'relay') {
      const sender = relaySender(source)
      if (sender !== null) lines.push(copy(lang, 'context.relay.from', { session: sender }))
    } else if (form === 'recall') {
      for (const s of recalledSessions(source) ?? []) {
        lines.push(`${s.label}  ${copy(lang, 'context.recall.counts', { retained: s.retained, omitted: s.omitted })}${s.truncated ? `  ${copy(lang, 'context.recall.truncated')}` : ''}`)
      }
    }
    return bodyText(lang, [lines.join('\n'), text].filter((s) => s !== '').join('\n\n'))
  }

  /** A non-user message that did not wake a turn, or a developer message: a collapsed 上下文注入 / 跨会话召回 row (chat/ContextInjectionRow.tsx), or 工具已更新 when it only changes tools. */
  const contextRow = (ev, message, st) => {
    const lang = st.lang
    const content = Array.isArray(message.content) ? message.content : []
    const source = asRecord(message.source) ?? {}
    const producer = contextProducer(source)
    const row = { id: `g${ev.seq}`, seq: ev.seq, role: 'context', at: ev.time, turn: st.turn, usage: '', tokens: null, blocks: [], state: '', summary: '' }
    const tools = content.length > 0 && content.every((b) => b?.type === 'tool-addition' || b?.type === 'tool-removal') ? content : null
    if (tools !== null) {
      const added = tools.filter((b) => b.type === 'tool-addition').map((b) => String(b.toolName ?? ''))
      const removed = tools.filter((b) => b.type === 'tool-removal').map((b) => String(b.toolName ?? ''))
      const single = tools.length === 1 ? tools[0] : null
      row.icon = 'symbol:adjust'
      row.title = single ? copy(lang, single.type === 'tool-addition' ? 'tool.added' : 'tool.removed', { name: single.toolName }) : copy(lang, 'tool.updated')
      row.summary = single ? '' : added.length > 0 && removed.length > 0 ? copy(lang, 'tool.changed', { added: added.length, removed: removed.length })
        : added.length > 0 ? copy(lang, 'tool.addedCount', { count: added.length }) : copy(lang, 'tool.removedCount', { count: removed.length })
      row.text = single ? '' : [added.length > 0 ? copy(lang, 'tool.addedNames', { names: added.join(', ') }) : '', removed.length > 0 ? copy(lang, 'tool.removedNames', { names: removed.join(', ') }) : ''].filter(Boolean).join('\n')
      row.state = single ? 'static' : ''
      return row
    }
    const note = contextForm(source) === 'notice' ? readStr(source, 'summary') : null
    row.icon = producer.role === 'recall' ? 'symbol:messages' : 'symbol:document'
    row.title = copy(lang, producer.role === 'recall' ? 'context.recall' : 'context.injection')
    row.summary = producer.label === null ? '' : [truncate(maskSecrets(producer.label), 200), note === null ? '' : truncate(maskSecrets(note), 200)].filter(Boolean).join(' · ')
    row.text = contextBody(lang, contextForm(source), source, content)
    return row
  }

  /** A non-user message that woke its turn: the Turn trigger header (chat/turn-trigger.ts), or the compact 已请求继续生成 receipt. */
  const triggerRow = (ev, message, st) => {
    const lang = st.lang
    const content = Array.isArray(message.content) ? message.content : []
    const det = triggerDetails(message.source, content)
    st.quota = null // a new turn begins: an older quota failure is history
    return {
      id: `g${ev.seq}`, seq: ev.seq, role: 'trigger', at: ev.time, turn: st.turn, usage: '', tokens: null, blocks: [],
      title: copy(lang, det.title), icon: det.icon, summary: '', state: det.compact ? 'compact' : '',
      text: det.compact ? '' : [copy(lang, 'trigger.explanation'), bodyText(lang, modelText(content))].filter((s) => s !== '').join('\n\n'),
    }
  }

  /** What the person typed: the bubble text, its @ chips, and its images (attachment refs the phone fetches through /v1/attachments). */
  const humanParts = (content, raw) => {
    const refs = []
    // A session mention travels as @[label](dsh-session:<id>): the bubble reads @label (the id
    // is opaque), the label is a ref chip, and the file-ref scan below never sees it as a path.
    const mention = /@\[((?:\\.|[^\\\]\n])+)\]\(dsh-session:[^\s)]*\)/gu
    const shown = String(raw).replace(mention, (_whole, label) => {
      const l = label.replace(/\\(.)/gu, '$1')
      if (l.length <= 300 && refs.length < 6) refs.push({ path: l, kind: 'session' })
      return `@${l}`
    })
    for (const m of String(raw).replace(mention, ' ').matchAll(/@(?:"([^"\n]+)"|([^\s，。,.!?"'()\[\]{}]+))/g)) {
      const p = (m[1] ?? m[2] ?? '').trim()
      if (p !== '' && !refs.some((r) => r.path === p) && p.length <= 300) refs.push({ path: p, kind: 'file' })
      if (refs.length >= 6) break
    }
    const images = []
    for (const b of content) {
      if (b?.type !== 'image') continue
      const ref = b.attachment ?? null
      if (!ref?.attachmentId) continue
      imageRefs.set(ref.attachmentId, ref)
      images.push({ id: `i${images.length}`, att: ref.attachmentId, media: ref.mediaType ?? 'image/png', w: ref.width ?? 0, h: ref.height ?? 0, text: ref.name ?? 'Image' })
    }
    return { shown, refs, images }
  }

  /** The compaction numbers and summary a `compaction/summary` carried, as CompactionItem shows them. */
  const compactFields = (lang, view, fallback) => {
    const expandable = view.text !== null
    return {
      summary: view.items !== null && view.tokens !== null ? copy(lang, 'compaction.completed', { items: view.items, tokens: view.tokens })
        : fallback ?? copy(lang, expandable ? 'compaction.expand' : 'compaction.unavailable'),
      text: expandable ? view.text : '',
    }
  }
  /** A command row's display fields (chat/GenericCommandCard.tsx; a manual /compact is CompactionCommandCard): idempotent, re-run after every event that touches it. */
  const showCommand = (lang, row) => {
    const o = row.outcome
    row.state = o === null ? 'running' : o.kind === 'error' ? 'error' : 'ok'
    row.role = 'command'
    row.text = ''
    if (row.name === 'compact' && row.compaction) {
      const f = compactFields(lang, row.compaction, o?.text ?? null)
      Object.assign(row, { role: 'compact', title: copy(lang, 'compaction.commandTitle'), icon: 'symbol:layers', summary: f.summary, text: f.text, state: 'ok' })
      return
    }
    const text = typeof o?.text === 'string' ? o.text : null
    row.title = row.name ?? copy(lang, 'command.title')
    row.icon = 'symbol:forward'
    row.summary = o === null ? copy(lang, row.name === 'compact' ? 'compaction.running' : 'command.running')
      : text !== null ? truncate(text.split('\n')[0], 100) : copy(lang, o.kind === 'error' ? 'command.failed' : 'command.done')
    if (text !== null && (text.includes('\n') || text.length > 100)) row.text = bodyText(lang, text)
  }
  const commandRow = (ev, st, id, name) => {
    const row = { id: `cmd${ev.seq}`, seq: ev.seq, role: 'command', at: ev.time, turn: null, usage: '', tokens: null, blocks: [], summary: '', icon: '', title: '', state: '', text: '', commandId: id, name, outcome: null, compaction: null }
    st.commands.set(id, row)
    return row
  }

  /** A failure row (chat/MessageItem.tsx TurnErrorItem / TurnMaxTokensItem); `summary` is the code badge. */
  const failureRow = (ev, st, state, title, text, code = '') => ({ id: `e${ev.seq}`, seq: ev.seq, role: 'error', at: ev.time, turn: Number.isInteger(ev.data?.turn) ? ev.data.turn : st.turn, title, text, summary: code, state, usage: '', tokens: null, blocks: [] })
  /** failureMessage(): the fixed copy for the codes that have one (AUTH never echoes the provider's message), else the message itself. */
  const failureText = (lang, code, message) => {
    if (code === 'ACCOUNT_SIGNED_OUT') return copy(lang, 'failure.accountSignedOut')
    if (code === 'INTERRUPTED') return copy(lang, 'failure.interrupted')
    if (code === 'ACCOUNT_SIGN_IN_REQUIRED') return copy(lang, 'failure.accountSignInRequired')
    if (code === 'QUOTA' || code === 'ACCOUNT_QUOTA') return copy(lang, 'failure.quota')
    return code === 'AUTH' ? copy(lang, 'failure.auth') : message
  }
  const failureMessage = (failure) => (failure?.code === 'AUTH' ? '' : maskSecrets(truncate(String(failure?.message ?? ''), 300)))

  /** The retry rows' display fields from their attempts and how the turn went on (conversation-nodes/retry.ts + MessageItem ModelRetryItem). Runs once the scan is over. */
  const finishRetries = (st) => {
    const lang = st.lang
    for (const { row, attempts } of st.retries.values()) {
      const cur = attempts[attempts.length - 1]
      const closedAt = st.ended.get(cur.turn) ?? st.stepEnded.get(`${cur.turn}:${cur.step}`)
      const state = cur.state === 'started' ? 'started' : closedAt !== undefined ? 'cancelled' : 'active'
      const seconds = state === 'active' ? retrySeconds(cur.time + cur.delayMs - Date.now()) : retrySeconds(cur.delayMs)
      const label = copy(lang, `retry.${state === 'active' ? 'active' : state}`)
      row.title = copy(lang, 'retry.status', { label, retry: cur.retry, maximum: cur.maximum, seconds })
      row.text = `${copy(lang, 'retry.delay')}${copy(lang, 'duration.milliseconds', { milliseconds: Math.round(cur.delayMs) })}\n${copy(lang, 'retry.failure')}${failureText(lang, cur.failure.code, failureMessage(cur.failure))}`
      row.state = state
      row.icon = 'symbol:refresh'
      // The row changes when its turn closes without another retry event: the incremental patch must carry it.
      if (state === 'cancelled') row.seq = Math.max(row.seq, closedAt)
      if (state === 'active') st.retryLive = { retry: cur.retry, maximum: cur.maximum, deadline: cur.time + cur.delayMs }
    }
  }

  const renderEvent = (ev, st = newScan('zh-Hans', { cwd: '', home: os.homedir() })) => {
    const type = ev?.type
    const d = ev?.data ?? {}
    const lang = st.lang
    // Coordinates every event feeds: the turn and step it belongs to, and what closes a skill batch.
    if (Number.isInteger(d.turn)) { st.turn = d.turn; st.lastTurn = Math.max(st.lastTurn ?? 0, d.turn) }
    if (Number.isInteger(d.step)) st.step = d.step
    if (type === 'turn/start') { st.step = null; st.turnStart = ev.seq }
    if (TURN_EVENTS.has(type) && Number.isInteger(d.turn)) trackTurn(st, ev)
    if (['turn/start', 'step/start', 'step/end', 'turn/end', 'assistant/message', 'tool/call', 'tool/result'].includes(type)) st.batch = null
    if (type === 'agent/inbox/spliced') { spliceInbox(st, d, ev.seq); return null }
    if (type === 'workspace/changes') { if (Number.isSafeInteger(d.turn) && d.turn >= 1) st.changes.set(d.turn, ev.seq); return null }
    if (type === 'step/end') st.stepEnded.set(`${d.turn}:${d.step}`, ev.seq)
    if (type === 'command/run') {
      const row = commandRow(ev, st, String(d.commandId), typeof d.name === 'string' && d.name !== '' ? d.name : null)
      showCommand(lang, row)
      return row
    }
    if (type === 'command/done') {
      const id = String(d.commandId)
      const known = st.commands.get(id)
      const row = known ?? commandRow(ev, st, id, null)
      row.outcome = { kind: d.kind === 'error' ? 'error' : 'success', ...(typeof d.text === 'string' ? { text: d.text } : {}) }
      row.seq = ev.seq
      showCommand(lang, row)
      return known ? null : row
    }
    if (type === 'compaction/summary') {
      const text = Array.isArray(d.summary) ? d.summary.map((b) => (b?.type === 'text' ? String(b.text ?? '') : '')).join('') : ''
      st.summaries.set(String(d.compactionId), {
        text: text.trim() === '' ? null : bodyText(lang, text),
        items: Array.isArray(d.shadowedSeqs) ? d.shadowedSeqs.length : null,
        tokens: Number.isSafeInteger(d.shadowedTokenCount) && d.shadowedTokenCount >= 0 ? d.shadowedTokenCount : null,
      })
      return null
    }
    if (type === 'llm/retry' || type === 'llm/retry-started') {
      const key = readStr(d, 'retryId') ?? `t${d.turn}s${d.step}`
      let chain = st.retries.get(key)
      if (type === 'llm/retry-started') {
        const hit = chain?.attempts.find((a) => a.retry === Number(d.retry))
        if (hit) { hit.state = 'started'; chain.row.seq = ev.seq }
        return null
      }
      const attempt = {
        turn: d.turn, step: d.step, seq: ev.seq, time: ev.time, retry: Number(d.retry ?? 0), state: 'scheduled',
        maximum: d.mode === 'always' ? '∞' : Number(d.maxRetries ?? 0), delayMs: Math.max(0, Number(d.delayMs ?? 0) || 0), failure: asRecord(d.failure) ?? {},
      }
      const fresh = chain === undefined
      if (fresh) {
        chain = { row: { id: `r${ev.seq}`, seq: ev.seq, role: 'retry', at: ev.time, turn: st.turn, usage: '', tokens: null, blocks: [], title: '', text: '', summary: '', icon: '', state: '' }, attempts: [] }
        st.retries.set(key, chain)
      }
      chain.attempts.push(attempt)
      chain.row.seq = ev.seq
      return fresh ? chain.row : null
    }
    if (type === 'developer/message') {
      const message = asRecord(d.message)
      return message === null ? null : contextRow(ev, message, st)
    }
    if (type === 'user/message') {
      const body = d.content ?? d.message?.content
      const content = Array.isArray(body) ? body : []
      const kind = d.source?.kind ?? 'user'
      // Only an append-surface message is a transcript row; a replacement is model-only. A compaction checkpoint is
      // one of those, and it is where the compaction row lands (the summary event came just before it).
      if (ev.surfaceOp !== undefined && ev.surfaceOp !== 'append') {
        if (kind !== 'compact-checkpoint' || typeof d.source?.compactionId !== 'string') return null
        const sum = st.summaries.get(d.source.compactionId)
        const view = { text: sum?.text ?? null, items: sum?.items ?? null, tokens: sum?.tokens ?? null }
        const manual = d.source.sourceCommandId === undefined ? null : String(d.source.sourceCommandId)
        if (manual !== null) {
          const known = st.commands.get(manual)
          const row = known ?? commandRow(ev, st, manual, 'compact')
          row.compaction = view
          row.seq = ev.seq
          showCommand(lang, row)
          return known ? null : row
        }
        const f = compactFields(lang, view, null)
        return { id: `cp${ev.seq}`, seq: ev.seq, role: 'compact', at: ev.time, turn: null, title: copy(lang, 'compaction.title'), icon: 'symbol:layers', summary: f.summary, text: f.text, state: 'ok', usage: '', tokens: null, blocks: [] }
      }
      if (kind === 'user-question-reply') {
        // A late answer to a continued question: shown as the 问题与回答 view, not as a runtime injection.
        const reply = parseQuestionReply(textOf(body))
        if (reply) return { id: `qr${ev.seq}`, seq: ev.seq, role: 'qreply', at: ev.time, turn: d.turn ?? null, text: '', usage: '', tokens: null, blocks: [{ id: 'b0', kind: 'qa', ask: reply }] }
      }
      if (kind !== 'user') {
        // A skill invocation names itself on the user bubble that asked for it, a session recall on the bubble it follows.
        const skill = kind === 'skill-invocation' ? readStr(d.source, 'name') : null
        if (skill !== null && st.batch !== null) {
          if (!st.batch.names.includes(skill)) st.batch.names.push(skill)
          for (const r of st.batch.rows) for (const n of st.batch.names) addRef(r, n, 'skill')
        }
        if (kind === 'session-reference') {
          const target = st.humans.get(ev.seq - 1)
          if (target) for (const label of collect(d.source, 'references', 'label')) addRef(target, label, 'session')
        }
        const turnWoken = wakesTurn(st, String(d.id ?? '')) || (kind === 'retry' && content.length === 0)
        return turnWoken ? triggerRow(ev, d, st) : contextRow(ev, d, st)
      }
      const { shown, refs, images } = humanParts(content, textOf(body))
      const text = maskSecrets(truncate(shown, 4000))
      if (isSteering(st, String(d.id ?? ''))) {
        // Inside the running turn: the assistant group takes it as a block (see the grouping pass), it opens no segment.
        return { id: `s${ev.seq}`, seq: ev.seq, role: 'steer', at: ev.time, turn: st.turn, usage: '', tokens: null, blocks: [{ kind: 'steer', text, summary: copy(lang, 'steer'), images }] }
      }
      st.quota = null // a new turn begins: an older quota failure is history
      const row = { id: `u${ev.seq}`, seq: ev.seq, role: 'user', at: ev.time, turn: st.turn, text, refs, blocks: images.map((im) => ({ kind: 'image', text: im.text, att: im.att, media: im.media, w: im.w, h: im.h })) }
      st.humans.set(ev.seq, row)
      if (st.batch === null || st.batch.names.length > 0) st.batch = { rows: [], names: [] }
      st.batch.rows.push(row)
      return row
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
      // Each block remembers its step: the turn's answer, its counts and the group order are read off it (removed before the wire).
      for (const b of content) {
        if (!b) continue
        const id = `b${blocks.length}`
        if (b.type === 'text') {
          // A blank text block is not a reply (hasAssistantReplyContent): it neither shows nor splits a process group.
          if ((b.text ?? '').trim() === '') continue
          const safe = maskSecrets(b.text ?? '')
          blocks.push({ id, step: d.step, kind: 'md', text: safe, nodes: mdNodes(safe) })
        } else if (b.type === 'reasoning' && (b.text ?? '').trim() !== '') blocks.push({ id, step: d.step, kind: 'reasoning', text: maskSecrets(truncate(b.text, 8000)) })
        else if (b.type === 'tool-call') blocks.push({ id, step: d.step, kind: 'tool', callId: b.id ?? null, name: b.name ?? 'tool', status: 'running', ...toolCard(lang, b.name ?? 'tool', b.arguments, st.env, b.id) })
        else if (b.type === 'image') {
          const ref = b.attachment ?? null
          if (ref?.attachmentId) imageRefs.set(ref.attachmentId, ref)
          blocks.push({
            id, step: d.step, kind: 'image',
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
      return { id: `a${ev.seq}`, seq: ev.seq, role: 'assistant', at: ev.time, turn: d.turn ?? null, msgId: typeof (d.message ?? d)?.id === 'string' ? (d.message ?? d).id : '', text, tokens: inTok == null && outTok == null ? null : [inTok ?? 0, outTok ?? 0], cache: cacheRead, interrupted: Boolean(d.interrupted), blocks }
    }
    if (type === 'turn/end') {
      // chat/TurnErrorItem + TurnMaxTokensItem: a failure, a max-tokens notice, a sign-out / restart stop each carry a row;
      // a user's stop carries none (the turn's group reads 已停止, see `stopped` below).
      st.ended.set(d.turn, ev.seq)
      const r = d.reason ?? {}
      if (r.kind === 'error') {
        st.failed.add(d.turn)
        const code = typeof r.error?.code === 'string' ? r.error.code : ''
        const stopped = code === 'ACCOUNT_SIGNED_OUT' || code === 'INTERRUPTED'
        const text = failureText(lang, code, failureMessage(r.error))
        const row = failureRow(ev, st, stopped ? 'stopped' : 'error', copy(lang, stopped ? 'failure.taskStopped' : 'failure.turnError'), text, code === 'INTERRUPTED' ? '' : code)
        // The quota toast follows the failure CODE, never its wording.
        if (code === 'QUOTA' || code === 'ACCOUNT_QUOTA') st.quota = { id: row.id, text }
        return row
      }
      if (r.kind === 'max-tokens') return failureRow(ev, st, 'warning', copy(lang, 'failure.maxTokens'), copy(lang, 'failure.maxTokens.hint'))
      if (r.kind === 'interrupted') {
        st.stopped.add(d.turn)
        return failureRow(ev, st, 'stopped', copy(lang, 'failure.taskStopped'), copy(lang, 'failure.interrupted'))
      }
      if (r.kind === 'aborted') {
        st.stopped.add(d.turn)
        if (r.reason?.kind === 'hook' && r.reason?.reason === 'deepseek-account/signed-out') {
          return failureRow(ev, st, 'stopped', copy(lang, 'failure.taskStopped'), copy(lang, 'failure.accountSignedOut'), 'ACCOUNT_SIGNED_OUT')
        }
      }
      return null
    }
    if (type === 'tool/call') {
      // The assistant message already carries the call block; this event is the same
      // call again. Keep it only as a fallback for providers that split calls out.
      orphanCalls.set(d.callId ?? `c${ev.seq}`, {
        id: `c${ev.seq}`, seq: ev.seq, role: 'assistant', at: ev.time, turn: d.turn ?? null, text: '',
        blocks: [{ id: 'b0', kind: 'tool', callId: d.callId ?? null, name: d.name ?? 'tool', status: 'running', ...toolCard(lang, d.name ?? 'tool', d.arguments, st.env, d.callId) }],
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
      const body = textOf(d.message?.content)
      // The shell footer `[exit code: N]` rides the END of the whole result, which the 800-char row text and the 64 KB detail both clip.
      const exitAt = body.lastIndexOf('[exit code: ')
      const exit = exitAt < 0 ? null : /^\[exit code: (\d+)\]/.exec(body.slice(exitAt, exitAt + 24))
      return {
        id: `t${ev.seq}`, seq: ev.seq, role: 'result', at: ev.time, turn: d.turn ?? null, callId,
        text: maskSecrets(truncate(body, 800)),
        failed: Boolean(d.message?.isError ?? d.error),
        diff: d.meta?.diffs ?? null,
        images,
        // The whole result for the call-detail route (the row itself stays 800 chars).
        [FULL]: {
          result: maskSecrets(truncate(body, FULL_CAP)), resultChars: body.length, errCode: String(d.error?.code ?? ''), exit: exit ? Number(exit[1]) : null,
          // What the card a tap opens is built from (toolView): the call's own result metadata, a failure's name / code / reason, and each picture's size.
          meta: keepMeta(d.meta), isError: Boolean(d.message?.isError ?? d.error),
          err: d.error && typeof d.error === 'object' ? { name: String(d.error.name ?? ''), code: String(d.error.code ?? ''), ...(typeof d.error.reason === 'string' ? { reason: d.error.reason.slice(0, 500) } : {}) } : undefined,
          imageRefs: parts.filter((part) => part?.type === 'image' && part.attachment?.attachmentId).map((part) => ({ width: part.attachment.width, height: part.attachment.height, bytes: part.attachment.bytes, ...(part.attachment.originalDimensions ? { originalWidth: part.attachment.originalDimensions.width, originalHeight: part.attachment.originalDimensions.height } : {}) })),
        },
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
// The detail comes from a per-session call index (what GET /v1/sessions/:id/call reads): the
// tool blocks of every window computed for that session, with their full args/result. Bounded
// in sessions and in calls per session; the oldest entries go first.
const callIndexes = new Map() // sessionId -> Map(callId -> tool block)
const CALL_INDEX_SESSIONS = 16
const CALL_INDEX_CALLS = 400
const rememberCalls = (sessionId, calls) => {
  const mine = callIndexes.get(sessionId) ?? new Map()
  for (const [callId, block] of calls) {
    mine.delete(callId)
    mine.set(callId, block)
  }
  while (mine.size > CALL_INDEX_CALLS) mine.delete(mine.keys().next().value)
  callIndexes.delete(sessionId)
  callIndexes.set(sessionId, mine)
  while (callIndexes.size > CALL_INDEX_SESSIONS) callIndexes.delete(callIndexes.keys().next().value)
}

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

// A turn of 40 steps is 40+ reasoning blocks and tool cards plus the groups around them. Past this many blocks a row keeps every
// reply and steering message (the answer is never dropped) and, newest first, each group with as many of its newest members as fit.
const MAX_BLOCKS = 240
const clipBlocks = (blocks) => {
  if (blocks.length <= MAX_BLOCKS) return blocks
  const units = []
  for (const b of blocks) {
    if (b.kind === 'group' || b.grp === undefined) units.push([b])
    else units[units.length - 1].push(b)
  }
  let room = MAX_BLOCKS
  const kept = new Array(units.length)
  for (let i = units.length - 1; i >= 0; i -= 1) {
    const unit = units[i]
    const fit = unit[0].kind === 'group' ? Math.min(unit.length, room) : unit.length
    if (unit[0].kind === 'group' && fit < 2) continue
    kept[i] = fit === unit.length ? unit : [unit[0], ...unit.slice(unit.length - fit + 1)]
    room -= fit
  }
  return kept.filter(Boolean).flat()
}

// One Markdown node as a row carries it: a code block, a long list or a wide table stays whole; the bounds only stop a pathological source.
const NODE_CHARS = 16000
const clipNode = (n) => {
  const node = { ...n }
  if (typeof node.v === 'string') node.v = truncate(node.v, NODE_CHARS)
  if (typeof node.head === 'string') node.head = truncate(node.head, 2000)
  if (Array.isArray(node.items) && node.t !== 'gallery') node.items = node.items.slice(0, 300).map((it) => ({ ...it, v: typeof it.v === 'string' ? truncate(it.v, 2000) : it.v }))
  if (Array.isArray(node.rows)) node.rows = node.rows.slice(0, 120).map((r) => ({ ...r, v: truncate(String(r.v ?? ''), 3000) }))
  return node
}
const clipNodes = (nodes) => nodes.slice(0, 300).map(clipNode)
// An older turn's final answer: whole nodes until this many characters of them (the newest rows keep every node).
const SLIM_ANSWER_CHARS = 6000
const slimAnswerNodes = (nodes) => {
  const out = []
  let size = 0
  for (const n of clipNodes(Array.isArray(nodes) ? nodes : [])) {
    size += JSON.stringify(n).length
    if (out.length > 0 && size > SLIM_ANSWER_CHARS) break
    out.push(n)
  }
  return out
}

const clipRow = (row) => {
  const text = truncate(String(row.text ?? ''), 4000)
  const blocks = clipBlocks(row.blocks ?? []).map((b) => {
    const copy = { ...b }
    delete copy.step
    // A steering message is its own text (no nodes carry it), so it keeps room.
    if (typeof copy.text === 'string') copy.text = truncate(copy.text, copy.kind === 'steer' ? 4000 : 1400)
    if (typeof copy.result === 'string') copy.result = truncate(copy.result, 800)
    if (copy.kind === 'tool') {
      delete copy.args
      delete copy.result
      delete copy.diffs
      // The raw meta.diffs (every changed file's full old/new text) stays in the call index; rows ship none of it.
      delete copy.diff
      copy.lazy = true
    }
    // A reply's nodes arrive whole (the answer is what the person reads): per node a pathological-source bound, no more.
    if (Array.isArray(copy.nodes)) copy.nodes = clipNodes(copy.nodes)
    return copy
  })
  // A long turn keeps its newest reasoning whole and only the first lines of the older ones (the phone shows them as previews):
  // a tool-heavy turn is resent on every tool event, and its reasoning is what would otherwise push it over the row budget.
  let fresh = 12
  for (let i = blocks.length - 1; i >= 0; i -= 1) {
    if (blocks[i].kind !== 'reasoning') continue
    if (fresh > 0) fresh -= 1
    else blocks[i].text = truncate(blocks[i].text, 240)
  }
  return {
    ...row,
    text,
    blocks,
    // Whole-turn duration in seconds (turn/start to turn/end once the turn is closed).
    took: Number(row.took ?? 0),
  }
}

// A tool call's one-line live detail (process-activity.ts liveToolDetail): the first readable argument, its text so far while
// the JSON is incomplete; complete arguments with none readable fall back to the tool's name.
const toolDetail = (name, rawArgs, preparing = false, parsedAlready) => {
  const parsed = parsedAlready === undefined ? parseArgs(rawArgs) : parsedAlready
  if (!parsed) return partialDetail(rawArgs)
  for (const key of LIVE_DETAIL_KEYS) {
    const v = parsed[key]
    if (v == null) continue
    const raw = typeof v === 'string' ? v
      : Array.isArray(v) && v.every((x) => typeof x === 'string') ? v.join(', ')
        : key === 'questions' && Array.isArray(v) ? (v.find((q) => typeof q?.question === 'string' && q.question !== '')?.question ?? '') : ''
    const detail = liveDetailText(raw)
    if (detail !== '') return detail
  }
  return preparing ? '' : liveDetailText(name ?? '')
}
// A tool call's live title (chat/step-process.ts): its category's 正在… label, or 准备… while its arguments still stream.
const activityFromTool = (lang, name, rawArgs, preparing = false) => ({
  kind: 'tool',
  label: copy(lang, `step.${preparing ? 'prepare.' : ''}${ACTIVITY(name || 'tool')}`),
  detail: toolDetail(name, rawArgs, preparing),
})

// Session-level projections (token usage, whole-log stats, context pressure) that the list rows
// leave out; null when the host does not serve them.
const readProjections = async (sessionId) => {
  try {
    const raw = await sc().projections?.({ sessionId }, new AbortController().signal)
    // Remote services may wrap results: {ok, value}; a baseline is {kind, asOfSeq, values}.
    const v = raw && typeof raw === 'object' && 'value' in raw ? raw.value : raw
    return v?.values ?? null
  } catch { return null }
}

// A step's own parts (reasoning, replies, images) come before its tool calls: the tool-call nodes follow their message in the flow.
const stepOrder = (blocks) => {
  const out = []
  let run = []
  const flush = () => { out.push(...run.filter((b) => b.kind !== 'tool'), ...run.filter((b) => b.kind === 'tool')); run = [] }
  for (const b of blocks) {
    if (b.step === undefined) { flush(); out.push(b) } else {
      if (run.length > 0 && run[0].step !== b.step) flush()
      run.push(b)
    }
  }
  flush()
  return out
}
/** Tokens per second over a turn's timed steps (first token -> message, steps that also report output tokens), or null. */
const turnSpeed = (events) => {
  let tokens = 0
  let ms = 0
  for (const e of events) {
    if (e.type !== 'assistant/message' || e.firstToken === undefined || !isCount(e.usage?.outputTokens)) continue
    ms += Math.max(0, e.time - e.firstToken)
    tokens += e.usage.outputTokens
  }
  return ms > 0 ? tokens / (ms / 1000) : null
}
/**
 * One pass over the window's assistant rows, per turn (conversation-nodes/{process-groups,turn-process,turn-process-presentation}.ts):
 * the consecutive non-reply members of a turn (reasoning, tool calls, in-turn contexts) form a group `{kind:'group', id:'g<turn>.<n>',
 * text: the closed title, icon}` placed before its members (each carries `grp`); a reply (text, image) or a steering message ends a
 * group and stands outside it. The reply of the turn's final answer step is marked `answer`. The turn control (`title`, `summary`,
 * `state`) rides the turn's first row, the usage panel its last; every row carries the flags the phone folds by (`steered`,
 * `foldAll`, `foldFinal`). Returns where an open turn's groups stand, for the live stream to continue.
 */
const assembleTurns = (rows, scan, lang) => {
  const byTurn = new Map()
  for (const m of rows) {
    if (m.role !== 'assistant' || !Number.isInteger(m.turn)) continue
    if (!byTurn.has(m.turn)) byTurn.set(m.turn, [])
    byTurn.get(m.turn).push(m)
  }
  let tail = null
  for (const [turn, rs] of byTurn) {
    const info = scan.turns.get(turn)
    const ended = scan.ended.has(turn)
    for (const m of rs) m.blocks = stepOrder(m.blocks)
    const blocks = rs.flatMap((m) => m.blocks)
    // The final answer: the last step of a closed turn, when it has reply content and no tool call.
    const steps = new Map()
    for (const b of blocks) {
      if (b.step === undefined) continue
      const s = steps.get(b.step) ?? { reply: false, tool: false, reasoning: false }
      if (b.kind === 'md' || b.kind === 'image') s.reply = true
      else if (b.kind === 'tool') s.tool = true
      else if (b.kind === 'reasoning') s.reasoning = true
      steps.set(b.step, s)
    }
    const lastStep = Math.max(-1, ...steps.keys())
    const answerStep = ended && steps.get(lastStep)?.reply && !steps.get(lastStep).tool ? lastStep : null
    for (const b of blocks) if (answerStep !== null && b.step === answerStep && (b.kind === 'md' || b.kind === 'image')) b.answer = true
    const outside = blocks.filter((b) => b.kind !== 'steer' && b.step !== answerStep)
    const steered = blocks.some((b) => b.kind === 'steer')
    const inline = answerStep !== null && steps.get(answerStep).reasoning
    const nonReply = outside.some((b) => b.kind === 'reasoning' || b.kind === 'tool' || b.kind === 'ctx')
    const toolCalls = blocks.filter((b) => b.kind === 'tool' && activityKind(String(b.name ?? '')) !== 'subagents').length
    const subagents = blocks.filter((b) => b.kind === 'tool' && activityKind(String(b.name ?? '')) === 'subagents').length
    const messages = [...steps].filter(([step, s]) => s.reply && (answerStep === null || step < answerStep)).length
    // Groups, numbered across the turn's rows (a retry row between two of them ends a group, as officially).
    let ordinal = 0
    for (const m of rs) {
      const out = []
      let cur = null
      const finish = () => {
        if (cur === null) return
        const counts = groupCounts(cur.members)
        cur.header.text = processTitle(lang, counts)
        cur.header.icon = `symbol:${GROUP_ICON[counts[0]?.kind ?? 'thinking']}`
        cur = null
      }
      for (const b of m.blocks) {
        if (b.kind === 'reasoning' || b.kind === 'tool' || b.kind === 'ctx') {
          if (cur === null) {
            cur = { header: { id: `g${turn}.${ordinal}`, kind: 'group', status: 'done', text: '', icon: '', summary: '', detail: '' }, members: [] }
            ordinal += 1
            out.push(cur.header)
          }
          b.grp = cur.header.id
          cur.members.push(b)
        } else finish()
        out.push(b)
      }
      finish()
      m.blocks = out
      m.steered = steered
      m.foldAll = !steered && (inline || nonReply)
      m.foldFinal = !steered && (inline || outside.length > 0)
    }
    const first = rs[0]
    const last = rs[rs.length - 1]
    if (ended && info !== undefined) {
      const stopped = scan.stopped.has(turn)
      const failed = scan.failed.has(turn)
      const elapsed = info.startAt !== undefined && info.endAt !== undefined ? Math.max(1000, info.endAt - info.startAt) : undefined
      first.state = stopped ? 'stopped' : failed ? 'failed' : 'done'
      first.title = stopped ? copy(lang, 'turn.stopped') : failed ? copy(lang, 'turn.failed') : elapsed === undefined ? copy(lang, 'turn.worked') : `${copy(lang, 'turn.took')}${runDuration(lang, elapsed)}`
      first.summary = [toolCalls > 0 ? copyCount(lang, 'turn.toolCalls', toolCalls) : '', messages > 0 ? copyCount(lang, 'turn.messages', messages) : '',
        subagents > 0 ? copyCount(lang, 'turn.subagents', subagents) : '', blocks.some((b) => b.kind === 'reasoning') ? copy(lang, 'turn.thought') : ''].filter(Boolean).join(copy(lang, 'turn.separator'))
      if (elapsed !== undefined) first.took = Math.round(elapsed / 1000)
      const usage = deriveTurnUsage(info.events)
      if (usage !== undefined) {
        const view = usageView(lang, usage, turnSpeed(info.events))
        last.usage = view.line
        last.usageRows = view.rows
      }
      // The turn closed after its last message: the rows it changed (header, usage, flags) must reach a phone holding the older ones.
      for (const m of rs) m.seq = Math.max(Number(m.seq), Number(info.endSeq))
    } else if (!ended && turn === scan.lastTurn) {
      // The open turn: its last group is the live one while nothing follows it. Its fallback title (the phone refines it from the stream).
      const lastBlock = last.blocks[last.blocks.length - 1]
      const grp = lastBlock?.grp ?? ''
      if (grp !== '') {
        const header = last.blocks.find((b) => b.kind === 'group' && b.id === grp)
        const running = [...last.blocks].reverse().find((b) => b.grp === grp && b.kind === 'tool' && b.status === 'running')
        const live = running ? { label: copy(lang, `step.${activityKind(String(running.name))}`), detail: running[FULL]?.live ?? '' } : { label: copy(lang, 'step.thinking'), detail: '' }
        header.status = 'running'
        header.summary = live.label
        header.detail = live.detail
        tail = { turn, groups: ordinal, open: grp, live: { kind: running ? 'tool' : 'thinking', label: live.label, detail: live.detail } }
      } else tail = { turn, groups: ordinal, open: '', live: null }
    }
  }
  // A new turn with nothing of its own yet is still an open turn the live stream can start groups in.
  if (tail === null && scan.lastTurn !== null && !scan.ended.has(scan.lastTurn) && !byTurn.has(scan.lastTurn)) tail = { turn: scan.lastTurn, groups: 0, open: '', live: null }
  return tail
}

// The heavy half of a snapshot: the event log (and the session-level projections) folded into
// phone rows. It is a pure function of the log, so projectSession caches it per (session, take)
// and only runs it again when the session's last event seq moves.
const computeProjection = async (sessionId, take, cwd, address, lang) => {
    const signal = () => new AbortController().signal
    const [page, pv] = await Promise.all([
      sc().events({ address, maxMessages: Math.min(take * MESSAGES_PER_TURN + 40, 6000) }, signal()).catch(() => null),
      readProjections(sessionId),
    ])
    const messages = []
    const lastEventSeq = page?.records?.length ? Number(page.records[page.records.length - 1]?.event?.seq ?? 0) : 0
    // A fork child carries an inherited-prefix cut marker (session/end-seed {inherited}).
    const inherited = (page?.records ?? []).some((r) => r?.event?.type === 'session/end-seed' && r?.event?.data?.inherited === true)
    orphanCalls.clear()
    // The session's own workspace (a path shows relative to it, a shell prompt names it); none known leaves paths as authored.
    const scan = newScan(lang, { cwd: cwd ?? '', home: os.homedir() })
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
          const block = { kind: 'tool', callId: `wf-${runId}`, name: 'workflow', label: copy(lang, 'workflow.label', { name: truncate(String(d.name ?? 'workflow'), 60) }), status: 'running', todos: [] }
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
      const row = renderEvent(rec?.event, scan)
      if (row) messages.push(row)
    }
    finishRetries(scan)
    // Fold tool results into the call they answer, the way the desktop transcript does.
    const callIndex = new Map()
    const callRow = new Map()
    for (const m of messages) {
      for (const b of m.blocks ?? []) {
        if (b.kind === 'tool' && b.callId) { b[TURN] = m.turn; callIndex.set(b.callId, b); callRow.set(b.callId, m) }
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
      if (target[FULL]) Object.assign(target[FULL], m[FULL])
      const host = callRow.get(m.callId)
      if (host && Number(m.seq) > Number(host.seq)) host.seq = m.seq
      // The row's settled facts (status, the exit / failure badge, the summary an error replaces, +/- totals): a non-zero exit is a
      // failure the transcript shows as one although the tool itself returned normally. Read off the whole result (the row text is clipped).
      if (m.diff) target.diff = m.diff
      settleTool(lang, target)
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
    // ask_user_question rows read their state (waiting / continued / answered n/m / cancelled…) off the
    // session's `userQuestions` projection and the recorded result.
    for (const b of callIndex.values()) {
      if (b.name !== 'ask_user_question') continue
      const ask = askCard(b, pv?.userQuestions)
      if (ask) b.ask = ask
    }
    // One turn is several assistant step-messages; the desktop shows them as one process
    // block. Merge them so the phone does not print a row per step.
    const grouped = []
    for (const m of messages) {
      const prev = grouped[grouped.length - 1]
      // A steering message (and a context injected mid-turn) stays inside its turn: it joins the turn's assistant row as a
      // block, so it opens no segment, splits no assistant group and never counts as a turn of its own. A steering message
      // with no assistant row before it opens the group; later steps merge into it.
      if (m.role === 'steer' || m.role === 'context') {
        const block = m.role === 'steer' ? m.blocks[0] : { kind: 'ctx', text: m.title, summary: m.summary, detail: m.text, icon: m.icon, status: m.state }
        if (prev && prev.role === 'assistant' && m.turn !== null && prev.turn === m.turn) {
          prev.blocks.push(block)
          // The row changed: an incremental patch (rows newer than the phone's cursor) must carry it.
          prev.seq = Math.max(Number(prev.seq), Number(m.seq))
          continue
        }
        if (m.role === 'steer') {
          grouped.push({ id: `s${m.seq}`, seq: m.seq, role: 'assistant', at: m.at, turn: m.turn, text: '', tokens: null, blocks: [block] })
          continue
        }
      }
      if (m.role === 'assistant' && prev && prev.role === 'assistant' && prev.turn === m.turn) {
        prev.blocks.push(...m.blocks)
        prev.text = prev.text !== '' ? prev.text : m.text
        // Copy and find need the whole turn, not the first step's prose.
        prev.fullText = `${prev.fullText ?? prev.text ?? ''}${m.text ? `\n\n${m.text}` : ''}`
        if (m.tokens) prev.tokens = [((prev.tokens ?? [0, 0])[0] + m.tokens[0]), ((prev.tokens ?? [0, 0])[1] + m.tokens[1])]
        if (m.cache) prev.cache = (prev.cache ?? 0) + m.cache
        prev.interrupted = prev.interrupted || m.interrupted
        prev.seq = m.seq
        // Message feedback targets the DSH message id; keep the latest step's id.
        if (m.msgId) prev.msgId = m.msgId
        // Turn duration: desktop's group head shows `✓ N steps · 1m 23s`.
        if (m.at) prev.lastAt = m.at
        continue
      }
      grouped.push(m)
    }
    for (let i = 0; i < grouped.length; i++) {
      const m = grouped[i]
      if (m.role !== 'assistant') continue
      // A turn runs from its opening message (a user's or a trigger's, past any context rows between them and the first
      // step); steering inside it never moves the start.
      let opener = null
      for (let j = i - 1; j >= 0 && opener === null; j -= 1) {
        const r = grouped[j]
        if (r.role === 'assistant') break
        if (r.role === 'user' || r.role === 'trigger') opener = r
      }
      const start = opener !== null && (opener.turn === null || opener.turn === m.turn) ? Number(opener.at ?? 0) : Number(m.at ?? 0)
      const end = Number(m.lastAt ?? m.at ?? 0)
      delete m.lastAt
      m.took = start > 0 && end >= start ? Math.round((end - start) / 1000) : 0
    }
    // How each turn ended (the turn/end reasons): a failed one reads 处理失败, a stopped one 已停止, and only the turn still
    // open is the active one (the phone expands that one alone while the session runs).
    for (const m of grouped) {
      if (m.role !== 'assistant') continue
      if (scan.failed.has(m.turn)) m.failed = true
      if (scan.stopped.has(m.turn)) m.interrupted = true
      if (m.turn !== null && m.turn === scan.lastTurn && !scan.ended.has(m.turn)) m.active = true
    }
    for (const m of grouped) {
      if (!m.blocks) continue
      m.blocks.forEach((b, i) => { b.id = `b${i}` })
    }
    // A Markdown image in an answer points at a file on the Mac; tell the app its shape.
    const baseCwd = cwd ?? process.cwd()
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
    // A turn opens with a user's message or with the trigger that woke it (a goal round, a schedule…); steering never opens one.
    const opens = (m) => m.role === 'user' || m.role === 'trigger'
    const segments = []
    for (const m of grouped) {
      if (segments.length === 0 || opens(m)) segments.push([])
      segments[segments.length - 1].push(m)
    }
    // The message window can start mid-turn; drop that partial segment so a turn's
    // row id stays the same when the window grows (the phone anchors on it). A window with older events behind it may
    // begin at a steering message whose claim is out of sight, which would read as an opener: drop that head too.
    if (segments.length > 0 && (!opens(segments[0][0]) || (page?.hasMore && segments.length > 1))) segments.shift()
    const trimmedAny = segments.length > take
    const merged = segments.slice(Math.max(0, segments.length - take)).flat()
    // Process groups, the turn control, the answer and the usage of every turn in the window (see assembleTurns).
    const tail = assembleTurns(merged, scan, lang)
    // The phone cannot carry a whole turn of 40 steps every 700 ms: keep the newest
    // rows that fit, and remember that the rest is still there.
    // Newest turns keep their detail (markdown, cards); older ones are text-only so
    // "load earlier" can actually add rows instead of being trimmed away again.
    const FULL_ROWS = 12
    const FULL_BUDGET = 150000
    // Projection version: bumped whenever the row PROJECTION changes shape (not just
    // new events). Clients cache rows keyed by rowsRev; a seq-only rev cannot express
    // "same seq, better content", so old caches would survive a fix like this.
    const PROJ = 11
    // Newest turns: the final answer's markdown is never dropped — degrade detail
    // (reasoning → tool cards), never the answer itself, and only past this cap.
    const ANSWER_CAP = 96000
    // An older turn's non-answer text: a shape of what it said (a code block loses its colors, a table its rows).
    const slimNodes = (nodes) => (Array.isArray(nodes) ? nodes.slice(0, 12).map((n) => ({
      ...n,
      v: typeof n.v === 'string' ? truncate(n.v, 320) : n.v,
      head: typeof n.head === 'string' ? truncate(n.head, 200) : n.head,
      runs: undefined,
      items: Array.isArray(n.items) ? n.items.slice(0, 8).map((it) => ({ ...it, v: typeof it.v === 'string' ? truncate(it.v, 200) : it.v })) : n.items,
      rows: Array.isArray(n.rows) ? n.rows.slice(0, 6).map((r2) => ({ ...r2, v: typeof r2.v === 'string' ? truncate(r2.v, 200) : r2.v })) : n.rows,
    })) : nodes)
    // The newest rows are whole (their answers complete) while they fit FULL_BUDGET, at most FULL_ROWS of them (the newest is always whole);
    // older rows are slim, so a long session still shows its history inside the row budget instead of only its last few answers.
    const fulls = merged.map((row) => clipRow(row))
    let fullBudget = FULL_BUDGET
    let fullFrom = merged.length
    for (let i = merged.length - 1; i >= 0 && merged.length - i <= FULL_ROWS; i -= 1) {
      const size = JSON.stringify(fulls[i]).length
      if (size > fullBudget && i < merged.length - 1) break
      fullBudget -= size
      fullFrom = i
    }
    const graded = merged.map((row, i) => {
      const full = fulls[i]
      // Merged turns carry the whole turn in .text only as the FIRST step's preamble;
      // fullText is the concatenated plain text of every step — always the better fallback.
      const flat = String(row.fullText ?? row.text ?? '')
      if (i < fullFrom) {
        // Older turns keep their SHAPE (headings, tool cards, code fences) with
        // slimmed detail instead of collapsing to flat text: parity with the
        // desktop's always-rich rendering, at a size "load earlier" can afford.
        return {
          ...full,
          text: truncate(flat, 2400),
          // The phone reads copy / find text from fullText: an older row keeps the first 6000 characters of it, not the whole turn.
          ...(typeof full.fullText === 'string' ? { fullText: truncate(full.fullText, 6000) } : {}),
          blocks: (full.blocks ?? []).map((b) => {
            if (!b) return b
            if (b.kind === 'reasoning') return { ...b, text: truncate(b.text, 240) }
            // An older row's final answer stays whole up to SLIM_ANSWER_CHARS of nodes; its other replies are slimmed.
            if (b.kind === 'md') return { ...b, text: truncate(b.text, 1400), nodes: b.answer ? slimAnswerNodes(b.nodes) : slimNodes(b.nodes) }
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
        blocks: (full.blocks || []).filter((b) => b && (b.kind === 'md' || b.kind === 'text' || b.kind === 'steer')),
      }
      if ((answerOnly.blocks || []).length > 0) {
        // The text stays whole; the colours of its code blocks are what a still-too-large row gives up (a run is ~6x the source it paints).
        if (JSON.stringify(answerOnly).length <= ANSWER_CAP * 1.5) return answerOnly
        return { ...answerOnly, blocks: answerOnly.blocks.map((b) => (b && Array.isArray(b.nodes) ? { ...b, nodes: b.nodes.map((n) => (n.runs ? { ...n, runs: undefined } : n)) } : b)) }
      }
      // Stage 3: answer with slimmed nodes — still never dropped.
      const slimAnswer = {
        ...full,
        blocks: (full.blocks || []).map((b) => (b && b.nodes ? { ...b, nodes: slimNodes(b.nodes) } : b)),
      }
      if ((slimAnswer.blocks || []).length > 0) return slimAnswer
      // Last resort (no md/text blocks at all): whole-turn plain text.
      return { ...full, text: truncate(flat, 8000), blocks: [] }
    })
    // The unique files a turn's successful write-class calls changed, each with its line counts:
    // from the result's real diffs, else from what the call itself says (a created file).
    // Read off the unclipped turn (merged[i]): the graded copy has no args or diffs left.
    const changedFilesOf = (blocks) => {
      const files = new Map() // resolved path -> {path, added, removed}
      const entry = (p) => {
        const abs = path.resolve(baseCwd, p)
        if (!files.has(abs)) {
          const rel = path.relative(baseCwd, abs)
          files.set(abs, { path: rel === '' || rel.startsWith('..') ? abs : rel, added: 0, removed: 0 })
        }
        return files.get(abs)
      }
      for (const b of blocks) {
        if (!b || b.kind !== 'tool' || !/^(write|edit|apply_patch)$/.test(String(b.name)) || b.status !== 'ok') continue
        const seen = new Set()
        for (const [p, c] of diffStats(b.diff)) {
          const e = entry(p)
          e.added += c.added
          e.removed += c.removed
          seen.add(e)
        }
        for (const f of b[FULL]?.files ?? []) {
          const e = entry(f.path)
          if (seen.has(e)) continue
          e.added += f.added
          e.removed += f.removed
        }
      }
      return [...files.values()]
    }
    // Turn-tail deliverables (parity with ui-deliverables): files the turn
    // `present`ed, plus the files its write-class tools changed.
    // The turn's changed files, as the host recorded them (`workspace/changes` -> workspaceChanges.summary: git snapshots of the turn start and
    // end, so a shell edit counts and each file has real line counts), on the turn's last assistant row; when the host has no summary
    // (a session reopened after a restart, an older host) the files its write-class tool calls touched stand in, and the diff route
    // falls back the same way.
    const lastOfTurn = new Map()
    merged.forEach((m, i) => { if (m.role === 'assistant' && m.turn !== null) lastOfTurn.set(m.turn, i) })
    const recorded = (turn) => {
      try {
        const seq = scan.changes.get(turn)
        const summary = seq === undefined ? undefined : ctx.get('workspaceChanges')?.summary?.(sessionId, seq)
        if (!summary || !Array.isArray(summary.files) || !Number.isSafeInteger(summary.total) || summary.total < 1) return null
        return {
          seq, total: summary.total, added: Number(summary.added) || 0, removed: Number(summary.deleted) || 0,
          files: summary.files.slice(0, 20).map((f, k) => ({ path: String(f.path ?? ''), name: String(f.display ?? f.path ?? ''), added: Number(f.added) || 0, removed: Number(f.deleted) || 0, i: k, note: f.binary === true ? 'binary' : f.oversized === true ? 'oversized' : '' })),
        }
      } catch { return null }
    }
    const enriched = graded.map((row, i) => {
      if (row.role !== 'assistant') return row
      const files = (row.blocks ?? [])
        .filter((b) => b && b.kind === 'tool' && b.name === 'present' && Array.isArray(b.files))
        .flatMap((b) => b.files)
      const host = lastOfTurn.get(row.turn) === i ? recorded(row.turn) : null
      const changed = host ? [] : changedFilesOf(merged[i]?.blocks ?? [])
      if (files.length === 0 && changed.length === 0 && host === null) return row
      const sum = (key) => changed.reduce((n, f) => n + f[key], 0)
      return {
        ...row,
        // The summary can land after the turn closed: the row moves to that event's seq, so a phone holding it gets the card in its patch.
        ...(host ? { seq: Math.max(Number(row.seq), host.seq) } : {}),
        deliverables: files.slice(0, 8),
        changedCount: host ? host.total : changed.length,
        ...(host ? { changesSeq: host.seq, changedAdded: host.added, changedRemoved: host.removed, changedFiles: host.files }
          : changed.length > 0 ? { changedAdded: sum('added'), changedRemoved: sum('removed'), changedFiles: changed.slice(0, 20).map((f) => ({ ...f, name: f.path, i: -1, note: '' })) } : {}),
      }
    })
    // Calendar-day separators (parity with use-calendar-day): one label where
    // the local day changes between chronological rows; the first row stays bare.
    const dayLabel = (ts) => {
      if (!ts) return ''
      const d = new Date(ts)
      const startOf = (x) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime()
      const diffDays = Math.round((startOf(new Date()) - startOf(d)) / 86400000)
      if (diffDays === 0) return copy(lang, 'day.today')
      if (diffDays === 1) return copy(lang, 'day.yesterday')
      if (diffDays === 2) return copy(lang, 'day.before')
      return copy(lang, d.getFullYear() === new Date().getFullYear() ? 'clock.md' : 'clock.ymd', { y: d.getFullYear(), m: d.getMonth() + 1, d: d.getDate() })
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
    // todo diff (todo-diff-model.ts): each todo_write card carries its list compared with the previous write in the window: the caption
    // (首次记录 / 与上次清单相比 / 旧清单不可用), the summary (新增 N · 更新 N · 移除 N, else 清单没有变化) and each item's change
    // (added, updated by status or position, removed, same). Older history that is not loaded may hold an earlier list: unavailable.
    // The pass works on copies: rows can be shared with the incremental cache.
    const isTodo = (b) => b && b.kind === 'tool' && (b.name === 'todo_write' || b.name === 'todo') && Array.isArray(b.todos)
    const annotated = enriched.map((row) => (row && Array.isArray(row.blocks) && row.blocks.some(isTodo)
      ? { ...row, blocks: row.blocks.map((b) => (isTodo(b) ? { ...b, todos: b.todos.map((t) => ({ ...t })) } : b)) }
      : row))
    const moreHistory = Boolean(page?.hasMore) || trimmedAny
    let prevTodos = null
    for (const row of annotated) {
      if (!row || !Array.isArray(row.blocks)) continue
      for (const b of row.blocks) {
        if (!isTodo(b)) continue
        const current = b.todos.map((t) => ({ text: t.text, state: t.state }))
        if (prevTodos === null && moreHistory) {
          b.detail = copy(lang, 'todo.diff.unavailable')
        } else {
          const prevByTitle = new Map((prevTodos ?? []).map((t) => [t.text, t]))
          const titles = new Set(current.map((t) => t.text))
          const retained = new Map((prevTodos ?? []).filter((t) => titles.has(t.text)).map((t, k) => [t.text, k]))
          let at = 0
          let added = 0
          let updated = 0
          b.todos = b.todos.map((t) => {
            const before = prevByTitle.get(t.text)
            prevByTitle.delete(t.text)
            if (before === undefined) { added += 1; return { ...t, change: 'added', label: copy(lang, 'todo.diff.addedItem') } }
            const moved = retained.get(t.text) !== at
            at += 1
            const statusChanged = before.state !== t.state
            if (statusChanged || moved) {
              updated += 1
              return { ...t, change: 'updated', label: copy(lang, statusChanged ? 'todo.diff.updatedItem' : 'todo.diff.movedItem'), prev: statusChanged ? copy(lang, `detail.todo.${before.state}`) : '' }
            }
            return { ...t, change: 'same' }
          })
          const removed = [...prevByTitle.values()]
          for (const [k, t] of removed.entries()) b.todos.push({ id: `rm${k}`, text: t.text, state: t.state, change: 'removed', label: copy(lang, 'todo.diff.removedItem') })
          b.todoSummary = [added > 0 ? copy(lang, 'todo.diff.added', { count: added }) : '', updated > 0 ? copy(lang, 'todo.diff.updated', { count: updated }) : '', removed.length > 0 ? copy(lang, 'todo.diff.removed', { count: removed.length }) : ''].filter(Boolean).join(' · ') || copy(lang, 'todo.diff.noChanges')
          b.detail = copy(lang, prevTodos === null ? 'todo.diff.initial' : 'todo.diff.compare')
        }
        prevTodos = current
      }
    }
    // Rows leave only on a rev change and arrive as tiny incremental patches
    // afterwards, so the one-shot cold window can afford real depth (newest turns
    // alone can legitimately be ~30 KB each now that answers are never degraded).
    const phoneRows = budget(annotated, 240000)

    // Session-wide counters for the stats sheet (desktop StatsPills). The whole-log projections
    // when the host serves them (the window is paged and compaction rewrites it); the loaded
    // window otherwise.
    const windowStats = (() => {
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
    })()
    const num = (v) => (Number.isFinite(v) ? v : 0)
    const usage = Number.isFinite(pv?.tokenUsage?.outputTokens) ? pv.tokenUsage : null
    const logStats = Number.isFinite(pv?.sessionStats?.turns) ? pv.sessionStats : null
    const stats = {
      turns: logStats ? num(logStats.turns) : windowStats.turns,
      steps: logStats ? num(logStats.steps) : windowStats.steps,
      // The phone has no cache-write slot: that billed prompt input rides inTok, so its
      // hit-rate (cacheRead / (inTok + cacheRead)) and per-turn total match the desktop pill.
      inTok: usage ? num(usage.uncachedInputTokens) + num(usage.cacheWriteTokens) : windowStats.inTok,
      outTok: usage ? num(usage.outputTokens) : windowStats.outTok,
      cacheRead: usage ? num(usage.cacheReadTokens) : windowStats.cacheRead,
      // The stats sheet's timing rows (stat-dialog): whole-log model / tool wall time, first-token latency and decode speed.
      // Zero when the host serves no sessionStats; the phone then leaves the rows out.
      llmMs: logStats ? num(logStats.llmMs) : 0,
      toolMs: logStats ? num(logStats.toolMs) : 0,
      ttftMs: logStats ? num(logStats.ttftMs) : 0,
      ttftSteps: logStats ? num(logStats.ttftSteps) : 0,
      decodeMs: logStats ? num(logStats.decodeMs) : 0,
      decodeTokens: logStats ? num(logStats.decodeTokens) : 0,
    }
    // Context meter (desktop ContextMeter): what the next request would carry over the route's window.
    const pressure = pv?.contextPressure
    const used = pressure?.projectedTokens ?? pressure?.pressureTokens
    // The composer meter's panel (ContextMeter): the heuristic system prompt / tool definitions / messages composition, when the host serves it.
    const bd = pv?.contextBreakdown
    const split = Number.isFinite(bd?.systemTokens) && Number.isFinite(bd?.toolsTokens) && Number.isFinite(bd?.messageTokens)
      ? { system: bd.systemTokens, tools: bd.toolsTokens, messages: bd.messageTokens }
      : {}
    const context = Number.isFinite(used) && Number.isFinite(pressure?.contextWindow) && pressure.contextWindow > 0
      ? { used, total: pressure.contextWindow, ...split }
      : null
    // The settled log's own idea of the live activity (the open turn's last group); a streaming attempt refines it per poll.
    const activity = tail?.live ?? null
    const todoBlocks = merged.flatMap((m) => m.blocks ?? []).filter((b) => Array.isArray(b.todos) && b.todos.length > 0)
    return {
      ok: page !== null,
      cursor: Number.isFinite(page?.cursor) ? page.cursor : null,
      rows: phoneRows.rows,
      // Live polls strip the rows; this revision tells the phone when to fetch them.
      rowsRev: `${lastEventSeq}:${take}:${PROJ}:${lang}`,
      hasMore: Boolean(page?.hasMore) || trimmedAny || phoneRows.rows.length < merged.length,
      todos: todoBlocks.length > 0 ? todoBlocks[todoBlocks.length - 1].todos : [],
      inherited,
      stats,
      context,
      activity,
      // Where the open turn's groups stand (the live stream continues them) and every turn number of the session (the turnOutline
      // projection; [] when the host does not serve it), for the phone's turn rail.
      tail,
      turns: Array.isArray(pv?.turnOutline)
        ? [...new Set(pv.turnOutline.map((e) => e?.turn).filter((n) => Number.isSafeInteger(n) && n >= 0))].sort((a, b) => a - b)
        : [],
      // Fallback for a turn already running when the plugin (re)loaded: the turn's first user
      // message timestamp, same as DSH's Turn start.
      lastUserAt: Number([...merged].reverse().find(opens)?.at ?? 0),
      // Quota notice (parity with QuotaNoticeHost): the newest turn failed with the QUOTA / ACCOUNT_QUOTA code (never the
      // wording) and nothing has begun since; the id lets the phone toast each failure once.
      quota: scan.quota?.text ?? '',
      quotaId: scan.quota?.id ?? '',
      // A retry that is counting down right now: the live poll words it (the row's own seconds are frozen at projection time).
      retryLive: scan.retryLive,
      callIndex,
      userQuestions: pv?.userQuestions ?? null,
      // The composer's host facts: the failed turn/end a 继续生成 would address (conversationContinuation, null when none), plan mode
      // (the `plan` projection {active, pending}; null where plan-mode is not composed) and the session's goal with its counters.
      continuation: Number.isSafeInteger(pv?.conversationContinuation) ? pv.conversationContinuation : null,
      planMode: typeof pv?.plan?.active === 'boolean' ? { active: pv.plan.active, pending: pv.plan.pending === true } : null,
      goal: (() => {
        const g = pv?.goal?.goal
        if (!g || typeof g.objective !== 'string' || typeof g.id !== 'string') return null
        return { id: g.id, objective: g.objective, phase: String(g.phase ?? ''), rounds: Number.isSafeInteger(pv.goal.roundsStarted) ? pv.goal.roundsStarted : 0, max: Number.isSafeInteger(g.maxGoalRounds) ? g.maxGoalRounds : 0, reason: g.phase === 'blocked' && typeof g.blockedReason?.message === 'string' ? g.blockedReason.message : '' }
      })(),
    }
  }

// computeProjection's cache, keyed by (session, take, lang); a module reload starts empty. An entry is
// good while the session's last event seq (tracked from 'session/event') has not moved and the
// log has not grown past where the entry read it (`cursor`, checked against the log end the
// state call reports, and against the tracked seq), the calendar day is the same (row day
// labels) and it is under a minute old (a net under both). The in-flight promise is cached too,
// so overlapping polls share one computation. Bounded; the oldest entries go first.
const projectionCache = new Map()
const PROJECTION_CACHE_MAX = 12
const PROJECTION_CACHE_TTL = 60000
const projectSession = (sessionId, take, cwd, address, logEnd, lang) => {
  const key = `${sessionId}:${take}:${lang}`
  const seq = sessions.get(sessionId)?.lastSeq ?? null
  const day = new Date().toDateString()
  const hit = projectionCache.get(key)
  const grown = (end) => hit.cursor !== null && Number.isFinite(end) && hit.cursor < end
  if (hit && hit.seq === seq && hit.day === day && Date.now() - hit.at < PROJECTION_CACHE_TTL
    && !grown(logEnd) && !grown(seq)) return hit.promise
  const entry = { seq, day, at: Date.now(), cursor: null, promise: null }
  entry.promise = computeProjection(sessionId, take, cwd, address, lang).then((heavy) => {
    entry.cursor = heavy.cursor
    // A failed read must not be remembered.
    if (!heavy.ok && projectionCache.get(key) === entry) projectionCache.delete(key)
    rememberCalls(sessionId, heavy.callIndex)
    return heavy
  }, (err) => {
    if (projectionCache.get(key) === entry) projectionCache.delete(key)
    throw err
  })
  projectionCache.delete(key)
  projectionCache.set(key, entry)
  while (projectionCache.size > PROJECTION_CACHE_MAX) projectionCache.delete(projectionCache.keys().next().value)
  return entry.promise
}

// reasoningText(): the display text of a reasoning stream (a `<signature>…</signature>` prefix is not shown).
const reasoningShown = (text) => {
  if (!text.startsWith('<')) return text
  const open = '<signature>'
  if (open.startsWith(text)) return ''
  if (!text.startsWith(open)) return text
  const end = text.indexOf('</signature>', open.length)
  return end === -1 ? '' : text.slice(end + '</signature>'.length).replace(/^(?:\r?\n)+/, '')
}
// The streaming text as Markdown nodes: the phone shows a long answer as it grows, so the node budget is wider than a settled row's
// (which the phone re-reads once), but still bounded. A growing answer keeps its newest blocks (`newest`), a static text its first.
const streamNodes = (src, newest = false) => (newest ? mdNodes(src, { highlight: false }).slice(-120) : mdNodes(src, { highlight: false }).slice(0, 120)).map((n) => ({
  ...n,
  v: typeof n.v === 'string' ? truncate(n.v, 6000) : n.v,
  items: Array.isArray(n.items) ? n.items.slice(0, 80).map((it) => ({ ...it, v: truncate(String(it.v ?? ''), 1200) })) : n.items,
  rows: Array.isArray(n.rows) ? n.rows.slice(0, 40).map((r) => ({ ...r, v: truncate(String(r.v ?? ''), 1200) })) : n.rows,
}))
/**
 * The streaming attempt as phone blocks that continue the open turn's groups (`tail`, from the settled projection): reasoning and
 * tool calls join the turn's open group or start the next, a text reply ends it; a step's tool calls follow its text. `live` is the
 * title of the group still open at the end of the attempt (preparing while its arguments stream), null when a reply ends it, and
 * undefined while the attempt has not said anything yet (the settled projection's own idea stands).
 */
const streamView = (attempt, tail, lang) => {
  const turn = Number.isInteger(attempt.turn) ? attempt.turn : (tail?.turn ?? 0)
  const own = tail !== null && tail !== undefined && tail.turn === turn ? tail : { turn, groups: 0, open: '' }
  const ordered = [...attempt.blocks.filter((b) => b.type !== 'tool-call'), ...attempt.blocks.filter((b) => b.type === 'tool-call')]
  const blocks = []
  let cur = own.open
  let ordinal = own.groups
  let header = null
  let members = []
  let live
  const seal = () => {
    if (header === null) return
    const counts = groupCounts(members)
    header.text = processTitle(lang, counts)
    header.icon = `symbol:${GROUP_ICON[counts[0]?.kind ?? 'thinking']}`
    header = null
    members = []
  }
  const join = () => {
    if (cur !== '') return
    cur = `g${own.turn}.${ordinal}`
    ordinal += 1
    header = { id: cur, kind: 'group', status: 'running', text: '', icon: '', summary: '', detail: '' }
    blocks.push(header)
  }
  for (const b of ordered) {
    const id = `sb${blocks.length}`
    if (b.type === 'reasoning') {
      const shown = reasoningShown(b.text)
      if (shown.trim() === '') continue
      join()
      const row = { id, kind: 'reasoning', text: maskSecrets(truncate(shown, 8000)), summary: reasoningPreview(maskSecrets(shown)), status: 'running', grp: cur }
      members.push(row)
      blocks.push(row)
      live = { kind: 'thinking', label: copy(lang, 'step.thinking'), detail: reasoningDetail(shown) }
    } else if (b.type === 'text') {
      if (b.text.trim() === '') continue
      seal()
      cur = ''
      blocks.push({ id, kind: 'md', text: '', nodes: streamNodes(maskSecrets(b.text), true), status: 'running' })
      live = null
    } else if (b.type === 'tool-call') {
      join()
      const look = TOOL_LOOKS[b.name] ?? { icon: 'circle' }
      const act = activityFromTool(lang, b.name || 'tool', b.arguments, !b.done)
      // `preparing` while the arguments still stream (正在准备调用), with the size of the content a write / edit has so far.
      const kb = b.name === 'write' || b.name === 'edit' ? contentKilobytes(null, b.arguments) : null
      const row = { id, kind: 'tool', name: b.name || 'tool', callId: '', status: b.done ? 'running' : 'preparing', icon: `symbol:${look.icon}`, title: toolTitle(lang, b.name || 'tool', parseArgsObject(b.arguments)), summary: act.detail, ...(kb !== null ? { suffix: copy(lang, 'tool.preparing.content', { kilobytes: kb }) } : {}), grp: cur }
      members.push(row)
      blocks.push(row)
      live = { kind: 'tool', label: act.label, detail: act.detail }
    }
  }
  seal()
  return { blocks, live }
}

// The session's subagent tree (ui-subagent SubagentHeaderLineage): direct children from the catalog projection, each with its own
// children below it (up to three levels, forty rows); a row says what the child is (mode), what it is doing (running / completed /
// not running), its tokens (the four tokenUsage buckets) and its active time (subagentTiming). Rows are worded in `lang`.
const SUBAGENT_ROWS = 40
const subagentTree = (lang, rootId, all, running) => {
  const out = []
  const seen = new Set([rootId])
  const walk = (parentId, depth) => {
    const catalog = all.get(parentId)?.projections?.subagentCatalog
    for (const e of (Array.isArray(catalog) ? catalog : []).slice(0, 24)) {
      if (out.length >= SUBAGENT_ROWS) return
      const id = String(e?.id ?? '')
      if (id === '' || seen.has(id)) continue
      seen.add(id)
      const child = all.get(id)
      const external = e.mode === 'external'
      const live = !external && (Boolean(child?.running) || running.get(id)?.status === 'running')
      const timing = child?.projections?.subagentTiming
      const done = !external && !live && timing?.lastTurnCompleted === true
      const usage = child?.projections?.tokenUsage
      const tokens = usage && [usage.uncachedInputTokens, usage.outputTokens, usage.cacheReadTokens, usage.cacheWriteTokens].every(Number.isFinite)
        ? usage.uncachedInputTokens + usage.outputTokens + usage.cacheReadTokens + usage.cacheWriteTokens : null
      const ms = timing && Number.isFinite(timing.settledMs)
        ? timing.settledMs + (timing.active ? Math.max(0, (live ? Date.now() : timing.active.through) - timing.active.since) : 0) : null
      const name = e.mode === 'continuable' || external ? String(e.name ?? id) : id
      const label = String(e.label ?? '') || (typeof child?.title === 'string' ? child.title : '') || name
      const mode = external ? 'external' : e.mode === 'one-shot' ? 'oneShot' : e.mode === 'continuable' ? 'continuable' : 'unknown'
      const activity = external ? '' : live ? 'running' : done ? 'completed' : 'inactive'
      out.push({
        id,
        sessionId: external ? '' : id,
        label: truncate(label, 80),
        sub: label !== name ? truncate(name, 60) : '',
        mode: copy(lang, `subagent.mode.${mode}`),
        modeCode: e.mode === 'one-shot' || e.mode === 'continuable' || external ? e.mode : 'unknown',
        activity,
        state: activity === '' ? '' : copy(lang, `subagent.activity.${activity}`),
        meta: [tokens === null ? '' : copy(lang, 'usage.count', { count: fmtTokens(lang, tokens) }), ms === null ? '' : runDuration(lang, ms)].filter(Boolean).join(' · '),
        depth,
      })
      if (!external && depth < 2) walk(id, depth + 1)
    }
  }
  walk(rootId, 0)
  return out
}
/** The direct children's counts line (catalogProgress): 1 已完成 · 2 进行中 · 1 未运行 · 1 外部任务. */
const subagentProgress = (lang, rows) => {
  const direct = rows.filter((r) => r.depth === 0)
  const n = (pick) => direct.filter(pick).length
  return [
    ['completed', n((r) => r.activity === 'completed')], ['active', n((r) => r.activity === 'running')],
    ['inactive', n((r) => r.activity === 'inactive')], ['external', n((r) => r.modeCode === 'external')],
  ].filter(([, count]) => count > 0).map(([key, count]) => copy(lang, `subagent.progress.${key}`, { count })).join(' · ')
}

// One snapshot = the cached projection + the parts that move without a new event (state, queue,
// streaming, approvals, question, jobs, the run clock).
const snapshotSession = async (sessionId, take = 8, showArchived = false, lang = 'zh-Hans') => {
    const listing = await mergeStatus(showArchived, lang, sessionId) // the only sc().list() of the request
    const meta = sessionId ? listing.find(sessionId) : null
    // Rows carry the whole projection blob for server-side use; the phone only
    // needs the list fields, and shipping `meta` made every poll ~230 KB.
    const wire = listing.rows.map(({ meta, ...rest }) => rest)
    // A fingerprint of the list; /v1/live omits the rows when the client already has it.
    // (the language words each row's age, the unread dot and the running-subagent count are part of what the phone shows)
    const listRev = `${lang}|${wire.map((r) => `${r.id}:${r.updatedAt ?? 0}:${r.running ? 1 : 0}:${r.pinned ? 1 : 0}:${r.attention ?? ''}:${r.unread ?? ''}:${r.subs ?? 0}:${r.title ?? ''}`).join('|')}`
    refreshBalance()
    const out = { version: Date.now(), listRev, balance: balanceCache.data, sessions: wire, session: null }
    if (!sessionId) return out
    const row = meta?.meta ?? null
    const pv = row?.projections ?? {}
    // A subagent child is read through its parent's address; the plain session address is refused.
    const address = row?.origin === 'subagent' && row.parentId
      ? { kind: 'subagent', parentSessionId: row.parentId, childSessionId: sessionId, mode: 'unknown' }
      : { kind: 'session', sessionId }
    // The state call is cheap (the log end is in memory for a live session) and says whether the
    // cached projection is still current.
    const state = await sc().state({ sessionId }, new AbortController().signal).catch(() => null)
    const heavy = await projectSession(sessionId, take, meta?.cwd ?? null, address, state?.cursor, lang)
    let attempt = null
    for (const item of live.values()) {
      if (item.sessionId === sessionId && (attempt === null || item.startedAt > attempt.startedAt)) attempt = item
    }
    // The attempt that is streaming right now, as blocks that continue the open turn's groups (see streamView).
    let streaming = null
    let streamLive
    if (attempt) {
      const view = streamView(attempt, heavy.tail, lang)
      streamLive = view.live
      if (view.blocks.length > 0) streaming = { blocks: view.blocks }
    }
    const jobRows = (() => {
      try {
        const all = ctx.get('jobs')?.list?.(sessionId) ?? []
        return all.slice().sort((a, b) => (b.startedAt ?? 0) - (a.startedAt ?? 0)).slice(0, 12).map((j) => ({
          id: String(j.id ?? ''),
          kind: String(j.kind ?? ''),
          label: truncate(String(j.label ?? ''), 120),
          status: String(j.status ?? ''),
          // The state in the job list's words (ui-jobs status.*); `status` stays the code the phone's controls read.
          state: Object.hasOwn(COPY.zh, `job.status.${j.status}`) ? copy(lang, `job.status.${j.status}`) : String(j.status ?? ''),
          progress: j.progress ? truncate(String(j.progress), 80) : '',
          detail: j.detail ? truncate(String(j.detail), 120) : '',
          startedAt: j.startedAt ?? 0,
          finishedAt: j.finishedAt ?? 0,
          when: ago(lang, j.finishedAt ?? j.startedAt ?? 0),
        }))
      } catch {
        return []
      }
    })()
    const subs = (() => { try { return subagentTree(lang, sessionId, listing.all, agentStatus()) } catch (err) { log('subagent tree failed:', String(err?.message ?? err)); return [] } })()
    const parentEntry = row?.origin === 'subagent' ? (listing.all.get(row.parentId)?.projections?.subagentCatalog ?? []).find((e) => e?.id === sessionId) : undefined
    const runStartedAt = attempt?.startedAt ?? heavy.lastUserAt
    // The composer's facts. 继续生成 (InputBar primaryRetries) is offered while the session's latest ending is a continuable failure, nothing runs
    // and nothing waits in the inbox for a human (a queued or steering message); an ordinary session only.
    const isRunning = Boolean(meta?.running ?? state?.running)
    const inbox = Array.isArray(state?.queue) ? state.queue : []
    const continueSeq = heavy.continuation !== null && state !== null && !isRunning && row?.origin !== 'subagent'
      && !inbox.some((q) => q?.placement === 'queued' || q?.placement === 'steering') ? heavy.continuation : null
    const planMode = heavy.planMode === null ? undefined : heavy.planMode.pending ? (heavy.planMode.active ? 'leaving' : 'entering') : heavy.planMode.active ? 'on' : 'off'
    const gi = heavy.goal
    // Process-local: whether this live process may continue an active goal (GoalBar's 待继续 label); a cold session has none.
    const goalActivation = gi === null ? '' : (() => {
      try {
        const agent = ctx.get('agents')?.get?.(sessionId)
        const act = agent ? ctx.get('goals')?.get?.(agent)?.activation : undefined
        return act === 'armed' || act === 'disarmed' ? act : ''
      } catch { return '' }
    })()
    // Agent-team board (parity with TeamBoard): tasks of this session's team.
    const teamTasks = pv.agentTeam?.tasks ?? pv.team?.tasks
    out.session = {
      id: sessionId,
      todos: heavy.todos,
      jobs: jobRows,
      title: meta?.title ?? null,
      cwd: meta?.cwd ?? null,
      running: isRunning,
      // Subagent child sessions are read-only on the phone unless they are continuable.
      origin: row?.origin === 'subagent' ? 'subagent' : '',
      subagentMode: row?.subagentMode ?? '',
      parentId: row?.parentId ?? '',
      // When this turn's first stream frame landed: drives the running-status
      // clock (DSH's `深度求索中，用时 …`) on the phone.
      runStartedAt: runStartedAt,
      // DSH RunningStatus copy: `深度求索中，用时 1分23秒 ···` (chat.deepDivingFor). Precomputed here
      // because data sources on the phone cannot call Date.now().
      runLabel: runStartedAt ? copy(lang, 'chat.deepDivingFor', { duration: runDuration(lang, Math.max(1000, Date.now() - runStartedAt)) }) : copy(lang, 'chat.deepDiving'),
      // The live title of the open group (ProcessGroupHeader): 正在… with the first readable argument, 准备… while a call's arguments
      // still stream, 正在分析请求 while it thinks; `kind` says which. A retry waiting out its delay has no open stream: the official status
      // line with its live countdown. Null when nothing is open (a reply is streaming, or no group yet).
      runActivity: (() => {
        if (heavy.retryLive && Boolean(meta?.running ?? state?.running)) {
          const { retry, maximum, deadline } = heavy.retryLive
          return { kind: 'retry', label: copy(lang, 'retry.status', { label: copy(lang, 'retry.active'), retry, maximum, seconds: retrySeconds(deadline - Date.now()) }), detail: '' }
        }
        return streamLive !== undefined ? streamLive : heavy.activity
      })(),
      stats: heavy.stats,
      ...(heavy.context ? { context: heavy.context } : {}),
      inherited: heavy.inherited,
      model: meta?.meta?.model ?? '',
      permission: meta?.permission ?? '',
      permissionOptions: permissionCatalog(ctx),
      hasMore: heavy.hasMore,
      plan: meta?.plan ?? null,
      goal: gi ? gi.objective : (meta?.goal ?? null),
      goalId: gi ? gi.id : (meta?.goalId ?? null),
      goalPhase: gi ? gi.phase : (meta?.goalPhase ?? null),
      // GoalBar's details: rounds, the blocker's message and the process-local activation.
      ...(gi ? { goalInfo: { rounds: gi.rounds, max: gi.max, reason: gi.reason, activation: goalActivation } } : {}),
      continueSeq,
      ...(planMode === undefined ? {} : { planMode }),
      streaming,
      rowsRev: heavy.rowsRev,
      // Every turn number of the session (only /v1/transcript carries it; the live poll drops it).
      turns: heavy.turns,
      messages: heavy.rows,
      queue: inbox.filter((q) => q?.placement === undefined || q.placement === 'queued').slice(0, 12).map(queueRow),
      ...interactionsFor(sessionId, pv.userQuestions ?? heavy.userQuestions, heavy.callIndex),
      quota: heavy.quota,
      quotaId: heavy.quotaId,
      subagents: subs,
      subagentProgress: subs.length > 0 ? subagentProgress(lang, subs) : '',
      // The child's place in its tree (SubagentHeaderLineage): the parent's title and what the parent's catalog calls this child.
      ...(row?.origin === 'subagent' ? { parentTitle: String(listing.all.get(row.parentId)?.title ?? ''), agentLabel: String(parentEntry?.label ?? '') || String(parentEntry?.name ?? '') } : {}),
      ...(Array.isArray(teamTasks) && teamTasks.length > 0 ? {
        team: teamTasks.slice(0, 20).map((t, k) => ({
          id: `tt${k}`,
          taskId: String(t.id ?? ''),
          subject: truncate(String(t.subject ?? ''), 120),
          status: String(t.status ?? 'pending'),
          owner: truncate(String(t.ownerName ?? t.ownerId ?? ''), 60),
        })),
      } : {}),
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
  // Relative time, computed here because the phone has no date library: the official buckets (ui-primitives relativeTime) in the
  // official words (ui-workspace time.*): 刚刚 / 4分钟 / 2小时 / 3天 / 2个月 / 1年, now / 4min / 2h / 3d / 2mo / 1y.
  const ago = (lang, ms) => {
    if (!ms) return ''
    const d = Math.max(0, Date.now() - Number(ms))
    if (!Number.isFinite(d)) return ''
    const MIN = 60_000
    const HOUR = 3_600_000
    const DAY = 86_400_000
    if (d < MIN) return copy(lang, 'time.now')
    if (d < HOUR) return copy(lang, 'time.minutes', { n: Math.floor(d / MIN) })
    if (d < DAY) return copy(lang, 'time.hours', { n: Math.floor(d / HOUR) })
    if (d < 30 * DAY) return copy(lang, 'time.days', { n: Math.floor(d / DAY) })
    if (d < 365 * DAY) return copy(lang, 'time.months', { n: Math.floor(d / (30 * DAY)) })
    return copy(lang, 'time.years', { n: Math.floor(d / (365 * DAY)) })
  }
  const baseName = (p) => (typeof p === 'string' && p !== '' ? p.split('/').filter(Boolean).pop() ?? p : '')

  // ---- reading marks (ui-session-status): the host's `sessionStatus` records are what the desktop sidebar's unread / failed dots read, and the
  // phone marks through the same service when it views a session. Without that service (or without its records) the bridge keeps its own,
  // fed by the turns that end while it runs, which is all the host's service knows either.
  const ownReads = new Map() // sessionId -> {completedTurn, failed, readTurn, manualUnread}
  const hostReads = () => { try { const svc = ctx.get('sessionStatus'); return typeof svc?.mark === 'function' && svc.records instanceof Map ? svc : null } catch { return null } }
  const readingOf = (id) => hostReads()?.records.get(id) ?? ownReads.get(id) ?? null
  const unreadOf = (id) => {
    const rec = readingOf(id)
    return rec && (rec.manualUnread === true || rec.completedTurn > rec.readTurn) ? (rec.failed ? 'failed' : 'done') : ''
  }
  const markRead = (id) => {
    try {
      const rec = readingOf(id)
      if (!rec || unreadOf(id) === '') return
      const svc = hostReads()
      if (svc) Promise.resolve(svc.mark(id, { type: 'read', throughTurn: rec.completedTurn })).catch((err) => log('reading mark failed:', String(err?.message ?? err)))
      else ownReads.set(id, { ...rec, readTurn: rec.completedTurn, manualUnread: false })
    } catch (err) { log('reading mark failed:', String(err?.message ?? err)) }
  }
  const noteTurnEnd = (sessionId, data) => {
    if (!sessionId || !Number.isInteger(data?.turn)) return
    const prev = ownReads.get(sessionId) ?? { completedTurn: 0, failed: false, readTurn: 0, manualUnread: false }
    ownReads.delete(sessionId)
    ownReads.set(sessionId, { ...prev, completedTurn: data.turn, failed: data.reason?.kind === 'error' })
    while (ownReads.size > 400) ownReads.delete(ownReads.keys().next().value)
  }

  const registrySets = () => {
    try {
      const reg = ctx.get('workspaceRegistry')
      return { pinned: new Set(reg?.pinnedSessionIds ?? []), archived: new Set(reg?.archivedSessionIds ?? []) }
    } catch {
      return { pinned: new Set(), archived: new Set() }
    }
  }

  const callList = async (showArchived = false, lang = 'zh-Hans') => {
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
        model: pv.modelSelection?.next?.model ?? null,
        provider: pv.modelSelection?.next?.provider ?? null,
        effort: pv.modelSelection?.next?.reasoningEffort ?? null,
        // Subagent lineage (completed below for children): the direct creator (an ordinary fork may
        // carry parentSessionId too, so only an `origin: 'subagent'` row counts) and the mode.
        parentId: r.origin === 'subagent' ? (r.parentSessionId ?? '') : '',
        subagentMode: '',
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
    // A child's parent and mode, read the way the desktop header does: from the parent's
    // subagentCatalog entry, else from the child's own descriptor. 'unknown' stays unknown.
    const catalogOf = new Map()
    for (const r of rows) {
      for (const e of Array.isArray(r.projections.subagentCatalog) ? r.projections.subagentCatalog : []) {
        if (e?.id) catalogOf.set(String(e.id), { parentId: r.id, mode: e.mode })
      }
    }
    for (const r of rows) {
      const c = catalogOf.get(r.id)
      if (r.origin !== 'subagent' && !c) continue
      r.parentId = r.parentId || (c?.parentId ?? '')
      const mode = c?.mode ?? r.projections.subagent?.mode
      r.subagentMode = mode === 'one-shot' || mode === 'continuable' || mode === 'external' ? mode : ''
    }
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
      r.when = ago(lang, r.updatedAt ?? r.lastPromptAt)
      prev = entry.key
    }
    // The Ungrouped bucket labels itself client-side (group ''); keep the group
    // key distinct from any workspace path so `first` still flips once.
    for (const r of stray) {
      r.group = ''
      r.first = prev !== '__ungrouped__'
      r.when = ago(lang, r.updatedAt ?? r.lastPromptAt)
      prev = '__ungrouped__'
    }
    // `visible` is exactly the list the phone shows; `all` also holds the rows the list hides
    // (subagent children, blanks, archived), for the metadata of a session opened directly.
    return { visible: [...ordered.map((e) => e.row), ...stray], all: new Map(rows.map((r) => [r.id, r])) }
  }

  // Uploaded-but-unsent photos: phone-facing id -> {ref, name, at}.
  const attachments = new Map()

  // The session list is the visible callList rows in callList order; `sessions` stays a status
  // cache (running/lastSeq...) and never adds or reorders rows. One sc().list() per call.
  const mergeStatus = async (showArchived = false, lang = 'zh-Hans', viewing = null) => {
    const { pinned: pinnedIds, archived: archivedIds } = registrySets()
    const { visible, all } = await callList(showArchived, lang)
    const st = agentStatus()
    // The session the phone is looking at acknowledges its own completion (the desktop's visible main view does the same).
    if (viewing) markRead(viewing)
    // What waits on the person, per session (a subagent child's request marks its parent's row too).
    const attention = (() => {
      try { return attentionMap([...all.values()], (id) => all.get(id)?.parentId || '') } catch (err) { log('attention failed:', String(err)); return new Map() }
    })()
    const merge = (r) => {
      const s = sessions.get(r.id)
      const live = st.get(r.id)
      return {
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
        pinned: pinnedIds.has(r.id),
        archived: archivedIds.has(r.id),
        model: r.model ?? null,
        permission: r.permission ?? s?.permission ?? null,
        group: r.group ?? null,
        first: Boolean(r.first),
        when: r.when ?? '',
        // 'approval' | 'question' | 'plan-review' while something on this session waits for the person.
        attention: attention.get(r.id) ?? '',
        // The sidebar's dots (ui-session-status): 'done' a completion nobody has read, 'failed' one that ended with an error.
        unread: r.id === viewing ? '' : unreadOf(r.id),
        // Direct subagents that are running right now (the sidebar's 「N 个子智能体运行中」).
        subs: (Array.isArray(r.projections?.subagentCatalog) ? r.projections.subagentCatalog : []).filter((e) => e?.mode !== 'external' && (all.get(e?.id)?.running || st.get(e?.id)?.status === 'running')).length,
        meta: r,
      }
    }
    const rows = visible.map((r) => {
      const m = merge(r)
      sessions.set(r.id, m)
      return m
    })
    // The open session may be one the list hides (a subagent child, an archived row): it still needs its metadata.
    const find = (id) => rows.find((r) => r.id === id) ?? (all.has(id) ? merge(all.get(id)) : null)
    return { rows, find, all }
  }

  // ---- the Mac's presentation settings -------------------------------------------------------------------------
  // The phone follows what the desktop is set to: transcriptView / collapseTiming / foldedReplies / performanceUsage of the `ui-chat`
  // entry and busyEnter of `ui-conversation`. The host's settings service describes every plugin entry's live (volatile) fields
  // resolved over the profile patch; without it (or without those entries) the profile's own patch file is read, read-only.
  // Defaults are the official ones; a desktop app that saved no transcriptView reads `standard`.
  const pick = (v, allowed, dflt) => (allowed.includes(v) ? v : dflt)
  const normalizePrefs = (chat, conv) => ({
    transcriptView: chat?.transcriptView === 'normal' || chat?.transcriptView === 'expanded' ? 'detailed' : pick(chat?.transcriptView, ['compact', 'standard', 'detailed', 'verbose'], 'standard'),
    collapseTiming: pick(chat?.collapseTiming, ['completion', 'next-input'], 'completion'),
    foldedReplies: pick(chat?.foldedReplies, ['all', 'final'], 'all'),
    performanceUsage: pick(chat?.performanceUsage, ['compact', 'detailed'], 'detailed'),
    busyEnter: pick(conv?.busyEnter, ['queue', 'steer'], 'queue'),
  })
  /** `id:` entries of the profile patch with their `config:` scalars (a line scan: the patch is a flat YAML list of id-targeted entries). */
  const patchPrefs = () => {
    try {
      const file = ctx.get('profileContext')?.patchPath ?? path.join(os.homedir(), '.dsh', 'profiles', 'desktop', 'cordis.patch.yml')
      const out = {}
      let id = null
      let inConfig = false
      for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
        const entry = /^- id:\s*(\S+)/.exec(line)
        if (entry) { id = entry[1]; inConfig = false; continue }
        if (/^ {2}config:\s*$/.test(line)) { inConfig = true; continue }
        if (/^ {2}\S/.test(line) || /^-/.test(line)) { inConfig = false; continue }
        const kv = /^ {4}(\w+):\s*(\S+)\s*$/.exec(line)
        if (inConfig && kv && id !== null) (out[id] ??= {})[kv[1]] = kv[2].replace(/^['"]|['"]$/g, '')
      }
      return { chat: out['ui-chat'], conv: out['ui-conversation'] }
    } catch { return {} }
  }
  let prefsCache = { at: 0, value: null }
  // The service says when a form changed; the TTL is the net under it (describe() walks every plugin entry, so a 0.7 s poll must not).
  try { ctx.on('settings/document-updated', () => { prefsCache = { at: 0, value: null } }, { global: true }) } catch {}
  const readPrefs = () => {
    if (prefsCache.value !== null && Date.now() - prefsCache.at < 10_000) return prefsCache.value
    let chat
    let conv
    try {
      const forms = ctx.get('settings')?.describe?.({ redactSecrets: true })
      if (Array.isArray(forms)) {
        chat = forms.find((f) => f?.ns === 'ui-chat')?.value
        conv = forms.find((f) => f?.ns === 'ui-conversation')?.value
      }
    } catch (err) { log('settings read failed:', String(err)) }
    if (chat === undefined || conv === undefined) {
      const patch = patchPrefs()
      chat ??= patch.chat
      conv ??= patch.conv
    }
    prefsCache = { at: Date.now(), value: normalizePrefs(chat, conv) }
    return prefsCache.value
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
      // Is the desktop renderer's half (client.js) attached? Then approvals / questions are the Mac's own cards, mirrored.
      desktopAttached: desktopAttached(),
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
          // The desktop renderer reaches loopback from a page origin; Chromium's private-network preflight asks for this.
          'access-control-allow-private-network': 'true',
        })
        return res.end()
      }

      if (url.pathname === '/v1/health') {
        return json(res, 200, { ok: true, name, instanceId: state.instanceId, paired: state.tokens.length > 0, sessions: sessions.size, publicUrl: tunnel.url, desktopAttached: desktopAttached(), api: BRIDGE_API, ...(isLoopback(req) || authorized(req, url) ? { dsh: dshVersion(), caps: capabilities() } : {}) })
      }

      // A page for the person at the Mac: one QR to scan, the code as a fallback.
      if ((url.pathname === '/pair' || url.pathname === '/') && req.method === 'GET') {
        if (!isLoopback(req)) {
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
        const pl = langOf(req.headers['accept-language'])
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' })
        return res.end(`<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${copy(pl, 'page.title')}</title>
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
<main><h1>${copy(pl, 'page.title')}</h1><p class="sub">${copy(pl, 'page.sub')}</p>
<div class="qr">${svg}</div>
<code>${p.code}</code>
<p class="note">${tunnel.url || `http://127.0.0.1:${port}`}<br>${copy(pl, 'page.expires', { mins, id: state.instanceId })}</p>
<p class="note">${copy(pl, state.tokens.length > 0 ? 'page.paired' : 'page.unpaired')}</p></main>`)
      }

      // Pairing code and token are only readable from the laptop itself (never through the tunnel).
      if (url.pathname === '/v1/pairing' && req.method === 'GET') {
        if (!isLoopback(req)) {
          return json(res, 403, { error: 'loopback_only' })
        }
        const p = state.pairing && state.pairing.expiresAt > Date.now() ? state.pairing : issuePairingCode()
        return json(res, 200, pairingView(p))
      }

      // Issue a new code on demand: the panel's 刷新二维码 button used to only bust the
      // image cache, so it looked dead while the same five minutes were still running.
      if (url.pathname === '/v1/pairing/refresh' && req.method === 'POST') {
        if (!isLoopback(req)) {
          return json(res, 403, { error: 'loopback_only' })
        }
        const p = issuePairingCode()
        return json(res, 200, pairingView(p))
      }

      // The same payload as an SVG, for a panel that does not want to draw a QR itself.
      if (url.pathname === '/v1/pairing.svg' && req.method === 'GET') {
        if (!isLoopback(req)) {
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
        const name = String(body.name ?? 'device').slice(0, 40)
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
        const isLoop = isLoopback(req)
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

      // The desktop renderer's half (client.js): loopback only -- never through the tunnel, no token, like
      // /v1/pairing -- and refused for a page of another site (a web page can reach loopback too).
      if (parts[0] === 'v1' && parts[1] === 'desktop') {
        if (!isLoopback(req) || !originOk(req)) return json(res, 403, { error: 'loopback_only' })
        sweepDesktop()
        const client = clipStr(url.searchParams.get('client') ?? '', 80)
        if (parts[2] === 'commands' && req.method === 'GET') {
          if (client === '') return json(res, 400, { error: 'client_required' })
          const c = touchDesktop(client)
          const wait = Math.min(Math.max(Number(url.searchParams.get('wait') ?? 0) || 0, 0), POLL_MAX_MS)
          // An open poll IS the liveness signal: it needs no timer, so a throttled background window stays attached.
          c.polls += 1
          let over = false
          const leave = () => { if (over) return; over = true; c.polls = Math.max(0, c.polls - 1); c.seenAt = Date.now() }
          res.on('close', leave)
          if (c.queue.length === 0 && wait > 0) {
            await new Promise((resolve) => {
              const done = () => { c.wakers.delete(done); clearTimeout(timer); resolve() }
              const timer = setTimeout(done, wait)
              c.wakers.add(done)
              res.on('close', done)
            })
          }
          if (res.destroyed || res.writableEnded) return
          return json(res, 200, { commands: c.queue.splice(0, 20) })
        }
        const body = req.method === 'POST' ? await readBody(req).catch(() => ({})) : {}
        const id = clipStr(body?.client, 80) || client
        if (id === '') return json(res, 400, { error: 'client_required' })
        if (parts[2] === 'state' && req.method === 'POST') {
          const c = touchDesktop(id)
          const items = cleanDesktopItems(id, body.items)
          const keep = new Map()
          for (const it of items) {
            it.at = c.firstSeen.get(it.key) ?? it.at
            keep.set(it.key, it.at)
          }
          c.firstSeen = keep
          c.items = items
          return json(res, 200, { ok: true })
        }
        if (parts[2] === 'ack' && req.method === 'POST') {
          touchDesktop(id)
          const cmd = commands.get(String(body.id ?? ''))
          if (cmd && cmd.clientId === id) cmd.done({ ok: body.ok === true, error: clipStr(body.error, 300), value: body.value })
          return json(res, 200, { ok: true })
        }
        if (parts[2] === 'detach' && req.method === 'POST') {
          dropDesktop(id)
          return json(res, 200, { ok: true })
        }
        return json(res, 404, { error: 'not_found' })
      }

      if (!authorized(req, url)) return json(res, 401, { error: 'unauthorized' })

      // Dev-only routes (_try, _ask, _svc) answer on the Mac itself only: a request through the
      // tunnel also arrives from 127.0.0.1, but cloudflared stamps it with cf-* headers.
      const loopback = isLoopback(req)
      // Dev-only: call a sessionController method with raw JSON args.
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

      // Tool approvals (and question-intent approvals) are allow-once or reject; a legacy 'always' is an
      // allow-once (the 'never' policy would reject everything from now on), unless a question-intent
      // approval offers its own persistent grant. The reply waits for the desktop client's ack (undelivered
      // after COMMAND_ACK_MS), so the phone never believes an answer that did not land.
      if (parts[0] === 'v1' && parts[1] === 'approvals' && parts[2] && req.method === 'POST') {
        const id = decodeURIComponent(parts[2])
        const body = await readBody(req)
        const item = pendingItems().find((x) => x.id === id && attentionKind(x) === 'approval') ?? null
        if (!item) return json(res, 404, { error: 'expired' })
        const r = await decideItem(item, body.decision === 'always' ? 'always' : body.decision === 'allow' ? 'allow' : 'deny')
        if (r.ok) pushFeed(item.sessionId, 'approval/resolved', { approvalId: id, decision: r.decision })
        return reply(res, r)
      }

      // A question / plan review: answer (all questions at once), dismiss (skip is the old name), hold the countdown.
      if (parts[0] === 'v1' && parts[1] === 'questions' && parts[2] && req.method === 'POST') {
        const id = decodeURIComponent(parts[2])
        const action = parts[3] ?? ''
        const item = await findQuestion(id)
        if (!item) return json(res, 404, { error: 'expired' })
        if (action === 'answer') {
          const body = await readBody(req)
          if (!Array.isArray(body.answers)) return json(res, 400, { error: 'no_answers' })
          const r = await answerQuestionItem(item, body.answers)
          if (r.ok) pushFeed(item.sessionId, 'question/answered', { id })
          return reply(res, r)
        }
        if (action === 'dismiss' || action === 'skip') {
          const r = await dismissItem(item)
          if (r.ok) pushFeed(item.sessionId, 'question/dismissed', { id })
          return reply(res, r)
        }
        if (action === 'hold') {
          const body = await readBody(req).catch(() => ({}))
          // Only the desktop's own countdown can be held (慢慢回答 / the first edit); without one there is nothing to stop.
          if (item.source !== 'desktop') return json(res, 200, { ok: true })
          return reply(res, await sendCommand(item.clientId, { op: 'hold', key: item.key, mode: body.mode === 'engage' ? 'engage' : 'take' }))
        }
        return json(res, 404, { error: 'not_found' })
      }

      // Put a collapsed question back (the tool row's 回答): the card the desktop hid, or the bridge's own.
      if (parts[0] === 'v1' && parts[1] === 'sessions' && parts[2] && parts[3] === 'questions' && parts[4] && parts[5] === 'reveal' && req.method === 'POST') {
        return reply(res, await revealQuestion(decodeURIComponent(parts[2]), decodeURIComponent(parts[4])))
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
        const agent = await agentFor(sessionId)
        const goalService = ctx.get('goals')
        if (!agent || !goalService) return json(res, 409, { error: 'goal unavailable' })
        const view = goalService.get?.(agent)
        if (!view?.id) return json(res, 409, { error: 'no goal on this session' })
        const ref = { id: view.id, revision: view.revision }
        try {
          if (action === 'pause') goalService.pause(agent, ref)
          else if (action === 'resume') goalService.resume(agent, ref)
          else if (action === 'clear') goalService.clear(agent, ref)
          else if (action === 'edit') {
            // GoalBar's 编辑目标: the same compare-and-set edit the official bar makes (not a /goal command line).
            const objective = String(body.objective ?? '').trim()
            if (objective === '' || objective.length > 4000) return json(res, 400, { error: 'empty objective' })
            goalService.edit(agent, ref, { objective })
          } else return json(res, 400, { error: 'unknown action' })
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
          const text = canonSessionMentions(String(body?.text ?? '').slice(0, 4000))
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
      if (url.pathname === '/v1/_ask' && req.method === 'POST' && loopback) {
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
      if (url.pathname === '/v1/_svc' && req.method === 'GET' && loopback) {
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
        const take = Math.min(Math.max(Number(url.searchParams.get('take') ?? 8) || 8, 4), 120)
        // The archived filter mirrors the desktop view-options toggle: 'default'
        // hides archived rows, 'show' mixes them back in grayed.
        const showArchived = url.searchParams.get('archived') === 'show'
        // The language bridge-worded rows read in (the phone's effective locale): zh-Hans (default) or en.
        const lang = langOf(url.searchParams.get('lang'))
        const snapshot = await snapshotSession(sessionId, take, showArchived, lang)
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
                turns: snapshot.session?.turns ?? [],
                ids: rowsOut.map((r) => r.id),
                rows: rowsOut.filter((r) => Number(r.seq) > since),
              })
            }
          }
          return json(res, 200, {
            rowsRev: snapshot.session?.rowsRev ?? '',
            hasMore: snapshot.session?.hasMore ?? false,
            seq: cursor,
            turns: snapshot.session?.turns ?? [],
            ids: rowsOut.map((r) => r.id),
            rows: rowsOut,
          })
        }
        const hasList = url.searchParams.get('listRev') !== snapshot.listRev
        if (!hasList) snapshot.sessions = []
        if (snapshot.session) { snapshot.session.messages = []; delete snapshot.session.turns }
        return json(res, 200, { ...snapshot, prefs: readPrefs(), limits: readLimits(), bridge: bridgeInfo() })
      }


      if (url.pathname === '/v1/sessions' && req.method === 'GET') {
        const { rows } = await mergeStatus(false, langOf(url.searchParams.get('lang')))
        return json(res, 200, { sessions: rows.slice(0, SESSION_MAX) })
      }

      // One tool card's detail, looked up in that session's call index: the full arguments and result
      // (64 KB each; argsChars/resultChars are the untruncated lengths) the rows leave out, and `view`, the card
      // (terminal / read / search / web / diff / image / details / input-output) built here, in the phone's `lang`.
      if (parts[0] === 'v1' && parts[1] === 'sessions' && parts[2] && parts[3] === 'call' && req.method === 'GET') {
        const callId = url.searchParams.get('callId') ?? ''
        const block = callIndexes.get(decodeURIComponent(parts[2]))?.get(callId)
        if (!block) return json(res, 404, { error: 'unknown call' })
        const full = block[FULL] ?? {}
        const lang = langOf(url.searchParams.get('lang'))
        let diffs = []
        let more = 0
        try { diffs = Array.isArray(block.diff) ? diffFiles(block.diff).map((f) => ({ ...f, lines: f.lines.map((l) => ({ ...l, text: maskSecrets(l.text) })) })) : []; more = Array.isArray(block.diff) ? diffHidden(block.diff) : 0 } catch { /* the card still opens */ }
        return json(res, 200, {
          callId,
          name: block.name ?? '',
          title: toolTitle(lang, String(block.name ?? ''), full.parsed),
          args: maskSecrets(full.args ?? block.args ?? ''),
          argsChars: full.argsChars ?? String(block.args ?? '').length,
          result: full.result ?? block.result ?? '',
          resultChars: full.resultChars ?? String(block.result ?? '').length,
          diffs,
          diffHidden: more,
          todos: block.todos ?? [],
          files: block.files ?? [],
          question: block.question ?? '',
          options: block.options ?? [],
          view: toolView(lang, { ...block, status: block.status }, full.env),
        })
      }

      if (parts[0] === 'v1' && parts[1] === 'file' && req.method === 'GET') {
        if (!authorized(req, url)) return json(res, 401, { error: 'unauthorized' })
        const raw = url.searchParams.get('p') ?? ''
        const sid = url.searchParams.get('s') ?? ''
        let base = process.cwd()
        if (sid) {
          const row = (await mergeStatus()).find(sid)
          if (row?.cwd) base = row.cwd
        }
        // path.resolve normalises an absolute path too, so `..` cannot hide in it.
        const resolved = path.resolve(base, raw)
        // Scoping: serve only the session's own workspace and the system temp dir
        // (charts and scratch images live there). Everything else is off-limits.
        if (!inScope(base, resolved)) return json(res, 403, { error: 'outside workspace' })
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
          const next = pv.modelSelection?.next ?? {}
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

      // The slash menu: the host's commands (an agent's scope view when the session has an agent) and the user-invocable skills (ui-skill's
      // `/` source; picking one lands the plain `/name ` the host's skill pre-step recognizes). `export` is a download the phone cannot take.
      if (parts[0] === 'v1' && parts[1] === 'sessions' && parts[2] && parts[3] === 'commands' && req.method === 'GET') {
        try {
          const sessionId = decodeURIComponent(parts[2])
          const commands = ctx.get('commands')
          const agent = await agentFor(sessionId, false) // opening a session must not wake it: a cold one lists the global commands
          const [list, skills] = await Promise.all([
            Promise.resolve().then(() => commands.list(agent ?? { sessionId })),
            skillRows(sessionId),
          ])
          return json(res, 200, {
            commands: (Array.isArray(list) ? list : []).filter((c) => c?.name !== 'export').map((c) => ({
              name: String(c.name ?? ''),
              description: String(c.description ?? ''),
              hint: String(c.input?.hint ?? ''),
            })),
            skills,
          })
        } catch (err) {
          return json(res, 409, { error: String(err?.message ?? err) })
        }
      }

      // Run a host command as the official composer does: `commands.execute(agent, '/name input', [], signal)` (rc.3: the registry parses the
      // line, logs command/run + command/done, runs the handler). An error result is a refusal the phone shows; a long one (/compact) answers
      // after a few seconds and finishes in the background (its command card follows in the transcript).
      if (parts[0] === 'v1' && parts[1] === 'sessions' && parts[2] && parts[3] === 'command' && req.method === 'POST') {
        const body = await readBody(req)
        const name = String(body.name ?? '').replace(/^\//, '')
        if (!/^[a-z][a-z0-9_-]*$/u.test(name)) return json(res, 400, { error: 'bad command name' })
        const input = typeof body.input === 'string' ? body.input.trim() : ''
        const agent = await agentFor(decodeURIComponent(parts[2]))
        const commands = ctx.get('commands')
        if (!agent || typeof commands?.execute !== 'function') return json(res, 409, { error: 'commands unavailable' })
        try {
          const run = Promise.resolve().then(() => commands.execute(agent, `/${name}${input === '' ? '' : ` ${input}`}`, [], new AbortController().signal))
          const done = await Promise.race([run, new Promise((resolve) => { setTimeout(() => resolve(LATER), 6000).unref?.() })])
          if (done === LATER) {
            run.catch((err) => log('command failed:', name, String(err?.message ?? err)))
            return json(res, 200, { ok: true, message: '' })
          }
          if (done === undefined) return json(res, 404, { error: `unknown command: /${name}` })
          const result = done.result ?? done
          const text = typeof result?.text === 'string' ? result.text : ''
          if (result?.kind === 'error') return json(res, 409, { error: text || 'command failed' })
          return json(res, 200, { ok: true, message: text })
        } catch (err) {
          return json(res, 409, { error: String(err?.message ?? err) })
        }
      }

      if (url.pathname === '/v1/sessions' && req.method === 'POST') {
        const body = await readBody(req)
        // Grouping parity with the desktop (see workspaceForCwd): create through the
        // workspace registry so the Host attaches the session to its group. A directory
        // no workspace owns yet registers first — idempotent per canonical path, the
        // same registration the desktop's directory picker performs; a path that
        // cannot register (missing / not a directory) falls back to a cwd-only create.
        let request = {}
        if (typeof body.cwd === 'string' && body.cwd !== '') {
          const registry = ctx.get('workspaceRegistry')
          let workspace = null
          try { workspace = workspaceForCwd(body.cwd, registry?.list?.() ?? []) } catch { workspace = null }
          if (!workspace && registry && typeof registry.create === 'function') {
            try { workspace = await registry.create(body.cwd) } catch { /* unregistrable: create by cwd */ }
          }
          const id = workspace?.id ?? workspace?.workspaceId
          request = id !== undefined ? { workspaceId: id } : { cwd: body.cwd }
        }
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

      // Message feedback (parity with ui-message-feedback): GET lists the session's ratings, POST records one (rating + category + note), POST
      // .../clear retracts one. The host compares versions per item (`ifVersion`), so every write reads the item's current version first;
      // a race the host still catches answers 409 `version-conflict` with the item as it now stands. Refusals are the host's stable codes.
      if (parts[0] === 'v1' && parts[1] === 'sessions' && parts[2] && parts[3] === 'feedback' && (req.method === 'POST' || req.method === 'GET')) {
        const id = decodeURIComponent(parts[2])
        const svc = (() => { try { return ctx.get('messageFeedback') } catch { return undefined } })()
        if (!svc || typeof svc.put !== 'function') return json(res, 409, { error: 'feedback unavailable' })
        const itemOf = (it) => ({ messageId: String(it?.messageId ?? ''), rating: it?.rating === 'negative' ? 'negative' : 'positive', note: typeof it?.note === 'string' ? truncate(it.note, 2000) : '', category: typeof it?.category === 'string' ? it.category : '', version: String(it?.version ?? '') })
        // A domain result is {ok:true, value} or {ok:false, error:{code}}; some hosts hand the bare value.
        const settled = (r) => (r && typeof r === 'object' && 'ok' in r ? r : { ok: true, value: r })
        const refused = (r) => {
          const code = String(r.error?.code ?? 'feedback_rejected')
          return json(res, code === 'version-conflict' ? 409 : code === 'note-too-large' ? 413 : code === 'note-blank' ? 400 : 404, { error: code, ...(r.error?.current ? { item: itemOf(r.error.current) } : {}) })
        }
        const listed = async () => {
          const r = settled(await svc.list({ sessionId: id }))
          return r.ok ? { items: (Array.isArray(r.value?.items) ? r.value.items : Array.isArray(r.value) ? r.value : []).map(itemOf) } : { refusal: r }
        }
        try {
          if (req.method === 'GET') {
            const l = await listed()
            return l.refusal ? refused(l.refusal) : json(res, 200, { items: l.items })
          }
          const body = await readBody(req)
          // The target is the DSH message id (a UUID); a numeric seq is the older phone's spelling.
          const messageId = typeof body.id === 'string' && body.id !== '' ? body.id : Number(body.seq)
          const l = await listed()
          if (l.refusal) return refused(l.refusal)
          const existing = l.items.find((it) => it.messageId === String(messageId))
          if (parts[4] === 'clear') {
            if (!existing) return json(res, 200, { ok: true })
            const r = settled(await svc.delete({ sessionId: id, messageId, ifVersion: existing.version }))
            return r.ok ? json(res, 200, { ok: true }) : refused(r)
          }
          const note = typeof body.note === 'string' ? body.note.trim() : ''
          const r = settled(await svc.put({
            sessionId: id,
            messageId,
            rating: body.rating === 'negative' ? 'negative' : 'positive',
            ...(note !== '' ? { note } : {}),
            ...(FEEDBACK_CATEGORIES.includes(body.category) ? { category: body.category } : {}),
            ifVersion: existing ? existing.version : null,
          }))
          return r.ok ? json(res, 200, { ok: true, item: itemOf(r.value) }) : refused(r)
        } catch (err) {
          return json(res, 409, { error: String(err?.message ?? err) })
        }
      }

      // A background job's output (ui-jobs' output panel): the tail of its retained ring, read without moving the model's cursor; ANSI
      // stripped, secrets masked. `more` says earlier output is not shown (past the tail, or already dropped by the ring).
      if (parts[0] === 'v1' && parts[1] === 'sessions' && parts[2] && parts[3] === 'job' && req.method === 'GET') {
        const sessionId = decodeURIComponent(parts[2])
        const jobId = String(url.searchParams.get('jobId') ?? '')
        const jobs = (() => { try { return ctx.get('jobs') } catch { return undefined } })()
        if (jobId === '' || typeof jobs?.readAt !== 'function' || typeof jobs?.get !== 'function') return json(res, 409, { error: 'jobs unavailable' })
        try {
          const view = jobs.get(jobId, sessionId)
          const total = Number(view?.output?.total ?? 0)
          const earliest = Number(view?.output?.earliest ?? 0)
          const from = Math.max(earliest, total - JOB_TAIL_BYTES)
          const read = total > 0 ? jobs.readAt(jobId, from, sessionId) : { chunks: [], lossy: false }
          const text = plainText((Array.isArray(read.chunks) ? read.chunks : []).map((c) => String(c?.text ?? '')).join(''))
          const tail = text.length > JOB_TAIL_CHARS ? text.slice(-JOB_TAIL_CHARS) : text
          return json(res, 200, { id: jobId, status: String(view?.status ?? ''), total, text: maskSecrets(tail), more: from > earliest || read.lossy === true || tail.length < text.length })
        } catch (err) { return json(res, 404, { error: String(err?.message ?? err) }) }
      }

      // Open a file or folder of the session's workspace on the Mac itself (the official 用默认应用打开 / 在访达中显示: the session controller's
      // openWorkspacePath). Only inside the workspace or the temp dir (as the viewer), and a file the system would RUN when opened is only
      // ever revealed, never opened.
      if (parts[0] === 'v1' && parts[1] === 'sessions' && parts[2] && parts[3] === 'open' && req.method === 'POST') {
        const id = decodeURIComponent(parts[2])
        const lang = langOf(url.searchParams.get('lang'))
        const body = await readBody(req)
        const controller = sc()
        if (typeof controller?.openWorkspacePath !== 'function' || controller.canOpenWorkspacePath?.() !== true) return json(res, 409, { error: copy(lang, 'open.unavailable') })
        const rel = String(body.path ?? '')
        if (rel === '') return json(res, 400, { error: 'missing_path' })
        const cwd = (await callList(true).catch(() => null))?.all.get(id)?.cwd ?? null
        if (cwd === null) return json(res, 404, { error: 'unknown_session' })
        const target = path.resolve(cwd, rel)
        if (!inScope(cwd, target)) return json(res, 403, { error: 'outside workspace' })
        try { await fsp.stat(target) } catch { return json(res, 404, { error: 'no_such_file' }) }
        const reveal = body.action === 'reveal'
        // The system opens what a link points at, so the real name is tested too (a `notes.txt` that links to a `.command` is the same file).
        const real = await fsp.realpath(target).catch(() => target)
        if (!reveal && (RUNS_WHEN_OPENED.test(target) || RUNS_WHEN_OPENED.test(real))) return json(res, 403, { error: copy(lang, 'open.notAllowed') })
        try {
          await controller.openWorkspacePath({ path: target, ...(reveal ? { action: 'reveal' } : {}) }, AbortSignal.timeout(15_000))
          return json(res, 200, { ok: true })
        } catch (err) {
          log('open on the Mac failed:', String(err?.message ?? err))
          return json(res, 409, { error: copy(lang, 'open.failed') })
        }
      }

      // One file's changes in one turn (ui-deliverables' FileDiff / review tab). The host's own comparison when it has one for the turn
      // (workspaceChanges.diff over the `workspace/changes` event `seq` and the file's index `i`: git snapshots, so the line numbers are
      // the file's and a shell edit shows), else the diffs of that turn's write-class tool calls (`turn`, `path`). Lines are the phone's
      // card lines: sign + - (changed), a space (context), # (a hunk header); `n` the new file's line number.
      if (parts[0] === 'v1' && parts[1] === 'sessions' && parts[2] && parts[3] === 'changes' && req.method === 'GET') {
        const id = decodeURIComponent(parts[2])
        const seq = Number(url.searchParams.get('seq') ?? 0)
        const index = Number(url.searchParams.get('i') ?? -1)
        const turn = Number(url.searchParams.get('turn') ?? -1)
        const rel = String(url.searchParams.get('path') ?? '')
        const wire = (lines, extra) => ({ ok: true, kind: 'text', name: rel, added: 0, removed: 0, created: false, deleted: false, coarse: false, cut: false, ...extra, lines: lines.map((l, k) => ({ id: `l${k}`, n: l.n ?? 0, sign: l.sign, text: maskSecrets(truncate(l.text, 400)), runs: [] })) })
        try {
          const service = (() => { try { return ctx.get('workspaceChanges') } catch { return undefined } })()
          if (Number.isSafeInteger(seq) && seq > 0 && Number.isSafeInteger(index) && index >= 0 && typeof service?.diff === 'function') {
            // A host that cannot read its snapshot (it throws) is no reason to show nothing: the turn's tool diffs below still answer.
            const d = await service.diff(id, seq, index, AbortSignal.timeout(15_000)).catch((err) => { log('workspaceChanges.diff failed:', String(err?.message ?? err)); return undefined })
            if (d) {
              if (d.kind !== 'text') return json(res, 200, { ok: true, kind: d.kind, name: String(d.display ?? rel), added: 0, removed: 0, created: false, deleted: false, coarse: false, cut: false, lines: [] })
              const lines = []
              let cut = false
              let added = 0
              let removed = 0
              for (const h of Array.isArray(d.hunks) ? d.hunks : []) {
                if (lines.length >= DIFF_PAGE_LINES) { cut = true; break }
                lines.push({ sign: '#', text: `@@ -${h.oldStart},${h.oldLines} +${h.newStart},${h.newLines} @@` })
                let n = h.newStart
                for (const raw of Array.isArray(h.lines) ? h.lines : []) {
                  const sign = raw[0] === '+' || raw[0] === '-' ? raw[0] : ' '
                  if (sign === '+') added += 1
                  else if (sign === '-') removed += 1
                  if (lines.length < DIFF_PAGE_LINES) lines.push({ sign, text: raw.slice(1), n: sign === '-' ? 0 : n })
                  else cut = true
                  if (sign !== '-') n += 1
                }
              }
              return json(res, 200, wire(lines, { name: String(d.display ?? rel), added, removed, created: d.before === false, deleted: d.after === false, coarse: d.coarse === true, cut }))
            }
          }
          // No host comparison: this turn's write-class calls, from the per-session call index.
          const cwd = (await callList(true).catch(() => null))?.all.get(id)?.cwd ?? process.cwd()
          const here = path.resolve(cwd, rel)
          const lines = []
          let added = 0
          let removed = 0
          let cut = false
          for (const b of callIndexes.get(id)?.values() ?? []) {
            if (b[TURN] !== turn || b.status !== 'ok' || !/^(write|edit|apply_patch)$/.test(String(b.name)) || !Array.isArray(b.diff)) continue
            for (const part of b.diff) {
              if (path.resolve(cwd, String(part?.path ?? '')) !== here) continue
              const r = diffRows(part.oldText, part.newText, DIFF_PAGE_LINES - lines.length)
              for (const [sign, text] of r.rows) lines.push({ sign, text })
              added += r.added
              removed += r.removed
              cut = cut || r.cut
            }
          }
          if (lines.length === 0) return json(res, 404, { error: 'missing' })
          return json(res, 200, wire(lines, { added, removed, cut }))
        } catch (err) {
          log('changes diff failed:', String(err?.message ?? err))
          return json(res, 404, { error: 'missing' })
        }
      }

      // File preview (parity with the desktop document preview): one workspace
      // file for one session. Text comes back as text; images as a data URL.
      if (parts[0] === 'v1' && parts[1] === 'sessions' && parts[3] === 'file' && req.method === 'GET') {
        const id = decodeURIComponent(parts[2])
        const rel = String(url.searchParams.get('p') ?? '')
        if (rel === '') return json(res, 400, { error: 'missing_path' })
        try {
          const { all } = await callList(true).catch(() => ({ all: new Map() }))
          const cwd = all.get(id)?.cwd ?? process.cwd()
          const target = path.resolve(cwd, rel)
          // The same scope as /v1/file: the session's workspace and the system temp dir.
          if (!inScope(cwd, target)) return json(res, 403, { error: 'outside workspace' })
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

      // Scheduled tasks (parity with ui-schedule's task manager): list, create, edit, delete, run. The timing travels as a structure
      // (`when`: once / every N minutes or hours / daily / weekly + time + zone), never as JSON; every refusal is a stable code the phone
      // words itself (the host's input codes, `schedule_conflict`, `schedule_not_found`, `schedule_execution_pending`).
      if (parts[0] === 'v1' && parts[1] === 'schedules') {
        const lang = langOf(url.searchParams.get('lang'))
        const svc = (() => { try { return ctx.get('schedule') } catch { return undefined } })()
        if (!svc || typeof svc.list !== 'function') return json(res, 409, { error: 'schedule unavailable' })
        // Remote services wrap results: {ok, value:{items}} -- unwrap either shape.
        const unwrapped = (raw) => (raw && typeof raw === 'object' && 'value' in raw ? raw.value : raw)
        const refused = (r) => (r && typeof r === 'object' && typeof r.code === 'string' && !('title' in r) ? r.code : '')
        const failed = (err) => {
          const code = typeof err?.code === 'string' && /^[a-z_]+$/.test(err.code) ? err.code : ''
          return json(res, code === 'schedule_conflict' || code === 'schedule_execution_pending' || code === '' ? 409 : code === 'schedule_not_found' ? 404 : 400, { error: code || String(err?.message ?? err) })
        }
        try {
          if (req.method === 'GET' && parts.length === 2) {
            const listed = unwrapped(await svc.list({ limit: 100 }))
            const items = Array.isArray(listed?.items) ? listed.items : []
            // `tomorrow` is the Mac's calendar date a day from now (a new task starts there; the phone has no zone database).
            const zone = systemZone()
            return json(res, 200, { items: items.map((t) => scheduleView(lang, t)), total: Number(listed?.total ?? items.length), zone, tomorrow: localParts(new Date(Date.now() + 86_400_000).toISOString(), zone).date })
          }
          const body = await readBody(req)
          const timingOf = () => (body.when !== undefined ? timingFromWhen(body.when) : body.timing && typeof body.timing === 'object' ? body.timing : null)
          if (req.method === 'POST' && parts.length === 2) {
            const title = String(body.title ?? '').trim()
            const prompt = String(body.prompt ?? '').trim()
            if (title === '' || prompt === '') return json(res, 400, { error: 'invalid_prompt' })
            const timing = timingOf()
            if (timing === null) return json(res, 400, { error: 'invalid_rule' })
            const created = await svc.create({ title, prompt, timing })
            return json(res, 200, { ok: true, task: scheduleView(lang, unwrapped(created)) })
          }
          if (parts.length === 4 && req.method === 'POST') {
            const id = decodeURIComponent(parts[2])
            // Optimistic concurrency: edits and deletes carry the entry's current updatedAt (the phone's copy, else a fresh list lookup).
            const currentUpdatedAt = async () => {
              if (typeof body.updatedAt === 'string' && body.updatedAt !== '') return body.updatedAt
              try {
                const hit = (unwrapped(await svc.list({ limit: 100 }))?.items ?? []).find((t) => String(t?.id ?? '') === id)
                return hit?.updatedAt ?? null
              } catch { return null }
            }
            if (parts[3] === 'run') {
              const code = refused(unwrapped(await svc.run({ id })))
              return code === '' ? json(res, 200, { ok: true }) : failed({ code })
            }
            if (parts[3] === 'edit') {
              const patch = {}
              if (typeof body.title === 'string' && body.title.trim() !== '') patch.title = body.title.trim()
              if (typeof body.prompt === 'string' && body.prompt.trim() !== '') patch.prompt = body.prompt.trim()
              if (body.active === true || body.active === false) patch.active = body.active
              if (body.when !== undefined || body.timing !== undefined) {
                const timing = timingOf()
                if (timing === null) return json(res, 400, { error: 'invalid_rule' })
                patch.timing = timing
              }
              if (Object.keys(patch).length === 0) return json(res, 400, { error: 'invalid_rule' })
              const result = unwrapped(await svc.edit({ id, action: 'update', patch, expectedUpdatedAt: await currentUpdatedAt() }))
              const code = refused(result)
              return code === '' ? json(res, 200, { ok: true, task: scheduleView(lang, result) }) : failed({ code })
            }
            if (parts[3] === 'delete') {
              const code = refused(unwrapped(await svc.edit({ id, action: 'delete', expectedUpdatedAt: await currentUpdatedAt() })))
              return code === '' ? json(res, 200, { ok: true }) : failed({ code })
            }
          }
          return json(res, 404, { error: 'unknown_schedule_route' })
        } catch (err) {
          return failed(err)
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

      // The @ menu: files and folders (the host's fileReferences), the session's subagents, other sessions (see refCandidates).
      if (parts[0] === 'v1' && parts[1] === 'sessions' && parts[2] && parts[3] === 'refs' && req.method === 'GET') {
        const query = String(url.searchParams.get('q') ?? '').slice(0, 300)
        const items = await refCandidates(decodeURIComponent(parts[2]), query, url.searchParams.get('quoted') === '1', langOf(url.searchParams.get('lang')))
        return json(res, 200, { items })
      }

      // A picture or a file from the phone: raw bytes in, an id out. A picture stays encoded here until the prompt carries it (the host admits,
      // validates and normalizes it then); a file is streamed into the host's fileUploads service, which stages it under a receipt owned by
      // that session's agent, and the prompt cites the receipt.
      if (url.pathname === '/v1/attach' && req.method === 'POST') {
        const name = String(url.searchParams.get('name') ?? 'photo').slice(0, 200)
        const lang = langOf(url.searchParams.get('lang'))
        for (const [k, v] of attachments) if (Date.now() - v.at > 30 * 60_000) attachments.delete(k)
        if (url.searchParams.get('kind') === 'file') {
          const sessionId = String(url.searchParams.get('session') ?? '')
          const uploads = ctx.get('fileUploads')
          if (sessionId === '') return json(res, 400, { error: copy(lang, 'file.sessionUnavailable') })
          if (typeof uploads?.uploadStream !== 'function') return json(res, 409, { error: copy(lang, 'file.noService') })
          const declared = Number(req.headers['content-length'] ?? 0)
          // An answer sent before the body is read must close the connection: the client would otherwise reuse a socket still carrying the rest of it.
          if (declared > FILE_CAP) { res.setHeader('connection', 'close'); return json(res, 413, { error: copy(lang, 'file.tooLarge', { size: sizeText(FILE_CAP) }) }) }
          if (req.headers['content-length'] === '0') return json(res, 400, { error: 'empty_body' })
          let seen = 0
          const data = (async function* () {
            for await (const chunk of req) {
              seen += chunk.length
              if (seen > FILE_CAP) throw Object.assign(new Error('too large'), { tooLarge: true })
              yield chunk
            }
          })()
          try {
            const value = await uploads.uploadStream({ sessionId, data, name })
            const id = crypto.randomUUID()
            const bytes = Number.isFinite(value?.file?.bytes) ? value.file.bytes : seen
            attachments.set(id, { kind: 'file', receiptId: value.receiptId, sessionId, name: String(value?.file?.name ?? name), bytes, at: Date.now() })
            return json(res, 200, { id, name: String(value?.file?.name ?? name), bytes, kind: 'file' })
          } catch (err) {
            if (err?.tooLarge) { res.setHeader('connection', 'close'); return json(res, 413, { error: copy(lang, 'file.tooLarge', { size: sizeText(FILE_CAP) }) }) }
            return json(res, 409, { error: promptFailure(lang, err) })
          }
        }
        const media = String(url.searchParams.get('media') ?? 'image/jpeg')
        const chunks = []
        for await (const chunk of req) chunks.push(chunk)
        const data = Buffer.concat(chunks).toString('base64')
        if (data === '') return json(res, 400, { error: 'empty_body' })
        const id = crypto.randomUUID()
        attachments.set(id, { kind: 'image', data, mediaType: media, name, at: Date.now() })
        return json(res, 200, { id, name, bytes: Math.round((data.length * 3) / 4), kind: 'image' })
      }

      if (parts[0] === 'v1' && parts[1] === 'sessions' && parts[3] === 'prompt' && req.method === 'POST') {
        const id = decodeURIComponent(parts[2])
        const lang = langOf(url.searchParams.get('lang'))
        const body = await readBody(req)
        const text = canonSessionMentions(String(body.text ?? ''))
        // The attachments the phone uploaded (pictures and staged files): taken only once the host accepts the prompt, so a refused
        // send leaves them for the retry; one that expired (the bridge keeps them half an hour) or belongs to another session refuses it.
        const taken = [...(Array.isArray(body.images) ? body.images : []), ...(Array.isArray(body.files) ? body.files : [])].map((uid) => [String(uid), attachments.get(String(uid))])
        if (taken.some(([, a]) => !a)) return json(res, 409, { error: copy(lang, 'prompt.attachmentExpired') })
        if (taken.some(([, a]) => a.kind === 'file' && a.sessionId !== id)) return json(res, 409, { error: copy(lang, 'file.notStaged') })
        const parts_ = taken.map(([, a]) => (a.kind === 'file' ? { type: 'file', receiptId: a.receiptId } : { type: 'image', mediaType: a.mediaType, data: a.data, name: a.name }))
        const mode = body.mode === 'steer' ? 'steer' : 'queue'
        let content
        if (text.trim() === '' && parts_.length === 0) {
          // The one empty prompt is 继续生成 (InputBar's primaryRetries → conversation hub retry): a prompt with no content, queued, that the
          // host takes only for a session whose latest ending is a continuable failure with nothing running or waiting in its inbox
          // (session-controller commands.ts). Anything else with no text is refused here, as before.
          if (body.continue !== true) return json(res, 400, { error: 'empty_text' })
          const [pv, st] = await Promise.all([readProjections(id), sc().state({ sessionId: id }, new AbortController().signal).catch(() => null)])
          const ending = pv?.conversationContinuation
          const waiting = (Array.isArray(st?.queue) ? st.queue : []).some((q) => q?.placement === 'queued' || q?.placement === 'steering')
          if (!Number.isSafeInteger(ending) || st === null || st.running || waiting || (body.failureSeq !== undefined && Number(body.failureSeq) !== ending)) {
            return json(res, 409, { error: copy(lang, 'prompt.noContinuation') })
          }
          content = []
        } else {
          content = [...(text.trim() === '' ? [] : [{ type: 'text', text }]), ...parts_]
        }
        const request = {
          sessionId: id,
          content,
          requestId: body.requestId ?? crypto.randomUUID(),
          mode: content.length === 0 ? 'queue' : mode,
        }
        // A subagent child belongs to subagent routing: the host's generic prompt refuses it (session/agent-busy, "use subagent delivery"), so a
        // continuable one takes the message the way the official composer sends it (remote.subagents.prompt); a one-shot one takes none, and
        // files cannot ride (the host stages them under the parent's agent).
        const child = (await callList(true).catch(() => null))?.all.get(id)
        if (child?.origin === 'subagent') {
          const subagents = (() => { try { return ctx.get('subagents') } catch { return undefined } })()
          if (child.subagentMode !== 'continuable') return json(res, 409, { error: copy(lang, 'subagent.notResumable') })
          if (parts_.some((p) => p.type === 'file')) return json(res, 409, { error: copy(lang, 'file.subagent') })
          if (content.length === 0) return json(res, 409, { error: copy(lang, 'prompt.noContinuation') })
          if (typeof subagents?.prompt !== 'function') return json(res, 409, { error: copy(lang, 'subagent.unavailable') })
          try {
            const receipt = await subagents.prompt({ requestId: request.requestId, childSessionId: id, delivery: request.mode, content }, new AbortController().signal)
            for (const [uid] of taken) attachments.delete(uid)
            touchSession(id, { status: 'running' })
            return json(res, 200, { accepted: true, receipt })
          } catch (err) {
            const code = String(err?.code ?? '')
            return json(res, 409, { error: code === 'subagent/not-resumable' ? copy(lang, 'subagent.notResumable') : code === 'subagent/delivery-unavailable' ? copy(lang, 'subagent.unavailable') : promptFailure(lang, err) })
          }
        }
        // A session that never picked a model yet refuses the prompt until one is set.
        await sc().initializeDefaultModel({ sessionId: id }, new AbortController().signal).catch(() => {})
        try {
          const receipt = await sc().prompt(request, new AbortController().signal)
          for (const [uid] of taken) attachments.delete(uid)
          touchSession(id, { status: 'running' })
          return json(res, 200, { accepted: true, receipt })
        } catch (err) {
          const gone = content.length === 0 && String(err?.code ?? '') === 'session/agent-busy'
          return json(res, 409, { error: gone ? copy(lang, 'prompt.noContinuation') : promptFailure(lang, err) })
        }
      }

      if (parts[0] === 'v1' && parts[1] === 'sessions' && parts[3] === 'cancel' && req.method === 'POST') {
        const id = decodeURIComponent(parts[2])
        // A subagent child is stopped through the subagent runtime (the official composer's interruptByUser), not the session controller.
        const child = (await callList(true).catch(() => null))?.all.get(id)
        if (child?.origin === 'subagent') {
          const subagents = (() => { try { return ctx.get('subagents') } catch { return undefined } })()
          if (typeof subagents?.interruptByUser !== 'function') return json(res, 409, { error: copy(langOf(url.searchParams.get('lang')), 'subagent.unavailable') })
          try { await subagents.interruptByUser(id) } catch (err) { return json(res, 409, { error: String(err?.message ?? err) }) }
          return json(res, 200, { cancelled: true })
        }
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
    // A held request must not outlive the plugin: fail it closed the way the host would without an answerer.
    for (const it of [...held.values()]) { try { it.drop() } catch {} }
    for (const id of [...desktop.keys()]) dropDesktop(id)
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

