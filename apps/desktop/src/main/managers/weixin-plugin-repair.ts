import * as path from 'path'
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'fs'

/**
 * Compatibility repair for @tencent-weixin/openclaw-weixin against
 * OpenClaw 2026.7.x.
 *
 * Contract broken upstream: commit c7e7ac27289 ("refactor: remove expired
 * plugin compatibility surfaces", #111451) deleted the `createTypingCallbacks`
 * re-export from `openclaw/plugin-sdk/channel-runtime`. The newest published
 * plugin (2.4.6, released before the break) still imports it from there, so
 * its channel process dies at import time and crash-loops. The same export
 * remains available from `openclaw/plugin-sdk/channel-outbound`, and every
 * other SDK subpath the plugin uses still resolves.
 *
 * Until Tencent publishes a fixed version there is nothing to upgrade to
 * (the peer range is open-ended, so npm happily installs the broken version),
 * hence this post-install rewrite. It is deliberately narrow: only an import
 * whose SOLE named binding is `createTypingCallbacks` is rewritten — if a
 * future plugin version imports additional names from channel-runtime we
 * must not blindly move bindings that may not exist in channel-outbound.
 * Once the plugin ships a compatible release the rewrite becomes a no-op.
 */

const BROKEN_IMPORT_RE =
  /import\s*\{\s*createTypingCallbacks\s*,?\s*\}\s*from\s*(["'])openclaw\/plugin-sdk\/channel-runtime\1/g

export function repairWeixinTypingImport(source: string): { changed: boolean; source: string } {
  const repaired = source.replace(
    BROKEN_IMPORT_RE,
    'import { createTypingCallbacks } from $1openclaw/plugin-sdk/channel-outbound$1',
  )
  return { changed: repaired !== source, source: repaired }
}

function collectJsFiles(dir: string, out: string[]): void {
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry)
    const stat = statSync(full)
    if (stat.isDirectory()) {
      collectJsFiles(full, out)
    } else if (entry.endsWith('.js')) {
      out.push(full)
    }
  }
}

/**
 * Rewrite the broken import in every installed copy of the Weixin plugin.
 * Idempotent — safe on every lifecycle hook (app start, plugin install,
 * Weixin connect). Returns the repaired file paths for logging.
 *
 * Install layout (openclaw plugin runtime):
 *   <openclawDir>/npm/projects/tencent-weixin-openclaw-weixin-*\/
 *     node_modules/@tencent-weixin/openclaw-weixin/dist/**\/*.js
 */
export function repairInstalledWeixinPlugin(openclawDir: string): { changedFiles: string[] } {
  const changedFiles: string[] = []
  const projectsDir = path.join(openclawDir, 'npm', 'projects')
  if (!existsSync(projectsDir)) return { changedFiles }

  for (const project of readdirSync(projectsDir)) {
    if (!project.startsWith('tencent-weixin-openclaw-weixin-')) continue
    const distDir = path.join(
      projectsDir, project,
      'node_modules', '@tencent-weixin', 'openclaw-weixin', 'dist',
    )
    if (!existsSync(distDir)) continue

    const jsFiles: string[] = []
    collectJsFiles(distDir, jsFiles)
    for (const file of jsFiles) {
      const original = readFileSync(file, 'utf8')
      const { changed, source } = repairWeixinTypingImport(original)
      if (changed) {
        writeFileSync(file, source, 'utf8')
        changedFiles.push(file)
      }
    }
  }
  return { changedFiles }
}
