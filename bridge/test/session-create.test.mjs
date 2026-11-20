// Plain-assert checks for the phone's workspace-shaped create. Run: node bridge/test/session-create.test.mjs
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { workspaceForCwd } from '../lib/index.js'

// An exact registered path matches by id (entity shape `w.path`); the registry
// stores canonical spellings (macOS /var → /private/var), so register realpath
{
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ws-a-')))
  const hit = workspaceForCwd(dir, [{ id: 'ws1', path: dir }])
  assert.equal(hit?.id, 'ws1')
}

// A symlinked spelling canonicalizes onto the registered canonical path (entity shape `w.record.path`)
{
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ws-b-'))
  const link = path.join(os.tmpdir(), `ws-b-link-${path.basename(dir)}`)
  fs.rmSync(link, { force: true })
  fs.symlinkSync(dir, link)
  const hit = workspaceForCwd(link, [{ id: 'ws2', record: { path: fs.realpathSync(dir) } }])
  assert.equal(hit?.id, 'ws2')
  fs.rmSync(link, { force: true })
}

// An unregistered directory resolves to null (the handler then registers one or falls back to cwd)
{
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ws-c-'))
  assert.equal(workspaceForCwd(dir, []), null)
  assert.equal(workspaceForCwd(dir, [{ id: 'ws3', path: '/elsewhere' }]), null)
}

// Missing directories still resolve defensively (path.resolve fallback) and match an equal record
{
  const ghost = path.resolve(os.tmpdir(), 'ws-missing-dir')
  const hit = workspaceForCwd(ghost, [{ id: 'ws4', path: ghost }])
  assert.equal(hit?.id, 'ws4')
}

// Blank workspaces lists match nothing
assert.equal(workspaceForCwd('/tmp', null), null)
assert.equal(workspaceForCwd('/tmp', undefined), null)

console.log('session-create: all assertions passed')
