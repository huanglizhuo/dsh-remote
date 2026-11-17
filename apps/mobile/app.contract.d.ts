// @generated from Contract source signatures; do not edit.
// Static types do not replace runtime shape, identity, or grant checks.
//
// What app.ts writes, in brief (the declarations follow): `sources: TypeScriptSources` has one
// function per source, given its arguments as an array (then store, storage, native) and
// answering its shape, or a Promise of it.
//   answerQuestion: (args: [string, string, string, string, string]) => Reply
//   cancelRun: (args: [string, string, string]) => Reply
//   createSession: (args: [string, string, string]) => Created
//   dropQueued: (args: [string, string, string, string]) => Reply
//   forkFrom: (args: [string, string, string, number]) => Created
//   forkSession: (args: [string, string, string]) => Created
//   killJob: (args: [string, string, string, string]) => Reply
//   loadCall: (args: [string, string, string, string]) => CallDetail
//   loadCommands: (args: [string, string, string]) => CommandsReply
//   loadDevices: (args: [string, string]) => DevicesReply
//   loadLive: (args: [string, string, string, string]) => Snapshot
//   loadModels: (args: [string, string, string]) => ModelsReply
//   loadRows: (args: [string, string, string, number, string]) => Rows
//   pairDevice: (args: [string, string]) => PairReply
//   pairFromLink: (args: [string]) => PairLink
//   queueItem: (args: [string, string, string, string, string, string]) => Reply
//   renameSession: (args: [string, string, string, string]) => Created
//   respondApproval: (args: [string, string, string, boolean, boolean]) => Reply
//   revokeDevice: (args: [string, string, string]) => Reply
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
//   SessionRow = { id: string; pinned: boolean; title: string; running: boolean; cwd: string; updatedAt: number; group: string; first: boolean; when: string }
//   MdItem = { id: string; v: string; sign: string; mark: string; d: number; alt: string; w: number; h: number; dw: number; dh: number }
//   MdNode = { id: string; t: string; v: string; lvl: number; lang: string; alt: string; w: number; h: number; head: string; items: MdItem[]; rows: MdItem[] }
//   DiffLine = { id: string; sign: string; text: string }
//   DiffFile = { id: string; path: string; added: number; removed: number; lines: DiffLine[] }
//   TodoItem = { id: string; text: string; state: string }
//   ChoiceItem = { id: string; text: string; description: string }
//   ImageRow = { id: string; att: string; media: string; w: number; h: number; text: string }
//   FileRow = { id: string; path: string; text: string }
//   BlockRow = { id: string; kind: string; text: string; detail: string; status: string; result: string; nodes: MdNode[]; callId: string; child: string; icon: string; summary: string; args: string; lazy: boolean; badge: string; diffs: DiffFile[]; todos: TodoItem[]; files: FileRow[]; question: string; options: ChoiceItem[]; att: string; media: string; w: number; h: number; images: ImageRow[] }
//   MessageRow = { id: string; role: string; seq: number; text: string; plain: string; usage: string; tools: number; running: number; thought: boolean; interrupted: boolean; took: number; folded: number; shadow: number; blocks: BlockRow[] }
//   ModelRow = { id: string; name: string; provider: string; current: boolean; efforts: string[] }
//   ModelsReply = { currentModel: string; currentProvider: string; currentEffort: string; models: ModelRow[] }
//   DeviceRow = { id: string; name: string; when: string; mine: boolean }
//   DevicesReply = { devices: DeviceRow[] }
//   CommandRow = { name: string; description: string; hint: string }
//   CommandsReply = { commands: CommandRow[] }
//   ApprovalRow = { id: string; toolName: string; reason: string; summary: string; args: string; plan: string; expiresIn: number }
//   WalletRow = { id: string; currency: string; text: string }
//   BalanceView = { signedOut: boolean; failed: boolean; wallets: WalletRow[]; bonus: WalletRow[] }
//   ActivityRow = { label: string; detail: string }
//   StatsRow = { turns: number; steps: number; inTok: number; outTok: number; cacheRead: number }
//   SubagentRow = { id: string; label: string; sessionId: string }
//   JobRow = { id: string; kind: string; label: string; status: string; progress: string; detail: string; when: string }
//   TodoRow = { id: string; text: string; state: string }
//   QueueRow = { id: string; text: string }
//   QuestionRow = { id: string; callId: string; hint: string; ask: string; detail: string; qid: string; multi: boolean; kind: string; options: ChoiceItem[] }
//   PlanStep = { id: string; text: string; state: string }
//   PlanCard = { title: string; steps: PlanStep[] }
//   Snapshot = { listRev: string; rowsRev: string; hasMore: boolean; plan: PlanCard; goal: string; goalId: string; pinned: boolean; archived: boolean; goalPhase: string; sessions: SessionRow[]; sessionTitle: string; sessionModel: string; sessionPermission: string; permissionOptions: OptionRow[]; running: boolean; inherited: boolean; runLabel: string; runActivity: ActivityRow | null; stats: StatsRow; messages: MessageRow[]; approvals: ApprovalRow[]; queue: QueueRow[]; todos: TodoRow[]; jobs: JobRow[]; subagents: SubagentRow[]; question: QuestionRow | null; streamText: string; streamReasoning: string; streamTools: BlockRow[]; balance: BalanceView | null }
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
type T4 = { "id": T0; "pinned": T2; "title": T0; "running": T2; "cwd": T0; "updatedAt": T3; "group": T0; "first": T2; "when": T0; };
type T5 = { "id": T0; "v": T0; "sign": T0; "mark": T0; "d": T3; "alt": T0; "w": T3; "h": T3; "dw": T3; "dh": T3; };
type T6 = T5[];
type T7 = { "id": T0; "t": T0; "v": T0; "lvl": T3; "lang": T0; "alt": T0; "w": T3; "h": T3; "head": T0; "items": T6; "rows": T6; };
type T8 = { "id": T0; "sign": T0; "text": T0; };
type T9 = T8[];
type T10 = { "id": T0; "path": T0; "added": T3; "removed": T3; "lines": T9; };
type T11 = { "id": T0; "text": T0; "state": T0; };
type T12 = { "id": T0; "text": T0; "description": T0; };
type T13 = { "id": T0; "att": T0; "media": T0; "w": T3; "h": T3; "text": T0; };
type T14 = T7[];
type T15 = T10[];
type T16 = T11[];
type T17 = { "id": T0; "path": T0; "text": T0; };
type T18 = T17[];
type T19 = T12[];
type T20 = T13[];
type T21 = { "id": T0; "kind": T0; "text": T0; "detail": T0; "status": T0; "result": T0; "nodes": T14; "callId": T0; "child": T0; "icon": T0; "summary": T0; "args": T0; "lazy": T2; "badge": T0; "diffs": T15; "todos": T16; "files": T18; "question": T0; "options": T19; "att": T0; "media": T0; "w": T3; "h": T3; "images": T20; };
type T22 = T21[];
type T23 = { "id": T0; "role": T0; "seq": T3; "text": T0; "plain": T0; "usage": T0; "tools": T3; "running": T3; "thought": T2; "interrupted": T2; "took": T3; "folded": T3; "shadow": T3; "blocks": T22; };
type T24 = T0[];
type T25 = { "id": T0; "name": T0; "provider": T0; "current": T2; "efforts": T24; };
type T26 = T25[];
type T27 = { "currentModel": T0; "currentProvider": T0; "currentEffort": T0; "models": T26; };
type T28 = { "id": T0; "name": T0; "when": T0; "mine": T2; };
type T29 = T28[];
type T30 = { "devices": T29; };
type T31 = { "name": T0; "description": T0; "hint": T0; };
type T32 = T31[];
type T33 = { "commands": T32; };
type T34 = { "id": T0; "toolName": T0; "reason": T0; "summary": T0; "args": T0; "plan": T0; "expiresIn": T3; };
type T35 = { "id": T0; "currency": T0; "text": T0; };
type T36 = T35[];
type T37 = { "signedOut": T2; "failed": T2; "wallets": T36; "bonus": T36; };
type T38 = { "label": T0; "detail": T0; };
type T39 = { "turns": T3; "steps": T3; "inTok": T3; "outTok": T3; "cacheRead": T3; };
type T40 = { "id": T0; "label": T0; "sessionId": T0; };
type T41 = { "id": T0; "kind": T0; "label": T0; "status": T0; "progress": T0; "detail": T0; "when": T0; };
type T42 = { "id": T0; "text": T0; "state": T0; };
type T43 = { "id": T0; "text": T0; };
type T44 = { "id": T0; "callId": T0; "hint": T0; "ask": T0; "detail": T0; "qid": T0; "multi": T2; "kind": T0; "options": T19; };
type T45 = { "id": T0; "text": T0; "state": T0; };
type T46 = T45[];
type T47 = { "title": T0; "steps": T46; };
type T48 = T4[];
type T49 = T1[];
type T50 = T38 | null;
type T51 = T23[];
type T52 = T34[];
type T53 = T43[];
type T54 = T42[];
type T55 = T41[];
type T56 = T40[];
type T57 = T44 | null;
type T58 = T37 | null;
type T59 = { "listRev": T0; "rowsRev": T0; "hasMore": T2; "plan": T47; "goal": T0; "goalId": T0; "pinned": T2; "archived": T2; "goalPhase": T0; "sessions": T48; "sessionTitle": T0; "sessionModel": T0; "sessionPermission": T0; "permissionOptions": T49; "running": T2; "inherited": T2; "runLabel": T0; "runActivity": T50; "stats": T39; "messages": T51; "approvals": T52; "queue": T53; "todos": T54; "jobs": T55; "subagents": T56; "question": T57; "streamText": T0; "streamReasoning": T0; "streamTools": T22; "balance": T58; };
type T60 = { "rev": T0; "hasMore": T2; "rows": T51; };
type T61 = { "callId": T0; "name": T0; "args": T0; "result": T0; };
type T62 = { "ok": T2; "error": T0; };
type T63 = { "ok": T2; "id": T0; "name": T0; "error": T0; };
type T64 = { "ok": T2; "token": T0; "error": T0; };
type T65 = { "id": T0; "error": T0; };
type T66 = { "ok": T2; "server": T0; "token": T0; "alt": T0; "error": T0; };
type T67 = { "prefersReducedMotion": T2; };
type T68 = { "permanentlyDenied": T2; "shouldShowRationale": T2; };
type T69 = T68 | null;
type T70 = "notDetermined" | "restricted" | "denied" | "authorized";
type T71 = { "authorizationStatus": T70; };
type T72 = T71 | null;
type T73 = "granted" | "prompt" | "denied" | "unknown";
type T74 = { "android": T69; "apple": T72; "available": T2; "state": T73; };
type T75 = T3 | null;
type T76 = { "max": T3; "min": T3; "step": T75; };
type T77 = T0 | null;
type T78 = { "refused": T77; };
type T79 = "audioinput" | "videoinput" | "audiooutput";
type T80 = { "deviceId": T0; "facingMode": T77; "groupId": T0; "kind": T79; "label": T0; };
type T81 = T80[];
type T82 = { "devices": T81; };
type T83 = { "cameraId": T77; "isClientSilenced": T2; "lensFacing": T77; };
type T84 = T83 | null;
type T85 = { "deviceType": T77; "portName": T77; "portType": T77; "position": T77; };
type T86 = T85 | null;
type T87 = T76 | null;
type T88 = T24 | null;
type T89 = T2 | null;
type T90 = { "aspectRatio": T87; "facingMode": T88; "frameRate": T87; "height": T87; "torch": T89; "width": T87; "zoom": T87; };
type T91 = T90 | null;
type T92 = "audio" | "video";
type T93 = "idle" | "interrupted" | "background" | "silenced" | "in-use" | "multitasking" | "system-pressure";
type T94 = T93 | null;
type T95 = "live" | "ended";
type T96 = { "aspectRatio": T75; "autoGainControl": T89; "channelCount": T75; "deviceId": T77; "echoCancellation": T89; "facingMode": T77; "frameRate": T75; "groupId": T77; "height": T75; "latency": T75; "noiseSuppression": T89; "resizeMode": T77; "sampleRate": T75; "sampleSize": T75; "torch": T89; "width": T75; "zoom": T75; };
type T97 = { "android": T84; "apple": T86; "capabilities": T91; "enabled": T2; "id": T0; "kind": T92; "label": T0; "muteReason": T94; "muted": T2; "readyState": T95; "settings": T96; };
type T98 = T97[];
type T99 = { "active": T2; "id": T0; "tracks": T98; };
type T100 = { "aspectRatio": T75; "autoGainControl": T89; "channelCount": T75; "deviceId": T77; "echoCancellation": T89; "facingMode": T77; "frameRate": T75; "groupId": T77; "height": T75; "latency": T75; "noiseSuppression": T89; "resizeMode": T77; "sampleRate": T75; "sampleSize": T75; "torch": T89; "width": T75; "zoom": T75; };
type T101 = { "permanentlyDenied": T2; "shouldShowRationale": T2; };
type T102 = T101 | null;
type T103 = "undetermined" | "denied" | "granted" | "notDetermined" | "restricted" | "authorized";
type T104 = { "recordPermission": T103; };
type T105 = T104 | null;
type T106 = "granted" | "prompt" | "denied" | "unknown";
type T107 = { "android": T102; "apple": T105; "available": T2; "state": T106; };
type T108 = { "x": T3; "y": T3; };
type T109 = { "bundled": T2; };
type T110 = T109 | null;
type T111 = { "symbologies": T24; };
type T112 = T111 | null;
type T113 = { "android": T110; "apple": T112; "formats": T24; "tracks": T2; };
type T114 = { "rawBytes": T77; "valueType": T0; };
type T115 = T114 | null;
type T116 = { "payloadData": T77; "symbology": T0; };
type T117 = T116 | null;
type T118 = { "height": T3; "width": T3; "x": T3; "y": T3; };
type T119 = { "x": T3; "y": T3; };
type T120 = T119[];
type T121 = { "android": T115; "apple": T117; "boundingBox": T118; "cornerPoints": T120; "format": T0; "rawValue": T0; };
type T122 = T121[];
type T123 = { "firstSeen": T3; "format": T0; "frames": T3; "lastSeen": T3; "rawValue": T0; };
type T124 = T123[];
type T125 = "idle" | "scanning" | "ended";
type T126 = { "barcodes": T122; "error": T77; "frame": T3; "height": T3; "seen": T124; "state": T125; "width": T3; };
type T127 = { "barcodes": T122; "height": T3; "width": T3; };
type T128 = { "path": T0; };
type T129 = { "height": T3; "path": T0; "size": T3; "type": T0; "width": T3; };
type T130 = "auto" | "off" | "flash";
type T131 = T130[];
type T132 = { "max": T3; "min": T3; "step": T3; };
type T133 = "never" | "always" | "controllable";
type T134 = { "fillLightMode": T131; "imageHeight": T132; "imageWidth": T132; "redEyeReduction": T133; };
type T135 = { "duration": T3; "height": T3; "path": T0; "size": T3; "type": T0; "width": T3; };
type T136 = { "height": T3; "width": T3; };
type T137 = { "id": T0; };
type T138 = { "id": T3; "name": T0; "url": T0; "tab": T0; "params": T137; "fragment": T0; };
type T139 = T138[];
type T140 = { "name": T0; "stack": T139; };
type T141 = T140[];
type T142 = { "tab": T0; "tabs": T141; "next": T3; };
type T143 = "builtInWideAngleCamera" | "builtInUltraWideCamera" | "builtInTelephotoCamera" | "builtInDualCamera" | "builtInDualWideCamera" | "builtInTripleCamera" | "builtInTrueDepthCamera" | "builtInLiDARDepthCamera" | "continuityCamera" | "deskViewCamera" | "external";
type T144 = T143 | null;
type T145 = "locked" | "autoExpose" | "continuousAutoExposure";
type T146 = T145 | null;
type T147 = T108 | null;
type T148 = "locked" | "autoFocus" | "continuousAutoFocus";
type T149 = T148 | null;
type T150 = { "deviceType": T144; "exposureMode": T146; "exposurePointOfInterest": T147; "focusMode": T149; "focusPointOfInterest": T147; };
type T151 = T150 | null;
type T152 = { "aspectRatio": T75; "facingMode": T77; "frameRate": T75; "height": T75; "resizeMode": T77; "torch": T89; "track": T0; "width": T75; "zoom": T75; "apple": T151; };
type T153 = { "formats": T88; "image": T0; };
type T154 = { "formats": T88; "interval": T75; "track": T0; };
type T155 = { "track": T0; };
type T156 = T100 | null;
type T157 = "mic" | "camcorder" | "voiceRecognition" | "voiceCommunication" | "unprocessed" | "voicePerformance";
type T158 = T157 | null;
type T159 = { "audioSource": T158; "privacySensitive": T89; };
type T160 = T159 | null;
type T161 = "mixWithOthers" | "duckOthers" | "allowBluetoothHFP" | "allowBluetoothA2DP" | "defaultToSpeaker" | "bluetoothHighQualityRecording" | "farFieldInput" | "overrideMutedMicrophoneInterruption";
type T162 = T161[];
type T163 = T162 | null;
type T164 = "builtInWideAngleCamera" | "builtInUltraWideCamera" | "builtInTelephotoCamera" | "builtInDualCamera" | "builtInDualWideCamera" | "builtInTripleCamera" | "builtInTrueDepthCamera" | "builtInLiDARDepthCamera" | "continuityCamera" | "deskViewCamera" | "external";
type T165 = T164 | null;
type T166 = "default" | "measurement" | "voiceChat" | "videoChat" | "videoRecording";
type T167 = T166 | null;
type T168 = "stereo" | "cardioid" | "omnidirectional";
type T169 = T168 | null;
type T170 = { "categoryOptions": T163; "deviceType": T165; "inputDataSource": T77; "mode": T167; "polarPattern": T169; "preferredIOBufferDuration": T75; "prefersNoInterruptionsFromSystemAlerts": T89; };
type T171 = T170 | null;
type T172 = { "audio": T89; "audioConstraints": T156; "video": T89; "videoConstraints": T156; "android": T160; "apple": T171; };
type T173 = { "track": T0; };
type T174 = "user" | "environment";
type T175 = T174 | null;
type T176 = "low" | "high";
type T177 = T176 | null;
type T178 = { "sizeLimit": T75; "videoQuality": T177; };
type T179 = T178 | null;
type T180 = "typeHigh" | "typeMedium" | "typeLow" | "type640x480" | "typeIFrame1280x720" | "typeIFrame960x540";
type T181 = T180 | null;
type T182 = { "videoQuality": T181; };
type T183 = T182 | null;
type T184 = { "facingMode": T175; "maxDuration": T75; "path": T77; "android": T179; "apple": T183; };
type T185 = { "enabled": T2; "track": T0; };
type T186 = { "track": T0; };
type T187 = "auto" | "off" | "flash";
type T188 = T187 | null;
type T189 = "minimizeLatency" | "maximizeQuality" | "zeroShutterLag";
type T190 = T189 | null;
type T191 = "auto" | "on" | "off";
type T192 = T191 | null;
type T193 = { "captureMode": T190; "flashMode": T192; "jpegQuality": T75; "shutterSound": T89; };
type T194 = T193 | null;
type T195 = "jpeg" | "hevc";
type T196 = T195 | null;
type T197 = "auto" | "on" | "off";
type T198 = T197 | null;
type T199 = T136 | null;
type T200 = "speed" | "balanced" | "quality";
type T201 = T200 | null;
type T202 = { "codec": T196; "flashMode": T198; "isAutoRedEyeReductionEnabled": T89; "isShutterSoundSuppressionEnabled": T89; "maxPhotoDimensions": T199; "photoQualityPrioritization": T201; };
type T203 = T202 | null;
type T204 = { "fillLightMode": T188; "imageHeight": T75; "imageWidth": T75; "path": T77; "redEyeReduction": T89; "track": T0; "android": T194; "apple": T203; };
type T205 = "user" | "environment";
type T206 = T205 | null;
type T207 = { "facingMode": T206; "path": T77; };
type T208 = T61 | null;
type T209 = T62 | null;
type T210 = T63 | null;
type T211 = T65 | null;
type T212 = T64 | null;
type T213 = T99 | null;
type T214 = T66 | null;
type T215 = T97 | null;
type T216 = { "scrollLeft": T3; "scrollTop": T3; "scrollWidth": T3; "scrollHeight": T3; "clientWidth": T3; "clientHeight": T3; "firstVisibleKey": T77; "firstVisibleOffset": T3; "scrollZoom": T3; };
type T217 = { "path": T0; "name": T0; "type": T0; "size": T3; "width": T75; "height": T75; "duration": T75; };
type T218 = T217[];

/** Sources called by compiled mutation sends. */
export type MutationSource = "answerQuestion" | "cancelRun" | "createSession" | "dropQueued" | "forkFrom" | "forkSession" | "killJob" | "loadCall" | "pairDevice" | "pairFromLink" | "queueItem" | "renameSession" | "respondApproval" | "revokeDevice" | "runSessionCommand" | "sendPrompt" | "setGoalAction" | "setModel" | "setPermission" | "setSessionFlag" | "skipQuestion" | "uploadPhoto";

export interface SourceMap {
  "answerQuestion": { args: [T0, T0, T0, T0, T0]; result: T62 };
  "cancelRun": { args: [T0, T0, T0]; result: T62 };
  "createSession": { args: [T0, T0, T0]; result: T65 };
  "dropQueued": { args: [T0, T0, T0, T0]; result: T62 };
  "forkFrom": { args: [T0, T0, T0, T3]; result: T65 };
  "forkSession": { args: [T0, T0, T0]; result: T65 };
  "killJob": { args: [T0, T0, T0, T0]; result: T62 };
  "loadCall": { args: [T0, T0, T0, T0]; result: T61 };
  "loadCommands": { args: [T0, T0, T0]; result: T33 };
  "loadDevices": { args: [T0, T0]; result: T30 };
  "loadLive": { args: [T0, T0, T0, T0]; result: T59 };
  "loadModels": { args: [T0, T0, T0]; result: T27 };
  "loadRows": { args: [T0, T0, T0, T3, T0]; result: T60 };
  "pairDevice": { args: [T0, T0]; result: T64 };
  "pairFromLink": { args: [T0]; result: T66 };
  "queueItem": { args: [T0, T0, T0, T0, T0, T0]; result: T62 };
  "renameSession": { args: [T0, T0, T0, T0]; result: T65 };
  "respondApproval": { args: [T0, T0, T0, T2, T2]; result: T62 };
  "revokeDevice": { args: [T0, T0, T0]; result: T62 };
  "runSessionCommand": { args: [T0, T0, T0, T0, T0]; result: T62 };
  "sendPrompt": { args: [T0, T0, T0, T0, T2, T0]; result: T62 };
  "setGoalAction": { args: [T0, T0, T0, T0]; result: T62 };
  "setModel": { args: [T0, T0, T0, T0, T0, T0]; result: T62 };
  "setPermission": { args: [T0, T0, T0, T0]; result: T62 };
  "setSessionFlag": { args: [T0, T0, T0, T0, T2]; result: T62 };
  "skipQuestion": { args: [T0, T0, T0]; result: T62 };
  "uploadPhoto": { args: [T0, T0, T0, T0]; result: T63 };
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
