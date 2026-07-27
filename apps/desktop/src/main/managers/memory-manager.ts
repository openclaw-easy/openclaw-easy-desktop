import * as path from 'path'
import * as os from 'os'
import { existsSync, readdirSync, statSync } from 'fs'
import { readFile, rm } from 'fs/promises'
import type { OpenClawCommandExecutor } from './openclaw-command-executor'

/** Narrow seam so tests can inject a fake without Electron. */
type CommandRunner = Pick<OpenClawCommandExecutor, 'executeCommand'>

/**
 * Desktop surface for OpenClaw agent memory.
 *
 * Upstream layout (memory-core): long-term memory lives as Markdown in the
 * agent workspace — `MEMORY.md` at the root plus `memory/*.md` — indexed
 * into the per-agent SQLite store for search. The CLI is the supported
 * client for status/search/reindex (`openclaw memory status|search|index`);
 * the files themselves are plain Markdown the operator may read or delete.
 */

export interface MemoryStatus {
  agentId: string
  files: number
  chunks: number
  dirty: boolean
  workspaceDir: string
  provider?: string
}

export interface MemoryFileInfo {
  /** Path relative to the workspace root (e.g. "MEMORY.md", "memory/notes.md"). */
  relPath: string
  sizeBytes: number
  modifiedAtMs: number
}

export interface MemorySearchResult {
  path?: string
  snippet?: string
  score?: number
  [key: string]: unknown
}

export class MemoryManager {
  constructor(private executor: CommandRunner) {}

  private fallbackWorkspaceDir(): string {
    return path.join(os.homedir(), '.openclaw', 'workspace')
  }

  async getStatus(): Promise<{ success: boolean; status?: MemoryStatus; error?: string }> {
    try {
      const result = await this.executor.executeCommand(['memory', 'status', '--json'], 30000)
      if (!result) return { success: false, error: 'No status output from memory CLI' }
      const data = JSON.parse(result)
      const entry = Array.isArray(data) ? data[0] : data
      const s = entry?.status ?? {}
      return {
        success: true,
        status: {
          agentId: entry?.agentId ?? 'main',
          files: Number(s.files) || 0,
          chunks: Number(s.chunks) || 0,
          dirty: s.dirty === true,
          workspaceDir: typeof s.workspaceDir === 'string' && s.workspaceDir
            ? s.workspaceDir
            : this.fallbackWorkspaceDir(),
          provider: s.provider,
        },
      }
    } catch (error: any) {
      console.error('[MemoryManager] Failed to get status:', error)
      return { success: false, error: error.message || 'Failed to get memory status' }
    }
  }

  async search(query: string): Promise<{ success: boolean; results?: MemorySearchResult[]; error?: string }> {
    const trimmed = query.trim()
    if (!trimmed) return { success: true, results: [] }
    try {
      const result = await this.executor.executeCommand(
        ['memory', 'search', trimmed, '--json', '--max-results', '20'],
        30000,
      )
      if (!result) return { success: true, results: [] }
      const data = JSON.parse(result)
      const results = Array.isArray(data) ? data : data.results || []
      return { success: true, results: Array.isArray(results) ? results : [] }
    } catch (error: any) {
      console.error('[MemoryManager] Search failed:', error)
      return { success: false, error: error.message || 'Memory search failed' }
    }
  }

  async reindex(): Promise<{ success: boolean; error?: string }> {
    try {
      // Full reindex embeds every chunk; give it room.
      await this.executor.executeCommand(['memory', 'index'], 120000)
      return { success: true }
    } catch (error: any) {
      console.error('[MemoryManager] Reindex failed:', error)
      return { success: false, error: error.message || 'Memory reindex failed' }
    }
  }

  /**
   * Enumerate the memory Markdown files (MEMORY.md + memory/*.md).
   * Read-only filesystem access; the workspace dir comes from `getStatus`
   * so the desktop follows whatever workspace the agent actually uses.
   */
  async listFiles(workspaceDir?: string): Promise<{ success: boolean; workspaceDir: string; files: MemoryFileInfo[]; error?: string }> {
    const root = workspaceDir || this.fallbackWorkspaceDir()
    const files: MemoryFileInfo[] = []
    try {
      const candidates: string[] = []
      const memoryMd = path.join(root, 'MEMORY.md')
      if (existsSync(memoryMd)) candidates.push(memoryMd)
      const memoryDir = path.join(root, 'memory')
      if (existsSync(memoryDir)) {
        for (const entry of readdirSync(memoryDir)) {
          if (entry.endsWith('.md')) candidates.push(path.join(memoryDir, entry))
        }
      }
      for (const full of candidates) {
        const stat = statSync(full)
        if (!stat.isFile()) continue
        files.push({
          relPath: path.relative(root, full),
          sizeBytes: stat.size,
          modifiedAtMs: stat.mtimeMs,
        })
      }
      return { success: true, workspaceDir: root, files }
    } catch (error: any) {
      console.error('[MemoryManager] Failed to list memory files:', error)
      return { success: false, workspaceDir: root, files: [], error: error.message }
    }
  }

  /** Containment guard: only paths inside the workspace's memory surface. */
  private resolveMemoryFile(workspaceDir: string, relPath: string): string | null {
    const root = path.resolve(workspaceDir)
    const full = path.resolve(root, relPath)
    const isInside = full === path.join(root, 'MEMORY.md') || full.startsWith(path.join(root, 'memory') + path.sep)
    return isInside && full.endsWith('.md') ? full : null
  }

  async readFileContent(workspaceDir: string, relPath: string): Promise<{ success: boolean; content?: string; error?: string }> {
    const full = this.resolveMemoryFile(workspaceDir, relPath)
    if (!full) return { success: false, error: 'Path is outside the memory surface' }
    try {
      return { success: true, content: await readFile(full, 'utf8') }
    } catch (error: any) {
      return { success: false, error: error.message || 'Failed to read memory file' }
    }
  }

  /** Delete one memory file, then reindex so search stops surfacing it. */
  async deleteFile(workspaceDir: string, relPath: string): Promise<{ success: boolean; error?: string }> {
    const full = this.resolveMemoryFile(workspaceDir, relPath)
    if (!full) return { success: false, error: 'Path is outside the memory surface' }
    try {
      await rm(full)
      const reindexed = await this.reindex()
      if (!reindexed.success) {
        // The file is gone either way; stale index entries clear on the
        // next successful reindex. Surface the partial outcome.
        return { success: true, error: `Deleted, but reindex failed: ${reindexed.error}` }
      }
      return { success: true }
    } catch (error: any) {
      console.error('[MemoryManager] Failed to delete memory file:', error)
      return { success: false, error: error.message || 'Failed to delete memory file' }
    }
  }
}
