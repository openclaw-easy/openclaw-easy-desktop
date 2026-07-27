import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'
import { repairWeixinTypingImport, repairInstalledWeixinPlugin } from './weixin-plugin-repair'

// The exact line shipped in @tencent-weixin/openclaw-weixin@2.4.6
// dist/src/messaging/process-message.js — the import upstream deleted.
const BROKEN_LINE = 'import { createTypingCallbacks } from "openclaw/plugin-sdk/channel-runtime";'
const REPAIRED_LINE = 'import { createTypingCallbacks } from "openclaw/plugin-sdk/channel-outbound";'

describe('repairWeixinTypingImport', () => {
  it('rewrites the broken channel-runtime import to channel-outbound', () => {
    const src = `import path from "node:path";\n${BROKEN_LINE}\nconst x = 1;\n`
    const result = repairWeixinTypingImport(src)
    expect(result.changed).toBe(true)
    expect(result.source).toContain(REPAIRED_LINE)
    expect(result.source).not.toContain('channel-runtime')
  })

  it('is idempotent on already-repaired source', () => {
    const result = repairWeixinTypingImport(`${REPAIRED_LINE}\n`)
    expect(result.changed).toBe(false)
  })

  it('handles single-quoted specifiers', () => {
    const result = repairWeixinTypingImport(
      "import { createTypingCallbacks } from 'openclaw/plugin-sdk/channel-runtime';\n",
    )
    expect(result.changed).toBe(true)
    expect(result.source).toContain("'openclaw/plugin-sdk/channel-outbound'")
  })

  it('leaves multi-binding channel-runtime imports alone', () => {
    // Other bindings may not exist in channel-outbound — moving them blindly
    // would swap an import-time crash for a different import-time crash.
    const src = 'import { createTypingCallbacks, somethingElse } from "openclaw/plugin-sdk/channel-runtime";\n'
    expect(repairWeixinTypingImport(src).changed).toBe(false)
  })

  it('leaves other specifiers and modules alone', () => {
    const src =
      'import { createTypingCallbacks } from "openclaw/plugin-sdk/channel-outbound";\n' +
      'import { other } from "openclaw/plugin-sdk/channel-runtime";\n'
    expect(repairWeixinTypingImport(src).changed).toBe(false)
  })
})

describe('repairInstalledWeixinPlugin', () => {
  let tmpDir: string

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'weixin-repair-test-'))
  })

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  function seedPlugin(projectSuffix: string, files: Record<string, string>): string {
    const distDir = path.join(
      tmpDir, 'npm', 'projects', `tencent-weixin-openclaw-weixin-${projectSuffix}`,
      'node_modules', '@tencent-weixin', 'openclaw-weixin', 'dist',
    )
    for (const [rel, content] of Object.entries(files)) {
      const full = path.join(distDir, rel)
      fs.mkdirSync(path.dirname(full), { recursive: true })
      fs.writeFileSync(full, content)
    }
    return distDir
  }

  it('repairs broken imports across the installed dist and reports the files', () => {
    const distDir = seedPlugin('abc123', {
      'src/messaging/process-message.js': `${BROKEN_LINE}\nexport const x = 1;\n`,
      'src/messaging/send.js': 'export const send = () => {};\n',
    })
    const { changedFiles } = repairInstalledWeixinPlugin(tmpDir)
    expect(changedFiles).toEqual([path.join(distDir, 'src', 'messaging', 'process-message.js')])
    const repaired = fs.readFileSync(changedFiles[0], 'utf8')
    expect(repaired).toContain(REPAIRED_LINE)
  })

  it('is a no-op on a repaired install and when nothing is installed', () => {
    seedPlugin('abc123', { 'src/messaging/process-message.js': `${REPAIRED_LINE}\n` })
    expect(repairInstalledWeixinPlugin(tmpDir).changedFiles).toEqual([])
    expect(repairInstalledWeixinPlugin(path.join(tmpDir, 'nope')).changedFiles).toEqual([])
  })
})
