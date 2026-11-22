/**
 * dsh-remote · client half
 *
 * Adds a "Mobile" entry to the left sidebar's panel list and a panel that shows
 * the pairing QR, the tunnel address, the six-digit code, and the device token.
 * All data comes from the bridge's own loopback HTTP endpoint, so the panel and
 * the phone see exactly the same pairing state.
 *
 * It also mirrors this renderer's pending interactions (tool approvals, questions, plan
 * reviews: ctx.uiSession.pendingInteractions) to the bridge and applies the phone's answers
 * through those same objects, so the Mac and the phone show one request and the first answer wins.
 */
window.__ModuleLoader__.load({
  id: 'dsh-remote',
  factory(require) {
    const React = require('react')
    const h = React.createElement
    const { useState, useEffect, useCallback } = React

    const PANEL_ID = 'mobile-pair'
    const BASE = 'http://127.0.0.1:8787'

    // The panel's words, in the language of the Mac's DSH window (navigator.language): zh, else en. Everything user-visible below goes through tr().
    const ZH = {
      title: '远程配对', panel: '远程配对',
      intro: '用 dsh-remote App（iOS / Android）扫下面的二维码，或者把配对链接复制到终端上。扫码后会自动填入服务器地址和 token。',
      retry: '重试', qrAlt: '配对二维码', code: '配对码', reading: '正在读取…',
      remaining: '还剩 {clock}', tunnelStarting: '（隧道还在启动，先扫这个本地地址）',
      refresh: '刷新二维码', refreshed: '已换新码', openBrowser: '在浏览器打开',
      devices: '已配对的终端 · {n}', devicesNote: '在线 = 最近 15 秒内有请求。断开后该终端立即失效，需重新配对。',
      online: '在线', offline: '离线', thisPanel: '（本机面板）', pairedAt: '配对于 {when} · 最近活动 {ago}', unknownTime: '未知时间',
      revoking: '断开中…', revoke: '断开配对', confirmRevoke: '断开「{name}」？该终端需要重新配对才能再连这台 Mac。',
      fieldServer: '服务器地址', fieldLink: '配对链接（复制到手机）', fieldToken: '设备 token', noDevice: '还没有配对过设备',
      tokenNote: 'token 等同于这台 Mac 上的会话读写权限，别发到公开的地方。手机上「设置 → 粘贴配对链接」也能完成配对。',
      mirrorOn: '桌面窗口已与手机同步：审批和提问在两边同时出现，谁先答谁算。', mirrorOff: '这个窗口还没有与手机同步审批和提问（刷新窗口，或重载 dsh-remote 插件）。',
      tunnelNote: '手机和 Mac 保持在同一个隧道地址上才能连；重载插件或重启会换域名，那时手机会提示 Re-link，重新扫一次即可。',
      errBridge: '连不上 bridge（{why}），插件可能在重载。', errDevices: '读取已配对终端失败（{why}）。', errRevoke: '断开失败（{why}）。', errRefresh: '换码失败（{why}）',
      copy: '复制', copied: '已复制', show: '显示', hide: '隐藏',
      never: '从未', now: '刚刚', seconds: '{n} 秒前', minutes: '{n} 分钟前', hours: '{n} 小时前', days: '{n} 天前',
    }
    const EN = {
      title: 'Remote pairing', panel: 'Remote pairing',
      intro: 'Scan the QR code below with the dsh-remote app (iOS / Android), or copy the pairing link to the device. Scanning fills in the server address and token.',
      retry: 'Retry', qrAlt: 'Pairing QR code', code: 'Pairing code', reading: 'Reading…',
      remaining: '{clock} left', tunnelStarting: ' (the tunnel is still starting; scan this local address for now)',
      refresh: 'New QR code', refreshed: 'New code issued', openBrowser: 'Open in browser',
      devices: 'Paired devices · {n}', devicesNote: 'Online = a request in the last 15 seconds. A disconnected device stops working at once and must pair again.',
      online: 'Online', offline: 'Offline', thisPanel: ' (this panel)', pairedAt: 'Paired {when} · last active {ago}', unknownTime: 'at an unknown time',
      revoking: 'Disconnecting…', revoke: 'Disconnect', confirmRevoke: 'Disconnect "{name}"? It will need to pair again to reach this Mac.',
      fieldServer: 'Server address', fieldLink: 'Pairing link (copy to the phone)', fieldToken: 'Device token', noDevice: 'No device has paired yet',
      tokenNote: 'The token is the same as read / write access to the sessions on this Mac; do not post it anywhere public. On the phone, Settings → paste the pairing link also pairs.',
      mirrorOn: 'This desktop window is in sync with the phone: approvals and questions show on both, and the first answer wins.', mirrorOff: 'This window is not yet in sync with the phone for approvals and questions (reload the window, or reload the dsh-remote plugin).',
      tunnelNote: 'The phone and the Mac must use the same tunnel address; reloading the plugin or restarting changes the domain, and the phone then offers Re-link: scan once more.',
      errBridge: 'Cannot reach the bridge ({why}); the plugin may be reloading.', errDevices: 'Could not read the paired devices ({why}).', errRevoke: 'Could not disconnect ({why}).', errRefresh: 'Could not issue a new code ({why})',
      copy: 'Copy', copied: 'Copied', show: 'Show', hide: 'Hide',
      never: 'never', now: 'just now', seconds: '{n}s ago', minutes: '{n} min ago', hours: '{n} h ago', days: '{n} d ago',
    }
    const tr = (key, vars) => {
      let lang = 'en'
      try { lang = /^zh/i.test(navigator.language || '') ? 'zh' : 'en' } catch { /* en */ }
      const text = (lang === 'zh' ? ZH : EN)[key] ?? EN[key] ?? key
      return text.replace(/\{(\w+)\}/g, (_, k) => String(vars && vars[k] !== undefined ? vars[k] : ''))
    }

    const styles = {
      page: {
        height: '100%',
        overflow: 'auto',
        padding: '40px 32px 64px',
        color: 'inherit',
        font: 'inherit',
        display: 'flex',
        justifyContent: 'center',
      },
      column: { width: '100%', maxWidth: 520, display: 'flex', flexDirection: 'column', gap: 20 },
      title: { fontSize: 22, fontWeight: 600, margin: 0 },
      lead: { margin: 0, opacity: 0.7, lineHeight: 1.5, fontSize: 13 },
      card: {
        border: '1px solid color-mix(in srgb, currentColor 14%, transparent)',
        borderRadius: 14,
        padding: 18,
        display: 'flex',
        flexDirection: 'column',
        gap: 12,
      },
      qrCard: {
        alignSelf: 'flex-start',
        background: '#fff',
        borderRadius: 14,
        padding: 12,
        lineHeight: 0,
        boxShadow: '0 1px 3px rgba(0,0,0,.12)',
      },
      qr: { width: 208, height: 208, display: 'block' },
      code: {
        fontSize: 34,
        letterSpacing: 10,
        fontVariantNumeric: 'tabular-nums',
        fontWeight: 600,
        margin: 0,
      },
      label: { fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.6, opacity: 0.55, margin: 0 },
      value: { fontSize: 13, wordBreak: 'break-all', margin: 0, fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' },
      row: { display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' },
      button: {
        font: 'inherit',
        fontSize: 12,
        padding: '5px 10px',
        borderRadius: 7,
        border: '1px solid color-mix(in srgb, currentColor 20%, transparent)',
        background: 'transparent',
        color: 'inherit',
        cursor: 'pointer',
      },
      primary: {
        font: 'inherit',
        fontSize: 12,
        padding: '5px 12px',
        borderRadius: 7,
        border: '1px solid transparent',
        background: 'var(--dsw-alias-accent, #2f6fed)',
        color: '#fff',
        cursor: 'pointer',
      },
      muted: { fontSize: 12, opacity: 0.55, margin: 0, lineHeight: 1.5 },
      error: { fontSize: 13, color: '#d9534f', margin: 0 },
      h2: { fontSize: 15, fontWeight: 600, margin: '0 0 2px' },
      deviceRow: { display: 'flex', alignItems: 'center', gap: 10, padding: '6px 0' },
      dot: { width: 8, height: 8, borderRadius: '50%', flex: '0 0 auto' },
      deviceName: { fontSize: 13, fontWeight: 600, margin: 0, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
      deviceMeta: { fontSize: 11, opacity: 0.6, margin: 0 },
      danger: {
        font: 'inherit',
        fontSize: 12,
        padding: '4px 10px',
        borderRadius: 7,
        border: '1px solid color-mix(in srgb, #d9534f 45%, transparent)',
        background: 'transparent',
        color: '#d9534f',
        cursor: 'pointer',
      },
    }

    function ago(ts, now) {
      if (!ts) return tr('never')
      const s = Math.max(0, Math.round((now - ts) / 1000))
      if (s < 15) return tr('now')
      if (s < 60) return tr('seconds', { n: s })
      const m = Math.floor(s / 60)
      if (m < 60) return tr('minutes', { n: m })
      const h = Math.floor(m / 60)
      if (h < 24) return tr('hours', { n: h })
      return tr('days', { n: Math.floor(h / 24) })
    }

    async function copy(text) {
      try {
        await navigator.clipboard.writeText(text)
        return true
      } catch {
        try {
          const el = document.createElement('textarea')
          el.value = text
          el.style.position = 'fixed'
          el.style.opacity = '0'
          document.body.appendChild(el)
          el.select()
          const ok = document.execCommand('copy')
          document.body.removeChild(el)
          return ok
        } catch {
          return false
        }
      }
    }

    function CopyButton({ value, children }) {
      const [done, setDone] = useState(false)
      const onClick = useCallback(() => {
        copy(value).then((ok) => {
          if (!ok) return
          setDone(true)
          window.setTimeout(() => setDone(false), 1400)
        })
      }, [value])
      return h(
        'button',
        { type: 'button', style: done ? styles.button : styles.button, onClick, 'aria-label': typeof children === 'string' ? children : 'Copy' },
        done ? tr('copied') : children,
      )
    }

    function Field({ label, value, masked }) {
      const [shown, setShown] = useState(!masked)
      if (!value) return null
      const shownValue = !masked || shown ? value : `${value.slice(0, 8)}${'•'.repeat(24)}`
      return h(
        'div',
        { style: { display: 'flex', flexDirection: 'column', gap: 6 } },
        h('p', { style: styles.label }, label),
        h(
          'div',
          { style: styles.row },
          h('p', { style: { ...styles.value, flex: '1 1 220px', margin: 0 } }, shownValue),
          masked ? h('button', { type: 'button', style: styles.button, onClick: () => setShown(!shown) }, shown ? tr('hide') : tr('show')) : null,
          h(CopyButton, { value }, tr('copy')),
        ),
      )
    }

    function Panel() {
      const [info, setInfo] = useState(null)
      const [devices, setDevices] = useState(null)
      const [revoking, setRevoking] = useState('')
      const [error, setError] = useState('')
      const [nonce, setNonce] = useState(0)
      const [fresh, setFresh] = useState(false)
      const [now, setNow] = useState(() => Date.now())

      const load = useCallback(() => {
        const pairing = fetch(`${BASE}/v1/pairing`, { cache: 'no-store' })
          .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
          .then((body) => {
            setInfo(body)
            setError('')
          })
        const listed = fetch(`${BASE}/v1/devices`, { cache: 'no-store' })
          .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
          .then((body) => setDevices(body))
        return Promise.allSettled([pairing, listed]).then(([a, b]) => {
          if (a.status === 'rejected') setError(tr('errBridge', { why: String((a.reason && a.reason.message) || a.reason) }))
          else if (b.status === 'rejected') setError(tr('errDevices', { why: String((b.reason && b.reason.message) || b.reason) }))
        })
      }, [])

      const revoke = (id, name) => {
        if (!window.confirm(tr('confirmRevoke', { name }))) return
        setRevoking(id)
        fetch(`${BASE}/v1/devices/${encodeURIComponent(id)}`, { method: 'DELETE', cache: 'no-store' })
          .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
          .then(() => load())
          .catch((err) => setError(tr('errRevoke', { why: String((err && err.message) || err) })))
          .finally(() => setRevoking(''))
      }

      useEffect(() => {
        const tick = window.setInterval(() => setNow(Date.now()), 1000)
        return () => window.clearInterval(tick)
      }, [])

      useEffect(() => {
        let alive = true
        load()
        const timer = window.setInterval(() => {
          if (alive) load()
        }, 5000)
        return () => {
          alive = false
          window.clearInterval(timer)
        }
      }, [load, nonce])

      const clock = () => {
        if (!info || !info.expiresAt) return ''
        const left = Math.max(0, Math.round((info.expiresAt - now) / 1000))
        const m = Math.floor(left / 60)
        const sec = left % 60
        return `${m}:${String(sec).padStart(2, '0')}`
      }
      const address = info ? info.publicUrl || info.localUrl : ''
      // Key the image by the code: a new code must show a new pattern even when the
      // nonce is unchanged, and an expired code re-issued by the server invalidates it.
      const qrSrc = `${BASE}/v1/pairing.svg?n=${nonce}&c=${info ? info.code : ''}`

      const refresh = () => {
        setFresh(false)
        fetch(`${BASE}/v1/pairing/refresh`, { method: 'POST', cache: 'no-store' })
          .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
          .then((body) => {
            setInfo(body)
            setError('')
            setNonce((n) => n + 1)
            setFresh(true)
            window.setTimeout(() => setFresh(false), 2500)
          })
          .catch((err) => setError(tr('errRefresh', { why: String((err && err.message) || err) })))
      }

      return h(
        'div',
        { style: styles.page, 'data-mobile-pair-panel': '' },
        h(
          'div',
          { style: styles.column },
          h('h1', { style: styles.title }, tr('title')),
          h(
            'p',
            { style: styles.lead },
            tr('intro'),
          ),

          error
            ? h(
                'div',
                { style: styles.card },
                h('p', { style: styles.error }, error),
                h('div', { style: styles.row }, h('button', { type: 'button', style: styles.primary, onClick: () => setNonce((n) => n + 1) }, tr('retry'))),
              )
            : null,

          h(
            'div',
            { style: { ...styles.card, flexDirection: 'row', gap: 22, alignItems: 'flex-start', flexWrap: 'wrap' } },
            h('div', { style: styles.qrCard }, h('img', { src: qrSrc, alt: tr('qrAlt'), style: styles.qr })),
            h(
              'div',
              { style: { display: 'flex', flexDirection: 'column', gap: 12, flex: '1 1 200px' } },
              h('p', { style: styles.label }, tr('code')),
              h('p', { style: styles.code }, info ? info.code : '······'),
              h(
                'p',
                { style: styles.muted },
                info
                  ? `${tr('remaining', { clock: clock() })}${info.publicUrl ? '' : tr('tunnelStarting')}`
                  : tr('reading'),
              ),
              h('div', { style: styles.row },
                h('button', { type: 'button', style: styles.primary, onClick: refresh }, fresh ? tr('refreshed') : tr('refresh')),
                h('a', { href: `${BASE}/pair`, target: '_blank', rel: 'noreferrer', style: { ...styles.button, textDecoration: 'none' } }, tr('openBrowser')),
              ),
            ),
          ),

          devices && devices.devices && devices.devices.length
            ? h(
                'div',
                { style: styles.card },
                h('h2', { style: styles.h2 }, tr('devices', { n: devices.devices.length })),
                h('p', { style: styles.muted }, tr('devicesNote')),
                ...devices.devices.map((d) =>
                  h(
                    'div',
                    { key: d.id, style: { ...styles.deviceRow, borderTop: '1px solid color-mix(in srgb, currentColor 10%, transparent)' } },
                    h('span', {
                      style: { ...styles.dot, background: d.online ? '#34c759' : 'color-mix(in srgb, currentColor 25%, transparent)' },
                      title: d.online ? tr('online') : tr('offline'),
                    }),
                    h(
                      'div',
                      { style: { flex: '1 1 120px', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2 } },
                      h('p', { style: styles.deviceName }, `${d.name}${devices.you && d.id === devices.you ? tr('thisPanel') : ''}`),
                      h('p', { style: styles.deviceMeta }, tr('pairedAt', { when: d.at ? new Date(d.at).toLocaleString() : tr('unknownTime'), ago: ago(d.seen, now) })),
                    ),
                    h(
                      'button',
                      { type: 'button', style: styles.danger, disabled: revoking === d.id || (devices.you && d.id === devices.you), onClick: () => revoke(d.id, d.name) },
                      revoking === d.id ? tr('revoking') : tr('revoke'),
                    ),
                  ),
                ),
              )
            : null,

          info
            ? h(
                'div',
                { style: styles.card },
                h(Field, { label: tr('fieldServer'), value: address }),
                h(Field, { label: tr('fieldLink'), value: info.deepLink }),
                h(Field, { label: tr('fieldToken'), value: info.token || tr('noDevice'), masked: true }),
                h(
                  'p',
                  { style: styles.muted },
                  tr('tokenNote'),
                ),
              )
            : null,

          // Whether this window's approval / question cards are mirrored to the phone (the desktop mirror below).
          info
            ? h(
                'p',
                { style: styles.muted },
                info.desktopAttached
                  ? tr('mirrorOn')
                  : tr('mirrorOff'),
              )
            : null,

          h(
            'p',
            { style: styles.muted },
            tr('tunnelNote'),
          ),
        ),
      )
    }

    function Icon() {
      return h(
        'svg',
        { viewBox: '0 0 16 16', width: 16, height: 16, fill: 'none', stroke: 'currentColor', 'stroke-width': 1.4, 'aria-hidden': true },
        h('rect', { x: 4.5, y: 1.5, width: 7, height: 13, rx: 1.8 }),
        h('line', { x1: 7, y1: 12.4, x2: 9, y2: 12.4, 'stroke-linecap': 'round' }),
        h('rect', { x: 6.6, y: 3.2, width: 2.8, height: 2.8, rx: 0.5 }),
      )
    }

    // ---- desktop mirror ------------------------------------------------------------------------
    // Everything here talks to the bridge's loopback-only /v1/desktop/* routes and must never disturb the
    // desktop UI: every entry point catches, nothing polls tightly (state goes out on change plus a slow
    // heartbeat; commands arrive over one long poll that backs off while the bridge is away).
    const MIRROR_KINDS = ['approval', 'question', 'plan-review']
    const HEARTBEAT_MS = 5000
    const POLL_WAIT_MS = 20000
    const newId = () => {
      try { return `c-${window.crypto.randomUUID()}` } catch { return `c-${Math.random().toString(36).slice(2)}${Date.now().toString(36)}` }
    }
    const jsonClone = (v) => {
      try { return v === undefined ? undefined : JSON.parse(JSON.stringify(v)) } catch { return undefined }
    }

    function createLatestSender(send, canSend) {
      let phase = 'idle'
      let queued = null
      let lastSig = ''
      const transmit = (items, sig) => {
        phase = 'sending'
        lastSig = sig
        send(items)
          .then((res) => { if (!res.ok) lastSig = '' })
          .catch(() => { lastSig = '' })
          .finally(() => {
            phase = 'idle'
            const next = queued
            queued = null
            if (next && canSend()) transmit(next.items, next.sig)
          })
      }
      return {
        push(items, sig, force) {
          if (!force && sig === lastSig) return
          if (phase === 'sending') {
            queued = { items, sig }
            return
          }
          transmit(items, sig)
        },
      }
    }

    function startMirror(scope) {
      const clientId = newId()
      const pendingSource = scope.uiSession.pendingInteractions
      const watched = new Map() // pending object -> unsubscribe (a question card reports its own state changes)
      const applied = new Map() // command id -> result, so a re-delivered command is answered, never applied twice
      let alive = true
      let dirty = false
      let aborter = new AbortController()

      const current = () => {
        try {
          return [...pendingSource.getSnapshot().values()].filter((o) => o && MIRROR_KINDS.includes(o.kind) && typeof o.key === 'string')
        } catch {
          return []
        }
      }

      // What the bridge needs of one pending object (serializable, no functions).
      const summarize = (o) => {
        const base = { key: o.key, kind: o.kind, sessionId: String(o.sessionId), callId: typeof o.callId === 'string' ? o.callId : null }
        if (o.kind === 'approval') {
          return { ...base, toolName: String(o.toolName ?? ''), reason: typeof o.reason === 'string' ? o.reason : '', displayReason: jsonClone(o.displayReason) ?? null }
        }
        let card = null
        try {
          const snap = typeof o.snapshot === 'function' ? o.snapshot() : null
          if (snap) {
            card = {
              state: snap.state,
              waitState: snap.waitState,
              channel: snap.channel,
              countdown: snap.countdown ? { remainingMs: Math.round(snap.countdown.remainingMs), running: snap.countdown.running === true } : null,
            }
          }
        } catch { /* a card without a snapshot reads as open */ }
        return { ...base, dismissal: o.dismissal === 'hide' ? 'hide' : 'cancel', questions: jsonClone(o.questions) ?? [], card }
      }

      const post = (path, body) =>
        fetch(`${BASE}${path}`, { method: 'POST', body: JSON.stringify(body), cache: 'no-store', signal: aborter.signal })

      // One state POST in flight at a time, always carrying the newest state: a late arrival of an older one
      // would otherwise overwrite it on the bridge.
      const sender = createLatestSender((items) => post('/v1/desktop/state', { client: clientId, items }), () => alive)
      const push = (force) => {
        if (!alive) return
        const items = current().map(summarize)
        // The countdown ticks every second; only its shape (running / held / continued) is news.
        const sig = JSON.stringify(items.map((it) => ({ ...it, card: it.card ? { ...it.card, countdown: it.card.countdown ? { running: it.card.countdown.running } : null } : null })))
        sender.push(items, sig, force)
      }

      // Coalesce a burst of changes into one push, without a timer (a hidden window throttles timers, not microtasks).
      const markDirty = () => {
        if (dirty || !alive) return
        dirty = true
        Promise.resolve().then(() => { dirty = false; sync(); safePush(false) }).catch(() => {})
      }

      const sync = () => {
        const now = new Set(current())
        for (const [obj, off] of watched) {
          if (now.has(obj)) continue
          try { off() } catch { /* already gone */ }
          watched.delete(obj)
        }
        for (const obj of now) {
          if (watched.has(obj) || typeof obj.subscribe !== 'function') continue
          try { watched.set(obj, obj.subscribe(markDirty)) } catch { /* not observable: the next list change still pushes */ }
        }
      }

      const find = (key) => current().find((o) => o.key === key)

      const fail = (error) => ({ ok: false, error })
      const validAnswers = (obj, raw) => {
        if (!Array.isArray(raw)) return null
        const ids = new Set((Array.isArray(obj.questions) ? obj.questions : []).map((q) => q.id))
        const out = []
        for (const a of raw) {
          if (!a || typeof a.id !== 'string' || !ids.has(a.id) || !Array.isArray(a.selected) || !a.selected.every((x) => typeof x === 'string')) return null
          out.push({ id: a.id, selected: a.selected, ...(typeof a.custom === 'string' && a.custom !== '' ? { custom: a.custom } : {}) })
        }
        return out.length === ids.size ? out : null
      }

      // The desktop object's own verb for each phone decision; errors come back as the ack.
      const apply = async (cmd) => {
        if (cmd.op === 'reveal') {
          const panels = scope.get('userQuestionPanels')
          return { ok: true, value: Boolean(panels && panels.reveal(String(cmd.sessionId), String(cmd.callId))) }
        }
        const obj = find(String(cmd.key))
        if (!obj) return fail('expired')
        if (cmd.op === 'answer') {
          if (obj.kind === 'approval') {
            if (cmd.decision !== 'allowed-once' && cmd.decision !== 'rejected') return fail('bad_decision')
            if (obj.answerable === false) return fail('expired')
            await obj.answer(cmd.decision)
            return { ok: true }
          }
          const answers = validAnswers(obj, cmd.answers)
          if (!answers) return fail('bad_answers')
          const remote = typeof obj.snapshot === 'function' && obj.snapshot().channel === 'rpc'
          await obj.answer({ answers })
          // A continued question answered over the Remote path closes its panel the way the desktop's own submit does.
          if (remote) { try { await obj.dismiss() } catch { /* the reply is already queued */ } }
          return { ok: true }
        }
        if (cmd.op === 'dismiss') {
          await obj.dismiss()
          return { ok: true }
        }
        if (cmd.op === 'hold') {
          // 慢慢回答 (takeTime) stops the countdown for good; the first edit (engage) does the same quietly.
          const verb = cmd.mode === 'engage' ? obj.engage : obj.takeTime
          if (typeof verb !== 'function') return fail('unsupported')
          verb.call(obj)
          return { ok: true }
        }
        return fail('unknown_op')
      }

      const handle = async (cmd) => {
        let result = applied.get(cmd.id)
        if (!result) {
          try { result = await apply(cmd) } catch (err) { result = fail(String((err && err.message) || err).slice(0, 300)) }
          applied.set(cmd.id, result)
          if (applied.size > 200) applied.delete(applied.keys().next().value)
        }
        try {
          await post('/v1/desktop/ack', { client: clientId, id: cmd.id, ok: result.ok === true, error: result.error, value: result.value })
        } catch { /* the bridge answers the phone "undelivered" by itself */ }
      }

      const sleep = (ms) => new Promise((resolve) => window.setTimeout(resolve, ms))
      // Commands apply in order on a side queue, so a slow one never keeps the next poll (the liveness signal) from opening.
      let queue = Promise.resolve()
      const pollLoop = async () => {
        let phase = 'connected'
        let backoff = 1000
        while (alive) {
          try {
            const res = await fetch(`${BASE}/v1/desktop/commands?client=${encodeURIComponent(clientId)}&wait=${POLL_WAIT_MS}`, { cache: 'no-store', signal: aborter.signal })
            if (!res.ok) throw new Error(`HTTP ${res.status}`)
            if (phase === 'backoff') push(true)
            phase = 'connected'
            backoff = 1000
            const body = await res.json()
            for (const cmd of Array.isArray(body.commands) ? body.commands : []) {
              if (cmd && typeof cmd.id === 'string') queue = queue.then(() => handle(cmd)).catch(() => {})
            }
          } catch {
            if (!alive) return
            phase = 'backoff'
            await sleep(backoff)
            backoff = Math.min(backoff * 2, 15000)
          }
        }
      }

      const detach = () => {
        try {
          const body = JSON.stringify({ client: clientId })
          if (!(navigator.sendBeacon && navigator.sendBeacon(`${BASE}/v1/desktop/detach`, body))) {
            fetch(`${BASE}/v1/desktop/detach`, { method: 'POST', body, keepalive: true }).catch(() => {})
          }
        } catch { /* closing anyway */ }
      }

      // Nothing here may throw into the desktop UI: a failed push is only a console note, the next one retries.
      const safePush = (force) => {
        try { push(force) } catch (err) { console.warn('[dsh-remote] desktop mirror push failed', err) }
      }
      const unsubscribe = pendingSource.subscribe(markDirty)
      const heartbeat = window.setInterval(() => safePush(true), HEARTBEAT_MS)
      window.addEventListener('pagehide', detach)
      sync()
      safePush(true)
      pollLoop()

      return () => {
        alive = false
        try { unsubscribe() } catch { /* already gone */ }
        for (const off of watched.values()) { try { off() } catch { /* already gone */ } }
        watched.clear()
        window.clearInterval(heartbeat)
        window.removeEventListener('pagehide', detach)
        detach()
        aborter.abort()
      }
    }

    // The layout decides whether a main panel may be opened by looking the key up in
    // `slots.entries('main')`, so the row and the panel must both be registered, and the
    // panel must be there before a tap arrives.
    let mainState = 'pending'
    const note = (v) => {
      mainState = String(v).slice(0, 160)
      if (!/^main:1:entry$/.test(mainState)) document.title = `MB-ERROR ${mainState}`
    }
    const hasMain = (ctx) => {
      try {
        return ctx.slots.entries('main').some((e) => e.options && e.options.key === PANEL_ID)
      } catch {
        return false
      }
    }

    return {
      inject: ['slots', 'layout'],
      apply(ctx) {
        try {
          ctx.slots.inject('main', () => ctx.slots.register({ name: 'main', key: PANEL_ID }, Panel))
          ctx.slots.inject('sidebar.panellist', () =>
            ctx.slots.register(
              { name: 'sidebar.panellist', id: PANEL_ID, order: 20, label: () => tr('panel') },
              Icon,
            ),
          )
        } catch (err) {
          note(`inject-throw:${String((err && err.message) || err)}`)
        }
        // The mirror needs the Session UI service, which the panel does not: a nested inject keeps the
        // panel working on a build that lacks it (the callback then simply never runs).
        try {
          ctx.inject(['uiSession'], (scope) => {
            scope.effect(() => {
              try { return startMirror(scope) } catch (err) { console.warn('[dsh-remote] desktop mirror failed to start', err); return () => {} }
            }, 'dsh-remote: desktop mirror')
          })
        } catch (err) {
          console.warn('[dsh-remote] desktop mirror unavailable', err)
        }
        // `inject` only fires when the slot is declared; the keyed `main` slot may appear
        // later, so make sure the entry exists before the first tap.
        setTimeout(() => {
          try {
            if (hasMain(ctx)) return note('main:1:entry')
            ctx.slots.register({ name: 'main', key: PANEL_ID }, Panel)
            note(hasMain(ctx) ? 'main:1:entry' : 'main:0:missing')
          } catch (err) {
            note(`late-throw:${String((err && err.message) || err)}`)
          }
        }, 1200)
      },
    }
  },
})
