/**
 * dsh-remote · client half
 *
 * Adds a "Mobile" entry to the left sidebar's panel list and a panel that shows
 * the pairing QR, the tunnel address, the six-digit code, and the device token.
 * All data comes from the bridge's own loopback HTTP endpoint, so the panel and
 * the phone see exactly the same pairing state.
 */
window.__ModuleLoader__.load({
  id: 'dsh-remote',
  factory(require) {
    const React = require('react')
    const h = React.createElement
    const { useState, useEffect, useCallback } = React

    const PANEL_ID = 'mobile-pair'
    const BASE = 'http://127.0.0.1:8787'

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
      if (!ts) return '从未'
      const s = Math.max(0, Math.round((now - ts) / 1000))
      if (s < 15) return '刚刚'
      if (s < 60) return s + ' 秒前'
      const m = Math.floor(s / 60)
      if (m < 60) return m + ' 分钟前'
      const h = Math.floor(m / 60)
      if (h < 24) return h + ' 小时前'
      return Math.floor(h / 24) + ' 天前'
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
        done ? '已复制' : children,
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
          masked ? h('button', { type: 'button', style: styles.button, onClick: () => setShown(!shown) }, shown ? '隐藏' : '显示') : null,
          h(CopyButton, { value }, '复制'),
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
          if (a.status === 'rejected') setError(`连不上 bridge（${String((a.reason && a.reason.message) || a.reason)}），插件可能在重载。`)
          else if (b.status === 'rejected') setError(`读取已配对终端失败（${String((b.reason && b.reason.message) || b.reason)}）。`)
        })
      }, [])

      const revoke = (id, name) => {
        if (!window.confirm(`断开「${name}」？该终端需要重新配对才能再连这台 Mac。`)) return
        setRevoking(id)
        fetch(`${BASE}/v1/devices/${encodeURIComponent(id)}`, { method: 'DELETE', cache: 'no-store' })
          .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
          .then(() => load())
          .catch((err) => setError(`断开失败（${String((err && err.message) || err)}）。`))
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
          .catch((err) => setError(`换码失败（${String((err && err.message) || err)}）`))
      }

      return h(
        'div',
        { style: styles.page, 'data-mobile-pair-panel': '' },
        h(
          'div',
          { style: styles.column },
          h('h1', { style: styles.title }, '远程配对'),
          h(
            'p',
            { style: styles.lead },
            '用 dsh-remote App（iOS / Android）扫下面的二维码，或者把配对链接复制到终端上。扫码后会自动填入服务器地址和 token。',
          ),

          error
            ? h(
                'div',
                { style: styles.card },
                h('p', { style: styles.error }, error),
                h('div', { style: styles.row }, h('button', { type: 'button', style: styles.primary, onClick: () => setNonce((n) => n + 1) }, '重试')),
              )
            : null,

          h(
            'div',
            { style: { ...styles.card, flexDirection: 'row', gap: 22, alignItems: 'flex-start', flexWrap: 'wrap' } },
            h('div', { style: styles.qrCard }, h('img', { src: qrSrc, alt: '配对二维码', style: styles.qr })),
            h(
              'div',
              { style: { display: 'flex', flexDirection: 'column', gap: 12, flex: '1 1 200px' } },
              h('p', { style: styles.label }, '配对码'),
              h('p', { style: styles.code }, info ? info.code : '······'),
              h(
                'p',
                { style: styles.muted },
                info
                  ? `还剩 ${clock()}${info.publicUrl ? '' : '（隧道还在启动，先扫这个本地地址）'}`
                  : '正在读取…',
              ),
              h('div', { style: styles.row },
                h('button', { type: 'button', style: styles.primary, onClick: refresh }, fresh ? '已换新码' : '刷新二维码'),
                h('a', { href: `${BASE}/pair`, target: '_blank', rel: 'noreferrer', style: { ...styles.button, textDecoration: 'none' } }, '在浏览器打开'),
              ),
            ),
          ),

          devices && devices.devices && devices.devices.length
            ? h(
                'div',
                { style: styles.card },
                h('h2', { style: styles.h2 }, `已配对的终端 · ${devices.devices.length}`),
                h('p', { style: styles.muted }, '在线 = 最近 15 秒内有请求。断开后该终端立即失效，需重新配对。'),
                ...devices.devices.map((d) =>
                  h(
                    'div',
                    { key: d.id, style: { ...styles.deviceRow, borderTop: '1px solid color-mix(in srgb, currentColor 10%, transparent)' } },
                    h('span', {
                      style: { ...styles.dot, background: d.online ? '#34c759' : 'color-mix(in srgb, currentColor 25%, transparent)' },
                      title: d.online ? '在线' : '离线',
                    }),
                    h(
                      'div',
                      { style: { flex: '1 1 120px', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2 } },
                      h('p', { style: styles.deviceName }, `${d.name}${devices.you && d.id === devices.you ? '（本机面板）' : ''}`),
                      h('p', { style: styles.deviceMeta }, `配对于 ${d.at ? new Date(d.at).toLocaleString() : '未知时间'} · 最近活动 ${ago(d.seen, now)}`),
                    ),
                    h(
                      'button',
                      { type: 'button', style: styles.danger, disabled: revoking === d.id || (devices.you && d.id === devices.you), onClick: () => revoke(d.id, d.name) },
                      revoking === d.id ? '断开中…' : '断开配对',
                    ),
                  ),
                ),
              )
            : null,

          info
            ? h(
                'div',
                { style: styles.card },
                h(Field, { label: '服务器地址', value: address }),
                h(Field, { label: '配对链接（复制到手机）', value: info.deepLink }),
                h(Field, { label: '设备 token', value: info.token || '还没有配对过设备', masked: true }),
                h(
                  'p',
                  { style: styles.muted },
                  'token 等同于这台 Mac 上的会话读写权限，别发到公开的地方。手机上「设置 → 粘贴配对链接」也能完成配对。',
                ),
              )
            : null,

          h(
            'p',
            { style: styles.muted },
            '手机和 Mac 保持在同一个隧道地址上才能连；重载插件或重启会换域名，那时手机会提示 Re-link，重新扫一次即可。',
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
              { name: 'sidebar.panellist', id: PANEL_ID, order: 20, label: () => '远程配对' },
              Icon,
            ),
          )
        } catch (err) {
          note(`inject-throw:${String((err && err.message) || err)}`)
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
