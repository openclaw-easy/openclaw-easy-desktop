import React, { useCallback, useEffect, useState } from 'react'
import { Brain, FileText, Loader2, RefreshCw, Search, Trash2, X } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useToast } from '../../../contexts/ToastContext'
import { Modal } from '../../ui/modal'
import type { ColorTheme } from '../types'

/**
 * Memory & context controls: what the assistant remembers (MEMORY.md +
 * memory/*.md in the agent workspace), search over the memory index, and
 * per-file delete. Read-only view of contents; deletion reindexes so
 * search stops surfacing removed facts.
 */

interface MemoryStatus {
  agentId: string
  files: number
  chunks: number
  dirty: boolean
  workspaceDir: string
  provider?: string
}

interface MemoryFileInfo {
  relPath: string
  sizeBytes: number
  modifiedAtMs: number
}

interface SearchResult {
  path?: string
  snippet?: string
  score?: number
}

interface Props {
  colors: ColorTheme
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  return `${(bytes / 1024).toFixed(1)} KB`
}

export function MemorySection({ colors }: Props) {
  const { t } = useTranslation()
  const { addToast } = useToast()
  const [status, setStatus] = useState<MemoryStatus | null>(null)
  const [files, setFiles] = useState<MemoryFileInfo[]>([])
  const [loading, setLoading] = useState(true)
  const [reindexing, setReindexing] = useState(false)
  const [query, setQuery] = useState('')
  const [searching, setSearching] = useState(false)
  const [results, setResults] = useState<SearchResult[] | null>(null)
  const [viewer, setViewer] = useState<{ relPath: string; content: string } | null>(null)
  const [viewerLoading, setViewerLoading] = useState<string | null>(null)
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null)
  const [deleting, setDeleting] = useState(false)

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true)
    try {
      const statusRes = await window.electronAPI?.getMemoryStatus?.()
      const workspaceDir = statusRes?.status?.workspaceDir
      if (statusRes?.success && statusRes.status) setStatus(statusRes.status)
      const filesRes = await window.electronAPI?.listMemoryFiles?.(workspaceDir)
      if (filesRes?.success) setFiles(filesRes.files)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  const reindex = async () => {
    setReindexing(true)
    try {
      const res = await window.electronAPI?.reindexMemory?.()
      if (res?.success) {
        addToast(t('memory.reindexed', 'Memory index rebuilt'), 'success')
        await load(true)
      } else {
        addToast(res?.error || t('memory.reindexFailed', 'Reindex failed'), 'error')
      }
    } finally {
      setReindexing(false)
    }
  }

  const search = async () => {
    if (!query.trim()) {
      setResults(null)
      return
    }
    setSearching(true)
    try {
      const res = await window.electronAPI?.searchMemory?.(query)
      if (res?.success) {
        setResults(res.results || [])
      } else {
        addToast(res?.error || t('memory.searchFailed', 'Search failed'), 'error')
      }
    } finally {
      setSearching(false)
    }
  }

  const openFile = async (relPath: string) => {
    if (!status) return
    setViewerLoading(relPath)
    try {
      const res = await window.electronAPI?.readMemoryFile?.(status.workspaceDir, relPath)
      if (res?.success) {
        setViewer({ relPath, content: res.content || '' })
      } else {
        addToast(res?.error || t('memory.readFailed', 'Could not read file'), 'error')
      }
    } finally {
      setViewerLoading(null)
    }
  }

  const doDelete = async () => {
    if (!status || !deleteConfirm) return
    setDeleting(true)
    try {
      const res = await window.electronAPI?.deleteMemoryFile?.(status.workspaceDir, deleteConfirm)
      if (res?.success) {
        addToast(t('memory.deleted', 'Memory file deleted'), 'success')
        setDeleteConfirm(null)
        setViewer(null)
        setResults(null)
        await load(true)
      } else {
        addToast(res?.error || t('memory.deleteFailed', 'Delete failed'), 'error')
      }
    } finally {
      setDeleting(false)
    }
  }

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin" style={{ color: colors.text.muted }} />
      </div>
    )
  }

  return (
    <div className="h-full overflow-y-auto p-6">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h2 className="flex items-center gap-2 font-display text-lg font-bold tracking-tight" style={{ color: colors.text.header }}>
            <Brain className="h-5 w-5" />
            {t('memory.title', 'Memory')}
          </h2>
          <p className="text-sm" style={{ color: colors.text.muted }}>
            {t('memory.subtitle', 'See and control what your assistant remembers across conversations.')}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={reindex}
            disabled={reindexing}
            className="flex items-center gap-1.5 rounded px-3 py-1.5 text-sm font-medium hover:opacity-80 disabled:opacity-50"
            style={{ backgroundColor: colors.bg.tertiary, color: colors.text.normal }}
          >
            {reindexing ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
            {t('memory.reindex', 'Rebuild index')}
          </button>
        </div>
      </div>

      <div className="mb-4 grid grid-cols-3 gap-3">
        {[
          { label: t('memory.statFiles', 'Memory files'), value: String(files.length) },
          { label: t('memory.statChunks', 'Indexed chunks'), value: String(status?.chunks ?? 0) },
          {
            label: t('memory.statIndex', 'Index'),
            value: status?.dirty
              ? t('memory.indexStale', 'needs rebuild')
              : t('memory.indexFresh', 'up to date'),
          },
        ].map((stat) => (
          <div key={stat.label} className="rounded-lg border p-3" style={{ borderColor: colors.bg.tertiary, backgroundColor: colors.bg.secondary }}>
            <p className="text-xs" style={{ color: colors.text.muted }}>{stat.label}</p>
            <p className="text-lg font-semibold" style={{ color: colors.text.header }}>{stat.value}</p>
          </div>
        ))}
      </div>

      <div className="mb-4">
        <div className="flex gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2" style={{ color: colors.text.muted }} />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') search()
              }}
              placeholder={t('memory.searchPlaceholder', 'Search what the assistant remembers…')}
              className="w-full rounded py-2 pl-9 pr-3 text-sm outline-none"
              style={{ backgroundColor: colors.bg.tertiary, color: colors.text.normal }}
            />
          </div>
          <button
            onClick={search}
            disabled={searching}
            className="rounded px-4 py-2 text-sm font-medium hover:opacity-80 disabled:opacity-50"
            style={{ backgroundColor: colors.button.primary, color: colors.button.primaryFg }}
          >
            {searching ? <Loader2 className="h-4 w-4 animate-spin" /> : t('memory.search', 'Search')}
          </button>
        </div>

        {results !== null && (
          <div className="mt-3 space-y-2">
            {results.length === 0 && (
              <p className="text-sm" style={{ color: colors.text.muted }}>
                {t('memory.noResults', 'No memories matched.')}
              </p>
            )}
            {results.map((r, i) => (
              <div key={i} className="rounded-lg border p-3" style={{ borderColor: colors.bg.tertiary, backgroundColor: colors.bg.secondary }}>
                <div className="mb-1 flex items-center justify-between">
                  <span className="font-mono text-xs" style={{ color: colors.text.muted }}>{r.path || ''}</span>
                  {typeof r.score === 'number' && (
                    <span className="text-xs" style={{ color: colors.text.muted }}>{r.score.toFixed(2)}</span>
                  )}
                </div>
                <p className="whitespace-pre-wrap text-sm" style={{ color: colors.text.normal }}>{r.snippet || ''}</p>
              </div>
            ))}
          </div>
        )}
      </div>

      <h3 className="mb-2 text-sm font-semibold" style={{ color: colors.text.header }}>
        {t('memory.filesTitle', 'Memory files')}
      </h3>
      {files.length === 0 ? (
        <p className="text-sm" style={{ color: colors.text.muted }}>
          {t('memory.noFiles', 'No memory files yet — the assistant writes memories as you talk to it.')}
        </p>
      ) : (
        <div className="space-y-1.5">
          {files.map((f) => (
            <div
              key={f.relPath}
              className="flex items-center justify-between rounded-lg border px-3 py-2"
              style={{ borderColor: colors.bg.tertiary, backgroundColor: colors.bg.secondary }}
            >
              <button
                onClick={() => openFile(f.relPath)}
                className="flex items-center gap-2 text-sm hover:underline"
                style={{ color: colors.text.normal }}
              >
                {viewerLoading === f.relPath ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <FileText className="h-4 w-4" style={{ color: colors.text.muted }} />
                )}
                {f.relPath}
              </button>
              <div className="flex items-center gap-3">
                <span className="text-xs" style={{ color: colors.text.muted }}>
                  {formatSize(f.sizeBytes)} · {new Date(f.modifiedAtMs).toLocaleDateString()}
                </span>
                <button
                  onClick={() => setDeleteConfirm(f.relPath)}
                  className="rounded p-1 hover:opacity-80"
                  style={{ color: colors.text.danger }}
                  aria-label={t('memory.delete', 'Delete')}
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {viewer && (
        <Modal open onClose={() => setViewer(null)} maxWidthClass="max-w-2xl">
          <div className="max-h-[70vh] overflow-y-auto p-4">
            <div className="mb-3 flex items-center justify-between">
              <h3 className="font-mono text-sm font-semibold" style={{ color: colors.text.header }}>{viewer.relPath}</h3>
              <button onClick={() => setViewer(null)} aria-label={t('common.close', 'Close')} style={{ color: colors.text.muted }}>
                <X className="h-4 w-4" />
              </button>
            </div>
            <pre className="whitespace-pre-wrap text-sm" style={{ color: colors.text.normal }}>{viewer.content}</pre>
          </div>
        </Modal>
      )}

      {deleteConfirm && (
        <Modal open onClose={() => setDeleteConfirm(null)}>
          <div className="p-4">
            <h3 className="mb-2 text-sm font-semibold" style={{ color: colors.text.header }}>
              {t('memory.deleteTitle', 'Delete this memory file?')}
            </h3>
            <p className="mb-4 text-sm" style={{ color: colors.text.muted }}>
              {t('memory.deleteBody', 'The assistant will permanently forget everything in {{file}}. This cannot be undone.', { file: deleteConfirm })}
            </p>
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setDeleteConfirm(null)}
                className="rounded px-3 py-1.5 text-sm hover:opacity-80"
                style={{ backgroundColor: colors.bg.tertiary, color: colors.text.normal }}
              >
                {t('common.cancel', 'Cancel')}
              </button>
              <button
                onClick={doDelete}
                disabled={deleting}
                className="rounded px-3 py-1.5 text-sm font-medium hover:opacity-80 disabled:opacity-50"
                style={{ backgroundColor: colors.button.destructive, color: colors.button.destructiveFg }}
              >
                {deleting ? t('memory.deleting', 'Deleting…') : t('memory.deleteConfirm', 'Delete')}
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  )
}
