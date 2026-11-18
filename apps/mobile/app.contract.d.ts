// @generated from Contract source signatures; do not edit.
// Static types do not replace runtime shape, identity, or grant checks.
//
// What app.ts writes, in brief (the declarations follow): `sources: TypeScriptSources` has one
// function per source, given its arguments as an array (then store, storage, native) and
// answering its shape, or a Promise of it.
//   answerQuestion: (args: [string, string, string, string, string]) => Reply
//   answerQuestions: (args: [string, string, string, string]) => Reply
//   cancelRun: (args: [string, string, string]) => Reply
//   createSchedule: (args: [string, string, string, string, string]) => Reply
//   createSession: (args: [string, string, string]) => Created
//   deleteSchedule: (args: [string, string, string, string]) => Reply
//   dropQueued: (args: [string, string, string, string]) => Reply
//   editSchedule: (args: [string, string, string, string]) => Reply
//   forkFrom: (args: [string, string, string, number]) => Created
//   forkSession: (args: [string, string, string]) => Created
//   killJob: (args: [string, string, string, string]) => Reply
//   loadCall: (args: [string, string, string, string]) => CallDetail
//   loadCommands: (args: [string, string, string]) => CommandsReply
//   loadDevices: (args: [string, string]) => DevicesReply
//   loadFile: (args: [string, string, string, string]) => FileDoc
//   loadLive: (args: [string, string, string, string, boolean]) => Snapshot
//   loadModels: (args: [string, string, string]) => ModelsReply
//   loadRows: (args: [string, string, string, number, string]) => Rows
//   loadSchedules: (args: [string, string]) => SchedulesReply
//   pairDevice: (args: [string, string]) => PairReply
//   pairFromLink: (args: [string]) => PairLink
//   queueItem: (args: [string, string, string, string, string, string]) => Reply
//   rateMessage: (args: [string, string, string, string, string, string]) => Reply
//   renameSession: (args: [string, string, string, string]) => Created
//   respondApproval: (args: [string, string, string, boolean, boolean]) => Reply
//   revokeDevice: (args: [string, string, string]) => Reply
//   runSchedule: (args: [string, string, string]) => Reply
//   runSessionCommand: (args: [string, string, string, string, string]) => Reply
//   sendPrompt: (args: [string, string, string, string, boolean, string]) => Reply
//   setGoalAction: (args: [string, string, string, string]) => Reply
//   setModel: (args: [string, string, string, string, string, string]) => Reply
//   setPermission: (args: [string, string, string, string]) => Reply
//   setSessionFlag: (args: [string, string, string, string, boolean]) => Reply
//   skipQuestion: (args: [string, string, string]) => Reply
//   uploadPhoto: (args: [string, string, string, string]) => UploadReply
// The shapes. None is exported: name one by its source, `type Reply = Result<'answerQuestion'>`.
//   OptionRow = { value: string; name: string; description: string }
//   SessionRow = { id: string; pinned: boolean; title: string; running: boolean; cwd: string; updatedAt: number; group: string; first: boolean; when: string; archived: boolean }
//   MdItem = { id: string; v: string; sign: string; mark: string; d: number; alt: string; w: number; h: number; dw: number; dh: number }
//   MdNode = { id: string; t: string; v: string; lvl: number; lang: string; alt: string; w: number; h: number; head: string; items: MdItem[]; rows: MdItem[] }
//   DiffLine = { id: string; sign: string; text: string }
//   DiffFile = { id: string; path: string; added: number; removed: number; lines: DiffLine[] }
//   TodoItem = { id: string; text: string; state: string; change: string }
//   ChoiceItem = { id: string; text: string; description: string }
//   ImageRow = { id: string; att: string; media: string; w: number; h: number; text: string }
//   FileRow = { id: string; path: string; text: string }
//   BlockRow = { id: string; kind: string; text: string; detail: string; status: string; result: string; nodes: MdNode[]; callId: string; child: string; icon: string; summary: string; args: string; lazy: boolean; badge: string; todoSummary: string; diffs: DiffFile[]; diffHidden: number; todos: TodoItem[]; files: FileRow[]; question: string; options: ChoiceItem[]; att: string; media: string; w: number; h: number; images: ImageRow[] }
//   UsageTokens = { in: number; out: number; cacheRead: number; reasoning: number | null }
//   MessageRow = { id: string; role: string; seq: number; msgId: string; text: string; plain: string; usage: string; tools: number; running: number; thought: boolean; failed: boolean; thoughtPreview: string; changedCount: number; day: string; deliverables: FileRow[]; refs: FileRow[]; usageTokens: UsageTokens | null; interrupted: boolean; took: number; folded: number; shadow: number; blocks: BlockRow[] }
//   ModelRow = { id: string; name: string; provider: string; current: boolean; efforts: string[] }
//   ModelsReply = { currentModel: string; currentProvider: string; currentEffort: string; models: ModelRow[] }
//   DeviceRow = { id: string; name: string; when: string; mine: boolean }
//   DevicesReply = { devices: DeviceRow[] }
//   CommandRow = { name: string; description: string; hint: string }
//   CommandsReply = { commands: CommandRow[] }
//   ApprovalRow = { id: string; toolName: string; reason: string; summary: string; args: string; command: string; plan: string; expiresIn: number }
//   WalletRow = { id: string; currency: string; text: string }
//   BalanceView = { signedOut: boolean; failed: boolean; wallets: WalletRow[]; bonus: WalletRow[] }
//   ActivityRow = { label: string; detail: string }
//   StatsRow = { turns: number; steps: number; inTok: number; outTok: number; cacheRead: number }
//   SubagentRow = { id: string; label: string; sessionId: string }
//   JobRow = { id: string; kind: string; label: string; status: string; progress: string; detail: string; when: string }
//   TodoRow = { id: string; text: string; state: string }
//   TaskRow = { id: string; title: string; prompt: string; status: string; kind: string; timing: string; nextAt: string; updatedAt: string; targetSessionId: string }
//   TeamRow = { id: string; taskId: string; subject: string; status: string; owner: string }
//   FileDoc = { ok: boolean; kind: string; media: string; name: string; bytes: number; text: string; url: string }
//   SchedulesReply = { items: TaskRow[] }
//   QueueRow = { id: string; text: string }
//   QuestionItem = { id: string; header: string; question: string; detail: string; multi: boolean; options: ChoiceItem[] }
//   QuestionRow = { id: string; callId: string; hint: string; ask: string; detail: string; qid: string; multi: boolean; kind: string; options: ChoiceItem[]; items: QuestionItem[]; expiresIn: number }
//   PlanStep = { id: string; text: string; state: string }
//   PlanCard = { title: string; steps: PlanStep[] }
//   ContextRow = { used: number; total: number }
//   Snapshot = { listRev: string; rowsRev: string; hasMore: boolean; plan: PlanCard; goal: string; goalId: string; pinned: boolean; archived: boolean; goalPhase: string; sessions: SessionRow[]; sessionTitle: string; sessionModel: string; sessionPermission: string; permissionOptions: OptionRow[]; running: boolean; inherited: boolean; runLabel: string; runActivity: ActivityRow | null; stats: StatsRow; messages: MessageRow[]; approvals: ApprovalRow[]; queue: QueueRow[]; todos: TodoRow[]; jobs: JobRow[]; subagents: SubagentRow[]; team: TeamRow[]; question: QuestionRow | null; streamText: string; streamReasoning: string; streamTools: BlockRow[]; balance: BalanceView | null; context: ContextRow | null; quota: string }
//   Rows = { rev: string; hasMore: boolean; rows: MessageRow[] }
//   CallDetail = { callId: string; name: string; args: string; result: string }
//   Reply = { ok: boolean; error: string }
//   UploadReply = { ok: boolean; id: string; name: string; error: string }
//   PairReply = { ok: boolean; token: string; error: string }
//   Created = { id: string; error: string }
//   PairLink = { ok: boolean; server: string; token: string; alt: string; error: string }

/** Storage capabilities supplied by the host. Import these types; there are
 * no ambient fs/sqlite globals and importing a type conveys no authority. */
export interface Storage {
  readonly fs: FileSystem;
  readonly sqlite: SQLite;
}

export interface FileSystem {
  readonly directories: {
    readonly data: "app:/data";
    readonly cache: "app:/cache";
    readonly temporary: "app:/tmp";
  };
  readFile(path: string): Promise<ArrayBuffer>;
  writeFile(path: string, data: ArrayBuffer | Uint8Array, options?: WriteOptions): Promise<void>;
  /** Atomic replacement visibility; not a power-loss durability guarantee. */
  atomicWriteFile(path: string, data: ArrayBuffer | Uint8Array, options?: WriteOptions): Promise<void>;
  appendFile(path: string, data: ArrayBuffer | Uint8Array, options?: WriteOptions): Promise<void>;
  readdir(path: string): Promise<string[]>;
  mkdir(path: string): Promise<void>;
  rm(path: string): Promise<void>;
  stat(path: string): Promise<FileStat>;
  rename(from: string, to: string): Promise<void>;
  copyFile(from: string, to: string): Promise<void>;
  realpath(path: string): Promise<string>;
  /** Exact patch 24 (exact2 LLP 1133.007 D6a): `stat` of a link itself. */
  lstat(path: string): Promise<FileStat>;
  /** A symbolic link's target. Needs `fs.read`. */
  readlink(path: string): Promise<string>;
  /** Resolves when this user may access the path as `mode` asks (0 exists,
   * 1 execute, 2 write, 4 read), counting ownership, ACLs and mounts. */
  access(path: string, mode: number): Promise<void>;
  /** Its permission bits; on Windows only the read-only bit. Needs `fs.write`. */
  chmod(path: string, mode: number): Promise<void>;
  /** A symbolic link at `path` to `target`, as Node's. Needs `fs.write` on `path`. */
  symlink(target: string, path: string): Promise<void>;
  /** A file's SHA-256, -384 or -512, lowercase hex, read in bounded memory. */
  digest(path: string, algorithm: "SHA-256" | "SHA-384" | "SHA-512"): Promise<string>;
  /** An exclusive advisory lock (POSIX `flock`), made if absent and left on
   * disk, waiting up to `timeout` ms: held until `unlock()`. Needs `fs.write`. */
  flock(path: string, options?: { timeout?: number }): Promise<{ unlock(): Promise<void> }>;
  /** Exact patch 9 (exact2 LLP 1069.002 A1), the app interface: decode the
   * image at `from`, scale it to fit `maxDimension` and encode a JPEG of at
   * most `maxBytes` at `to`, searching quality as Bluesky's composer does,
   * under `quality` when it is given (A1.12); with `quality` alone, one
   * encode at it; or, with `type: "image/png"` (A1.11), a PNG that keeps
   * alpha, shrunk by 0.8 up to four times until it fits. Orientation is
   * applied and no metadata is written. Needs `fs.read` on `from` and
   * `fs.write` on `to`, both `app:/` paths. Rejects with a
   * `TypeError` for a bad option, else with `code` `unsupported` (no codec
   * on this host), `undecodable`, `too-large` (over 64 MiB, 64 Mi pixels,
   * or more decoding memory than the host allows), `unfit` (nothing fits) or
   * `timeout` (20 s), or a filesystem code. With `rotate`, `flip` or `crop`
   * (exact2 LLP 1133.019 D15) the edit is made first, in `transformImage`'s
   * order, and the search runs on the edited picture; a crop that misses it
   * rejects with `code` `outside`. */
  compressImage(from: string, to: string, options: CompressImageOptions): Promise<CompressedImage>;
  /** Exact patch 9a (exact2 LLP 1133.019 D14), the app interface: decode
   * the image at `from` once, turn it upright, then `rotate` it about its
   * centre (degrees clockwise; a free angle takes the bounding box, clear
   * where the type keeps alpha and white otherwise), `flip` it in the
   * turned frame, `crop` it in that frame's pixels, size it as
   * `createImageBitmap` does, and encode it once at `to`. Unlike
   * `compressImage` it keeps what the camera made where the host can: the
   * source's colour space, an HDR gain map (JPEG and HEIC on Apple) and,
   * by `metadata`, its EXIF, TIFF, GPS, IPTC and XMP; the result says what
   * was written. A `to` with no extension gains the type's. Needs `fs.read`
   * on `from` and `fs.write` on `to`, both `app:/` paths. Rejects with a
   * `TypeError` for a bad option, else with `code` `unsupported` (a type
   * this host does not write), `undecodable`, `too-large`, `outside` (the
   * crop misses the picture) or `timeout`, or a filesystem code. */
  transformImage(from: string, to: string, options?: TransformImageOptions): Promise<TransformedImage>;
  /** Exact patch 14 (exact2 LLP 1069.010.000 D1), the app interface: this
   * answer depends on the `doc:/` path, and the host asks it again when the
   * file, a folder's own entries or, with `recursive`, its subtree change on
   * disk, by any process. Call it inside an answer; it carries no value, so
   * the answer reads again. Needs `fs.read` on the path. */
  watch(path: string, options?: WatchOptions): void;
  /** Exact patch 15 (exact2 LLP 1069.010.000 D5), the app interface: the
   * documents the host keeps for this app across launches, most recent
   * first, without reading them. `watch("doc:/")` asks the answer again when
   * the list changes. Needs the `doc.keep` grant; a host that keeps nothing
   * lists nothing. */
  recentDocuments(): Promise<KeptDocument[]>;
  /** Exact patch 15: the app's own removal of a kept document (a "Remove
   * from Recents" item). Rejects with `code` `ENOENT` for a path it does not
   * keep. Needs the `doc.keep` grant. */
  forgetDocument(path: string): Promise<void>;
}

export interface KeptDocument {
  /** Its `doc:/<n>/<name>`, valid in every launch while it is kept. */
  readonly path: string;
  /** Its name when chosen. */
  readonly name: string;
  readonly kind: "file" | "directory";
  /** What the choice granted: `read`, or `readwrite`. */
  readonly mode: "read" | "readwrite";
  /** When it was last chosen or opened, in milliseconds since 1970. */
  readonly opened: number;
}

export interface WatchOptions {
  /** The whole subtree, not only a folder's own entries. */
  readonly recursive?: boolean;
}

export interface WriteOptions {
  /** Exact patch 14 (exact2 LLP 1069.010.000 D2a): on a `doc:/` path, the
   * stat last read. The write is refused with `code` `ECHANGED`, writing
   * nothing, when the file's `modifiedMs` or `size` is no longer this. */
  readonly expect?: Pick<FileStat, "modifiedMs" | "size">;
}

/** A byte target, a quality or both (exact2 LLP 1069.002 A1.12). */
export type CompressImageOptions = CompressImageLimits &
  ({ readonly maxBytes: number } | { readonly quality: number });

export interface CompressImageLimits {
  /** An integer from 1 to 8192: the longer side's limit, in pixels. */
  readonly maxDimension: number;
  /** An integer from 1 to 67108864: the encoded file's limit. */
  readonly maxBytes?: number;
  /** From 0 to 1: the JPEG quality tried first at each size and never
   * exceeded; without `maxBytes`, the one encode's. A PNG ignores it. */
  readonly quality?: number;
  /** What to write; `"image/jpeg"` when absent. */
  readonly type?: "image/jpeg" | "image/png";
  /** Exact patch 9a (exact2 LLP 1133.019 D15): `transformImage`'s edit. */
  readonly rotate?: number;
  readonly flip?: "horizontal" | "vertical";
  readonly crop?: ImageCrop;
}

/** A rectangle in the turned picture's pixels, as a `DOMRect` names one.
 * It is clipped to the picture and its edges rounded. */
export interface ImageCrop {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface TransformImageOptions {
  /** Degrees clockwise, as CSS's `rotate` turns. */
  readonly rotate?: number;
  /** In the turned frame: `horizontal` mirrors what the person sees. */
  readonly flip?: "horizontal" | "vertical";
  readonly crop?: ImageCrop;
  /** `createImageBitmap`'s: one keeps the aspect, both set the size,
   * neither keeps the crop's. Integers from 1 to 16384. */
  readonly resizeWidth?: number;
  readonly resizeHeight?: number;
  /** `"high"` when absent. */
  readonly resizeQuality?: "pixelated" | "low" | "medium" | "high";
  /** The source's type when the host writes it, else `"image/jpeg"`. A
   * type the host does not write rejects with `code` `unsupported`. */
  readonly type?: string;
  /** From 0 to 1, for a lossy type; 0.9 when absent. */
  readonly quality?: number;
  /** What of the source's metadata to write: all of it, with the
   * orientation reset and the size rewritten (`"keep"`, when absent); the
   * capture's standard tags and the IPTC rights fields, with no GPS, maker
   * note or XMP (`"no-location"`); or none. */
  readonly metadata?: "keep" | "no-location" | "none";
}

export interface TransformedImage {
  /** `to`, with the type's extension where it had none. */
  readonly path: string;
  readonly type: string;
  readonly size: number;
  readonly width: number;
  readonly height: number;
  /** What was written, which a host that cannot keep something says. */
  readonly colorSpace: "srgb" | "display-p3" | "other";
  readonly hdr: boolean;
  readonly metadata: "keep" | "no-location" | "none";
}

export interface CompressedImage {
  readonly path: string;
  readonly type: "image/jpeg" | "image/png";
  readonly size: number;
  readonly width: number;
  readonly height: number;
}

export interface FileStat {
  readonly size: number;
  readonly isFile: boolean;
  readonly isDirectory: boolean;
  readonly modifiedMs: number;
  /** Exact patch 24: its permission bits, natively (the web's records have none). */
  readonly mode?: number;
  /** Exact patch 24: an `lstat` that met a symbolic link. */
  readonly isSymbolicLink?: boolean;
}

/** SQLite INTEGER results are bigint, including small integers. Number
 * inputs must be finite; integral numbers must be safely representable. */
export type SQLValue = null | bigint | number | string | Uint8Array;
export interface SQLRows {
  columns: string[];
  rows: SQLValue[][];
}
export interface SQLExecution {
  changes: number;
  lastInsertRowid: bigint;
}
export interface SQLCommand {
  sql: string;
  params?: SQLValue[];
}
export interface SQLTransactionOptions {
  foreignKeys?: "check";
}
export interface SQLite {
  open(path: string): Promise<Database>;
}
export interface Database {
  execute(sql: string, params?: SQLValue[]): Promise<SQLExecution>;
  /** Read-only queries; one SQL statement per call. */
  query(sql: string, params?: SQLValue[]): Promise<SQLRows>;
  prepare(sql: string): Promise<Statement>;
  /** One atomic batch, rolled back on failure; no callback transaction.
   * `foreignKeys: "check"` is for a migration that rebuilds a table other
   * rows reference: foreign keys are not enforced while the batch runs and
   * are checked once, before it commits. */
  transaction(commands: SQLCommand[], options?: SQLTransactionOptions): Promise<SQLExecution[]>;
  /** Idempotent; invalidates this database's prepared statements. */
  close(): Promise<void>;
}
export interface Statement {
  execute(params?: SQLValue[]): Promise<SQLExecution>;
  query(params?: SQLValue[]): Promise<SQLRows>;
  close(): Promise<void>;
}

type T0 = string;
type T1 = { "value": T0; "name": T0; "description": T0; };
type T2 = boolean;
type T3 = number;
type T4 = { "id": T0; "pinned": T2; "title": T0; "running": T2; "cwd": T0; "updatedAt": T3; "group": T0; "first": T2; "when": T0; "archived": T2; };
type T5 = { "id": T0; "v": T0; "sign": T0; "mark": T0; "d": T3; "alt": T0; "w": T3; "h": T3; "dw": T3; "dh": T3; };
type T6 = T5[];
type T7 = { "id": T0; "t": T0; "v": T0; "lvl": T3; "lang": T0; "alt": T0; "w": T3; "h": T3; "head": T0; "items": T6; "rows": T6; };
type T8 = { "id": T0; "sign": T0; "text": T0; };
type T9 = T8[];
type T10 = { "id": T0; "path": T0; "added": T3; "removed": T3; "lines": T9; };
type T11 = { "id": T0; "text": T0; "state": T0; "change": T0; };
type T12 = { "id": T0; "text": T0; "description": T0; };
type T13 = { "id": T0; "att": T0; "media": T0; "w": T3; "h": T3; "text": T0; };
type T14 = T7[];
type T15 = T10[];
type T16 = T11[];
type T17 = { "id": T0; "path": T0; "text": T0; };
type T18 = T17[];
type T19 = T12[];
type T20 = T13[];
type T21 = { "id": T0; "kind": T0; "text": T0; "detail": T0; "status": T0; "result": T0; "nodes": T14; "callId": T0; "child": T0; "icon": T0; "summary": T0; "args": T0; "lazy": T2; "badge": T0; "todoSummary": T0; "diffs": T15; "diffHidden": T3; "todos": T16; "files": T18; "question": T0; "options": T19; "att": T0; "media": T0; "w": T3; "h": T3; "images": T20; };
type T22 = T3 | null;
type T23 = { "in": T3; "out": T3; "cacheRead": T3; "reasoning": T22; };
type T24 = T23 | null;
type T25 = T21[];
type T26 = { "id": T0; "role": T0; "seq": T3; "msgId": T0; "text": T0; "plain": T0; "usage": T0; "tools": T3; "running": T3; "thought": T2; "failed": T2; "thoughtPreview": T0; "changedCount": T3; "day": T0; "deliverables": T18; "refs": T18; "usageTokens": T24; "interrupted": T2; "took": T3; "folded": T3; "shadow": T3; "blocks": T25; };
type T27 = T0[];
type T28 = { "id": T0; "name": T0; "provider": T0; "current": T2; "efforts": T27; };
type T29 = T28[];
type T30 = { "currentModel": T0; "currentProvider": T0; "currentEffort": T0; "models": T29; };
type T31 = { "id": T0; "name": T0; "when": T0; "mine": T2; };
type T32 = T31[];
type T33 = { "devices": T32; };
type T34 = { "name": T0; "description": T0; "hint": T0; };
type T35 = T34[];
type T36 = { "commands": T35; };
type T37 = { "id": T0; "toolName": T0; "reason": T0; "summary": T0; "args": T0; "command": T0; "plan": T0; "expiresIn": T3; };
type T38 = { "id": T0; "currency": T0; "text": T0; };
type T39 = T38[];
type T40 = { "signedOut": T2; "failed": T2; "wallets": T39; "bonus": T39; };
type T41 = { "label": T0; "detail": T0; };
type T42 = { "turns": T3; "steps": T3; "inTok": T3; "outTok": T3; "cacheRead": T3; };
type T43 = { "id": T0; "label": T0; "sessionId": T0; };
type T44 = { "id": T0; "kind": T0; "label": T0; "status": T0; "progress": T0; "detail": T0; "when": T0; };
type T45 = { "id": T0; "text": T0; "state": T0; };
type T46 = { "id": T0; "title": T0; "prompt": T0; "status": T0; "kind": T0; "timing": T0; "nextAt": T0; "updatedAt": T0; "targetSessionId": T0; };
type T47 = { "id": T0; "taskId": T0; "subject": T0; "status": T0; "owner": T0; };
type T48 = { "ok": T2; "kind": T0; "media": T0; "name": T0; "bytes": T3; "text": T0; "url": T0; };
type T49 = T46[];
type T50 = { "items": T49; };
type T51 = { "id": T0; "text": T0; };
type T52 = { "id": T0; "header": T0; "question": T0; "detail": T0; "multi": T2; "options": T19; };
type T53 = T52[];
type T54 = { "id": T0; "callId": T0; "hint": T0; "ask": T0; "detail": T0; "qid": T0; "multi": T2; "kind": T0; "options": T19; "items": T53; "expiresIn": T3; };
type T55 = { "id": T0; "text": T0; "state": T0; };
type T56 = T55[];
type T57 = { "title": T0; "steps": T56; };
type T58 = T4[];
type T59 = T1[];
type T60 = T41 | null;
type T61 = T26[];
type T62 = T37[];
type T63 = T51[];
type T64 = T45[];
type T65 = T44[];
type T66 = T43[];
type T67 = T47[];
type T68 = T54 | null;
type T69 = T40 | null;
type T70 = { "used": T3; "total": T3; };
type T71 = T70 | null;
type T72 = { "listRev": T0; "rowsRev": T0; "hasMore": T2; "plan": T57; "goal": T0; "goalId": T0; "pinned": T2; "archived": T2; "goalPhase": T0; "sessions": T58; "sessionTitle": T0; "sessionModel": T0; "sessionPermission": T0; "permissionOptions": T59; "running": T2; "inherited": T2; "runLabel": T0; "runActivity": T60; "stats": T42; "messages": T61; "approvals": T62; "queue": T63; "todos": T64; "jobs": T65; "subagents": T66; "team": T67; "question": T68; "streamText": T0; "streamReasoning": T0; "streamTools": T25; "balance": T69; "context": T71; "quota": T0; };
type T73 = { "rev": T0; "hasMore": T2; "rows": T61; };
type T74 = { "callId": T0; "name": T0; "args": T0; "result": T0; };
type T75 = { "ok": T2; "error": T0; };
type T76 = { "ok": T2; "id": T0; "name": T0; "error": T0; };
type T77 = { "ok": T2; "token": T0; "error": T0; };
type T78 = { "id": T0; "error": T0; };
type T79 = { "ok": T2; "server": T0; "token": T0; "alt": T0; "error": T0; };
type T80 = { "prefersReducedMotion": T2; };
type T81 = { "permanentlyDenied": T2; "shouldShowRationale": T2; };
type T82 = T81 | null;
type T83 = "notDetermined" | "restricted" | "denied" | "authorized";
type T84 = { "authorizationStatus": T83; };
type T85 = T84 | null;
type T86 = "granted" | "prompt" | "denied" | "unknown";
type T87 = { "android": T82; "apple": T85; "available": T2; "state": T86; };
type T88 = { "max": T3; "min": T3; "step": T22; };
type T89 = T0 | null;
type T90 = { "refused": T89; };
type T91 = "audioinput" | "videoinput" | "audiooutput";
type T92 = { "deviceId": T0; "facingMode": T89; "groupId": T0; "kind": T91; "label": T0; };
type T93 = T92[];
type T94 = { "devices": T93; };
type T95 = { "cameraId": T89; "isClientSilenced": T2; "lensFacing": T89; };
type T96 = T95 | null;
type T97 = { "deviceType": T89; "portName": T89; "portType": T89; "position": T89; };
type T98 = T97 | null;
type T99 = T88 | null;
type T100 = T27 | null;
type T101 = T2 | null;
type T102 = { "aspectRatio": T99; "facingMode": T100; "frameRate": T99; "height": T99; "torch": T101; "width": T99; "zoom": T99; };
type T103 = T102 | null;
type T104 = "audio" | "video";
type T105 = "idle" | "interrupted" | "background" | "silenced" | "in-use" | "multitasking" | "system-pressure";
type T106 = T105 | null;
type T107 = "live" | "ended";
type T108 = { "aspectRatio": T22; "autoGainControl": T101; "channelCount": T22; "deviceId": T89; "echoCancellation": T101; "facingMode": T89; "frameRate": T22; "groupId": T89; "height": T22; "latency": T22; "noiseSuppression": T101; "resizeMode": T89; "sampleRate": T22; "sampleSize": T22; "torch": T101; "width": T22; "zoom": T22; };
type T109 = { "android": T96; "apple": T98; "capabilities": T103; "enabled": T2; "id": T0; "kind": T104; "label": T0; "muteReason": T106; "muted": T2; "readyState": T107; "settings": T108; };
type T110 = T109[];
type T111 = { "active": T2; "id": T0; "tracks": T110; };
type T112 = { "aspectRatio": T22; "autoGainControl": T101; "channelCount": T22; "deviceId": T89; "echoCancellation": T101; "facingMode": T89; "frameRate": T22; "groupId": T89; "height": T22; "latency": T22; "noiseSuppression": T101; "resizeMode": T89; "sampleRate": T22; "sampleSize": T22; "torch": T101; "width": T22; "zoom": T22; };
type T113 = { "permanentlyDenied": T2; "shouldShowRationale": T2; };
type T114 = T113 | null;
type T115 = "undetermined" | "denied" | "granted" | "notDetermined" | "restricted" | "authorized";
type T116 = { "recordPermission": T115; };
type T117 = T116 | null;
type T118 = "granted" | "prompt" | "denied" | "unknown";
type T119 = { "android": T114; "apple": T117; "available": T2; "state": T118; };
type T120 = { "x": T3; "y": T3; };
type T121 = { "bundled": T2; };
type T122 = T121 | null;
type T123 = { "symbologies": T27; };
type T124 = T123 | null;
type T125 = { "android": T122; "apple": T124; "formats": T27; "tracks": T2; };
type T126 = { "rawBytes": T89; "valueType": T0; };
type T127 = T126 | null;
type T128 = { "payloadData": T89; "symbology": T0; };
type T129 = T128 | null;
type T130 = { "height": T3; "width": T3; "x": T3; "y": T3; };
type T131 = { "x": T3; "y": T3; };
type T132 = T131[];
type T133 = { "android": T127; "apple": T129; "boundingBox": T130; "cornerPoints": T132; "format": T0; "rawValue": T0; };
type T134 = T133[];
type T135 = { "firstSeen": T3; "format": T0; "frames": T3; "lastSeen": T3; "rawValue": T0; };
type T136 = T135[];
type T137 = "idle" | "scanning" | "ended";
type T138 = { "barcodes": T134; "error": T89; "frame": T3; "height": T3; "seen": T136; "state": T137; "width": T3; };
type T139 = { "barcodes": T134; "height": T3; "width": T3; };
type T140 = { "path": T0; };
type T141 = { "height": T3; "path": T0; "size": T3; "type": T0; "width": T3; };
type T142 = "auto" | "off" | "flash";
type T143 = T142[];
type T144 = { "max": T3; "min": T3; "step": T3; };
type T145 = "never" | "always" | "controllable";
type T146 = { "fillLightMode": T143; "imageHeight": T144; "imageWidth": T144; "redEyeReduction": T145; };
type T147 = { "duration": T3; "height": T3; "path": T0; "size": T3; "type": T0; "width": T3; };
type T148 = { "height": T3; "width": T3; };
type T149 = { "id": T0; };
type T150 = { "id": T3; "name": T0; "url": T0; "tab": T0; "params": T149; "fragment": T0; };
type T151 = T150[];
type T152 = { "name": T0; "stack": T151; };
type T153 = T152[];
type T154 = { "tab": T0; "tabs": T153; "next": T3; };
type T155 = "builtInWideAngleCamera" | "builtInUltraWideCamera" | "builtInTelephotoCamera" | "builtInDualCamera" | "builtInDualWideCamera" | "builtInTripleCamera" | "builtInTrueDepthCamera" | "builtInLiDARDepthCamera" | "continuityCamera" | "deskViewCamera" | "external";
type T156 = T155 | null;
type T157 = "locked" | "autoExpose" | "continuousAutoExposure";
type T158 = T157 | null;
type T159 = T120 | null;
type T160 = "locked" | "autoFocus" | "continuousAutoFocus";
type T161 = T160 | null;
type T162 = { "deviceType": T156; "exposureMode": T158; "exposurePointOfInterest": T159; "focusMode": T161; "focusPointOfInterest": T159; };
type T163 = T162 | null;
type T164 = { "aspectRatio": T22; "facingMode": T89; "frameRate": T22; "height": T22; "resizeMode": T89; "torch": T101; "track": T0; "width": T22; "zoom": T22; "apple": T163; };
type T165 = { "formats": T100; "image": T0; };
type T166 = { "formats": T100; "interval": T22; "track": T0; };
type T167 = { "track": T0; };
type T168 = T112 | null;
type T169 = "mic" | "camcorder" | "voiceRecognition" | "voiceCommunication" | "unprocessed" | "voicePerformance";
type T170 = T169 | null;
type T171 = { "audioSource": T170; "privacySensitive": T101; };
type T172 = T171 | null;
type T173 = "mixWithOthers" | "duckOthers" | "allowBluetoothHFP" | "allowBluetoothA2DP" | "defaultToSpeaker" | "bluetoothHighQualityRecording" | "farFieldInput" | "overrideMutedMicrophoneInterruption";
type T174 = T173[];
type T175 = T174 | null;
type T176 = "builtInWideAngleCamera" | "builtInUltraWideCamera" | "builtInTelephotoCamera" | "builtInDualCamera" | "builtInDualWideCamera" | "builtInTripleCamera" | "builtInTrueDepthCamera" | "builtInLiDARDepthCamera" | "continuityCamera" | "deskViewCamera" | "external";
type T177 = T176 | null;
type T178 = "default" | "measurement" | "voiceChat" | "videoChat" | "videoRecording";
type T179 = T178 | null;
type T180 = "stereo" | "cardioid" | "omnidirectional";
type T181 = T180 | null;
type T182 = { "categoryOptions": T175; "deviceType": T177; "inputDataSource": T89; "mode": T179; "polarPattern": T181; "preferredIOBufferDuration": T22; "prefersNoInterruptionsFromSystemAlerts": T101; };
type T183 = T182 | null;
type T184 = { "audio": T101; "audioConstraints": T168; "video": T101; "videoConstraints": T168; "android": T172; "apple": T183; };
type T185 = { "track": T0; };
type T186 = "user" | "environment";
type T187 = T186 | null;
type T188 = "low" | "high";
type T189 = T188 | null;
type T190 = { "sizeLimit": T22; "videoQuality": T189; };
type T191 = T190 | null;
type T192 = "typeHigh" | "typeMedium" | "typeLow" | "type640x480" | "typeIFrame1280x720" | "typeIFrame960x540";
type T193 = T192 | null;
type T194 = { "videoQuality": T193; };
type T195 = T194 | null;
type T196 = { "facingMode": T187; "maxDuration": T22; "path": T89; "android": T191; "apple": T195; };
type T197 = { "enabled": T2; "track": T0; };
type T198 = { "track": T0; };
type T199 = "auto" | "off" | "flash";
type T200 = T199 | null;
type T201 = "minimizeLatency" | "maximizeQuality" | "zeroShutterLag";
type T202 = T201 | null;
type T203 = "auto" | "on" | "off";
type T204 = T203 | null;
type T205 = { "captureMode": T202; "flashMode": T204; "jpegQuality": T22; "shutterSound": T101; };
type T206 = T205 | null;
type T207 = "jpeg" | "hevc";
type T208 = T207 | null;
type T209 = "auto" | "on" | "off";
type T210 = T209 | null;
type T211 = T148 | null;
type T212 = "speed" | "balanced" | "quality";
type T213 = T212 | null;
type T214 = { "codec": T208; "flashMode": T210; "isAutoRedEyeReductionEnabled": T101; "isShutterSoundSuppressionEnabled": T101; "maxPhotoDimensions": T211; "photoQualityPrioritization": T213; };
type T215 = T214 | null;
type T216 = { "fillLightMode": T200; "imageHeight": T22; "imageWidth": T22; "path": T89; "redEyeReduction": T101; "track": T0; "android": T206; "apple": T215; };
type T217 = "user" | "environment";
type T218 = T217 | null;
type T219 = { "facingMode": T218; "path": T89; };
type T220 = T74 | null;
type T221 = T75 | null;
type T222 = T76 | null;
type T223 = T78 | null;
type T224 = T77 | null;
type T225 = T111 | null;
type T226 = T79 | null;
type T227 = T109 | null;
type T228 = { "scrollLeft": T3; "scrollTop": T3; "scrollWidth": T3; "scrollHeight": T3; "clientWidth": T3; "clientHeight": T3; "firstVisibleKey": T89; "firstVisibleOffset": T3; "scrollZoom": T3; };
type T229 = { "path": T0; "name": T0; "type": T0; "size": T3; "width": T22; "height": T22; "duration": T22; };
type T230 = T229[];

/** Sources called by compiled mutation sends. */
export type MutationSource = "answerQuestion" | "answerQuestions" | "cancelRun" | "createSchedule" | "createSession" | "deleteSchedule" | "dropQueued" | "editSchedule" | "forkFrom" | "forkSession" | "killJob" | "loadCall" | "pairDevice" | "pairFromLink" | "queueItem" | "rateMessage" | "renameSession" | "respondApproval" | "revokeDevice" | "runSchedule" | "runSessionCommand" | "sendPrompt" | "setGoalAction" | "setModel" | "setPermission" | "setSessionFlag" | "skipQuestion" | "uploadPhoto";

export interface SourceMap {
  "answerQuestion": { args: [T0, T0, T0, T0, T0]; result: T75 };
  "answerQuestions": { args: [T0, T0, T0, T0]; result: T75 };
  "cancelRun": { args: [T0, T0, T0]; result: T75 };
  "createSchedule": { args: [T0, T0, T0, T0, T0]; result: T75 };
  "createSession": { args: [T0, T0, T0]; result: T78 };
  "deleteSchedule": { args: [T0, T0, T0, T0]; result: T75 };
  "dropQueued": { args: [T0, T0, T0, T0]; result: T75 };
  "editSchedule": { args: [T0, T0, T0, T0]; result: T75 };
  "forkFrom": { args: [T0, T0, T0, T3]; result: T78 };
  "forkSession": { args: [T0, T0, T0]; result: T78 };
  "killJob": { args: [T0, T0, T0, T0]; result: T75 };
  "loadCall": { args: [T0, T0, T0, T0]; result: T74 };
  "loadCommands": { args: [T0, T0, T0]; result: T36 };
  "loadDevices": { args: [T0, T0]; result: T33 };
  "loadFile": { args: [T0, T0, T0, T0]; result: T48 };
  "loadLive": { args: [T0, T0, T0, T0, T2]; result: T72 };
  "loadModels": { args: [T0, T0, T0]; result: T30 };
  "loadRows": { args: [T0, T0, T0, T3, T0]; result: T73 };
  "loadSchedules": { args: [T0, T0]; result: T50 };
  "pairDevice": { args: [T0, T0]; result: T77 };
  "pairFromLink": { args: [T0]; result: T79 };
  "queueItem": { args: [T0, T0, T0, T0, T0, T0]; result: T75 };
  "rateMessage": { args: [T0, T0, T0, T0, T0, T0]; result: T75 };
  "renameSession": { args: [T0, T0, T0, T0]; result: T78 };
  "respondApproval": { args: [T0, T0, T0, T2, T2]; result: T75 };
  "revokeDevice": { args: [T0, T0, T0]; result: T75 };
  "runSchedule": { args: [T0, T0, T0]; result: T75 };
  "runSessionCommand": { args: [T0, T0, T0, T0, T0]; result: T75 };
  "sendPrompt": { args: [T0, T0, T0, T0, T2, T0]; result: T75 };
  "setGoalAction": { args: [T0, T0, T0, T0]; result: T75 };
  "setModel": { args: [T0, T0, T0, T0, T0, T0]; result: T75 };
  "setPermission": { args: [T0, T0, T0, T0]; result: T75 };
  "setSessionFlag": { args: [T0, T0, T0, T0, T2]; result: T75 };
  "skipQuestion": { args: [T0, T0, T0]; result: T75 };
  "uploadPhoto": { args: [T0, T0, T0, T0]; result: T76 };
}

export type Source = keyof SourceMap;
export type Args<S extends Source> = SourceMap[S]['args'];
/** A generated backend operation's arguments (distinct from this app's source tuple). */
export type ArgsOf<O> = O extends { readonly __args?: infer A } ? A : never;
/** A source's answer. A shape has no exported name: name one by its source,
* `type Recipe = Result<'recipe'>` (a list's element: `Result<'recipes'>[number]`). */
export type Result<S extends Source> = SourceMap[S]['result'];
export interface Store {
/** The value kept under `name`; throws `InvalidAccessError` for a locked presence secret, read with `unlock` (LLP 1133.010). */
get(name: string): string | null;
/** Throws `NotSupportedError` when the name would be kept locked and this device keeps no locked secret. */
set(name: string, value: string): void;
forget(name: string): void;
/** A value is kept under `name`, locked or not. */
has(name: string): boolean;
/** `name` is kept under its presence policy, or awaits the move to it. */
locked(name: string): boolean;
/** The value: after the person's check when `name` is locked, at once when not; `null` when nothing is kept. Rejects with `code` `USER_CANCEL`, `AUTHENTICATION_FAILED`, `LOCKOUT`, `NOT_AVAILABLE`, `PERMISSION_DENIED` or `NotSupportedError`. */
unlock(name: string, options?: { reason?: string }): Promise<string | null>;
/** Lock an `optional` presence name for good; rejects `NotSupportedError` where no locked secret can be kept. */
protect(name: string): Promise<void>;
/** After the person's check, unlock an `optional` presence name for good. */
unprotect(name: string, options?: { reason?: string }): Promise<void>;
/** Keep a P-256 pair under the `secret.keep <name>` grant (LLP 1069.005 D1b). */
keepKey(name: string, pair: CryptoKeyPair): Promise<void>;
/** The pair kept under `name`, its private key non-extractable. */
key(name: string): Promise<CryptoKeyPair | null>;
}
declare global {
/** Sign in through the system browser (LLP 1069.006): the callback URL, or a rejection whose `status` is 499 cancelled, 403, 409, 428, 501 or 502. `message` is the sentence a loopback callback's page shows in place of "You can close this tab." (LLP 1133.005 D9). */
function openAuthSession(url: string, options: { callback: string; state: string; /** An RP-initiated logout return has neither code nor error and may omit state. */ logout?: boolean; ephemeral?: boolean; message?: string }): Promise<string>;
/** This carrier's auth callback, known before PAR (LLP 1069.006 D2). */
function authCallback(): string;
/** The kept bitmap of the one mounted 2D canvas of `surface`, what its host has drawn, written as an sRGB image at device pixels to the `app:/` file `path` under `fs.write` (LLP 1056 D9). `type` and `quality` are `toBlob`'s: a straight-alpha PNG by default, `image/jpeg` on every host (over opaque black, `quality` 0 to 1, 0.92 by default), another type where the host's system encoder writes it, else a PNG; `type` in the answer is the one written. Rejects with a DOMException: `NotFoundError` (none mounted), `InvalidStateError` (several, or its size refused), `IndexSizeError` (no bitmap), `QuotaExceededError` (over 8192² px), `NotSupportedError` (`display-p3` or `float16`, or a host that cannot), `NotAllowedError` (the path), `EncodingError`. */
function captureCanvas(surface: string, path: string, type?: string, quality?: number): Promise<{ readonly path: string; readonly width: number; readonly height: number; readonly scale: number; readonly type: string }>;
}
export interface NativeModule { readonly available: boolean; call(request: Record<string, unknown>): Record<string, unknown>; later(request: Record<string, unknown>): Promise<Record<string, unknown>>; watch(topic: string): void }
/** A resource-owned WebSocket, for TypeScript on the web JS target and native hosts (LLP 1016.000 D7). Methods are synchronous-mutation-only; refresh or disposal invalidates it. */
export interface StreamSocket { readonly readyState: number; readonly bufferedAmount: number; send(data: string | ArrayBuffer | ArrayBufferView): void; close(code?: number, reason?: string): void }
/** A local listener's connection (LLP 1133.005 D1): `send` writes a line and a `\n` (a line with a `\n` throws `SyntaxError`); `end()` closes it once what was sent is written. `readyState` is 1 while open, 3 after its `end`. The same rules as `StreamSocket`'s, by connection: its listener's mapper sends on the connection it is handed. */
export interface ListenConnection { readonly readyState: number; send(line: string): void; end(): void }
/** A local listener's event: `listening` (`address`, `port`: 0 for `unix:`), then each `connection`, `message` (one line, without its terminator) and `end` (`reason` `peer`, `app`, `timeout` or `overflow`), by connection `id`; `error` ends it (`kind` `Refused`, `AddressInUse`, `Unsupported` or `Network`). */
export type ListenEvent = { readonly type: "listening"; readonly address: string; readonly port: number } | { readonly type: "connection"; readonly id: number } | { readonly type: "message"; readonly id: number; readonly data: string } | { readonly type: "end"; readonly id: number; readonly reason: "peer" | "app" | "timeout" | "overflow" } | { readonly type: "error"; readonly kind: string; readonly message: string };
declare global {
/** A local listener (LLP 1133.005), a resource's answer as `fetch(url, {exactStream})` is: listening while the resource holds it, on `unix:<absolute path>` under a `net.listen` grant. Defined on desktop hosts only: test `"exactListen" in globalThis`. A mutation that calls it throws `InvalidStateError`. */
function exactListen<T>(address: string, options: { exactStream: (event: ListenEvent, connection?: ListenConnection) => T; /** Newest wins: take the address over from a live listener. */ takeover?: boolean; /** ms, 1 to 600000: a connection whose first line has not arrived ends `timeout`. */ firstLineTimeout?: number; /** 1 to 1048576, 65536 by default. */ maxLineBytes?: number; /** 1 to 64, 16 by default. */ maxConnections?: number }): Promise<T>;
}
export interface StreamEvent { readonly type: string; readonly data: string | ArrayBuffer; readonly lastEventId: string; readonly coalesced: number; readonly protocol?: string; readonly kind?: string; readonly message?: string; readonly status?: number; readonly code?: number; readonly reason?: string; readonly wasClean?: boolean; /** An upload's `progress`: the body's bytes sent so far, of `total`. */ readonly loaded?: number; readonly total?: number; readonly lengthComputable?: boolean }
declare global {
interface RequestInit { /** Checked on every host; the request is made as written. No host holds its reply yet. */ exactPrefetch?: boolean; /** Take this preload when method and URL agree; a name matching ^[a-z][a-z0-9-]*$. Accepted and ignored on the web. */ exactPreload?: string; exactProtocols?: string[]; cache?: "default" | "no-store" | "reload" | "no-cache" | "force-cache" | "only-if-cached"; exactStream?: (event: StreamEvent, socket?: StreamSocket) => unknown; exactIndependentHttp?: { maxResponseBytes: number }; /** A deadline for the whole exchange, 1 to 3600000 ms: the request is cancelled and the fetch rejects with a FetchError whose `kind` is "Timeout". Not with `exactStream`, but for an upload (`exactUploadProgress`). */ exactTimeout?: number; /** With `exactStream` on a `ws:` or `wss:` URL: the socket ends when nothing has arrived for this long, 1 to 3600000 ms of real time, its opening and each message counting; the mapper gets one `error` event whose `kind` is "Timeout". Reopening is the app's: refresh the resource. */ exactIdleTimeout?: number; /** The body is this app file (`app:/…`), streamed from disk by the host when it sends the request, under `fs.read`, with no size bound (on the web a file the app wrote is read whole, at most 64 MiB); its bytes never enter JavaScript. Not with `body`, nor on a GET or HEAD; no Content-Type is added. */ exactBodyFrom?: string; /** A 2xx reply's body is written to this app file (`app:/…`) by the host as it arrives, under `fs.write`, at most `exactIndependentHttp.maxResponseBytes` or 1 GiB; its bytes never enter JavaScript. The file appears whole or not at all, and the response's `exactBodyTo` names the bytes written. A reply that is not 2xx leaves the file untouched and is read as usual. Not with `exactStream`, nor on a HEAD. */ exactBodyTo?: string; /** The server may hold the reply until something changes (a long poll): no clock waits on it (a jump, `clock settle`, `clock data`), and each reply that leaves it out names it. Its answer must be safe to supersede. Not with `exactStream`. */ exactHeld?: boolean; /** With `exactStream`, an upload: as its body (`body` or `exactBodyFrom`) goes out the mapper gets `progress` events (`loaded` of `total` bytes sent), then `load` with the reply's `status` and `data`, whatever the status, which ends it. It is in flight until that reply, for `pending` and every clock. Not on a GET or HEAD, a WebSocket or a long poll; it follows its redirects. */ exactUploadProgress?: boolean; /** With `exactStream`, a long poll: the host asks again and again, one GET at a time, each JSON reply an event whose `lastEventId` is its cursor (the reply's field `from`, `a` or `a.b`), asked with next in the query parameter `cursor`; a heartbeat (204, 304, an empty body, or by default the same cursor) is asked again with no event; the network, 408, 429, 502, 503 or 504 after `Retry-After` or a backoff of 1 s doubling to 30 s. */ exactLongPoll?: { cursor: string; from: string; sameCursor?: "heartbeat" | "event" } }
/** `{path, bytes}` when `exactBodyTo` wrote the body to its file (its `text()` and `arrayBuffer()` are then empty); absent or `null` otherwise. */
interface Response { readonly exactBodyTo?: { readonly path: string; readonly bytes: number } | null }
/** An answer that keeps coming: `exactStream` maps each event, and the end, to the answer. */
function fetch<T>(input: string | URL, init: RequestInit & { exactStream: (event: StreamEvent, socket?: StreamSocket) => T }): Promise<T>;
}
export type Sources = { [S in Source]: (args: Args<S>, store: Store, storage: Storage, native?: NativeModule | null) => Result<S> | Promise<Result<S>> };
export type Answer = <S extends Source>(source: S, args: Args<S>, store: Store, storage: Storage, native?: NativeModule | null) => Result<S> | Promise<Result<S>>;
/** A send shown over a resource it `refreshes`, in send order: `reply` once its reply has landed. `answered`: it landed and this answer was asked after it, so the answer should include it; call `keep()` to go on showing it when the answer does not include it yet. */
export type Write = { [S in Source]: { readonly id: number; readonly mutation: string; readonly source: S; readonly args: Args<S>; readonly reply?: Result<S>; readonly answered: boolean; keep(): void } }[Source];
/** What a resource shows while writes affect it: its answer with them laid over it. Synchronous, with no effects; `undefined` shows the answer and stops showing every answered write. */
export type Overlay = <S extends Source>(source: S, args: Args<S>, answer: Result<S>, writes: readonly Write[]) => Result<S> | undefined;

/** Sources this build delegates to TypeScript (LLP 1027 D8). */
export type TypeScriptSource = Source;
export type TypeScriptSources = Pick<Sources, TypeScriptSource>;
export type TypeScriptAnswer = <S extends TypeScriptSource>(source: S, args: Args<S>, store: Store, storage: Storage, native?: NativeModule | null) => Result<S> | Promise<Result<S>>;
/** A colour token of the app's design, by its name (LLP 1121 D12). */
export type ColorToken = "surface.page" | "surface.card" | "surface.card-strong" | "text.ink" | "text.soft" | "brand.fill" | "ink.on-brand";
/** An image, by the URL or asset an `image` node's `src` takes (LLP 1056 D9). */
export type ImageHandle = string;
/** The 2D context a surface draws with (LLP 1056 §3, stages 1 and 2). */
export type Ctx2D = Pick<OffscreenCanvasRenderingContext2D,
  | 'save' | 'restore' | 'reset'
  | 'translate' | 'rotate' | 'scale' | 'transform' | 'setTransform' | 'resetTransform' | 'getTransform'
  | 'beginPath' | 'moveTo' | 'lineTo' | 'quadraticCurveTo' | 'bezierCurveTo' | 'arc' | 'arcTo' | 'ellipse' | 'rect' | 'roundRect' | 'closePath'
  | 'fill' | 'stroke' | 'clip' | 'fillRect' | 'strokeRect' | 'clearRect'
  | 'lineWidth' | 'lineCap' | 'lineJoin' | 'miterLimit' | 'setLineDash' | 'getLineDash' | 'lineDashOffset'
  | 'fillStyle' | 'strokeStyle' | 'createLinearGradient' | 'createRadialGradient' | 'createConicGradient'
  | 'globalAlpha' | 'globalCompositeOperation'
  | 'shadowColor' | 'shadowBlur' | 'shadowOffsetX' | 'shadowOffsetY'
  | 'imageSmoothingEnabled' | 'imageSmoothingQuality'
  | 'font' | 'textAlign' | 'textBaseline' | 'direction' | 'letterSpacing' | 'wordSpacing'
  | 'fontKerning' | 'fontStretch' | 'fontVariantCaps' | 'textRendering'
  | 'fillText' | 'strokeText' | 'measureText'
  | 'createImageData' | 'putImageData'> & {
  drawImage(image: ImageHandle, dx: number, dy: number): void;
  drawImage(image: ImageHandle, dx: number, dy: number, dw: number, dh: number): void;
  drawImage(image: ImageHandle, sx: number, sy: number, sw: number, sh: number, dx: number, dy: number, dw: number, dh: number): void;
  createPattern(image: ImageHandle, repetition: string | null): CanvasPattern | null;
};
/** What one draw is told (LLP 1056 D4–D6). */
export interface Frame {
  readonly time: number;
  readonly mounted: number;
  readonly cause: 'mount' | 'args' | 'size' | 'frame' | 'image' | 'font' | 'style';
  readonly causes: readonly string[];
  readonly width: number;
  readonly height: number;
  readonly pixelWidth: number;
  readonly pixelHeight: number;
  readonly scale: number;
}
/** A module's `draw`: true asks for another frame. */
export type Draw = (surface: string, args: any, ctx: Ctx2D, frame: Frame) => boolean;

export type LanguageModelToolSchemas = [];
type SchemaInput<S, D = S extends { $defs: infer Defs } ? Defs : {}> =
    S extends { $ref: `#/$defs/${infer N}` } ? N extends keyof D ? SchemaInput<D[N], D> : any
  : S extends { enum: readonly (infer E)[] } ? E
  : S extends { type: 'string' } ? string
  : S extends { type: 'number' | 'integer' } ? number
  : S extends { type: 'boolean' } ? boolean
  : S extends { type: 'array'; items: infer I } ? SchemaInput<I, D>[]
  : S extends { type: 'array' } ? unknown[]
  : S extends { type: 'object'; properties: infer P }
    ? { [K in keyof P as K extends SchemaRequired<S> ? K : never]: SchemaInput<P[K], D> }
      & { [K in keyof P as K extends SchemaRequired<S> ? never : K]?: SchemaInput<P[K], D> }
  : S extends { type: 'object' } ? Record<string, unknown>
  : any;
type SchemaRequired<S> = S extends { required: readonly (infer K)[] } ? K : never;
type ToolHandler<T> = T extends { inputSchema: infer S } ? (args: SchemaInput<S>, store: Store, storage: Storage) => unknown : never;
type EveryHandler<H> = (H extends unknown ? (handler: H) => void : never) extends (handler: infer I) => void ? I : never;
/** Handlers receive the model's input object, then the data module's store and storage. */
export type LanguageModelToolHandlers<T extends readonly { name: string; inputSchema: unknown }[]> = {
  [N in T[number]['name']]: EveryHandler<ToolHandler<Extract<T[number], { name: N }>>>;
};
/** The handlers named by literal language-model tools in Contract. */
export type LanguageModelTools = LanguageModelToolHandlers<LanguageModelToolSchemas>;
