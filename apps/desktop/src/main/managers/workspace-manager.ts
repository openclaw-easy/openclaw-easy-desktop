import { readdir, readFile, writeFile, copyFile, stat, unlink, mkdir } from 'fs/promises'
import { join, basename, relative } from 'path'
import { homedir } from 'os'
import { existsSync } from 'fs'

interface WorkspaceFile {
  name: string
  size: number
  modified: number
}

interface MemoryFile {
  name: string
  /** Relative path from workspace root, used to read the file */
  path: string
  /** YYYY-MM-DD date extracted from filename, or empty for non-dated files */
  date: string
  size: number
  modified: number
}

// Only allow uppercase letters, digits, hyphens, underscores + .md extension
const WORKSPACE_FILE_PATTERN = /^[A-Z0-9_-]+\.md$/
// Extract YYYY-MM-DD prefix from filenames like "2026-03-10.md" or "2026-03-10-session-notes.md"
const DATE_PREFIX_PATTERN = /^(\d{4}-\d{2}-\d{2})/

export class WorkspaceManager {
  private workspaceDir: string
  private memoryDir: string

  constructor() {
    this.workspaceDir = join(homedir(), '.openclaw', 'workspace')
    this.memoryDir = join(homedir(), '.openclaw', 'workspace', 'memory')
  }

  async listFiles(): Promise<{ success: boolean; files?: WorkspaceFile[]; error?: string }> {
    try {
      if (!existsSync(this.workspaceDir)) {
        return { success: true, files: [] }
      }

      const entries = await readdir(this.workspaceDir, { withFileTypes: true })
      const files: WorkspaceFile[] = []

      for (const entry of entries) {
        if (!entry.isFile() || !entry.name.endsWith('.md')) continue
        try {
          const filePath = join(this.workspaceDir, entry.name)
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

  async readFile(name: string): Promise<{ success: boolean; content?: string; error?: string }> {
    if (!WORKSPACE_FILE_PATTERN.test(name) && !name.endsWith('.md')) {
      return { success: false, error: 'Invalid filename' }
    }

    // Extra safety: no directory traversal
    const sanitized = basename(name)
    if (sanitized !== name || name.includes('..') || name.includes('/')) {
      return { success: false, error: 'Invalid filename' }
    }

    try {
      const filePath = join(this.workspaceDir, sanitized)
      const content = await readFile(filePath, 'utf-8')
      return { success: true, content }
    } catch (error: any) {
      return { success: false, error: error.message }
    }
  }

  async writeFile(
    name: string,
    content: string
  ): Promise<{ success: boolean; error?: string }> {
    if (!WORKSPACE_FILE_PATTERN.test(name)) {
      return { success: false, error: 'Invalid filename. Only uppercase letters, digits, hyphens, underscores allowed.' }
    }

    const sanitized = basename(name)
    if (sanitized !== name) {
      return { success: false, error: 'Invalid filename' }
    }

    try {
      const filePath = join(this.workspaceDir, sanitized)

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

  async createFile(name: string): Promise<{ success: boolean; error?: string }> {
    if (!WORKSPACE_FILE_PATTERN.test(name)) {
      return { success: false, error: 'Invalid filename. Only uppercase letters, digits, hyphens, underscores allowed with .md extension.' }
    }

    const sanitized = basename(name)
    if (sanitized !== name) {
      return { success: false, error: 'Invalid filename' }
    }

    try {
      // Ensure workspace directory exists
      if (!existsSync(this.workspaceDir)) {
        await mkdir(this.workspaceDir, { recursive: true })
      }

      const filePath = join(this.workspaceDir, sanitized)
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

  async deleteFile(name: string): Promise<{ success: boolean; error?: string }> {
    if (!WORKSPACE_FILE_PATTERN.test(name)) {
      return { success: false, error: 'Invalid filename' }
    }

    const sanitized = basename(name)
    if (sanitized !== name) {
      return { success: false, error: 'Invalid filename' }
    }

    try {
      const filePath = join(this.workspaceDir, sanitized)
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
   * List all memory-related files:
   * - MEMORY.md / memory.md from workspace root (long-term curated memory)
   * - All .md files under memory/ directory (daily logs, session summaries)
   */
  async listMemoryFiles(): Promise<{ success: boolean; files?: MemoryFile[]; error?: string }> {
    try {
      const files: MemoryFile[] = []

      // 1. Check for root-level MEMORY.md / memory.md
      for (const name of ['MEMORY.md', 'memory.md']) {
        const filePath = join(this.workspaceDir, name)
        if (!existsSync(filePath)) continue
        try {
          const stats = await stat(filePath)
          files.push({
            name,
            path: name,
            date: '',
            size: stats.size,
            modified: stats.mtimeMs,
          })
        } catch {
          // Skip if can't stat
        }
      }

      // 2. Recursively collect all .md files under memory/
      if (existsSync(this.memoryDir)) {
        await this.collectMemoryFiles(this.memoryDir, files)
      }

      // Sort: MEMORY.md first, then by modified time descending (newest first)
      files.sort((a, b) => {
        // Root memory files always come first
        if (!a.date && !b.date) return a.name.localeCompare(b.name)
        if (!a.date) return -1
        if (!b.date) return 1
        // Dated files: newest first by modified time
        return b.modified - a.modified
      })

      return { success: true, files }
    } catch (error: any) {
      return { success: false, error: error.message }
    }
  }

  /** Recursively collect .md files from a directory into the files array. */
  private async collectMemoryFiles(dir: string, files: MemoryFile[]): Promise<void> {
    const entries = await readdir(dir, { withFileTypes: true })
    for (const entry of entries) {
      const fullPath = join(dir, entry.name)
      if (entry.isDirectory()) {
        await this.collectMemoryFiles(fullPath, files)
      } else if (entry.isFile() && entry.name.endsWith('.md')) {
        try {
          const stats = await stat(fullPath)
          const relPath = relative(this.workspaceDir, fullPath)
          const dateMatch = entry.name.match(DATE_PREFIX_PATTERN)
          files.push({
            name: entry.name,
            path: relPath,
            date: dateMatch ? dateMatch[1] : '',
            size: stats.size,
            modified: stats.mtimeMs,
          })
        } catch {
          // Skip files we can't stat
        }
      }
    }
  }

  /**
   * Read a memory file by its relative path from workspace root.
   * Accepts paths like "MEMORY.md", "memory/2026-03-10-notes.md".
   */
  async readMemoryFile(relPath: string): Promise<{ success: boolean; content?: string; error?: string }> {
    // Prevent directory traversal
    if (relPath.includes('..') || relPath.startsWith('/')) {
      return { success: false, error: 'Invalid memory file path' }
    }

    // Validate it's a .md file
    if (!relPath.endsWith('.md')) {
      return { success: false, error: 'Invalid memory file path' }
    }

    // Ensure the resolved path stays within workspace
    const fullPath = join(this.workspaceDir, relPath)
    const resolvedRelative = relative(this.workspaceDir, fullPath)
    if (resolvedRelative.startsWith('..')) {
      return { success: false, error: 'Invalid memory file path' }
    }

    try {
      const content = await readFile(fullPath, 'utf-8')
      return { success: true, content }
    } catch (error: any) {
      return { success: false, error: error.message }
    }
  }
}
