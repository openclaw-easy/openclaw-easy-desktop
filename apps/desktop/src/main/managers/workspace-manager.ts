import { readdir, readFile, writeFile, copyFile, stat, unlink, mkdir } from 'fs/promises'
import { join, basename, resolve } from 'path'
import { homedir } from 'os'
import { existsSync, readFileSync } from 'fs'
import { safeOpenWorkspaceDir } from '../safe-open-path'
import { getAgent } from './agent-roster'

interface WorkspaceFile {
  name: string
  size: number
  modified: number
}

// Only allow uppercase letters, digits, hyphens, underscores + .md extension
const WORKSPACE_FILE_PATTERN = /^[A-Z0-9_-]+\.md$/

// Desktop's default (routing) agent id. The main agent's workspace is the
// bare `~/.openclaw/workspace`; every other agent gets its own dir.
const DEFAULT_AGENT_ID = 'main'

export class WorkspaceManager {
  /**
   * Resolve the workspace directory for an agent. Mirrors the gateway's
   * `resolveAgentWorkspaceDir` (src/agents/agent-scope-config.ts) so the
   * desktop edits exactly the files the agent injects as Project Context:
   *   1. a configured `agents.list[].workspace` wins
   *   2. main agent → `OPENCLAW_WORKSPACE_DIR` or `~/.openclaw/workspace`
   *      (or `agents.defaults.workspace` when set)
   *   3. other agent → `<defaults.workspace>/<id>` or sibling
   *      `~/.openclaw/workspace-<id>`
   * agentId comes from the renderer; the PATH is always derived here from
   * trusted config — the renderer never supplies a raw filesystem path.
   */
  private resolveDir(agentId?: string): string {
    const id = (agentId || DEFAULT_AGENT_ID).trim() || DEFAULT_AGENT_ID

    let cfg: any = {}
    try {
      cfg = JSON.parse(readFileSync(join(homedir(), '.openclaw', 'openclaw.json'), 'utf-8'))
    } catch {
      // No config yet — fall back to the default layout below.
    }

    const entry = getAgent(cfg, id)
    const configured = typeof entry?.workspace === 'string' ? entry.workspace.trim() : ''
    if (configured) return this.expandHome(configured)

    const fallback =
      typeof cfg?.agents?.defaults?.workspace === 'string'
        ? cfg.agents.defaults.workspace.trim()
        : ''

    if (id === DEFAULT_AGENT_ID) {
      if (fallback) return this.expandHome(fallback)
      const envDir = process.env.OPENCLAW_WORKSPACE_DIR?.trim()
      return envDir ? resolve(envDir) : join(homedir(), '.openclaw', 'workspace')
    }
    return fallback
      ? join(this.expandHome(fallback), id)
      : join(homedir(), '.openclaw', `workspace-${id}`)
  }

  /** Expand a leading `~` to the home dir (config paths may be tilde-prefixed). */
  private expandHome(p: string): string {
    if (p === '~') return homedir()
    if (p.startsWith('~/') || p.startsWith('~\\')) return join(homedir(), p.slice(2))
    return p
  }

  async listFiles(
    agentId?: string,
  ): Promise<{ success: boolean; files?: WorkspaceFile[]; error?: string }> {
    const workspaceDir = this.resolveDir(agentId)
    try {
      if (!existsSync(workspaceDir)) {
        return { success: true, files: [] }
      }

      const entries = await readdir(workspaceDir, { withFileTypes: true })
      const files: WorkspaceFile[] = []

      for (const entry of entries) {
        if (!entry.isFile() || !entry.name.endsWith('.md')) continue
        try {
          const filePath = join(workspaceDir, entry.name)
          const stats = await stat(filePath)
          files.push({
            name: entry.name,
            size: stats.size,
            modified: stats.mtimeMs,
          })
        } catch {
          // Skip files we can't stat
        }
      }

      // Sort alphabetically
      files.sort((a, b) => a.name.localeCompare(b.name))
      return { success: true, files }
    } catch (error: any) {
      return { success: false, error: error.message }
    }
  }

  async readFile(
    name: string,
    agentId?: string,
  ): Promise<{ success: boolean; content?: string; error?: string }> {
    if (!WORKSPACE_FILE_PATTERN.test(name) && !name.endsWith('.md')) {
      return { success: false, error: 'Invalid filename' }
    }

    // Extra safety: no directory traversal
    const sanitized = basename(name)
    if (sanitized !== name || name.includes('..') || name.includes('/')) {
      return { success: false, error: 'Invalid filename' }
    }

    try {
      const filePath = join(this.resolveDir(agentId), sanitized)
      const content = await readFile(filePath, 'utf-8')
      return { success: true, content }
    } catch (error: any) {
      return { success: false, error: error.message }
    }
  }

  async writeFile(
    name: string,
    content: string,
    agentId?: string,
  ): Promise<{ success: boolean; error?: string }> {
    if (!WORKSPACE_FILE_PATTERN.test(name)) {
      return { success: false, error: 'Invalid filename. Only uppercase letters, digits, hyphens, underscores allowed.' }
    }

    const sanitized = basename(name)
    if (sanitized !== name) {
      return { success: false, error: 'Invalid filename' }
    }

    try {
      const workspaceDir = this.resolveDir(agentId)
      // Create on demand so a never-launched agent's workspace can be seeded.
      if (!existsSync(workspaceDir)) {
        await mkdir(workspaceDir, { recursive: true })
      }
      const filePath = join(workspaceDir, sanitized)

      // Create .bak backup before overwriting
      if (existsSync(filePath)) {
        await copyFile(filePath, filePath + '.bak')
      }

      await writeFile(filePath, content, 'utf-8')
      return { success: true }
    } catch (error: any) {
      return { success: false, error: error.message }
    }
  }

  async createFile(name: string, agentId?: string): Promise<{ success: boolean; error?: string }> {
    if (!WORKSPACE_FILE_PATTERN.test(name)) {
      return { success: false, error: 'Invalid filename. Only uppercase letters, digits, hyphens, underscores allowed with .md extension.' }
    }

    const sanitized = basename(name)
    if (sanitized !== name) {
      return { success: false, error: 'Invalid filename' }
    }

    try {
      const workspaceDir = this.resolveDir(agentId)
      // Ensure workspace directory exists
      if (!existsSync(workspaceDir)) {
        await mkdir(workspaceDir, { recursive: true })
      }

      const filePath = join(workspaceDir, sanitized)
      if (existsSync(filePath)) {
        return { success: false, error: `File "${name}" already exists` }
      }

      const title = name.replace(/\.md$/, '')
      await writeFile(filePath, `# ${title}\n`, 'utf-8')
      return { success: true }
    } catch (error: any) {
      return { success: false, error: error.message }
    }
  }

  async deleteFile(name: string, agentId?: string): Promise<{ success: boolean; error?: string }> {
    if (!WORKSPACE_FILE_PATTERN.test(name)) {
      return { success: false, error: 'Invalid filename' }
    }

    const sanitized = basename(name)
    if (sanitized !== name) {
      return { success: false, error: 'Invalid filename' }
    }

    try {
      const filePath = join(this.resolveDir(agentId), sanitized)
      if (!existsSync(filePath)) {
        return { success: false, error: `File "${name}" not found` }
      }

      await unlink(filePath)
      return { success: true }
    } catch (error: any) {
      return { success: false, error: error.message }
    }
  }

  /**
   * Reveal the agent's workspace directory in the OS file manager so the
   * user can drop in files the markdown editor can't handle (images,
   * non-context files, `skills/<x>/SKILL.md`). Creates the dir on demand
   * so a freshly-added agent always opens to something.
   */
  async openDir(agentId?: string): Promise<{ success: boolean; error?: string }> {
    const workspaceDir = this.resolveDir(agentId)
    try {
      if (!existsSync(workspaceDir)) {
        await mkdir(workspaceDir, { recursive: true })
      }
    } catch (error: any) {
      return { success: false, error: error.message }
    }
    return safeOpenWorkspaceDir(workspaceDir)
  }
}
