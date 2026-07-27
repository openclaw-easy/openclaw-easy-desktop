import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'
import { MemoryManager } from './memory-manager'

const STATUS_JSON = JSON.stringify([
  { agentId: 'main', status: { files: 2, chunks: 9, dirty: false, workspaceDir: '/tmp/ws', provider: 'openai' } },
])

function makeManager(outputs: Record<string, string | Error> = {}) {
  const calls: string[][] = []
  const executor = {
    executeCommand: vi.fn(async (args: string[]) => {
      calls.push(args)
      const key = args.slice(0, 2).join(' ')
      const out = outputs[key]
      if (out instanceof Error) throw out
      return out ?? ''
    }),
  }
  return { mgr: new MemoryManager(executor), calls }
}

describe('MemoryManager', () => {
  let ws: string

  beforeEach(() => {
    ws = fs.mkdtempSync(path.join(os.tmpdir(), 'memory-manager-test-'))
  })

  afterEach(() => {
    fs.rmSync(ws, { recursive: true, force: true })
  })

  it('parses the per-agent status array', async () => {
    const { mgr } = makeManager({ 'memory status': STATUS_JSON })
    const res = await mgr.getStatus()
    expect(res.success).toBe(true)
    expect(res.status).toMatchObject({ agentId: 'main', files: 2, chunks: 9, dirty: false, workspaceDir: '/tmp/ws' })
  })

  it('lists MEMORY.md and memory/*.md only', async () => {
    fs.writeFileSync(path.join(ws, 'MEMORY.md'), '# index')
    fs.mkdirSync(path.join(ws, 'memory'))
    fs.writeFileSync(path.join(ws, 'memory', 'facts.md'), 'fact')
    fs.writeFileSync(path.join(ws, 'memory', 'ignore.txt'), 'not md')
    fs.writeFileSync(path.join(ws, 'SOUL.md'), 'not memory') // workspace file, not memory surface
    const { mgr } = makeManager()
    const res = await mgr.listFiles(ws)
    expect(res.success).toBe(true)
    expect(res.files.map((f) => f.relPath).sort()).toEqual(['MEMORY.md', path.join('memory', 'facts.md')])
  })

  it('reads only files inside the memory surface', async () => {
    fs.writeFileSync(path.join(ws, 'MEMORY.md'), 'remembered')
    const { mgr } = makeManager()
    expect((await mgr.readFileContent(ws, 'MEMORY.md')).content).toBe('remembered')
    // Containment: escapes and non-memory workspace files are refused.
    expect((await mgr.readFileContent(ws, '../outside.md')).success).toBe(false)
    expect((await mgr.readFileContent(ws, 'SOUL.md')).success).toBe(false)
    expect((await mgr.readFileContent(ws, 'memory/../SOUL.md')).success).toBe(false)
  })

  it('deletes a memory file and reindexes', async () => {
    fs.mkdirSync(path.join(ws, 'memory'))
    const target = path.join(ws, 'memory', 'gone.md')
    fs.writeFileSync(target, 'bye')
    const { mgr, calls } = makeManager()
    const res = await mgr.deleteFile(ws, 'memory/gone.md')
    expect(res.success).toBe(true)
    expect(fs.existsSync(target)).toBe(false)
    expect(calls).toContainEqual(['memory', 'index'])
  })

  it('returns empty results for a blank search without spawning the CLI', async () => {
    const { mgr, calls } = makeManager()
    expect(await mgr.search('   ')).toEqual({ success: true, results: [] })
    expect(calls).toHaveLength(0)
  })
})
