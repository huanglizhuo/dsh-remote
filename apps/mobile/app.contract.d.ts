// @generated from Contract source signatures; do not edit.
// Static types do not replace runtime shape, identity, or grant checks.
//
// What app.ts writes, in brief (the declarations follow): `sources: TypeScriptSources` has one
// function per source, given its arguments as an array (then store, storage, native) and
// answering its shape, or a Promise of it.
//   answerQuestions: (args: [string, string, string, string]) => Reply
//   cancelRun: (args: [string, string, string]) => Reply
//   clearRating: (args: [string, string, string, string]) => Reply
//   continueGeneration: (args: [string, string, string, number, string]) => Reply
//   createSession: (args: [string, string, string]) => Created
//   deleteSchedule: (args: [string, string, string, string]) => Reply
//   dismissQuestion: (args: [string, string, string]) => Reply
//   dropQueued: (args: [string, string, string, string]) => Reply
//   forkFrom: (args: [string, string, string, number]) => Created
//   forkSession: (args: [string, string, string]) => Created
//   holdQuestion: (args: [string, string, string, string]) => Reply
//   killJob: (args: [string, string, string, string]) => Reply
//   loadCall: (args: [string, string, string, string, string, number]) => CallDetail
//   loadChanges: (args: [string, string, string, number, number, number, string, string]) => ChangesDoc
//   loadCommands: (args: [string, string, string]) => CommandsReply
//   loadDevices: (args: [string, string]) => DevicesReply
//   loadFeedback: (args: [string, string, string]) => FeedbackReply
//   loadFile: (args: [string, string, string, string]) => FileDoc
//   loadJobOutput: (args: [string, string, string, string, number]) => JobOutput
//   loadLive: (args: [string, string, string, string, boolean, string]) => LiveCore
//   loadModels: (args: [string, string, string]) => ModelsReply
//   loadOlder: (args: [string, string, string, number, string]) => History
//   loadRefs: (args: [string, string, string, string, boolean, string]) => RefsReply
//   loadRows: (args: [string, string, string, number, string, string]) => Rows
//   loadSchedules: (args: [string, string, string]) => SchedulesReply
//   openOnMac: (args: [string, string, string, string, string, string]) => Reply
//   pairDevice: (args: [string, string]) => PairReply
//   pairFromLink: (args: [string]) => PairLink
//   queueItem: (args: [string, string, string, string, string, string]) => Reply
//   rateMessage: (args: [string, string, string, string, string, string, string]) => Reply
//   renameSession: (args: [string, string, string, string]) => Created
//   respondApproval: (args: [string, string, string, string]) => Reply
//   revealQuestion: (args: [string, string, string, string]) => Reply
//   revokeDevice: (args: [string, string, string]) => Reply
//   runSchedule: (args: [string, string, string]) => Reply
//   runSessionCommand: (args: [string, string, string, string, string]) => Reply
//   saveSchedule: (args: [string, string, string, string, string, string, string, string, string, string, string, string, string]) => Reply
//   sendPrompt: (args: [string, string, string, string, boolean, string, string, string, string]) => Reply
//   setGoalAction: (args: [string, string, string, string, string]) => Reply
//   setModel: (args: [string, string, string, string, string, string]) => Reply
//   setPermission: (args: [string, string, string, string]) => Reply
//   setSessionFlag: (args: [string, string, string, string, boolean]) => Reply
//   toggleSchedule: (args: [string, string, string, string, boolean]) => Reply
//   uploadFiles: (args: [string, string, string, string, string]) => UploadReply
// The shapes. None is exported: name one by its source, `type Reply = Result<'answerQuestions'>`.
//   OptionRow = { value: string; name: string; description: string }
//   SessionRow = { id: string; pinned: boolean; title: string; running: boolean; cwd: string; updatedAt: number; group: string; first: boolean; when: string; archived: boolean; attention: string; unread: string; subs: number }
//   MdItem = { id: string; v: string; sign: string; mark: string; d: number; alt: string; w: number; h: number; dw: number; dh: number }
//   CodeRun = { id: string; v: string; mark: string }
//   MdCell = { id: string; v: string; a: string }
//   MdRow = { id: string; cells: MdCell[] }
//   MdNode = { id: string; t: string; v: string; lvl: number; lang: string; alt: string; w: number; h: number; items: MdItem[]; runs: CodeRun[]; heads: MdCell[]; grid: MdRow[] }
//   TodoItem = { id: string; text: string; state: string; change: string; label: string; prev: string }
//   ChoiceItem = { id: string; text: string; description: string }
//   ImageRow = { id: string; att: string; w: number; h: number; text: string }
//   FileRow = { id: string; path: string; text: string }
//   AskItem = { id: string; header: string; question: string; answers: string[]; skipped: boolean }
//   AskCard = { state: string; answered: number; total: number; answerable: boolean; callId: string; items: AskItem[] }
//   ToolLine = { id: string; n: number; sign: string; text: string; runs: CodeRun[] }
//   ToolField = { id: string; label: string; value: string }
//   ToolItem = { id: string; title: string; subtitle: string; badge: string; tone: string; text: string; link: string; group: string; md: boolean; fields: ToolField[]; lines: ToolLine[] }
//   ToolPart = { id: string; kind: string; label: string; badge: string; tone: string; text: string; link: string; md: boolean; fold: number; lines: ToolLine[]; items: ToolItem[] }
//   ToolView = { kind: string; head: string; tone: string; more: number; parts: ToolPart[] }
//   BlockRow = { id: string; kind: string; text: string; detail: string; status: string; nodes: MdNode[]; callId: string; child: string; icon: string; summary: string; args: string; lazy: boolean; badge: string; todoSummary: string; todos: TodoItem[]; files: FileRow[]; question: string; options: ChoiceItem[]; att: string; w: number; h: number; images: ImageRow[]; ask: AskCard | null; grp: string; answer: boolean; title: string; suffix: string; added: number; removed: number; view: ToolView }
//   UsageRow = { id: string; label: string; value: string }
//   ChangedFile = { id: string; path: string; name: string; added: number; removed: number; i: number; note: string }
//   MessageRow = { id: string; role: string; seq: number; msgId: string; turn: number; text: string; plain: string; usage: string; usageRows: UsageRow[]; title: string; summary: string; icon: string; state: string; failed: boolean; active: boolean; steered: boolean; foldAll: boolean; foldFinal: boolean; changedCount: number; changesSeq: number; changedAdded: number; changedRemoved: number; changedFiles: ChangedFile[]; day: string; deliverables: FileRow[]; refs: FileRow[]; interrupted: boolean; blocks: BlockRow[]; fold: boolean; grouped: boolean; liveGroup: string }
//   ModelRow = { id: string; name: string; provider: string; current: boolean; efforts: string[] }
//   ModelsReply = { currentEffort: string; models: ModelRow[] }
//   DeviceRow = { id: string; name: string; when: string; mine: boolean }
//   DevicesReply = { devices: DeviceRow[] }
//   CommandRow = { name: string; description: string; hint: string }
//   SkillRow = { name: string; description: string; userOnly: boolean }
//   CommandsReply = { commands: CommandRow[]; skills: SkillRow[] }
//   RefRow = { id: string; kind: string; name: string; detail: string; text: string; done: string; wire: string; section: string; first: boolean }
//   RefsReply = { items: RefRow[] }
//   ApprovalRow = { id: string; toolName: string; reason: string; summary: string; args: string; command: string; subject: string; detail: string; approveLabel: string; alwaysLabel: string }
//   WalletRow = { id: string; currency: string; text: string }
//   BalanceView = { signedOut: boolean; failed: boolean; wallets: WalletRow[]; bonus: WalletRow[] }
//   ActivityRow = { kind: string; label: string; detail: string }
//   StatsRow = { turns: number; steps: number; inTok: number; outTok: number; cacheRead: number; llmMs: number; toolMs: number; ttftMs: number; ttftSteps: number; decodeMs: number; decodeTokens: number }
//   PrefsRow = { transcriptView: string; collapseTiming: string; foldedReplies: string; performanceUsage: string; busyEnter: string }
//   SubagentRow = { id: string; label: string; sessionId: string; sub: string; mode: string; activity: string; state: string; meta: string; depth: number }
//   JobRow = { id: string; kind: string; label: string; status: string; state: string; progress: string; detail: string; when: string }
//   TodoRow = { id: string; text: string; state: string }
//   TaskRow = { id: string; tid: string; title: string; prompt: string; status: string; state: string; kind: string; timing: string; next: string; running: boolean; overdue: boolean; nextAt: string; updatedAt: string; targetSessionId: string; mode: string; date: string; time: string; zone: string; interval: number; unit: string; days: string }
//   TeamRow = { id: string; subject: string; status: string; owner: string }
//   FileDoc = { ok: boolean; kind: string; name: string; bytes: number; text: string; url: string }
//   ChangesDoc = { ok: boolean; kind: string; name: string; added: number; removed: number; created: boolean; deleted: boolean; coarse: boolean; cut: boolean; lines: ToolLine[] }
//   FeedbackItem = { id: string; messageId: string; rating: string; note: string; version: string }
//   FeedbackReply = { items: FeedbackItem[] }
//   JobOutput = { ok: boolean; text: string; more: boolean; status: string }
//   SchedulesReply = { items: TaskRow[]; zone: string; tomorrow: string }
//   QueueRow = { id: string; text: string; images: ImageRow[]; files: FileRow[]; editable: boolean }
//   AskOption = { id: string; value: string; text: string; description: string; recommended: boolean }
//   QuestionItem = { id: string; header: string; question: string; detail: string; multi: boolean; options: AskOption[] }
//   PlanReview = { title: string; description: string; nodes: MdNode[]; approve: string }
//   QuestionRow = { id: string; callId: string; kind: string; state: string; dismissal: string; countdown: number; running: boolean; held: boolean; items: QuestionItem[]; plan: PlanReview | null }
//   PlanStep = { id: string; text: string; state: string }
//   PlanCard = { title: string; steps: PlanStep[] }
//   LimitsRow = { images: number; files: boolean; fileBytes: number }
//   ContextRow = { used: number; total: number; system: number; tools: number; messages: number }
//   LiveCore = { listRev: string; rowsRev: string; plan: PlanCard; goal: string; goalId: string; pinned: boolean; archived: boolean; goalPhase: string; goalActivation: string; goalRounds: number; goalMax: number; goalReason: string; continueSeq: number; planMode: string; limits: LimitsRow; origin: string; subagentMode: string; parentId: string; parentTitle: string; agentLabel: string; subagentProgress: string; sessionCwd: string; bridgeApi: number; bridgeOpen: boolean; sessions: SessionRow[]; sessionTitle: string; sessionModel: string; sessionPermission: string; permissionOptions: OptionRow[]; running: boolean; inherited: boolean; runLabel: string; runActivity: ActivityRow | null; stats: StatsRow; approvals: ApprovalRow[]; queue: QueueRow[]; todos: TodoRow[]; jobs: JobRow[]; subagents: SubagentRow[]; team: TeamRow[]; question: QuestionRow | null; streamBlocks: BlockRow[]; prefs: PrefsRow; balance: BalanceView | null; context: ContextRow | null; quota: string; quotaId: string }
//   Rows = { hasMore: boolean; from: number; turns: number[]; rows: MessageRow[] }
//   History = { session: string; before: number; from: number; hasMore: boolean; rows: MessageRow[] }
//   CallDetail = { callId: string; name: string; title: string; args: string; view: ToolView }
//   Reply = { ok: boolean; error: string }
//   AttRow = { id: string; name: string; kind: string; sid: string; bytes: number }
//   UploadReply = { ok: boolean; error: string; items: AttRow[] }
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
type T4 = { "id": T0; "pinned": T2; "title": T0; "running": T2; "cwd": T0; "updatedAt": T3; "group": T0; "first": T2; "when": T0; "archived": T2; "attention": T0; "unread": T0; "subs": T3; };
type T5 = { "id": T0; "v": T0; "sign": T0; "mark": T0; "d": T3; "alt": T0; "w": T3; "h": T3; "dw": T3; "dh": T3; };
type T6 = { "id": T0; "v": T0; "mark": T0; };
type T7 = { "id": T0; "v": T0; "a": T0; };
type T8 = T7[];
type T9 = { "id": T0; "cells": T8; };
type T10 = T5[];
type T11 = T6[];
type T12 = T9[];
type T13 = { "id": T0; "t": T0; "v": T0; "lvl": T3; "lang": T0; "alt": T0; "w": T3; "h": T3; "items": T10; "runs": T11; "heads": T8; "grid": T12; };
type T14 = { "id": T0; "text": T0; "state": T0; "change": T0; "label": T0; "prev": T0; };
type T15 = { "id": T0; "text": T0; "description": T0; };
type T16 = { "id": T0; "att": T0; "w": T3; "h": T3; "text": T0; };
type T17 = T13[];
type T18 = T14[];
type T19 = { "id": T0; "path": T0; "text": T0; };
type T20 = T19[];
type T21 = T15[];
type T22 = T16[];
type T23 = T0[];
type T24 = { "id": T0; "header": T0; "question": T0; "answers": T23; "skipped": T2; };
type T25 = T24[];
type T26 = { "state": T0; "answered": T3; "total": T3; "answerable": T2; "callId": T0; "items": T25; };
type T27 = T26 | null;
type T28 = { "id": T0; "n": T3; "sign": T0; "text": T0; "runs": T11; };
type T29 = T28[];
type T30 = { "id": T0; "label": T0; "value": T0; };
type T31 = T30[];
type T32 = { "id": T0; "title": T0; "subtitle": T0; "badge": T0; "tone": T0; "text": T0; "link": T0; "group": T0; "md": T2; "fields": T31; "lines": T29; };
type T33 = T32[];
type T34 = { "id": T0; "kind": T0; "label": T0; "badge": T0; "tone": T0; "text": T0; "link": T0; "md": T2; "fold": T3; "lines": T29; "items": T33; };
type T35 = T34[];
type T36 = { "kind": T0; "head": T0; "tone": T0; "more": T3; "parts": T35; };
type T37 = { "id": T0; "kind": T0; "text": T0; "detail": T0; "status": T0; "nodes": T17; "callId": T0; "child": T0; "icon": T0; "summary": T0; "args": T0; "lazy": T2; "badge": T0; "todoSummary": T0; "todos": T18; "files": T20; "question": T0; "options": T21; "att": T0; "w": T3; "h": T3; "images": T22; "ask": T27; "grp": T0; "answer": T2; "title": T0; "suffix": T0; "added": T3; "removed": T3; "view": T36; };
type T38 = { "id": T0; "label": T0; "value": T0; };
type T39 = T38[];
type T40 = { "id": T0; "path": T0; "name": T0; "added": T3; "removed": T3; "i": T3; "note": T0; };
type T41 = T40[];
type T42 = T37[];
type T43 = { "id": T0; "role": T0; "seq": T3; "msgId": T0; "turn": T3; "text": T0; "plain": T0; "usage": T0; "usageRows": T39; "title": T0; "summary": T0; "icon": T0; "state": T0; "failed": T2; "active": T2; "steered": T2; "foldAll": T2; "foldFinal": T2; "changedCount": T3; "changesSeq": T3; "changedAdded": T3; "changedRemoved": T3; "changedFiles": T41; "day": T0; "deliverables": T20; "refs": T20; "interrupted": T2; "blocks": T42; "fold": T2; "grouped": T2; "liveGroup": T0; };
type T44 = { "id": T0; "name": T0; "provider": T0; "current": T2; "efforts": T23; };
type T45 = T44[];
type T46 = { "currentEffort": T0; "models": T45; };
type T47 = { "id": T0; "name": T0; "when": T0; "mine": T2; };
type T48 = T47[];
type T49 = { "devices": T48; };
type T50 = { "name": T0; "description": T0; "hint": T0; };
type T51 = T50[];
type T52 = { "name": T0; "description": T0; "userOnly": T2; };
type T53 = T52[];
type T54 = { "commands": T51; "skills": T53; };
type T55 = { "name": T0; "label": T0; "description": T0; "hint": T0; "kind": T0; "section": T0; "rank": T3; };
type T56 = { "id": T0; "kind": T0; "name": T0; "detail": T0; "text": T0; "done": T0; "wire": T0; "section": T0; "first": T2; };
type T57 = T56[];
type T58 = { "items": T57; };
type T59 = { "id": T0; "toolName": T0; "reason": T0; "summary": T0; "args": T0; "command": T0; "subject": T0; "detail": T0; "approveLabel": T0; "alwaysLabel": T0; };
type T60 = { "id": T0; "currency": T0; "text": T0; };
type T61 = T60[];
type T62 = { "signedOut": T2; "failed": T2; "wallets": T61; "bonus": T61; };
type T63 = { "kind": T0; "label": T0; "detail": T0; };
type T64 = { "turns": T3; "steps": T3; "inTok": T3; "outTok": T3; "cacheRead": T3; "llmMs": T3; "toolMs": T3; "ttftMs": T3; "ttftSteps": T3; "decodeMs": T3; "decodeTokens": T3; };
type T65 = { "transcriptView": T0; "collapseTiming": T0; "foldedReplies": T0; "performanceUsage": T0; "busyEnter": T0; };
type T66 = { "id": T0; "label": T0; "sessionId": T0; "sub": T0; "mode": T0; "activity": T0; "state": T0; "meta": T0; "depth": T3; };
type T67 = { "id": T0; "kind": T0; "label": T0; "status": T0; "state": T0; "progress": T0; "detail": T0; "when": T0; };
type T68 = { "id": T0; "text": T0; "state": T0; };
type T69 = { "id": T0; "tid": T0; "title": T0; "prompt": T0; "status": T0; "state": T0; "kind": T0; "timing": T0; "next": T0; "running": T2; "overdue": T2; "nextAt": T0; "updatedAt": T0; "targetSessionId": T0; "mode": T0; "date": T0; "time": T0; "zone": T0; "interval": T3; "unit": T0; "days": T0; };
type T70 = { "id": T0; "subject": T0; "status": T0; "owner": T0; };
type T71 = { "ok": T2; "kind": T0; "name": T0; "bytes": T3; "text": T0; "url": T0; };
type T72 = { "ok": T2; "kind": T0; "name": T0; "added": T3; "removed": T3; "created": T2; "deleted": T2; "coarse": T2; "cut": T2; "lines": T29; };
type T73 = { "id": T0; "messageId": T0; "rating": T0; "note": T0; "version": T0; };
type T74 = T73[];
type T75 = { "items": T74; };
type T76 = { "ok": T2; "text": T0; "more": T2; "status": T0; };
type T77 = T69[];
type T78 = { "items": T77; "zone": T0; "tomorrow": T0; };
type T79 = { "id": T0; "text": T0; "images": T22; "files": T20; "editable": T2; };
type T80 = { "id": T0; "value": T0; "text": T0; "description": T0; "recommended": T2; };
type T81 = T80[];
type T82 = { "id": T0; "header": T0; "question": T0; "detail": T0; "multi": T2; "options": T81; };
type T83 = T82[];
type T84 = { "title": T0; "description": T0; "nodes": T17; "approve": T0; };
type T85 = T84 | null;
type T86 = { "id": T0; "callId": T0; "kind": T0; "state": T0; "dismissal": T0; "countdown": T3; "running": T2; "held": T2; "items": T83; "plan": T85; };
type T87 = { "id": T0; "text": T0; "state": T0; };
type T88 = T87[];
type T89 = { "title": T0; "steps": T88; };
type T90 = { "images": T3; "files": T2; "fileBytes": T3; };
type T91 = T4[];
type T92 = T1[];
type T93 = T63 | null;
type T94 = T59[];
type T95 = T79[];
type T96 = T68[];
type T97 = T67[];
type T98 = T66[];
type T99 = T70[];
type T100 = T86 | null;
type T101 = T62 | null;
type T102 = { "used": T3; "total": T3; "system": T3; "tools": T3; "messages": T3; };
type T103 = T102 | null;
type T104 = { "listRev": T0; "rowsRev": T0; "plan": T89; "goal": T0; "goalId": T0; "pinned": T2; "archived": T2; "goalPhase": T0; "goalActivation": T0; "goalRounds": T3; "goalMax": T3; "goalReason": T0; "continueSeq": T3; "planMode": T0; "limits": T90; "origin": T0; "subagentMode": T0; "parentId": T0; "parentTitle": T0; "agentLabel": T0; "subagentProgress": T0; "sessionCwd": T0; "bridgeApi": T3; "bridgeOpen": T2; "sessions": T91; "sessionTitle": T0; "sessionModel": T0; "sessionPermission": T0; "permissionOptions": T92; "running": T2; "inherited": T2; "runLabel": T0; "runActivity": T93; "stats": T64; "approvals": T94; "queue": T95; "todos": T96; "jobs": T97; "subagents": T98; "team": T99; "question": T100; "streamBlocks": T42; "prefs": T65; "balance": T101; "context": T103; "quota": T0; "quotaId": T0; };
type T105 = T3[];
type T106 = T43[];
type T107 = { "hasMore": T2; "from": T3; "turns": T105; "rows": T106; };
type T108 = { "session": T0; "before": T3; "from": T3; "hasMore": T2; "rows": T106; };
type T109 = { "callId": T0; "name": T0; "title": T0; "args": T0; "view": T36; };
type T110 = { "ok": T2; "error": T0; };
type T111 = { "id": T0; "name": T0; "kind": T0; "sid": T0; "bytes": T3; };
type T112 = T111[];
type T113 = { "ok": T2; "error": T0; "items": T112; };
type T114 = { "ok": T2; "token": T0; "error": T0; };
type T115 = { "id": T0; "error": T0; };
type T116 = { "ok": T2; "server": T0; "token": T0; "alt": T0; "error": T0; };
type T117 = { "prefersReducedMotion": T2; };
type T118 = { "permanentlyDenied": T2; "shouldShowRationale": T2; };
type T119 = T118 | null;
type T120 = "notDetermined" | "restricted" | "denied" | "authorized";
type T121 = { "authorizationStatus": T120; };
type T122 = T121 | null;
type T123 = "granted" | "prompt" | "denied" | "unknown";
type T124 = { "android": T119; "apple": T122; "available": T2; "state": T123; };
type T125 = T3 | null;
type T126 = { "max": T3; "min": T3; "step": T125; };
type T127 = T0 | null;
type T128 = { "refused": T127; };
type T129 = "audioinput" | "videoinput" | "audiooutput";
type T130 = { "deviceId": T0; "facingMode": T127; "groupId": T0; "kind": T129; "label": T0; };
type T131 = T130[];
type T132 = { "devices": T131; };
type T133 = { "cameraId": T127; "isClientSilenced": T2; "lensFacing": T127; };
type T134 = T133 | null;
type T135 = { "deviceType": T127; "portName": T127; "portType": T127; "position": T127; };
type T136 = T135 | null;
type T137 = T126 | null;
type T138 = T23 | null;
type T139 = T2 | null;
type T140 = { "aspectRatio": T137; "facingMode": T138; "frameRate": T137; "height": T137; "torch": T139; "width": T137; "zoom": T137; };
type T141 = T140 | null;
type T142 = "audio" | "video";
type T143 = "idle" | "interrupted" | "background" | "silenced" | "in-use" | "multitasking" | "system-pressure";
type T144 = T143 | null;
type T145 = "live" | "ended";
type T146 = { "aspectRatio": T125; "autoGainControl": T139; "channelCount": T125; "deviceId": T127; "echoCancellation": T139; "facingMode": T127; "frameRate": T125; "groupId": T127; "height": T125; "latency": T125; "noiseSuppression": T139; "resizeMode": T127; "sampleRate": T125; "sampleSize": T125; "torch": T139; "width": T125; "zoom": T125; };
type T147 = { "android": T134; "apple": T136; "capabilities": T141; "enabled": T2; "id": T0; "kind": T142; "label": T0; "muteReason": T144; "muted": T2; "readyState": T145; "settings": T146; };
type T148 = T147[];
type T149 = { "active": T2; "id": T0; "tracks": T148; };
type T150 = { "aspectRatio": T125; "autoGainControl": T139; "channelCount": T125; "deviceId": T127; "echoCancellation": T139; "facingMode": T127; "frameRate": T125; "groupId": T127; "height": T125; "latency": T125; "noiseSuppression": T139; "resizeMode": T127; "sampleRate": T125; "sampleSize": T125; "torch": T139; "width": T125; "zoom": T125; };
type T151 = { "permanentlyDenied": T2; "shouldShowRationale": T2; };
type T152 = T151 | null;
type T153 = "undetermined" | "denied" | "granted" | "notDetermined" | "restricted" | "authorized";
type T154 = { "recordPermission": T153; };
type T155 = T154 | null;
type T156 = "granted" | "prompt" | "denied" | "unknown";
type T157 = { "android": T152; "apple": T155; "available": T2; "state": T156; };
type T158 = { "x": T3; "y": T3; };
type T159 = { "bundled": T2; };
type T160 = T159 | null;
type T161 = { "symbologies": T23; };
type T162 = T161 | null;
type T163 = { "android": T160; "apple": T162; "formats": T23; "tracks": T2; };
type T164 = { "rawBytes": T127; "valueType": T0; };
type T165 = T164 | null;
type T166 = { "payloadData": T127; "symbology": T0; };
type T167 = T166 | null;
type T168 = { "height": T3; "width": T3; "x": T3; "y": T3; };
type T169 = { "x": T3; "y": T3; };
type T170 = T169[];
type T171 = { "android": T165; "apple": T167; "boundingBox": T168; "cornerPoints": T170; "format": T0; "rawValue": T0; };
type T172 = T171[];
type T173 = { "firstSeen": T3; "format": T0; "frames": T3; "lastSeen": T3; "rawValue": T0; };
type T174 = T173[];
type T175 = "idle" | "scanning" | "ended";
type T176 = { "barcodes": T172; "error": T127; "frame": T3; "height": T3; "seen": T174; "state": T175; "width": T3; };
type T177 = { "barcodes": T172; "height": T3; "width": T3; };
type T178 = { "path": T0; };
type T179 = { "height": T3; "path": T0; "size": T3; "type": T0; "width": T3; };
type T180 = "auto" | "off" | "flash";
type T181 = T180[];
type T182 = { "max": T3; "min": T3; "step": T3; };
type T183 = "never" | "always" | "controllable";
type T184 = { "fillLightMode": T181; "imageHeight": T182; "imageWidth": T182; "redEyeReduction": T183; };
type T185 = { "duration": T3; "height": T3; "path": T0; "size": T3; "type": T0; "width": T3; };
type T186 = { "height": T3; "width": T3; };
type T187 = { "id": T0; };
type T188 = { "id": T3; "name": T0; "url": T0; "tab": T0; "params": T187; "fragment": T0; };
type T189 = T188[];
type T190 = { "name": T0; "stack": T189; };
type T191 = T190[];
type T192 = { "tab": T0; "tabs": T191; "next": T3; };
type T193 = T86[];
type T194 = T55[];
type T195 = T55 | null;
type T196 = T43 | null;
type T197 = "builtInWideAngleCamera" | "builtInUltraWideCamera" | "builtInTelephotoCamera" | "builtInDualCamera" | "builtInDualWideCamera" | "builtInTripleCamera" | "builtInTrueDepthCamera" | "builtInLiDARDepthCamera" | "continuityCamera" | "deskViewCamera" | "external";
type T198 = T197 | null;
type T199 = "locked" | "autoExpose" | "continuousAutoExposure";
type T200 = T199 | null;
type T201 = T158 | null;
type T202 = "locked" | "autoFocus" | "continuousAutoFocus";
type T203 = T202 | null;
type T204 = { "deviceType": T198; "exposureMode": T200; "exposurePointOfInterest": T201; "focusMode": T203; "focusPointOfInterest": T201; };
type T205 = T204 | null;
type T206 = { "aspectRatio": T125; "facingMode": T127; "frameRate": T125; "height": T125; "resizeMode": T127; "torch": T139; "track": T0; "width": T125; "zoom": T125; "apple": T205; };
type T207 = { "formats": T138; "image": T0; };
type T208 = { "formats": T138; "interval": T125; "track": T0; };
type T209 = { "track": T0; };
type T210 = T150 | null;
type T211 = "mic" | "camcorder" | "voiceRecognition" | "voiceCommunication" | "unprocessed" | "voicePerformance";
type T212 = T211 | null;
type T213 = { "audioSource": T212; "privacySensitive": T139; };
type T214 = T213 | null;
type T215 = "mixWithOthers" | "duckOthers" | "allowBluetoothHFP" | "allowBluetoothA2DP" | "defaultToSpeaker" | "bluetoothHighQualityRecording" | "farFieldInput" | "overrideMutedMicrophoneInterruption";
type T216 = T215[];
type T217 = T216 | null;
type T218 = "builtInWideAngleCamera" | "builtInUltraWideCamera" | "builtInTelephotoCamera" | "builtInDualCamera" | "builtInDualWideCamera" | "builtInTripleCamera" | "builtInTrueDepthCamera" | "builtInLiDARDepthCamera" | "continuityCamera" | "deskViewCamera" | "external";
type T219 = T218 | null;
type T220 = "default" | "measurement" | "voiceChat" | "videoChat" | "videoRecording";
type T221 = T220 | null;
type T222 = "stereo" | "cardioid" | "omnidirectional";
type T223 = T222 | null;
type T224 = { "categoryOptions": T217; "deviceType": T219; "inputDataSource": T127; "mode": T221; "polarPattern": T223; "preferredIOBufferDuration": T125; "prefersNoInterruptionsFromSystemAlerts": T139; };
type T225 = T224 | null;
type T226 = { "audio": T139; "audioConstraints": T210; "video": T139; "videoConstraints": T210; "android": T214; "apple": T225; };
type T227 = { "track": T0; };
type T228 = "user" | "environment";
type T229 = T228 | null;
type T230 = "low" | "high";
type T231 = T230 | null;
type T232 = { "sizeLimit": T125; "videoQuality": T231; };
type T233 = T232 | null;
type T234 = "typeHigh" | "typeMedium" | "typeLow" | "type640x480" | "typeIFrame1280x720" | "typeIFrame960x540";
type T235 = T234 | null;
type T236 = { "videoQuality": T235; };
type T237 = T236 | null;
type T238 = { "facingMode": T229; "maxDuration": T125; "path": T127; "android": T233; "apple": T237; };
type T239 = { "enabled": T2; "track": T0; };
type T240 = { "track": T0; };
type T241 = "auto" | "off" | "flash";
type T242 = T241 | null;
type T243 = "minimizeLatency" | "maximizeQuality" | "zeroShutterLag";
type T244 = T243 | null;
type T245 = "auto" | "on" | "off";
type T246 = T245 | null;
type T247 = { "captureMode": T244; "flashMode": T246; "jpegQuality": T125; "shutterSound": T139; };
type T248 = T247 | null;
type T249 = "jpeg" | "hevc";
type T250 = T249 | null;
type T251 = "auto" | "on" | "off";
type T252 = T251 | null;
type T253 = T186 | null;
type T254 = "speed" | "balanced" | "quality";
type T255 = T254 | null;
type T256 = { "codec": T250; "flashMode": T252; "isAutoRedEyeReductionEnabled": T139; "isShutterSoundSuppressionEnabled": T139; "maxPhotoDimensions": T253; "photoQualityPrioritization": T255; };
type T257 = T256 | null;
type T258 = { "fillLightMode": T242; "imageHeight": T125; "imageWidth": T125; "path": T127; "redEyeReduction": T139; "track": T0; "android": T248; "apple": T257; };
type T259 = "user" | "environment";
type T260 = T259 | null;
type T261 = { "facingMode": T260; "path": T127; };
type T262 = T109 | null;
type T263 = T108 | null;
type T264 = T110 | null;
type T265 = T113 | null;
type T266 = T115 | null;
type T267 = T114 | null;
type T268 = T149 | null;
type T269 = T116 | null;
type T270 = T147 | null;
type T271 = { "scrollLeft": T3; "scrollTop": T3; "scrollWidth": T3; "scrollHeight": T3; "clientWidth": T3; "clientHeight": T3; "firstVisibleKey": T127; "firstVisibleOffset": T3; "scrollZoom": T3; };
type T272 = { "path": T0; "name": T0; "type": T0; "size": T3; "width": T125; "height": T125; "duration": T125; };
type T273 = T272[];

/** Sources called by compiled mutation sends. */
export type MutationSource = "answerQuestions" | "cancelRun" | "clearRating" | "continueGeneration" | "createSession" | "deleteSchedule" | "dismissQuestion" | "dropQueued" | "forkFrom" | "forkSession" | "holdQuestion" | "killJob" | "loadCall" | "loadOlder" | "openOnMac" | "pairDevice" | "pairFromLink" | "queueItem" | "rateMessage" | "renameSession" | "respondApproval" | "revealQuestion" | "revokeDevice" | "runSchedule" | "runSessionCommand" | "saveSchedule" | "sendPrompt" | "setGoalAction" | "setModel" | "setPermission" | "setSessionFlag" | "toggleSchedule" | "uploadFiles";

export interface SourceMap {
  "answerQuestions": { args: [T0, T0, T0, T0]; result: T110 };
  "cancelRun": { args: [T0, T0, T0]; result: T110 };
  "clearRating": { args: [T0, T0, T0, T0]; result: T110 };
  "continueGeneration": { args: [T0, T0, T0, T3, T0]; result: T110 };
  "createSession": { args: [T0, T0, T0]; result: T115 };
  "deleteSchedule": { args: [T0, T0, T0, T0]; result: T110 };
  "dismissQuestion": { args: [T0, T0, T0]; result: T110 };
  "dropQueued": { args: [T0, T0, T0, T0]; result: T110 };
  "forkFrom": { args: [T0, T0, T0, T3]; result: T115 };
  "forkSession": { args: [T0, T0, T0]; result: T115 };
  "holdQuestion": { args: [T0, T0, T0, T0]; result: T110 };
  "killJob": { args: [T0, T0, T0, T0]; result: T110 };
  "loadCall": { args: [T0, T0, T0, T0, T0, T3]; result: T109 };
  "loadChanges": { args: [T0, T0, T0, T3, T3, T3, T0, T0]; result: T72 };
  "loadCommands": { args: [T0, T0, T0]; result: T54 };
  "loadDevices": { args: [T0, T0]; result: T49 };
  "loadFeedback": { args: [T0, T0, T0]; result: T75 };
  "loadFile": { args: [T0, T0, T0, T0]; result: T71 };
  "loadJobOutput": { args: [T0, T0, T0, T0, T3]; result: T76 };
  "loadLive": { args: [T0, T0, T0, T0, T2, T0]; result: T104 };
  "loadModels": { args: [T0, T0, T0]; result: T46 };
  "loadOlder": { args: [T0, T0, T0, T3, T0]; result: T108 };
  "loadRefs": { args: [T0, T0, T0, T0, T2, T0]; result: T58 };
  "loadRows": { args: [T0, T0, T0, T3, T0, T0]; result: T107 };
  "loadSchedules": { args: [T0, T0, T0]; result: T78 };
  "openOnMac": { args: [T0, T0, T0, T0, T0, T0]; result: T110 };
  "pairDevice": { args: [T0, T0]; result: T114 };
  "pairFromLink": { args: [T0]; result: T116 };
  "queueItem": { args: [T0, T0, T0, T0, T0, T0]; result: T110 };
  "rateMessage": { args: [T0, T0, T0, T0, T0, T0, T0]; result: T110 };
  "renameSession": { args: [T0, T0, T0, T0]; result: T115 };
  "respondApproval": { args: [T0, T0, T0, T0]; result: T110 };
  "revealQuestion": { args: [T0, T0, T0, T0]; result: T110 };
  "revokeDevice": { args: [T0, T0, T0]; result: T110 };
  "runSchedule": { args: [T0, T0, T0]; result: T110 };
  "runSessionCommand": { args: [T0, T0, T0, T0, T0]; result: T110 };
  "saveSchedule": { args: [T0, T0, T0, T0, T0, T0, T0, T0, T0, T0, T0, T0, T0]; result: T110 };
  "sendPrompt": { args: [T0, T0, T0, T0, T2, T0, T0, T0, T0]; result: T110 };
  "setGoalAction": { args: [T0, T0, T0, T0, T0]; result: T110 };
  "setModel": { args: [T0, T0, T0, T0, T0, T0]; result: T110 };
  "setPermission": { args: [T0, T0, T0, T0]; result: T110 };
  "setSessionFlag": { args: [T0, T0, T0, T0, T2]; result: T110 };
  "toggleSchedule": { args: [T0, T0, T0, T0, T2]; result: T110 };
  "uploadFiles": { args: [T0, T0, T0, T0, T0]; result: T113 };
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
