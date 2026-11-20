import type { Answer, Result, Sources } from './app.contract.d.ts';

// The bridge plugin listens on loopback; a phone reaches the Mac over a tunnel
// (https) or the LAN (http), and the person names that origin in Settings.
export const grants = ['net.fetch https:', 'net.fetch http:', 'device.camera scanPurpose', 'fs.read app:/tmp', 'fs.write app:/tmp', 'fs.read app:/tmp/picked'].join('\n');

type WireItem = { id?: string; v?: string; sign?: string; mark?: string; d?: number; alt?: string; w?: number; h?: number; dw?: number; dh?: number };
type WireRun = [string, string];
type WireNode = { id?: string; t?: string; v?: string; lvl?: number; lang?: string; alt?: string; w?: number; h?: number; head?: string; align?: string; items?: WireItem[]; rows?: WireItem[]; runs?: WireRun[] };
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
  todos?: { id?: string; text?: string; state?: string; change?: string; label?: string; prev?: string }[];
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
  ask?: WireAsk | null;
  // The process group the block belongs to (a header block of kind 'group' carries that id); a reply of the final answer step.
  grp?: string;
  answer?: boolean;
  // A tool row: its localized title, the collapsed row's right-hand text and the lines it added / removed.
  title?: string;
  suffix?: string;
  added?: number;
  removed?: number;
};
// A question tool row's state / a late reply's Q&A, as the bridge folds them (ui-tool AskQuestionRow parity).
type WireAsk = { state?: string; answered?: number; total?: number; answerable?: boolean; callId?: string; items?: { id?: string; header?: string; question?: string; answers?: string[]; skipped?: boolean }[] };

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

// The composer shows `@label`; each pick the @ menu made is a `@label<TAB>wire` line, `wire` being the canonical mention the bridge
// worded (`@[label](dsh-session:…)`, labels escaped as the host's parser expects). Sending swaps every readable form for its wire form in
// one pass, so a replacement is never searched again; the longest label goes first, so one that starts another's is not cut short.
function withMentions(text: string, picks: string): string {
  const refs = picks.split('\n').map((l) => l.split('\t')).filter((p) => p.length === 2 && p[0] !== '' && p[1] !== '')
    .sort((a, b) => b[0].length - a[0].length);
  if (refs.length === 0) return text;
  const wire = new Map(refs.map(([shown, mention]) => [shown, mention] as [string, string]));
  const re = new RegExp(refs.map(([shown]) => shown.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|'), 'g');
  return text.replace(re, (m) => wire.get(m) ?? m);
}

// A note row's header (title / summary / icon / state) is worded by the bridge in the `lang` the phone asked for; `refs` carry a kind (skill | session | file).
// An assistant row of a closed turn also carries the turn control (title / summary / state), the flags the phone folds by and the turn's usage panel.
type WireMessage = { id?: string; role?: string; seq?: number; turn?: number | null; msgId?: string; text?: string; fullText?: string; usage?: string; usageRows?: { id?: string; label?: string; value?: string }[]; title?: string; summary?: string; icon?: string; state?: string; interrupted?: boolean; failed?: boolean; active?: boolean; steered?: boolean; foldAll?: boolean; foldFinal?: boolean; changedCount?: number; changesSeq?: number; changedAdded?: number; changedRemoved?: number; changedFiles?: { path?: string; name?: string; added?: number; removed?: number; i?: number; note?: string }[]; deliverables?: { path?: string; text?: string }[]; refs?: { path?: string; kind?: string }[]; day?: string; blocks?: WireBlock[] };
type WireSession = { id?: string; title?: string | null; running?: boolean; runStartedAt?: number; pinned?: boolean; archived?: boolean; cwd?: string | null; updatedAt?: number | null; group?: string | null; first?: boolean; when?: string | null; attention?: string; unread?: string; subs?: number };
// A tool approval, or a question-intent approval (subject / detail / the asker's labels).
type WireApproval = { id?: string; toolName?: string | null; reason?: string | null; command?: string; summary?: string | null; args?: string; subject?: string; detail?: string; approveLabel?: string; alwaysLabel?: string };
type WireQueue = { id?: string; text?: string; images?: { id?: string; att?: string; media?: string; w?: number; h?: number; text?: string }[]; files?: { id?: string; path?: string; text?: string }[]; editable?: boolean };
type WireQuestionItem = { id?: string; header?: string; question?: string; detail?: string; multiSelect?: boolean; options?: { id?: string; label?: string; text?: string; description?: string; recommended?: boolean }[] };
type WirePlan = { title?: string; description?: string; nodes?: WireNode[]; approve?: string; chars?: number };
// The Mac's pending question / plan review, mirrored from its own composer card.
type WireQuestion = { id?: string; callId?: string | null; kind?: string; state?: string; dismissal?: string; countdown?: number; running?: boolean; held?: boolean; questions?: WireQuestionItem[]; plan?: WirePlan | null };
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
    runActivity?: { kind?: string; label?: string; detail?: string } | null;
    context?: { used?: number; total?: number; system?: number; tools?: number; messages?: number } | null;
    quota?: string;
    quotaId?: string;
    stats?: { turns?: number; steps?: number; inTok?: number; outTok?: number; cacheRead?: number; llmMs?: number; toolMs?: number; ttftMs?: number; ttftSteps?: number; decodeMs?: number; decodeTokens?: number } | null;
    hasMore?: boolean;
    model?: string;
    permission?: string | null;
    permissionOptions?: { default?: string; options?: { value?: string; name?: string; description?: string }[] } | null;
    messages?: WireMessage[];
    queue?: WireQueue[];
    todos?: { id?: string; text?: string; state?: string; change?: string }[];
    subagents?: { id?: string; label?: string; sessionId?: string; sub?: string; mode?: string; modeCode?: string; activity?: string; state?: string; meta?: string; depth?: number }[];
    subagentProgress?: string;
    parentId?: string;
    parentTitle?: string;
    agentLabel?: string;
    cwd?: string | null;
    team?: { id?: string; taskId?: string; subject?: string; status?: string; owner?: string }[];
    jobs?: { id?: string; kind?: string; label?: string; status?: string; state?: string; progress?: string; detail?: string; when?: string }[];
    goalId?: string | null;
    pinned?: boolean;
    archived?: boolean;
    goalPhase?: string | null;
    origin?: string;
    subagentMode?: string;
    question?: WireQuestion | null;
    plan?: { title?: string | null; steps?: { id?: string; text?: string; state?: string }[] } | null
  goal?: string | null
    // The composer's host facts: the failed turn/end a 继续生成 addresses, plan mode (on / off / entering / leaving), the goal bar's details.
    continueSeq?: number | null;
    planMode?: string;
    goalInfo?: { rounds?: number; max?: number; reason?: string; activation?: string } | null;
  approvals?: WireApproval[];
    // The attempt streaming right now, as blocks that continue the open turn's groups.
    streaming?: { blocks?: WireBlock[] } | null;
  } | null;
  prefs?: { transcriptView?: string; collapseTiming?: string; foldedReplies?: string; performanceUsage?: string; busyEnter?: string } | null;
  // What the composer may attach: a message's image count, whether staged files can be taken, the per-file size cap.
  limits?: { images?: number; files?: boolean; fileBytes?: number } | null;
  // The bridge's wire revision and whether it can open files on the Mac (absent on an older bridge).
  bridge?: { api?: number; open?: boolean } | null;
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
type PhoneRun = { id: string; v: string; mark: string };
type PhoneCell = { id: string; v: string; a: string };
type PhoneNode = {
  id: string;
  t: string;
  v: string;
  lvl: number;
  lang: string;
  alt: string;
  w: number;
  h: number;
  items: PhoneItem[];
  runs: PhoneRun[];
  heads: PhoneCell[];
  grid: { id: string; cells: PhoneCell[] }[];
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

const mapAsk = (a: WireAsk | null | undefined) => {
  if (!a || typeof a !== 'object') return null;
  return {
    state: typeof a.state === 'string' ? a.state : '',
    answered: typeof a.answered === 'number' ? a.answered : 0,
    total: typeof a.total === 'number' ? a.total : 0,
    answerable: a.answerable === true,
    callId: typeof a.callId === 'string' ? a.callId : '',
    items: (Array.isArray(a.items) ? a.items : []).map((it, k) => ({
      id: typeof it.id === 'string' ? it.id : `i${k}`,
      header: typeof it.header === 'string' ? it.header : '',
      question: typeof it.question === 'string' ? it.question : '',
      answers: (Array.isArray(it.answers) ? it.answers : []).filter((v) => typeof v === 'string'),
      skipped: it.skipped === true,
    })),
  };
};

// The Mac's pending question / plan review. `countdown` is -1 for a question that carries no timed wait.
const mapQuestion = (q: WireQuestion) => ({
  id: String(q.id ?? ''),
  callId: typeof q.callId === 'string' ? q.callId : '',
  kind: q.kind === 'plan-review' ? 'plan-review' : 'question',
  state: q.state === 'continued' ? 'continued' : 'open',
  dismissal: q.dismissal === 'hide' ? 'hide' : 'cancel',
  countdown: typeof q.countdown === 'number' ? q.countdown : -1,
  running: q.running === true,
  held: q.held === true,
  items: (Array.isArray(q.questions) ? q.questions : []).map((it, k) => ({
    id: String(it.id ?? `q${k}`),
    header: typeof it.header === 'string' ? it.header : '',
    question: typeof it.question === 'string' ? it.question : '',
    detail: typeof it.detail === 'string' ? it.detail : '',
    multi: it.multiSelect === true,
    options: (Array.isArray(it.options) ? it.options : []).map((o, j) => ({
      id: String(o.id ?? `o${j}`),
      value: typeof o.label === 'string' ? o.label : '',
      text: typeof o.text === 'string' ? o.text : typeof o.label === 'string' ? o.label : '',
      description: typeof o.description === 'string' ? o.description : '',
      recommended: o.recommended === true,
    })),
  })),
  plan: q.plan && typeof q.plan === 'object'
    ? {
      title: typeof q.plan.title === 'string' ? q.plan.title : '',
      description: typeof q.plan.description === 'string' ? q.plan.description : '',
      nodes: mapNodes(q.plan.nodes),
      approve: typeof q.plan.approve === 'string' ? q.plan.approve : '',
      chars: typeof q.plan.chars === 'number' ? q.plan.chars : 0,
    }
    : null,
});

// One mapper for markdown nodes: transcript blocks and the plan-review card read the same wire form.
const mapRuns = (runs: WireRun[] | undefined): PhoneRun[] =>
  (Array.isArray(runs) ? runs : []).filter((r) => Array.isArray(r)).map((r, k) => ({ id: `r${k}`, v: typeof r[1] === 'string' ? r[1] : '', mark: typeof r[0] === 'string' ? r[0] : '' }));

// A table's cells arrive joined with U+001F (the bridge's separator), `align` one letter per column (l, c, r or -).
const CELL_SEP = '\u001f';
const cellsOf = (joined: string, align: string, prefix: string): PhoneCell[] =>
  joined.split(CELL_SEP).map((v, i) => ({ id: `${prefix}${i}`, v, a: align[i] === 'r' ? 'end' : align[i] === 'c' ? 'center' : 'start' }));

const mapNodes = (nodes: WireNode[] | undefined): PhoneNode[] =>
  groupImages((Array.isArray(nodes) ? nodes : []).map((n, j) => ({
    id: typeof n.id === 'string' ? n.id : `n${j}`,
    t: typeof n.t === 'string' ? n.t : 'p',
    v: typeof n.v === 'string' ? n.v : '',
    lvl: typeof n.lvl === 'number' ? n.lvl : 0,
    lang: typeof n.lang === 'string' ? n.lang : '',
    alt: typeof n.alt === 'string' ? n.alt : '',
    w: typeof n.w === 'number' ? n.w : 0,
    h: typeof n.h === 'number' ? n.h : 0,
    // A code block's coloured runs: [mark, text] pairs, numbered here.
    runs: mapRuns(n.runs),
    heads: n.t === 'table' && typeof n.head === 'string' ? cellsOf(n.head, typeof n.align === 'string' ? n.align : '', 'h') : [],
    grid: n.t === 'table'
      ? (Array.isArray(n.rows) ? n.rows : []).map((r, k) => ({ id: typeof r.id === 'string' ? r.id : `r${k}`, cells: cellsOf(typeof r.v === 'string' ? r.v : '', typeof n.align === 'string' ? n.align : '', 'c') }))
      : [],
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
  })));


/** One transcript or streaming block as this app maps it (ids default to a position when the bridge sends none). */
const mapBlock = (b: WireBlock, i: number) => ({
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
  // A settled reasoning block carries no summary: its preview is its first line (ReasoningRow); a streaming one brings its own.
  summary: typeof b.summary === 'string' ? b.summary : b.kind === 'reasoning' && typeof b.text === 'string' ? (b.text.split('\n')[0] ?? '').replaceAll('**', '').trim().slice(0, 160) : '',
  args: typeof b.args === 'string' ? b.args : '',
  lazy: b.lazy === true,
  badge: typeof b.badge === 'string' ? b.badge : '',
  todos: (Array.isArray(b.todos) ? b.todos : []).map((t, k) => ({
    id: typeof t.id === 'string' ? t.id : `t${k}`,
    text: typeof t.text === 'string' ? t.text : '',
    state: typeof t.state === 'string' ? t.state : 'pending',
    change: typeof t.change === 'string' ? t.change : '',
    label: typeof t.label === 'string' ? t.label : '',
    prev: typeof t.prev === 'string' ? t.prev : '',
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
  ask: mapAsk(b.ask),
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
  nodes: mapNodes(b.nodes),
  grp: typeof b.grp === 'string' ? b.grp : '',
  answer: b.answer === true,
  title: typeof b.title === 'string' ? b.title : '',
  suffix: typeof b.suffix === 'string' ? b.suffix : '',
  added: typeof b.added === 'number' ? b.added : 0,
  removed: typeof b.removed === 'number' ? b.removed : 0,
  view: mapToolView(undefined),
});

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
      // 'approval' | 'question' | 'plan-review' while something on that session waits for the person.
      attention: s.attention === 'approval' || s.attention === 'question' || s.attention === 'plan-review' ? s.attention : '',
      // The sidebar's dots: a completion nobody has read ('done') or one that failed; direct subagents running now.
      unread: s.unread === 'done' || s.unread === 'failed' ? s.unread : '',
      subs: typeof s.subs === 'number' ? s.subs : 0,
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
    runLabel: typeof session?.runLabel === 'string' ? session.runLabel : '',
    runActivity: session?.runActivity && typeof session.runActivity === 'object'
      ? { kind: typeof session.runActivity.kind === 'string' ? session.runActivity.kind : 'tool', label: typeof session.runActivity.label === 'string' ? session.runActivity.label : '', detail: typeof session.runActivity.detail === 'string' ? session.runActivity.detail : '' }
      : null,
    // ContextMeter parity: how much of the context window the session occupies.
    context: session?.context && typeof session.context === 'object'
      ? { used: Number(session.context.used ?? 0) || 0, total: Number(session.context.total ?? 0) || 0, system: Number(session.context.system ?? 0) || 0, tools: Number(session.context.tools ?? 0) || 0, messages: Number(session.context.messages ?? 0) || 0 }
      : null,
    // The newest billing/quota failure, for a one-shot toast (QuotaNoticeHost parity).
    quota: typeof session?.quota === 'string' ? session.quota : '',
    // One id per quota failure: the toast shows each once, whatever its (fixed) wording.
    quotaId: typeof session?.quotaId === 'string' ? session.quotaId : '',
    stats: (() => {
      const st = session?.stats
      const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : 0)
      return {
        turns: num(st?.turns),
        steps: num(st?.steps),
        inTok: num(st?.inTok),
        outTok: num(st?.outTok),
        cacheRead: num(st?.cacheRead),
        llmMs: num(st?.llmMs),
        toolMs: num(st?.toolMs),
        ttftMs: num(st?.ttftMs),
        ttftSteps: num(st?.ttftSteps),
        decodeMs: num(st?.decodeMs),
        decodeTokens: num(st?.decodeTokens),
      }
    })(),
    messages: (Array.isArray(session?.messages) ? session?.messages ?? [] : []).map((m) => ({
      id: String(m.id ?? ''),
      msgId: typeof m.msgId === 'string' ? m.msgId : '',
      role: String(m.role ?? 'assistant'),
      seq: typeof m.seq === 'number' ? m.seq : 0,
      // The turn this row belongs to (the turn rail maps its chips to the opening rows by it); -1 for a row of no turn.
      turn: typeof m.turn === 'number' ? m.turn : -1,
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
      // The turn's usage line and panel rows (bridge-worded; an assistant row's last row of the turn).
      usage: typeof m.usage === 'string' ? m.usage : '',
      usageRows: (Array.isArray(m.usageRows) ? m.usageRows : []).map((u, k) => ({
        id: typeof u.id === 'string' ? u.id : `u${k}`,
        label: typeof u.label === 'string' ? u.label : '',
        value: typeof u.value === 'string' ? u.value : '',
      })),
      title: typeof m.title === 'string' ? m.title : '',
      summary: typeof m.summary === 'string' ? m.summary : '',
      icon: typeof m.icon === 'string' ? m.icon : '',
      state: typeof m.state === 'string' ? m.state : '',
      failed: m.failed === true,
      active: m.active === true,
      steered: m.steered === true,
      foldAll: m.foldAll === true,
      foldFinal: m.foldFinal === true,
      changedCount: typeof m.changedCount === 'number' ? m.changedCount : 0,
      // The turn's changed files (the host's summary when it has one: `changesSeq`, and each file's index `i`; else the files its write-class tools touched).
      changesSeq: typeof m.changesSeq === 'number' ? m.changesSeq : 0,
      changedAdded: typeof m.changedAdded === 'number' ? m.changedAdded : 0,
      changedRemoved: typeof m.changedRemoved === 'number' ? m.changedRemoved : 0,
      changedFiles: (Array.isArray(m.changedFiles) ? m.changedFiles : []).map((f, k) => ({
        id: `cf${k}`,
        path: typeof f.path === 'string' ? f.path : '',
        name: typeof f.name === 'string' && f.name !== '' ? f.name : typeof f.path === 'string' ? f.path : '',
        added: typeof f.added === 'number' ? f.added : 0,
        removed: typeof f.removed === 'number' ? f.removed : 0,
        i: typeof f.i === 'number' ? f.i : -1,
        note: typeof f.note === 'string' ? f.note : '',
      })),
      day: typeof m.day === 'string' ? m.day : '',
      refs: (Array.isArray(m.refs) ? m.refs : []).map((r, k) => ({
        id: `rf${k}`,
        path: typeof r.path === 'string' ? r.path : '',
        // What the chip stands for: a skill the message loaded, a session it recalled, a file it names.
        text: typeof r.kind === 'string' ? r.kind : '',
      })),
      deliverables: (Array.isArray(m.deliverables) ? m.deliverables : []).map((f, k) => ({
        id: `dl${k}`,
        path: typeof f.path === 'string' ? f.path : '',
        text: typeof f.text === 'string' ? f.text : '',
      })),
      interrupted: m.interrupted === true,
      blocks: (Array.isArray(m.blocks) ? m.blocks : []).map(mapBlock),
      // The phone's own presentation of the row (derived in the contract from the Mac's settings): nothing folded until it says so.
      fold: false,
      grouped: false,
      liveGroup: '',
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
      args: typeof a.args === 'string' ? a.args : '',
      command: typeof a.command === 'string' ? a.command : '',
      subject: typeof a.subject === 'string' ? a.subject : '',
      detail: typeof a.detail === 'string' ? a.detail : '',
      approveLabel: typeof a.approveLabel === 'string' ? a.approveLabel : '',
      alwaysLabel: typeof a.alwaysLabel === 'string' ? a.alwaysLabel : '',
    })),
    goalId: typeof session?.goalId === 'string' ? session.goalId : '',
    pinned: session?.pinned === true,
    archived: session?.archived === true,
    goalPhase: typeof session?.goalPhase === 'string' ? session.goalPhase : '',
    // GoalBar's details: process-local activation (armed / disarmed), rounds started of the cap, the blocker's message.
    goalActivation: typeof session?.goalInfo?.activation === 'string' ? session.goalInfo.activation : '',
    goalRounds: typeof session?.goalInfo?.rounds === 'number' ? session.goalInfo.rounds : 0,
    goalMax: typeof session?.goalInfo?.max === 'number' ? session.goalInfo.max : 0,
    goalReason: typeof session?.goalInfo?.reason === 'string' ? session.goalInfo.reason : '',
    // The failed turn/end the 继续生成 button addresses (-1: none) and plan mode ('' where the Mac composes none).
    continueSeq: typeof session?.continueSeq === 'number' ? session.continueSeq : -1,
    planMode: typeof session?.planMode === 'string' ? session.planMode : '',
    // 'subagent' marks a child session; its mode says whether it can continue. Absent on an older bridge.
    origin: typeof session?.origin === 'string' ? session.origin : '',
    subagentMode: typeof session?.subagentMode === 'string' ? session.subagentMode : '',
    // The subagent tree (an older bridge sends id / label / sessionId only): what each is, what it does, its tokens and time, its depth.
    subagents: (Array.isArray(session?.subagents) ? session?.subagents ?? [] : []).map((a, i) => ({
      id: typeof a.id === 'string' ? a.id : `a${i}`,
      label: typeof a.label === 'string' ? a.label : '',
      sessionId: typeof a.sessionId === 'string' ? a.sessionId : '',
      sub: str(a.sub),
      mode: str(a.mode),
      modeCode: str(a.modeCode),
      activity: str(a.activity),
      state: str(a.state),
      meta: str(a.meta),
      depth: typeof a.depth === 'number' ? a.depth : 0,
    })),
    subagentProgress: str(session?.subagentProgress),
    parentId: str(session?.parentId),
    parentTitle: str(session?.parentTitle),
    agentLabel: str(session?.agentLabel),
    sessionCwd: typeof session?.cwd === 'string' ? session.cwd : '',
    bridgeApi: typeof body.bridge?.api === 'number' ? body.bridge.api : 0,
    bridgeOpen: body.bridge?.open === true,
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
      state: typeof j.state === 'string' && j.state !== '' ? j.state : typeof j.status === 'string' ? j.status : '',
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
      // What a queued message carries besides text, and whether it can be rewritten (text only: the host refuses an edit that drops them).
      images: (Array.isArray(q.images) ? q.images : []).map((im, k) => ({
        id: typeof im.id === 'string' ? im.id : `qi${k}`,
        att: typeof im.att === 'string' ? im.att : '',
        media: typeof im.media === 'string' ? im.media : '',
        w: typeof im.w === 'number' ? im.w : 0,
        h: typeof im.h === 'number' ? im.h : 0,
        text: typeof im.text === 'string' ? im.text : '',
      })),
      files: (Array.isArray(q.files) ? q.files : []).map((f, k) => ({ id: typeof f.id === 'string' ? f.id : `qf${k}`, path: str(f.path), text: str(f.text) })),
      editable: q.editable !== false,
    })),
    question: session?.question && typeof session.question === 'object'
      ? mapQuestion(session.question)
      : null,
    // The attempt streaming right now: blocks that continue the open turn's groups (reasoning, Markdown nodes, tool calls).
    streamBlocks: (Array.isArray(streaming?.blocks) ? streaming.blocks : []).map(mapBlock),
    // The Mac's work-details settings (the official defaults when the bridge names none), for the contract's presentation policy.
    prefs: {
      transcriptView: typeof body.prefs?.transcriptView === 'string' ? body.prefs.transcriptView : '',
      collapseTiming: typeof body.prefs?.collapseTiming === 'string' ? body.prefs.collapseTiming : '',
      foldedReplies: typeof body.prefs?.foldedReplies === 'string' ? body.prefs.foldedReplies : '',
      performanceUsage: typeof body.prefs?.performanceUsage === 'string' ? body.prefs.performanceUsage : '',
      busyEnter: typeof body.prefs?.busyEnter === 'string' ? body.prefs.busyEnter : '',
    },
    // What the composer may attach (an older bridge names none: pictures only, the host's default count).
    limits: {
      images: typeof body.limits?.images === 'number' && body.limits.images > 0 ? body.limits.images : 20,
      files: body.limits?.files === true,
      fileBytes: typeof body.limits?.fileBytes === 'number' ? body.limits.fileBytes : 0,
    },
    // Only /v1/transcript lists the turns (loadRows fills it in).
    turns: [],
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
// these cover that shape (and the id-carrying fork/create/rename family).
const postData = async (server: string, token: string, path: string, body: unknown = {}, method: string = 'POST', exactTimeout: number = timeout): Promise<{ ok: boolean; error: string; data: Record<string, unknown> }> => {
  try {
    const res = await call(server, token, path, { method, body: JSON.stringify(body ?? {}), exactTimeout } as RequestInit);
    if (!res.ok) return { ok: false, error: await reason(res), data: {} };
    return { ok: true, error: '', data: (await res.json().catch(() => ({}))) as Record<string, unknown> };
  } catch {
    return { ok: false, error: 'Can’t reach the Mac.', data: {} };
  }
};
// A Reply mutation's answer is exactly {ok, error}: Exact refuses an extra field and then never runs its `then`.
const post = async (server: string, token: string, path: string, body: unknown = {}, method: string = 'POST', exactTimeout: number = timeout): Promise<{ ok: boolean; error: string }> => {
  const { ok, error } = await postData(server, token, path, body, method, exactTimeout);
  return { ok, error };
};
// A decision on a pending approval / question is acked by the Mac's own UI first (the bridge waits up to 8 s),
// so these calls outwait that and the phone hears "undelivered" instead of a timeout.
const decisionTimeout = 15000;
const postId = async (server: string, token: string, path: string, body: unknown = {}, method: string = 'POST'): Promise<{ id: string; error: string }> => {
  const r = await postData(server, token, path, body, method);
  return { id: r.ok ? String(r.data.id ?? r.data.title ?? '') : '', error: r.ok ? '' : r.error };
};

// The card a tool row opens, as GET /v1/sessions/:id/call words it in the phone's language.
type WireLine = { id?: string; n?: number; sign?: string; text?: string; runs?: WireRun[] };
type WireToolItem = { id?: string; title?: string; subtitle?: string; badge?: string; tone?: string; text?: string; link?: string; group?: string; md?: boolean; fields?: { id?: string; label?: string; value?: string }[]; lines?: WireLine[] };
type WireToolPart = { id?: string; kind?: string; label?: string; badge?: string; tone?: string; text?: string; link?: string; md?: boolean; fold?: number; lines?: WireLine[]; items?: WireToolItem[] };
type WireToolView = { kind?: string; head?: string; tone?: string; more?: number; parts?: WireToolPart[] };
const str = (v: unknown): string => (typeof v === 'string' ? v : '');
const mapLines = (lines: WireLine[] | undefined, prefix = 'l') => (Array.isArray(lines) ? lines : []).map((l, i) => ({
  id: typeof l.id === 'string' ? l.id : `${prefix}${i}`,
  n: typeof l.n === 'number' ? l.n : 0,
  sign: typeof l.sign === 'string' ? l.sign : ' ',
  text: str(l.text),
  runs: mapRuns(l.runs),
}));
const mapToolView = (v: WireToolView | undefined) => ({
  kind: str(v?.kind),
  head: str(v?.head),
  tone: str(v?.tone),
  more: typeof v?.more === 'number' ? v.more : 0,
  parts: (Array.isArray(v?.parts) ? v.parts : []).map((p, i) => ({
    id: typeof p.id === 'string' ? p.id : `p${i}`,
    kind: str(p.kind),
    label: str(p.label),
    badge: str(p.badge),
    tone: str(p.tone),
    text: str(p.text),
    link: str(p.link),
    md: p.md === true,
    fold: typeof p.fold === 'number' && p.fold > 0 ? p.fold : 40,
    lines: mapLines(p.lines),
    items: (Array.isArray(p.items) ? p.items : []).map((it, k) => ({
      id: typeof it.id === 'string' ? it.id : `i${k}`,
      title: str(it.title),
      subtitle: str(it.subtitle),
      badge: str(it.badge),
      tone: str(it.tone),
      text: str(it.text),
      link: str(it.link),
      group: str(it.group),
      md: it.md === true,
      fields: (Array.isArray(it.fields) ? it.fields : []).map((f, j) => ({ id: typeof f.id === 'string' ? f.id : `f${j}`, label: str(f.label), value: str(f.value) })),
      lines: mapLines(it.lines),
    })),
  })),
});

const sources: Sources = {
  loadCall: async ([server, token, sid, callId, lang]): Promise<Result<'loadCall'>> => {
    const empty = { callId: String(callId), name: '', title: '', args: '', result: '', view: mapToolView(undefined) };
    const res = await fetch(`${server}/v1/sessions/${sid}/call?callId=${encodeURIComponent(String(callId))}&lang=${encodeURIComponent(String(lang ?? ''))}&t=${token}`, { exactTimeout: 15000 })
    if (!res.ok) return empty
    const body = (await res.json()) as { name?: string; title?: string; args?: string; result?: string; view?: WireToolView }
    return { callId: String(callId), name: String(body.name ?? ''), title: String(body.title ?? ''), args: String(body.args ?? ''), result: String(body.result ?? ''), view: mapToolView(body.view) }
  },
  // The small poll: everything except the transcript rows (the bridge strips them).
  loadLive: async ([server, token, selected, listRev, showArchived, lang]): Promise<Result<'loadLive'>> => {
    const parts = [] as string[]
    if (selected != '') parts.push(`session=${encodeURIComponent(selected as string)}`)
    if (typeof listRev === 'string' && listRev != '') parts.push(`listRev=${encodeURIComponent(listRev)}`);
    if (showArchived === true) parts.push('archived=show')
    // The language the bridge words its own rows in (zh-Hans or en: the app's effective locale).
    if (typeof lang === 'string' && lang != '') parts.push(`lang=${encodeURIComponent(lang)}`)
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
  loadRows: async ([server, token, selected, take, rev, lang]): Promise<Result<'loadRows'>> => {
    const size = typeof take === 'number' ? take : 8;
    const key = `${server}|${selected}|${lang}`;
    // The rev's tail (`<projection version>:<lang>`) says HOW the bridge projected the rows: when the server
    // changes that (same seqs, better content) or the person switches language, cached rows are
    // stale even though no seq moved — only an incremental patch would never fix them.
    const proj = String(rev ?? '').split(':').slice(2).join(':');
    const cacheOk = tCache.key === key && tCache.take === size && tCache.seq > 0 && tCache.proj === proj;
    const query = `?session=${encodeURIComponent(selected as string)}&take=${size}${typeof lang === 'string' && lang != '' ? `&lang=${encodeURIComponent(lang)}` : ''}${cacheOk ? `&since=${tCache.seq}` : ''}`;
    const res = await call(server as string, token as string, `/v1/transcript${query}`, { exactTimeout: 30000 });
    if (res.status === 401) throw new Error('unauthorized');
    if (!res.ok) throw new Error(await reason(res));
    const body = (await res.json()) as { rows?: unknown[]; ids?: unknown[]; seq?: unknown; hasMore?: boolean; rowsRev?: string; turns?: unknown[] };
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
    // Every turn number of the session (the turn rail), whole in a patch too.
    const turns = (Array.isArray(body.turns) ? body.turns : []).filter((n): n is number => typeof n === 'number' && Number.isFinite(n));
    return { rev: String(body.rowsRev ?? ''), hasMore: mapped.hasMore, turns, rows: mapped.messages };
  },

  // Several pictures and files from one pick, uploaded in turn: a picture is compressed first (long side 1600px, at most 1.5 MB: a phone photo is
  // usually 3–6 MB), a file streams as it is. Each answers its own row; the first failure's words ride along without dropping the ones that made it.
  uploadFiles: async ([server, token, sid, lines, lang], _store, storage): Promise<Result<'uploadFiles'>> => {
    const items: { id: string; name: string; kind: string; sid: string; bytes: number }[] = [];
    let error = '';
    for (const line of String(lines).split('\n')) {
      const [from = '', name = 'file', type = ''] = line.split('\t');
      if (from === '') continue;
      try {
        const picture = type.startsWith('image/');
        const out = picture ? await storage.fs.compressImage(from, 'app:/tmp/dshm-upload.jpg', { maxDimension: 1600, maxBytes: 1_500_000 }) : null;
        const query = out === null
          ? `kind=file&session=${encodeURIComponent(String(sid))}&name=${encodeURIComponent(name)}`
          : `name=${encodeURIComponent(name)}&media=${encodeURIComponent(out.type)}`;
        const res = await fetch(`${server}/v1/attach?${query}&lang=${encodeURIComponent(String(lang ?? ''))}`, {
          method: 'POST',
          exactTimeout: 120000,
          headers: { authorization: `Bearer ${token}`, 'content-type': out === null ? 'application/octet-stream' : out.type },
          exactBodyFrom: out === null ? from : out.path,
        });
        const body = (await res.json().catch(() => ({}))) as { id?: unknown; bytes?: unknown; error?: unknown };
        if (!res.ok || typeof body.id !== 'string') {
          if (error === '') error = typeof body.error === 'string' ? body.error : `The Mac answered ${res.status}.`;
          continue;
        }
        items.push({ id: body.id, name, kind: picture ? 'image' : 'file', sid: String(sid), bytes: typeof body.bytes === 'number' ? body.bytes : 0 });
      } catch (e) {
        if (error === '') error = String((e as Error)?.message ?? e);
      }
    }
    return { ok: error === '', error, items };
  },

  // `images` / `files` are the comma-joined ids of what the bridge holds for this message (see uploadFiles).
  sendPrompt: async ([server, token, selected, text, steer, images, files, mentions, lang]): Promise<Result<'sendPrompt'>> => {
    const ids = (v: unknown) => String(v ?? '').split(',').filter((x) => x !== '');
    try {
      const res = await call(server as string, token as string, `/v1/sessions/${encodeURIComponent(selected as string)}/prompt?lang=${encodeURIComponent(String(lang ?? ''))}`, {
        method: 'POST',
        body: JSON.stringify({ text: withMentions(String(text), String(mentions)), mode: steer ? 'steer' : 'queue', images: ids(images), files: ids(files) }),
      });
      return res.ok ? { ok: true, error: '' } : { ok: false, error: await reason(res) };
    } catch (e) {
      if ((e as { code?: string }).code === 'bake') throw e;
      return { ok: false, error: 'Can’t reach the Mac. Check the tunnel and the server address.' };
    }
  },

  // 继续生成 (InputBar's retry): the prompt with no content that a continuable failure takes, queued; `failureSeq` is the failed turn/end the
  // button was showing, so a button gone stale (the session moved on) is refused instead of resuming something else.
  continueGeneration: async ([server, token, selected, failureSeq, lang]): Promise<Result<'continueGeneration'>> =>
    post(server as string, token as string, `/v1/sessions/${encodeURIComponent(selected as string)}/prompt?lang=${encodeURIComponent(String(lang ?? ''))}`, { text: '', mode: 'queue', continue: true, failureSeq: Number(failureSeq) }),

  // The @ menu: files and folders, this session's subagents, other sessions, as the bridge ranks and words them for the query being typed.
  loadRefs: async ([server, token, selected, query, quoted, lang]): Promise<Result<'loadRefs'>> => {
    try {
      const res = await call(server as string, token as string, `/v1/sessions/${encodeURIComponent(selected as string)}/refs?q=${encodeURIComponent(String(query))}&quoted=${quoted === true ? 1 : 0}&lang=${encodeURIComponent(String(lang ?? ''))}`);
      if (!res.ok) return { items: [] };
      const body = (await res.json()) as { items?: { id?: string; kind?: string; name?: string; detail?: string; text?: string; done?: string; wire?: string; section?: string; first?: boolean }[] };
      return {
        items: (body.items ?? []).map((r, i) => ({
          id: typeof r.id === 'string' ? r.id : `r${i}`,
          kind: str(r.kind),
          name: str(r.name),
          detail: str(r.detail),
          text: str(r.text),
          done: str(r.done),
          wire: str(r.wire),
          section: str(r.section),
          first: r.first === true,
        })),
      };
    } catch {
      return { items: [] };
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
          const when = at <= 0 ? '' : new Date(at).toLocaleDateString();
          return {
            id: String(d.id ?? ''),
            name: String(d.name ?? 'device'),
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

  // pause / resume / clear, or edit with the new objective (GoalBar's inline editor).
  setGoalAction: async ([server, token, sid, action, objective]): Promise<Result<'setGoalAction'>> =>
    post(server as string, token as string, `/v1/sessions/${encodeURIComponent(String(sid))}/goal`, { action, ...(typeof objective === 'string' && objective !== '' ? { objective } : {}) }),

  // The question card's one submit (QuestionComposer parity): every question of the request in one answer.
  // `payload` is one `id|label,label|custom` record per question, each field percent-encoded, `;`-joined; a
  // skipped question has no labels and no custom text, which is the desktop's own encoding of a skip.
  answerQuestions: async ([server, token, id, payload]): Promise<Result<'answerQuestions'>> => {
    const dec = (v: string | undefined) => { try { return decodeURIComponent(v ?? ''); } catch { return v ?? ''; } };
    const answers = String(payload ?? '').split(';').filter((rec) => rec.includes('|')).map((rec) => {
      const [qid, picks, custom] = rec.split('|');
      const answer: { id: string; selected: string[]; custom?: string } = {
        id: dec(qid),
        selected: String(picks ?? '').split(',').filter((v) => v !== '').map(dec),
      };
      const text = dec(custom);
      if (text.trim() !== '') answer.custom = text;
      return answer;
    });
    return post(server as string, token as string, `/v1/questions/${encodeURIComponent(String(id))}/answer`, { answers }, 'POST', decisionTimeout);
  },

  // Close the card: a blocking question or a plan review is cancelled (要求修改); a timed one only collapses.
  dismissQuestion: async ([server, token, id]): Promise<Result<'dismissQuestion'>> =>
    post(server as string, token as string, `/v1/questions/${encodeURIComponent(String(id))}/dismiss`, {}, 'POST', decisionTimeout),

  // 慢慢回答 ('take') and the first edit ('engage') both stop the Mac's countdown.
  holdQuestion: async ([server, token, id, mode]): Promise<Result<'holdQuestion'>> =>
    post(server as string, token as string, `/v1/questions/${encodeURIComponent(String(id))}/hold`, { mode }, 'POST', decisionTimeout),

  // A tool row's 回答: put a collapsed question back on screen.
  revealQuestion: async ([server, token, sid, callId]): Promise<Result<'revealQuestion'>> =>
    post(server as string, token as string, `/v1/sessions/${encodeURIComponent(String(sid))}/questions/${encodeURIComponent(String(callId))}/reveal`, {}, 'POST', decisionTimeout),

  // Message feedback (ui-message-feedback parity): this session's ratings (loaded when it opens and after every change), a rating with its
  // category and note (a message that already has one is replaced: the bridge reads the item's current version), and the retraction.
  // A refusal is the host's stable code (version-conflict, note-too-large, target-not-found…); the view words it.
  loadFeedback: async ([server, token, id]): Promise<Result<'loadFeedback'>> => {
    try {
      const res = await call(server as string, token as string, `/v1/sessions/${encodeURIComponent(String(id))}/feedback`);
      if (!res.ok) return { items: [] };
      const body = (await res.json()) as { items?: { messageId?: string; rating?: string; note?: string; category?: string; version?: string }[] };
      return {
        items: (body.items ?? []).map((it, k) => ({
          id: `fb${k}`,
          messageId: str(it.messageId),
          rating: it.rating === 'negative' ? 'negative' : 'positive',
          note: str(it.note),
          category: str(it.category),
          version: str(it.version),
        })),
      };
    } catch {
      return { items: [] };
    }
  },

  rateMessage: async ([server, token, id, msgId, rating, note, category]): Promise<Result<'rateMessage'>> => {
    const path = `/v1/sessions/${encodeURIComponent(String(id))}/feedback`;
    try {
      const payload: Record<string, unknown> = { id: String(msgId), rating: rating === 'negative' ? 'negative' : 'positive' };
      if (typeof note === 'string' && note.trim() !== '') payload.note = note.trim();
      if (typeof category === 'string' && category !== '') payload.category = category;
      const res = await call(server as string, token as string, path, { method: 'POST', body: JSON.stringify(payload) });
      if (res.ok) return { ok: true, error: '' };
      return { ok: false, error: await reason(res) };
    } catch {
      return { ok: false, error: 'unreachable' };
    }
  },

  clearRating: async ([server, token, id, msgId]): Promise<Result<'clearRating'>> =>
    post(server as string, token as string, `/v1/sessions/${encodeURIComponent(String(id))}/feedback/clear`, { id: String(msgId) }),

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

  // Scheduled tasks (ui-schedule's task manager): rows in the manager's words, with the timing as plain editor fields (no JSON).
  loadSchedules: async ([server, token, lang]): Promise<Result<'loadSchedules'>> => {
    const empty = { items: [] as Result<'loadSchedules'>['items'], zone: '', tomorrow: '' };
    try {
      const res = await call(server as string, token as string, `/v1/schedules?lang=${encodeURIComponent(String(lang ?? ''))}`);
      if (!res.ok) return empty;
      const body = (await res.json()) as { zone?: string; tomorrow?: string; items?: { id?: string; title?: string; prompt?: string; status?: string; state?: string; kind?: string; timing?: string; next?: string; running?: boolean; overdue?: boolean; nextAt?: string | null; updatedAt?: string | null; targetSessionId?: string | null; mode?: string; date?: string; time?: string; zone?: string; interval?: number; unit?: string; days?: string }[] };
      return {
        zone: str(body.zone),
        tomorrow: str(body.tomorrow),
        items: (body.items ?? []).map((t, k) => ({
          id: `st${k}-${String(t.id ?? '')}`,
          tid: String(t.id ?? ''),
          title: str(t.title),
          prompt: str(t.prompt),
          status: String(t.status ?? 'active'),
          state: str(t.state),
          kind: str(t.kind),
          timing: str(t.timing),
          next: str(t.next),
          running: t.running === true,
          overdue: t.overdue === true,
          nextAt: str(t.nextAt),
          updatedAt: str(t.updatedAt),
          targetSessionId: str(t.targetSessionId),
          mode: str(t.mode) || 'custom',
          date: str(t.date),
          time: str(t.time),
          zone: str(t.zone),
          interval: typeof t.interval === 'number' && t.interval >= 1 ? t.interval : 1,
          unit: t.unit === 'hours' ? 'hours' : 'minutes',
          days: str(t.days),
        })),
      };
    } catch {
      return empty;
    }
  },

  // Create (id '') or edit one task: title, prompt and, when `mode` names one (once, every, daily, weekly), its timing; `custom` leaves the
  // stored rule alone. A refusal is the host's stable code (invalid_rule, invalid_time_zone, not_future, schedule_conflict…); the view words it.
  saveSchedule: async ([server, token, id, updatedAt, title, prompt, mode, date, time, zone, interval, unit, days]): Promise<Result<'saveSchedule'>> => {
    const body: Record<string, unknown> = { title: String(title), prompt: String(prompt) };
    if (String(mode) !== 'custom') body.when = { mode: String(mode), date: String(date), time: String(time), zone: String(zone), interval: Number(interval), unit: String(unit), days: String(days) };
    if (String(id) === '') return post(server as string, token as string, `/v1/schedules`, body);
    if (typeof updatedAt === 'string' && updatedAt !== '') body.updatedAt = updatedAt;
    return post(server as string, token as string, `/v1/schedules/${encodeURIComponent(String(id))}/edit`, body);
  },

  // Pause (active false) or resume (true) a task.
  toggleSchedule: async ([server, token, id, updatedAt, active]): Promise<Result<'toggleSchedule'>> =>
    post(server as string, token as string, `/v1/schedules/${encodeURIComponent(String(id))}/edit`, { active: active === true, ...(typeof updatedAt === 'string' && updatedAt !== '' ? { updatedAt } : {}) }),

  deleteSchedule: async ([server, token, id, updatedAt]): Promise<Result<'deleteSchedule'>> => {
    const body: Record<string, unknown> = {};
    if (typeof updatedAt === 'string' && updatedAt !== '') body.updatedAt = updatedAt;
    return post(server as string, token as string, `/v1/schedules/${encodeURIComponent(String(id))}/delete`, body);
  },

  runSchedule: async ([server, token, id]): Promise<Result<'runSchedule'>> =>
    post(server as string, token as string, `/v1/schedules/${encodeURIComponent(String(id))}/run`),

  // One file's changes in one turn (the host's own comparison when the turn has a summary, else the turn's tool diffs).
  loadChanges: async ([server, token, sid, seq, idx, turn, path, lang]): Promise<Result<'loadChanges'>> => {
    const empty = { ok: false, kind: 'missing', name: '', added: 0, removed: 0, created: false, deleted: false, coarse: false, cut: false, lines: [] as Result<'loadChanges'>['lines'] };
    try {
      const res = await call(server as string, token as string, `/v1/sessions/${encodeURIComponent(String(sid))}/changes?seq=${Number(seq)}&i=${Number(idx)}&turn=${Number(turn)}&path=${encodeURIComponent(String(path))}&lang=${encodeURIComponent(String(lang ?? ''))}`, { exactTimeout: 20000 });
      if (!res.ok) return empty;
      const body = (await res.json()) as { kind?: string; name?: string; added?: number; removed?: number; created?: boolean; deleted?: boolean; coarse?: boolean; cut?: boolean; lines?: WireLine[] };
      return {
        ok: true,
        kind: str(body.kind) || 'text',
        name: str(body.name),
        added: typeof body.added === 'number' ? body.added : 0,
        removed: typeof body.removed === 'number' ? body.removed : 0,
        created: body.created === true,
        deleted: body.deleted === true,
        coarse: body.coarse === true,
        cut: body.cut === true,
        lines: mapLines(body.lines),
      };
    } catch {
      return empty;
    }
  },

  // Open a workspace file or folder on the Mac itself (action 'open': its default application; 'reveal': show it in Finder).
  openOnMac: async ([server, token, sid, p, action, lang]): Promise<Result<'openOnMac'>> =>
    post(server as string, token as string, `/v1/sessions/${encodeURIComponent(String(sid))}/open?lang=${encodeURIComponent(String(lang ?? ''))}`, { path: String(p), action: action === 'reveal' ? 'reveal' : 'open' }),

  // A background job's output tail (`tick` only makes the resource ask again).
  loadJobOutput: async ([server, token, sid, jobId, _tick]): Promise<Result<'loadJobOutput'>> => {
    try {
      const res = await call(server as string, token as string, `/v1/sessions/${encodeURIComponent(String(sid))}/job?jobId=${encodeURIComponent(String(jobId))}`);
      if (!res.ok) return { ok: false, text: '', more: false, status: '' };
      const body = (await res.json()) as { text?: string; more?: boolean; status?: string };
      return { ok: true, text: str(body.text), more: body.more === true, status: str(body.status) };
    } catch {
      return { ok: false, text: '', more: false, status: '' };
    }
  },

  dropQueued: async ([server, token, sid, itemId]): Promise<Result<'dropQueued'>> =>
    post(server as string, token as string, `/v1/sessions/${encodeURIComponent(String(sid))}/queue/${encodeURIComponent(String(itemId))}/remove`),

  // kind 'edit' rewrites the queued text in place; 'steer' injects it into the
  // running turn immediately (DSH QueueDock's paper-plane).
  queueItem: async ([server, token, sid, itemId, kind, text]): Promise<Result<'queueItem'>> =>
    post(server as string, token as string, `/v1/sessions/${encodeURIComponent(String(sid))}/queue/${encodeURIComponent(String(itemId))}/${kind}`, kind === 'edit' ? { text } : {}),

  loadCommands: async ([server, token, selected]): Promise<Result<'loadCommands'>> => {
    try {
      const res = await call(server as string, token as string, `/v1/sessions/${encodeURIComponent(selected as string)}/commands`);
      if (!res.ok) return { commands: [], skills: [] };
      const body = (await res.json()) as { commands?: { name?: string; description?: string; hint?: string }[]; skills?: { name?: string; description?: string; userOnly?: boolean }[] };
      return {
        commands: (body.commands ?? []).map((c) => ({
          name: String(c.name ?? ''),
          description: String(c.description ?? ''),
          hint: String(c.hint ?? ''),
        })),
        // Listed after the commands; picking one lands the plain `/name ` the host's skill pre-step recognizes.
        skills: (body.skills ?? []).map((k) => ({ name: String(k.name ?? ''), description: String(k.description ?? ''), userOnly: k.userOnly === true })),
      };
    } catch {
      return { commands: [], skills: [] };
    }
  },

  runSessionCommand: async ([server, token, selected, name, input]): Promise<Result<'runSessionCommand'>> => {
    const r = await postData(server as string, token as string, `/v1/sessions/${encodeURIComponent(selected as string)}/command`, { name, input });
    // The command's receipt text rides in `error`.
    return { ok: r.ok, error: r.ok ? String(r.data.message ?? '') : r.error };
  },

  // A tool approval is allow-once or deny; `always` only exists on a question-intent approval that offers it.
  respondApproval: async ([server, token, id, which]): Promise<Result<'respondApproval'>> =>
    post(server as string, token as string, `/v1/approvals/${encodeURIComponent(String(id))}`, { decision: which === 'allow' || which === 'always' ? which : 'deny' }, 'POST', decisionTimeout),

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
          body: JSON.stringify({ code, name: 'dsh-remote phone' }),
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
        body: JSON.stringify({ code, name: 'dsh-remote phone' }),
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
