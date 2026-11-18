import type { Answer, Result, Sources } from './app.contract.d.ts';

// The bridge plugin listens on loopback; a phone reaches the Mac over a tunnel
// (https) or the LAN (http), and the person names that origin in Settings.
export const grants = ['net.fetch https:', 'net.fetch http:', 'device.camera scanPurpose', 'fs.read app:/tmp', 'fs.write app:/tmp', 'fs.read app:/tmp/picked'].join('\n');

type WireItem = { id?: string; v?: string; sign?: string; mark?: string; d?: number; alt?: string; w?: number; h?: number; dw?: number; dh?: number };
type WireNode = { id?: string; t?: string; v?: string; lvl?: number; lang?: string; alt?: string; w?: number; h?: number; head?: string; items?: WireItem[]; rows?: WireItem[] };
type WireBlock = {
  id?: string;
  kind?: string;
  name?: string;
  text?: string;
  detail?: string | null;
  status?: string;
  result?: string;
  nodes?: WireNode[];
  callId?: string | null;
  icon?: string;
  summary?: string;
  args?: string;
  lazy?: boolean;
  badge?: string;
  todoSummary?: string;
  todos?: { id?: string; text?: string; state?: string; change?: string }[];
  files?: { id?: string; path?: string; text?: string }[];
  question?: string;
  options?: { id?: string; text?: string }[];
  diffs?: { id?: string; path?: string; added?: number; removed?: number; lines?: { id?: string; sign?: string; text?: string }[] }[];
  diffHidden?: number;
  att?: string;
  media?: string;
  w?: number;
  h?: number;
  images?: { id?: string; att?: string; media?: string; w?: number; h?: number; text?: string }[];
};

// Old turns arrive as plain text, so drop the markdown punctuation that would
// otherwise show up literally ("## heading", "**bold**", "`code`").
function plain(md: string): string {
  return md
    .replace(/```[a-zA-Z0-9]*\n([\s\S]*?)```/g, '$1')
    .replace(/!\[([^\]]*)\]\(([^)]+)\)/g, '[$1]')
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '$1 ($2)')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/__([^_]+)__/g, '$1')
    .replace(/(^|\s)\*([^*\n]+)\*/g, '$1$2')
    .replace(/^\s{0,3}#{1,6}\s*/gm, '')
    .replace(/^\s{0,3}[-*+]\s+/gm, '• ')
    .trim();
}

type WireUsageTokens = { in?: number | null; out?: number | null; cacheRead?: number | null; reasoning?: number | null } | null;
type WireMessage = { id?: string; role?: string; seq?: number; msgId?: string; text?: string; fullText?: string; usage?: string; tools?: number; running?: number; thought?: boolean; interrupted?: boolean; took?: number; folded?: number; shadow?: number; failed?: boolean; changedCount?: number; usageTokens?: WireUsageTokens; deliverables?: { path?: string; text?: string }[]; refs?: { path?: string }[]; day?: string; blocks?: WireBlock[] };
type WireSession = { id?: string; title?: string | null; running?: boolean; runStartedAt?: number; pinned?: boolean; archived?: boolean; cwd?: string | null; updatedAt?: number | null; group?: string | null; first?: boolean; when?: string | null };
type WireApproval = { id?: string; toolName?: string | null; reason?: string | null; command?: string; summary?: string | null; args?: string; plan?: string; diffs?: { id?: string; path?: string; added?: number; removed?: number; lines?: { id?: string; sign?: string; text?: string }[] }[] | null; expiresIn?: number };
type WireQueue = { id?: string; text?: string };
type WireQuestionItem = { id?: string; header?: string; question?: string; detail?: string; multiSelect?: boolean; kind?: string; options?: { id?: string; label?: string; description?: string }[] };
type WireQuestion = { id?: string; callId?: string | null; expiresIn?: number; questions?: WireQuestionItem[] };
type WireSnapshot = {
  balance?: { signedOut?: boolean; failed?: boolean; wallets?: { currency?: string; balance?: string; text?: string }[]; bonus?: { currency?: string; balance?: string; text?: string }[] } | null;
  sessions?: WireSession[];
  session?: {
    id?: string;
    title?: string | null;
    running?: boolean;
    runStartedAt?: number;
    inherited?: boolean;
    runLabel?: string;
    runActivity?: { label?: string; detail?: string } | null;
    context?: { used?: number; total?: number } | null;
    quota?: string;
    stats?: { turns?: number; steps?: number; inTok?: number; outTok?: number; cacheRead?: number } | null;
    hasMore?: boolean;
    model?: string;
    permission?: string | null;
    permissionOptions?: { default?: string; options?: { value?: string; name?: string; description?: string }[] } | null;
    messages?: WireMessage[];
    queue?: WireQueue[];
    todos?: { id?: string; text?: string; state?: string; change?: string }[];
    subagents?: { id?: string; label?: string; sessionId?: string }[];
    team?: { id?: string; taskId?: string; subject?: string; status?: string; owner?: string }[];
    jobs?: { id?: string; kind?: string; label?: string; status?: string; progress?: string; detail?: string; when?: string }[];
    goalId?: string | null;
    pinned?: boolean;
    archived?: boolean;
    goalPhase?: string | null;
    question?: WireQuestion | null;
    plan?: { title?: string | null; steps?: { id?: string; text?: string; state?: string }[] } | null
  goal?: string | null
  approvals?: WireApproval[];
    streaming?: { text?: string; reasoning?: string; tools?: { name?: string; detail?: string; done?: boolean }[] } | null;
  } | null;
};

const timeout = 8000;

async function call(server: string, token: string, path: string, init: RequestInit = {}): Promise<Response> {
  return fetch(`${server}${path}`, {
    ...init,
    exactTimeout: (init as { exactTimeout?: number }).exactTimeout ?? timeout,
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
  });
}

async function reason(res: Response): Promise<string> {
  const body = (await res.json().catch(() => ({}))) as { error?: unknown };
  return typeof body.error === 'string' ? body.error : `The Mac answered ${res.status}.`;
}


/** A markdown node as this app maps it; the image fields let a run of pictures become a gallery. */
type PhoneItem = {
  id: string;
  v: string;
  sign: string;
  mark: string;
  d: number;
  alt: string;
  w: number;
  h: number;
  dw: number;
  dh: number;
};
type PhoneNode = {
  id: string;
  t: string;
  v: string;
  lvl: number;
  lang: string;
  alt: string;
  w: number;
  h: number;
  head: string;
  items: PhoneItem[];
  rows: PhoneItem[];
};

/** Fit a picture into a 240pt-tall card; wide pictures are capped so a neighbour still peeks in. */
function fitPicture(w: number, h: number): { dw: number; dh: number } {
  const dh = 240;
  if (!(w > 0) || !(h > 0)) return { dw: 320, dh };
  // At least 200pt keeps a neighbour peeking in; 280pt keeps a card from filling the screen.
  return { dw: Math.max(200, Math.min(280, Math.round((dh * w) / h))), dh };
}

/**
 * Pictures that arrive back to back become one sideways gallery, so the phone shows them as a
 * paging row with the next picture peeking in instead of a tall stack.
 */
function groupImages(nodes: PhoneNode[]): PhoneNode[] {
  const out: PhoneNode[] = [];
  let run: PhoneNode[] = [];
  const flush = () => {
    if (run.length === 1) {
      out.push(run[0]);
    } else if (run.length > 1) {
      const items = run.map((n) => {
        const fit = fitPicture(n.w, n.h);
        return { id: n.id, v: n.v, sign: ' ', mark: '', d: 0, alt: n.alt, w: n.w, h: n.h, dw: fit.dw, dh: fit.dh };
      });
      out.push({ ...run[0], t: 'gallery', v: '', items });
    }
    run = [];
  };
  for (const n of nodes) {
    if (n.t === 'img') run.push(n);
    else {
      flush();
      out.push(n);
    }
  }
  flush();
  return out;
}

// One mapper for every snapshot-shaped response (snapshot, live, transcript).
const mapSnapshot = (body: WireSnapshot): Result<'loadLive'> => {
  const rows = Array.isArray(body.sessions) ? body.sessions : [];
  const session = body.session ?? null;
  const streaming = session?.streaming ?? null;
  return {
    sessions: rows.map((s) => ({
      id: String(s.id ?? ''),
      pinned: s.pinned === true,
      title: typeof s.title === 'string' ? s.title : '',
      running: s.running === true,
      cwd: typeof s.cwd === 'string' ? s.cwd : '',
      updatedAt: typeof s.updatedAt === 'number' ? s.updatedAt : 0,
      group: typeof s.group === 'string' ? s.group : '',
      first: s.first === true,
      archived: s.archived === true,
      when: typeof s.when === 'string' ? s.when : '',
    })),
    sessionTitle: typeof session?.title === 'string' ? session.title : '',
    sessionModel: typeof session?.model === 'string' ? session.model : '',
    rowsRev: typeof (session as { rowsRev?: unknown } | null)?.rowsRev === 'string' ? String((session as { rowsRev?: string }).rowsRev) : '',
    listRev: typeof (body as { listRev?: unknown }).listRev === 'string' ? String((body as { listRev?: string }).listRev) : '',
    sessionPermission: typeof session?.permission === 'string' ? session.permission : '',
    permissionOptions: Array.isArray(session?.permissionOptions?.options)
      ? session.permissionOptions.options.map((o: { value?: unknown; name?: unknown; description?: unknown }) => ({
        value: String(o.value ?? ''),
        name: String(o.name ?? o.value ?? ''),
        description: String(o.description ?? ''),
      }))
      : [],
    hasMore: Boolean(session?.hasMore),
    running: session?.running === true,
    // DSH's RunningStatus copy, precomputed bridge-side (data sources have no clock).
    inherited: session?.inherited === true,
    runLabel: typeof session?.runLabel === 'string' ? session.runLabel : '深度求索中',
    runActivity: session?.runActivity && typeof session.runActivity === 'object'
      ? { label: typeof session.runActivity.label === 'string' ? session.runActivity.label : '', detail: typeof session.runActivity.detail === 'string' ? session.runActivity.detail : '' }
      : null,
    // ContextMeter parity: how much of the context window the session occupies.
    context: session?.context && typeof session.context === 'object'
      ? { used: Number(session.context.used ?? 0) || 0, total: Number(session.context.total ?? 0) || 0 }
      : null,
    // The newest billing/quota failure, for a one-shot toast (QuotaNoticeHost parity).
    quota: typeof session?.quota === 'string' ? session.quota : '',
    stats: (() => {
      const st = session?.stats
      const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : 0)
      return {
        turns: num(st?.turns),
        steps: num(st?.steps),
        inTok: num(st?.inTok),
        outTok: num(st?.outTok),
        cacheRead: num(st?.cacheRead),
      }
    })(),
    messages: (Array.isArray(session?.messages) ? session?.messages ?? [] : []).map((m) => ({
      id: String(m.id ?? ''),
      msgId: typeof m.msgId === 'string' ? m.msgId : '',
      role: String(m.role ?? 'assistant'),
      seq: typeof m.seq === 'number' ? m.seq : 0,
      // Copy and find want every step of a turn; the screen renders blocks.
      // Block-only assistant turns (text arrives via md nodes) still expose the
      // markdown body so the tail actions (copy/quote/feedback) and in-session
      // find have something to work with.
      text: typeof m.fullText === 'string' && m.fullText !== '' ? m.fullText : typeof m.text === 'string' && m.text !== '' ? m.text
        : String(m.role ?? '') === 'assistant'
          ? (Array.isArray(m.blocks) ? (m.blocks as { kind?: string; text?: string }[]).filter((b) => b && (b.kind === 'md' || b.kind === 'reasoning')).map((b) => typeof b.text === 'string' ? b.text : '').filter((t) => t !== '').join('\n\n') : '')
          : '',
      plain: plain(typeof m.text === 'string' && m.text !== '' ? m.text : String(m.role ?? '') === 'assistant' && Array.isArray(m.blocks)
        ? (m.blocks as { kind?: string; text?: string }[]).filter((b) => b && (b.kind === 'md' || b.kind === 'reasoning')).map((b) => typeof b.text === 'string' ? b.text : '').filter((t) => t !== '').join('\n\n')
        : ''),
      usage: typeof m.usage === 'string' ? m.usage : '',
      tools: typeof m.tools === 'number' ? m.tools : 0,
      running: typeof m.running === 'number' ? m.running : 0,
      thought: m.thought === true,
      failed: m.failed === true,
      // ReasoningRow parity: the first meaningful line, shown under a collapsed turn.
      thoughtPreview: (() => {
        const blocks = Array.isArray(m.blocks) ? m.blocks : [];
        const r = blocks.find((b) => b && b.kind === 'reasoning' && typeof b.text === 'string' && b.text.trim() !== '');
        if (!r) return '';
        const line = (r.text as string).split(/\n/).map((s) => s.trim()).filter((s) => s !== '')[0] ?? '';
        return line.slice(0, 80);
      })(),
      changedCount: typeof m.changedCount === 'number' ? m.changedCount : 0,
      day: typeof m.day === 'string' ? m.day : '',
      refs: (Array.isArray(m.refs) ? m.refs : []).map((r, k) => ({
        id: `rf${k}`,
        path: typeof r.path === 'string' ? r.path : '',
        text: '',
      })),
      deliverables: (Array.isArray(m.deliverables) ? m.deliverables : []).map((f, k) => ({
        id: `dl${k}`,
        path: typeof f.path === 'string' ? f.path : '',
        text: typeof f.text === 'string' ? f.text : '',
      })),
      usageTokens: m.usageTokens && typeof m.usageTokens === 'object'
        ? {
          in: typeof m.usageTokens.in === 'number' ? m.usageTokens.in : 0,
          out: typeof m.usageTokens.out === 'number' ? m.usageTokens.out : 0,
          cacheRead: typeof m.usageTokens.cacheRead === 'number' ? m.usageTokens.cacheRead : 0,
          reasoning: typeof m.usageTokens.reasoning === 'number' ? m.usageTokens.reasoning : null,
        }
        : null,
      interrupted: m.interrupted === true,
      took: typeof m.took === 'number' ? m.took : 0,
      folded: typeof m.folded === 'number' ? m.folded : 0,
      shadow: typeof m.shadow === 'number' ? m.shadow : 0,
      blocks: (Array.isArray(m.blocks) ? m.blocks : []).map((b, i) => ({
        id: typeof b.id === 'string' ? b.id : `b${i}`,
        kind: typeof b.kind === 'string' ? b.kind : 'text',
        text: typeof b.name === 'string' ? b.name : typeof b.text === 'string' ? b.text : '',
        detail: typeof b.detail === 'string' ? b.detail : '',
        status: typeof b.status === 'string' ? b.status : '',
        result: typeof b.result === 'string' ? b.result : '',
        callId: typeof b.callId === 'string' ? b.callId : '',
        // A subagent tool result names the child session; offer a jump to it.
        child: (() => {
          const name = String(b.name ?? '');
          if (!name.startsWith('subagent')) return '';
          const hit = `${String(b.result ?? '')} ${String(b.args ?? '')}`.match(/session-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/);
          return hit ? hit[0] : '';
        })(),
        icon: typeof b.icon === 'string' ? b.icon : '',
        summary: typeof b.summary === 'string' ? b.summary : '',
        args: typeof b.args === 'string' ? b.args : '',
        lazy: b.lazy === true,
        badge: typeof b.badge === 'string' ? b.badge : '',
        todos: (Array.isArray(b.todos) ? b.todos : []).map((t, k) => ({
          id: typeof t.id === 'string' ? t.id : `t${k}`,
          text: typeof t.text === 'string' ? t.text : '',
          state: typeof t.state === 'string' ? t.state : 'pending',
          change: typeof t.change === 'string' ? t.change : '',
        })),
        todoSummary: typeof b.todoSummary === 'string' ? b.todoSummary : '',
        files: (Array.isArray(b.files) ? b.files : []).map((f, k) => ({
          id: typeof f.id === 'string' ? f.id : `f${k}`,
          path: typeof f.path === 'string' ? f.path : '',
          text: typeof f.text === 'string' ? f.text : '',
        })),
        question: typeof b.question === 'string' ? b.question : '',
        att: typeof b.att === 'string' ? b.att : '',
        media: typeof b.media === 'string' ? b.media : '',
        w: typeof b.w === 'number' ? b.w : 0,
        h: typeof b.h === 'number' ? b.h : 0,
        images: (Array.isArray(b.images) ? b.images : []).map((im, k) => ({
          id: typeof im.id === 'string' ? im.id : `im${k}`,
          att: typeof im.att === 'string' ? im.att : '',
          media: typeof im.media === 'string' ? im.media : '',
          w: typeof im.w === 'number' ? im.w : 0,
          h: typeof im.h === 'number' ? im.h : 0,
          text: typeof im.text === 'string' ? im.text : '',
        })),
        options: (Array.isArray(b.options) ? b.options : []).map((o, k) => ({
          id: typeof o.id === 'string' ? o.id : `o${k}`,
          text: typeof o.text === 'string' ? o.text : '',
          description: '',
        })),
        diffs: (Array.isArray(b.diffs) ? b.diffs : []).map((d, k) => ({
          id: typeof d.id === 'string' ? d.id : `f${k}`,
          path: typeof d.path === 'string' ? d.path : '',
          added: typeof d.added === 'number' ? d.added : 0,
          removed: typeof d.removed === 'number' ? d.removed : 0,
          lines: (Array.isArray(d.lines) ? d.lines : []).map((ln, x) => ({
            id: typeof ln.id === 'string' ? ln.id : `l${x}`,
            sign: typeof ln.sign === 'string' ? ln.sign : ' ',
            text: typeof ln.text === 'string' ? ln.text : '',
          })),
        })),
        diffHidden: typeof b.diffHidden === 'number' ? b.diffHidden : 0,
        nodes: groupImages((Array.isArray(b.nodes) ? b.nodes : []).map((n, j) => ({
          id: typeof n.id === 'string' ? n.id : `n${j}`,
          t: typeof n.t === 'string' ? n.t : 'p',
          v: typeof n.v === 'string' ? n.v : '',
          lvl: typeof n.lvl === 'number' ? n.lvl : 0,
          lang: typeof n.lang === 'string' ? n.lang : '',
          alt: typeof n.alt === 'string' ? n.alt : '',
          w: typeof n.w === 'number' ? n.w : 0,
          h: typeof n.h === 'number' ? n.h : 0,
          head: typeof n.head === 'string' ? n.head : '',
          items: (Array.isArray(n.items) ? n.items : []).map((it, k) => ({
            id: typeof it.id === 'string' ? it.id : `i${k}`,
            v: typeof it.v === 'string' ? it.v : '',
            sign: typeof it.sign === 'string' ? it.sign : ' ',
            mark: typeof it.mark === 'string' ? it.mark : '•',
            d: typeof it.d === 'number' ? it.d : 0,
            alt: typeof it.alt === 'string' ? it.alt : '',
            w: typeof it.w === 'number' ? it.w : 0,
            h: typeof it.h === 'number' ? it.h : 0,
            dw: typeof it.dw === 'number' ? it.dw : 0,
            dh: typeof it.dh === 'number' ? it.dh : 0,
          })),
          rows: (Array.isArray(n.rows) ? n.rows : []).map((it, k) => ({
            id: typeof it.id === 'string' ? it.id : `r${k}`,
            v: typeof it.v === 'string' ? it.v : '',
            sign: ' ',
            mark: '•',
            d: 0,
            alt: '',
            w: 0,
            h: 0,
            dw: 0,
            dh: 0,
          })),
        }))),
      })),
    })),
    plan: {
      title: typeof session?.plan?.title === 'string' ? session.plan.title : '',
      steps: (Array.isArray(session?.plan?.steps) ? session?.plan?.steps ?? [] : []).map((st, k) => ({
        id: typeof st.id === 'string' ? st.id : `p${k}`,
        text: typeof st.text === 'string' ? st.text : '',
        state: typeof st.state === 'string' ? st.state : 'pending',
      })),
    },
    goal: typeof session?.goal === 'string' ? session.goal : '',
    approvals: (Array.isArray(session?.approvals) ? session?.approvals ?? [] : []).map((a) => ({
      id: String(a.id ?? ''),
      toolName: typeof a.toolName === 'string' ? a.toolName : 'tool',
      reason: typeof a.reason === 'string' ? a.reason : '',
      summary: typeof a.summary === 'string' ? a.summary : '',
      plan: typeof a.plan === 'string' ? a.plan : '',
      args: typeof a.args === 'string' ? a.args : '',
      command: typeof a.command === 'string' ? a.command : '',
      lazy: false,
      expiresIn: typeof a.expiresIn === 'number' ? a.expiresIn : 0,
    })),
    goalId: typeof session?.goalId === 'string' ? session.goalId : '',
    pinned: session?.pinned === true,
    archived: session?.archived === true,
    goalPhase: typeof session?.goalPhase === 'string' ? session.goalPhase : '',
    subagents: (Array.isArray(session?.subagents) ? session?.subagents ?? [] : []).map((a, i) => ({
      id: typeof a.id === 'string' ? a.id : `a${i}`,
      label: typeof a.label === 'string' ? a.label : '',
      sessionId: typeof a.sessionId === 'string' ? a.sessionId : '',
    })),
    team: (Array.isArray(session?.team) ? session?.team ?? [] : []).map((t, i) => ({
      id: typeof t.id === 'string' ? t.id : `tt${i}`,
      taskId: typeof t.taskId === 'string' ? t.taskId : '',
      subject: typeof t.subject === 'string' ? t.subject : '',
      status: typeof t.status === 'string' ? t.status : 'pending',
      owner: typeof t.owner === 'string' ? t.owner : '',
    })),
    jobs: (Array.isArray(session?.jobs) ? session?.jobs ?? [] : []).map((j, i) => ({
      id: typeof j.id === 'string' ? j.id : `j${i}`,
      kind: typeof j.kind === 'string' ? j.kind : '',
      label: typeof j.label === 'string' ? j.label : '',
      status: typeof j.status === 'string' ? j.status : '',
      progress: typeof j.progress === 'string' ? j.progress : '',
      detail: typeof j.detail === 'string' ? j.detail : '',
      when: typeof j.when === 'string' ? j.when : '',
    })),
    todos: (Array.isArray(session?.todos) ? session?.todos ?? [] : []).map((t, i) => ({
      id: typeof t.id === 'string' ? t.id : `t${i}`,
      text: typeof t.text === 'string' ? t.text : '',
      state: typeof t.state === 'string' ? t.state : 'pending',
    })),
    queue: (Array.isArray(session?.queue) ? session?.queue ?? [] : []).map((q, i) => ({
      id: typeof q.id === 'string' ? q.id : `q${i}`,
      text: typeof q.text === 'string' ? q.text : '',
    })),
    question: session?.question && typeof session.question === 'object'
      ? {
        id: String(session.question.id ?? ''),
        callId: typeof session.question.callId === 'string' ? session.question.callId : '',
        hint: (session.question.questions?.[0]?.header ?? ''),
        ask: (session.question.questions?.[0]?.question ?? ''),
        detail: (session.question.questions?.[0]?.detail ?? ''),
        qid: String(session.question.questions?.[0]?.id ?? 'q0'),
        multi: session.question.questions?.[0]?.multiSelect === true,
        kind: (session.question.questions?.[0]?.kind ?? ''),
        expiresIn: typeof session.question.expiresIn === 'number' ? session.question.expiresIn : 0,
        // QuestionComposer parity: every question in the request, not just the first.
        items: (Array.isArray(session.question.questions) ? session.question.questions : []).map((q, k) => ({
          id: String(q.id ?? `q${k}`),
          header: typeof q.header === 'string' ? q.header : '',
          question: typeof q.question === 'string' ? q.question : '',
          detail: typeof q.detail === 'string' ? q.detail : '',
          multi: q.multiSelect === true,
          options: (Array.isArray(q.options) ? q.options : []).map((o, j) => ({
            id: String(o.id ?? `o${j}`),
            text: typeof o.label === 'string' ? o.label : '',
            description: typeof o.description === 'string' ? o.description : '',
          })),
        })),
        options: (session.question.questions?.[0]?.options ?? []).map((o, k) => ({
          id: String(o.id ?? `o${k}`),
          text: typeof o.label === 'string' ? o.label : '',
          description: typeof o.description === 'string' ? o.description : '',
        })),
      }
      : null,
    streamText: typeof streaming?.text === 'string' ? streaming.text : '',
    streamReasoning: typeof streaming?.reasoning === 'string' ? streaming.reasoning : '',
    streamTools: (Array.isArray(streaming?.tools) ? streaming?.tools ?? [] : []).map((t, i) => ({
      id: `t${i}`,
      kind: 'tool',
      text: typeof t.name === 'string' ? t.name : 'tool',
      detail: typeof t.detail === 'string' ? t.detail : '',
      status: t.done === true ? 'ok' : 'running',
      att: '',
      media: '',
      w: 0,
      h: 0,
      images: [],
      result: '',
      callId: '',
      child: '',
      icon: 'symbol:circle',
      summary: typeof t.detail === 'string' ? t.detail : '',
      args: '',
      lazy: false,
      badge: '',
      todoSummary: '',
      todos: [],
      files: [],
      question: '',
      options: [],
      description: '',
      diffs: [],
      diffHidden: 0,
      nodes: [],
    })),
    balance: (() => {
      const b = body.balance
      if (!b || typeof b !== 'object') return null
      const wallet = (w: { currency?: string; balance?: string; text?: string } | null, id: string) => {
        const cur = typeof w?.currency === 'string' ? w.currency : ''
        const raw = typeof w?.balance === 'string' ? w.balance : (typeof w?.text === 'string' ? w.text : '')
        const num = Number.parseFloat(raw)
        return { id, currency: cur, text: Number.isFinite(num) ? num.toFixed(2) : raw }
      }
      return {
        signedOut: b.signedOut === true,
        failed: b.failed === true,
        wallets: (Array.isArray(b.wallets) ? b.wallets : []).map((w, i) => wallet(w, `w${i}`)),
        bonus: (Array.isArray(b.bonus) ? b.bonus : []).map((w, i) => wallet(w, `b${i}`)),
      }
    })(),
  };
};

// The last transcript window: /v1/transcript sends only rows newer than the
// cursor while this holds, so a running turn no longer re-downloads its history.
type TranscriptCache = { key: string; take: number; seq: number; proj: string; ids: string[]; byId: Map<string, unknown> };
let tCache: TranscriptCache = { key: '', take: 0, seq: 0, proj: '', ids: [], byId: new Map() };

// Most bridge calls are fire-and-forget POSTs whose answer is just ok/error;
// these two cover that shape (and the id-carrying fork/create/rename family).
const post = async (server: string, token: string, path: string, body: unknown = {}, method: string = 'POST'): Promise<{ ok: boolean; error: string; data: Record<string, unknown> }> => {
  try {
    const res = await call(server, token, path, { method, body: JSON.stringify(body ?? {}) });
    if (!res.ok) return { ok: false, error: await reason(res), data: {} };
    return { ok: true, error: '', data: (await res.json().catch(() => ({}))) as Record<string, unknown> };
  } catch {
    return { ok: false, error: 'Can’t reach the Mac.', data: {} };
  }
};
const postId = async (server: string, token: string, path: string, body: unknown = {}, method: string = 'POST'): Promise<{ id: string; error: string }> => {
  const r = await post(server, token, path, body, method);
  return { id: r.ok ? String(r.data.id ?? r.data.title ?? '') : '', error: r.ok ? '' : r.error };
};

const sources: Sources = {
  loadCall: async ([server, token, sid, callId]): Promise<Result<'loadCall'>> => {
    const res = await fetch(`${server}/v1/sessions/${sid}/call?callId=${encodeURIComponent(String(callId))}&t=${token}`, { exactTimeout: 15000 })
    if (!res.ok) return { callId: String(callId), name: '', args: '', result: '' }
    const body = (await res.json()) as { name?: string; args?: string; result?: string }
    return { callId: String(callId), name: String(body.name ?? ''), args: String(body.args ?? ''), result: String(body.result ?? '') }
  },
  // The small poll: everything except the transcript rows (the bridge strips them).
  loadLive: async ([server, token, selected, listRev, showArchived]): Promise<Result<'loadLive'>> => {
    const parts = [] as string[]
    if (selected != '') parts.push(`session=${encodeURIComponent(selected as string)}`)
    if (typeof listRev === 'string' && listRev != '') parts.push(`listRev=${encodeURIComponent(listRev)}`);
    if (showArchived === true) parts.push('archived=show')
    const query = parts.length > 0 ? `?${parts.join('&')}` : ''
    const res = await call(server as string, token as string, `/v1/live${query}`);
    if (res.status === 401) throw new Error('unauthorized');
    if (!res.ok) throw new Error(await reason(res));
    const mapped = mapSnapshot((await res.json()) as WireSnapshot);
    return { ...mapped, messages: [] };
  },
  // The heavy poll: fetched when the transcript revision moves. While the session,
  // window size and cursor all hold, the bridge sends only rows newer than the
  // cursor (`since=`) plus the window's id order; everything else is this cache.
  loadRows: async ([server, token, selected, take, rev]): Promise<Result<'loadRows'>> => {
    const size = typeof take === 'number' ? take : 8;
    const key = `${server}|${selected}`;
    // The rev's third segment is the bridge's projection version: when the server
    // changes HOW rows are projected (same seqs, better content), cached rows are
    // stale even though no seq moved — only an incremental patch would never fix them.
    const proj = String(rev ?? '').split(':')[2] ?? '';
    const cacheOk = tCache.key === key && tCache.take === size && tCache.seq > 0 && tCache.proj === proj;
    const query = `?session=${encodeURIComponent(selected as string)}&take=${size}${cacheOk ? `&since=${tCache.seq}` : ''}`;
    const res = await call(server as string, token as string, `/v1/transcript${query}`, { exactTimeout: 30000 });
    if (res.status === 401) throw new Error('unauthorized');
    if (!res.ok) throw new Error(await reason(res));
    const body = (await res.json()) as { rows?: unknown[]; ids?: unknown[]; seq?: unknown; hasMore?: boolean; rowsRev?: string };
    const ids = Array.isArray(body.ids) ? body.ids.map((v) => String(v)) : [];
    const dirty = Array.isArray(body.rows) ? body.rows : [];
    if (!cacheOk) {
      tCache = { key, take: size, seq: Number(body.seq) || 0, proj, ids: dirty.map((r) => String((r as { id?: unknown }).id ?? '')), byId: new Map(dirty.map((r) => [String((r as { id?: unknown }).id ?? ''), r])) };
    } else {
      for (const r of dirty) tCache.byId.set(String((r as { id?: unknown }).id ?? ''), r);
      if (ids.length > 0) tCache.ids = ids;
      tCache.seq = Number(body.seq) || tCache.seq;
    }
    const rows = tCache.ids.map((id) => tCache.byId.get(id)).filter((r) => r !== undefined);
    const mapped = mapSnapshot({ session: { messages: rows, hasMore: body.hasMore === true } } as WireSnapshot);
    return { rev: String(body.rowsRev ?? ''), hasMore: mapped.hasMore, rows: mapped.messages };
  },

  uploadPhoto: async ([server, token, from, name], _store, storage): Promise<Result<'uploadPhoto'>> => {
    try {
      // Long side to 1600px, at most 1.5 MB: a phone photo is usually 3–6 MB.
      const out = await storage.fs.compressImage(String(from), 'app:/tmp/dshm-upload.jpg', { maxDimension: 1600, maxBytes: 1_500_000 });
      const res = await fetch(`${server}/v1/attach?name=${encodeURIComponent(String(name))}&media=${encodeURIComponent(out.type)}`, {
        method: 'POST',
        exactTimeout: 120000,
        headers: { authorization: `Bearer ${token}`, 'content-type': out.type },
        exactBodyFrom: out.path,
      });
      const body = (await res.json().catch(() => ({}))) as { id?: unknown; error?: unknown };
      if (!res.ok) return { ok: false, id: '', name: '', error: typeof body.error === 'string' ? body.error : `The Mac answered ${res.status}.` };
      return { ok: true, id: String(body.id ?? ''), name: String(name), error: '' };
    } catch (e) {
      return { ok: false, id: '', name: '', error: String((e as Error)?.message ?? e) };
    }
  },

  sendPrompt: async ([server, token, selected, text, steer, attach]): Promise<Result<'sendPrompt'>> => {
    try {
      const res = await call(server as string, token as string, `/v1/sessions/${encodeURIComponent(selected as string)}/prompt`, {
        method: 'POST',
        body: JSON.stringify({ text, mode: steer ? 'steer' : 'queue', images: attach === '' ? [] : [attach] }),
      });
      return res.ok ? { ok: true, error: '' } : { ok: false, error: await reason(res) };
    } catch (e) {
      if ((e as { code?: string }).code === 'bake') throw e;
      return { ok: false, error: 'Can’t reach the Mac. Check the tunnel and the server address.' };
    }
  },

  setPermission: async ([server, token, selected, value]): Promise<Result<'setPermission'>> =>
    post(server as string, token as string, `/v1/sessions/${encodeURIComponent(selected as string)}/permission`, { value }),

  cancelRun: async ([server, token, selected]): Promise<Result<'cancelRun'>> =>
    post(server as string, token as string, `/v1/sessions/${encodeURIComponent(selected as string)}/cancel`),


  loadModels: async ([server, token, selected]): Promise<Result<'loadModels'>> => {
    const empty = { currentModel: '', currentProvider: '', currentEffort: '', models: [] };
    try {
      const res = await call(server as string, token as string, `/v1/sessions/${encodeURIComponent(selected as string)}/models`);
      if (!res.ok) return empty;
      const body = (await res.json()) as {
        current?: { provider?: string; model?: string; effort?: string };
        groups?: { id?: string; name?: string; models?: { id?: string; name?: string; efforts?: { id?: string; name?: string }[] }[] }[];
      };
      const rows: { id: string; name: string; provider: string; current: boolean; efforts: string[] }[] = [];
      for (const g of body.groups ?? []) {
        for (const m of g.models ?? []) {
          rows.push({
            id: String(m.id ?? ''),
            name: String(m.name ?? m.id ?? ''),
            provider: String(g.id ?? ''),
            current: body.current?.model === m.id && body.current?.provider === g.id,
            efforts: (m.efforts ?? []).map((e) => String(e.id ?? '')).filter((v) => v !== ''),
          });
        }
      }
      return {
        currentModel: String(body.current?.model ?? ''),
        currentProvider: String(body.current?.provider ?? ''),
        currentEffort: String(body.current?.effort ?? ''),
        models: rows,
      };
    } catch {
      return empty;
    }
  },

  // Paired-device list for the settings screen (name, paired-at, self marker).
  loadDevices: async ([server, token]): Promise<Result<'loadDevices'>> => {
    try {
      const res = await call(server as string, token as string, '/v1/devices');
      if (!res.ok) return { devices: [] };
      const body = (await res.json()) as { you?: string; devices?: { id?: string; name?: string; at?: number }[] };
      const mine = String(body.you ?? '');
      return {
        devices: (body.devices ?? []).map((d) => {
          const at = Number(d.at ?? 0);
          const when = at <= 0 ? '' : new Date(at).toLocaleDateString('zh-CN');
          return {
            id: String(d.id ?? ''),
            name: String(d.name ?? '未命名设备'),
            when,
            mine: String(d.id ?? '') === mine,
          };
        }),
      };
    } catch {
      return { devices: [] };
    }
  },

  revokeDevice: async ([server, token, id]): Promise<Result<'revokeDevice'>> =>
    post(server as string, token as string, `/v1/devices/${encodeURIComponent(String(id))}`, {}, 'DELETE'),

  setModel: async ([server, token, selected, provider, model, effort]): Promise<Result<'setModel'>> =>
    post(server as string, token as string, `/v1/sessions/${encodeURIComponent(selected as string)}/model`, { provider, model, effort }),

  killJob: async ([server, token, sid, jobId]): Promise<Result<'killJob'>> =>
    post(server as string, token as string, `/v1/sessions/${encodeURIComponent(String(sid))}/jobs/${encodeURIComponent(String(jobId))}/kill`),

  forkFrom: async ([server, token, sid, seq]): Promise<Result<'forkFrom'>> =>
    postId(server as string, token as string, `/v1/sessions/${encodeURIComponent(String(sid))}/fork`, { atSeq: Number(seq) }),

  setSessionFlag: async ([server, token, sid, flag, on]): Promise<Result<'setSessionFlag'>> =>
    post(server as string, token as string, `/v1/sessions/${encodeURIComponent(String(sid))}/${String(flag)}`, { on }),

  setGoalAction: async ([server, token, sid, action]): Promise<Result<'setGoalAction'>> =>
    post(server as string, token as string, `/v1/sessions/${encodeURIComponent(String(sid))}/goal`, { action }),

  answerQuestion: async ([server, token, id, questionId, selected]): Promise<Result<'answerQuestion'>> => {
    const labels = String(selected ?? '').split('|').filter((v) => v !== '');
    const answer: { id: string; selected: string[] } = { id: String(questionId), selected: labels };
    return post(server as string, token as string, `/v1/questions/${encodeURIComponent(String(id))}/answer`, { answers: [answer] });
  },

  // QuestionComposer parity: answer every question of the request in one submit.
  // `payload` is one `id\tpicks\tcustom` line per question (picks |-joined), \n-joined.
  answerQuestions: async ([server, token, id, payload]): Promise<Result<'answerQuestions'>> => {
    const answers = String(payload ?? '').split('\n').filter((line) => line.includes('\t')).map((line) => {
      const [qid, picks, custom] = line.split('\t');
      const answer: { id: string; selected: string[]; custom?: string } = {
        id: String(qid ?? ''),
        selected: String(picks ?? '').split('|').filter((v) => v !== ''),
      };
      const text = String(custom ?? '').trim();
      if (text !== '') answer.custom = text;
      return answer;
    });
    return post(server as string, token as string, `/v1/questions/${encodeURIComponent(String(id))}/answer`, { answers });
  },

  // Message feedback (ui-message-feedback parity): thumbs up/down on an assistant turn.
  rateMessage: async ([server, token, id, msgId, rating, note]): Promise<Result<'rateMessage'>> => {
    const path = `/v1/sessions/${encodeURIComponent(String(id))}/feedback`;
    try {
      const payload: Record<string, unknown> = { id: String(msgId), rating: rating === 'negative' ? 'negative' : 'positive' };
      if (typeof note === 'string' && note.trim() !== '') payload.note = note.trim();
      const res = await call(server as string, token as string, path, { method: 'POST', body: JSON.stringify(payload) });
      if (res.ok) return { ok: true, error: '' };
      return { ok: false, error: await reason(res) };
    } catch {
      return { ok: false, error: 'The Mac did not answer.' };
    }
  },

  // File preview (document-preview parity): one workspace file as text or data URL.
  loadFile: async ([server, token, sid, filePath]): Promise<Result<'loadFile'>> => {
    const empty = { ok: false, kind: '', media: '', name: '', bytes: 0, text: '', url: '' };
    try {
      const res = await call(server as string, token as string, `/v1/sessions/${encodeURIComponent(String(sid))}/file?p=${encodeURIComponent(String(filePath))}`);
      if (!res.ok) return empty;
      const body = (await res.json()) as { ok?: boolean; kind?: string; media?: string; name?: string; bytes?: number; text?: string; url?: string };
      return {
        ok: body.ok !== false,
        kind: String(body.kind ?? ''),
        media: String(body.media ?? ''),
        name: String(body.name ?? ''),
        bytes: Number(body.bytes ?? 0),
        text: String(body.text ?? ''),
        url: String(body.url ?? ''),
      };
    } catch {
      return empty;
    }
  },

  // Scheduled tasks (ui-schedule parity).
  loadSchedules: async ([server, token]): Promise<Result<'loadSchedules'>> => {
    const empty = { items: [] as { id: string; title: string; prompt: string; status: string; kind: string; timing: string; nextAt: string; updatedAt: string; targetSessionId: string }[] };
    try {
      const res = await call(server as string, token as string, `/v1/schedules`);
      if (!res.ok) return empty;
      const body = (await res.json()) as { items?: { id?: string; title?: string; prompt?: string; status?: string; kind?: string; timing?: string; nextAt?: string | null; updatedAt?: string | null; targetSessionId?: string | null }[] };
      return {
        items: (body.items ?? []).map((t, k) => ({
          id: `st${k}-${String(t.id ?? '')}`,
          title: String(t.title ?? ''),
          prompt: String(t.prompt ?? ''),
          status: String(t.status ?? 'active'),
          kind: String(t.kind ?? ''),
          timing: String(t.timing ?? ''),
          nextAt: String(t.nextAt ?? ''),
          updatedAt: String(t.updatedAt ?? ''),
          targetSessionId: String(t.targetSessionId ?? ''),
        })),
      };
    } catch {
      return empty;
    }
  },

  createSchedule: async ([server, token, title, prompt, timing]): Promise<Result<'createSchedule'>> => {
    try {
      let parsed: unknown = { kind: 'daily', daily: { time: '09:00:00', time_zone: 'Asia/Shanghai' } };
      try { parsed = JSON.parse(String(timing)); } catch { /* default above */ }
      const res = await call(server as string, token as string, `/v1/schedules`, { method: 'POST', body: JSON.stringify({ title: String(title), prompt: String(prompt), timing: parsed }) });
      return res.ok ? { ok: true, error: '' } : { ok: false, error: await reason(res) };
    } catch {
      return { ok: false, error: 'The Mac did not answer.' };
    }
  },

  editSchedule: async ([server, token, id, patchJson]): Promise<Result<'editSchedule'>> => {
    try {
      let patch: Record<string, unknown> = {};
      try { patch = JSON.parse(String(patchJson)) as Record<string, unknown>; } catch { /* empty patch */ }
      const res = await call(server as string, token as string, `/v1/schedules/${encodeURIComponent(String(id))}/edit`, { method: 'POST', body: JSON.stringify(patch) });
      return res.ok ? { ok: true, error: '' } : { ok: false, error: await reason(res) };
    } catch {
      return { ok: false, error: 'The Mac did not answer.' };
    }
  },

  deleteSchedule: async ([server, token, id]): Promise<Result<'deleteSchedule'>> =>
    post(server as string, token as string, `/v1/schedules/${encodeURIComponent(String(id))}/delete`),

  runSchedule: async ([server, token, id]): Promise<Result<'runSchedule'>> =>
    post(server as string, token as string, `/v1/schedules/${encodeURIComponent(String(id))}/run`),

  skipQuestion: async ([server, token, id]): Promise<Result<'skipQuestion'>> =>
    post(server as string, token as string, `/v1/questions/${encodeURIComponent(String(id))}/skip`),

  dropQueued: async ([server, token, sid, itemId]): Promise<Result<'dropQueued'>> =>
    post(server as string, token as string, `/v1/sessions/${encodeURIComponent(String(sid))}/queue/${encodeURIComponent(String(itemId))}/remove`),

  // kind 'edit' rewrites the queued text in place; 'steer' injects it into the
  // running turn immediately (DSH QueueDock's paper-plane).
  queueItem: async ([server, token, sid, itemId, kind, text]): Promise<Result<'queueItem'>> =>
    post(server as string, token as string, `/v1/sessions/${encodeURIComponent(String(sid))}/queue/${encodeURIComponent(String(itemId))}/${kind}`, kind === 'edit' ? { text } : {}),

  loadCommands: async ([server, token, selected]): Promise<Result<'loadCommands'>> => {
    try {
      const res = await call(server as string, token as string, `/v1/sessions/${encodeURIComponent(selected as string)}/commands`);
      if (!res.ok) return { commands: [] };
      const body = (await res.json()) as { commands?: { name?: string; description?: string; hint?: string }[] };
      return {
        commands: (body.commands ?? []).map((c) => ({
          name: String(c.name ?? ''),
          description: String(c.description ?? ''),
          hint: String(c.hint ?? ''),
        })),
      };
    } catch {
      return { commands: [] };
    }
  },

  runSessionCommand: async ([server, token, selected, name, input]): Promise<Result<'runSessionCommand'>> => {
    const r = await post(server as string, token as string, `/v1/sessions/${encodeURIComponent(selected as string)}/command`, { name, input });
    return r.ok ? { ok: true, error: String(r.data.message ?? '') } : r;
  },

  respondApproval: async ([server, token, id, allow, always]): Promise<Result<'respondApproval'>> =>
    post(server as string, token as string, `/v1/approvals/${encodeURIComponent(String(id))}`, { decision: always === true ? 'always' : allow === true ? 'allow' : 'deny' }),

  // A QR carries `dshm://pair?u=<origin>&c=<code>`; the origin is the tunnel.
  pairFromLink: async ([raw]): Promise<Result<'pairFromLink'>> => {
    const text = String(raw ?? '').trim();
    let tunnel = '';
    let direct = '';
    let code = '';
    if (text.startsWith('dshm://')) {
      const rest = text.slice('dshm://'.length);
      const q = rest.indexOf('?');
      const params = new URLSearchParams(q >= 0 ? rest.slice(q + 1) : '');
      tunnel = params.get('u') ?? '';
      direct = params.get('d') ?? '';
      code = params.get('c') ?? '';
    } else if (text.startsWith('http://') || text.startsWith('https://')) {
      try {
        const url = new URL(text);
        tunnel = url.origin;
        code = url.searchParams.get('c') ?? '';
      } catch {
        tunnel = '';
      }
    }
    // The link carries both paths; Tailscale is the faster, restart-proof one, so try
    // it first and fall back to the tunnel when the phone is outside the tailnet.
    const candidates = [direct, tunnel].map((c) => c.replace(/\/+$/, '')).filter((c) => c !== '');
    if (candidates.length === 0 || code.length !== 6) {
      return { ok: false, server: '', token: '', alt: '', error: 'That code is not a DSH Mobile pairing link.' };
    }
    let lastError = '';
    for (const server of candidates) {
      try {
        const res = await fetch(`${server}/v1/pair`, {
          method: 'POST',
          exactTimeout: timeout,
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ code, name: 'dsh-remote 手机' }),
        });
        const body = (await res.json().catch(() => ({}))) as { token?: unknown; error?: unknown };
        // The other path becomes the phone's fallback: Tailscale drops when its
        // app quits, tunnels rename on restart — either side can go dark first.
        const alt = candidates.find((c) => c !== server) ?? '';
        if (!res.ok) {
          // The Mac answered on this path; a bad code will not get better on the other one.
          return { ok: false, server, token: '', alt, error: typeof body.error === 'string' ? body.error : `The Mac answered ${res.status}.` };
        }
        return { ok: true, server, token: typeof body.token === 'string' ? body.token : '', alt, error: '' };
      } catch {
        lastError = 'Can’t reach that Mac. Is the tunnel still running?';
      }
    }
    return { ok: false, server: '', token: '', alt: '', error: lastError };
  },

  createSession: async ([server, token, cwd]): Promise<Result<'createSession'>> =>
    postId(server as string, token as string, '/v1/sessions', typeof cwd === 'string' && cwd !== '' ? { cwd } : {}),

  renameSession: async ([server, token, id, title]): Promise<Result<'renameSession'>> =>
    postId(server as string, token as string, `/v1/sessions/${encodeURIComponent(id as string)}/rename`, { title }),

  forkSession: async ([server, token, id]): Promise<Result<'forkSession'>> =>
    postId(server as string, token as string, `/v1/sessions/${encodeURIComponent(id as string)}/fork`),

  pairDevice: async ([server, code]): Promise<Result<'pairDevice'>> => {
    try {
      const res = await fetch(`${server as string}/v1/pair`, {
        method: 'POST',
        exactTimeout: timeout,
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ code, name: 'dsh-remote 手机' }),
      });
      const body = (await res.json().catch(() => ({}))) as { token?: unknown; error?: unknown };
      if (!res.ok) return { ok: false, token: '', error: typeof body.error === 'string' ? body.error : `The Mac answered ${res.status}.` };
      return { ok: true, token: typeof body.token === 'string' ? body.token : '', error: '' };
    } catch {
      return { ok: false, token: '', error: 'Can’t reach the Mac. Check the server address.' };
    }
  },
};

export const answer: Answer = (source, args, store, storage, native) =>
  sources[source](args, store, storage, native);
