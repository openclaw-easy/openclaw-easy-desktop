import React, { useState, useEffect, useCallback } from 'react'
import { FileText, Save, Loader2, AlertCircle, RefreshCw, Plus, Trash2, X, FolderOpen } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useToast } from '../../../contexts/ToastContext'
import { Modal } from '../../ui/modal'
import type { ColorTheme } from '../types'

// Local alias for back-compat with the prop name. Was a duplicated
// interface declaration until the 2026-06-15 ColorTheme dedup pass.
type ColorScheme = ColorTheme

interface WorkspaceFile {
  name: string
  size: number
  modified: number
}

interface WorkspaceSectionProps {
  colors: ColorScheme
}

export function WorkspaceSection({ colors }: WorkspaceSectionProps) {
  const { t } = useTranslation()
  const [files, setFiles] = useState<WorkspaceFile[]>([])
  const [selectedFile, setSelectedFile] = useState<string | null>(null)
  const [content, setContent] = useState('')
  const [originalContent, setOriginalContent] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [fileLoading, setFileLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Create modal state
  const [showCreateModal, setShowCreateModal] = useState(false)
  const [newFileName, setNewFileName] = useState('')
  const [creating, setCreating] = useState(false)

  // Delete confirmation state
  const [deleteConfirm, setDeleteConfirm] = useState<{ show: boolean; fileName: string }>({ show: false, fileName: '' })
  const [deleting, setDeleting] = useState(false)


  const { addToast } = useToast()

  // Agent selector — which agent's workspace we're editing. 'main' = the
  // default agent's ~/.openclaw/workspace; other agents get their own dir.
  const [agents, setAgents] = useState<Array<{ id: string; name: string }>>([])
  const [selectedAgent, setSelectedAgent] = useState<string>('main')

  const hasUnsavedChanges = content !== originalContent

  // Reload the file list for the current agent (Refresh button + post-save).
  const refresh = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const result = await window.electronAPI?.listWorkspaceFiles?.(selectedAgent)
      if (result?.success && result.files) {
        setFiles(result.files)
      } else {
        setError(result?.error || 'Failed to load workspace files')
      }
    } catch (err: any) {
      setError(err.message || 'Failed to load workspace files')
    } finally {
      setLoading(false)
    }
  }, [selectedAgent])

  const loadFile = async (name: string) => {
    // Warn about unsaved changes
    if (hasUnsavedChanges) {
      const discard = confirm('You have unsaved changes. Discard them?')
      if (!discard) return
    }

    setFileLoading(true)
    setError(null)
    try {
      const result = await window.electronAPI?.readWorkspaceFile?.(name, selectedAgent)
      if (result?.success && result.content !== undefined) {
        setSelectedFile(name)
        setContent(result.content)
        setOriginalContent(result.content)
      } else {
        setError(result?.error || 'Failed to read file')
      }
    } catch (err: any) {
      setError(err.message || 'Failed to read file')
    } finally {
      setFileLoading(false)
    }
  }

  const handleSave = async () => {
    if (!selectedFile || !hasUnsavedChanges) return

    setSaving(true)
    setError(null)
    try {
      const result = await window.electronAPI?.writeWorkspaceFile?.(selectedFile, content, selectedAgent)
      if (result?.success) {
        setOriginalContent(content)
        refresh()
      } else {
        setError(result?.error || 'Failed to save file')
      }
    } catch (err: any) {
      setError(err.message || 'Failed to save file')
    } finally {
      setSaving(false)
    }
  }

  const handleCreate = async () => {
    const trimmed = newFileName.trim()
    if (!trimmed) return

    // Auto-uppercase and append .md
    const filename = trimmed.toUpperCase().replace(/\.md$/i, '') + '.md'

    setCreating(true)
    setError(null)
    try {
      if (!window.electronAPI?.createWorkspaceFile) {
        addToast('Create not available — restart the app to apply updates', 'error')
        return
      }
      const result = await window.electronAPI.createWorkspaceFile(filename, selectedAgent)
      if (result?.success) {
        addToast(`Created ${filename}`, 'success')
        setShowCreateModal(false)
        setNewFileName('')
        // Refresh and auto-select the new file
        const listResult = await window.electronAPI?.listWorkspaceFiles?.(selectedAgent)
        if (listResult?.success && listResult.files) {
          setFiles(listResult.files)
        }
        await loadFile(filename)
      } else {
        addToast(result?.error || 'Failed to create file', 'error')
      }
    } catch (err: any) {
      addToast(err.message || 'Failed to create file', 'error')
    } finally {
      setCreating(false)
    }
  }

  const handleDelete = async (fileName: string) => {
    setDeleting(true)
    setError(null)
    try {
      if (!window.electronAPI?.deleteWorkspaceFile) {
        addToast('Delete not available — restart the app to apply updates', 'error')
        return
      }
      const result = await window.electronAPI.deleteWorkspaceFile(fileName, selectedAgent)
      if (result?.success) {
        addToast(`Deleted ${fileName}`, 'success')
        setDeleteConfirm({ show: false, fileName: '' })

        // If we deleted the selected file, clear editor or select next
        if (selectedFile === fileName) {
          const remaining = files.filter(f => f.name !== fileName)
          if (remaining.length > 0) {
            loadFile(remaining[0].name)
          } else {
            setSelectedFile(null)
            setContent('')
            setOriginalContent('')
          }
        }

        // Refresh file list
        const listResult = await window.electronAPI?.listWorkspaceFiles?.(selectedAgent)
        if (listResult?.success && listResult.files) {
          setFiles(listResult.files)
        }
      } else {
        addToast(result?.error || 'Failed to delete file', 'error')
      }
    } catch (err: any) {
      addToast(err.message || 'Failed to delete file', 'error')
    } finally {
      setDeleting(false)
    }
  }

  // Load the agent list once so the picker can offer per-agent workspaces.
  useEffect(() => {
    let cancelled = false
    window.electronAPI?.listAgents?.()
      .then((list: any[]) => {
        if (cancelled) return
        const mapped = Array.isArray(list)
          ? list.map((a) => ({ id: String(a.id), name: String(a.name || a.id) }))
          : []
        setAgents(mapped)
        // Prefer 'main'; otherwise fall back to the first agent.
        if (mapped.length > 0 && !mapped.some((a) => a.id === selectedAgent)) {
          setSelectedAgent(mapped.some((a) => a.id === 'main') ? 'main' : mapped[0].id)
        }
      })
      .catch(() => { /* agents optional — default to main */ })
    return () => { cancelled = true }
  }, [])

  // (Re)load files whenever the selected agent changes (and on mount):
  // reset the editor and auto-select the first file. Inline reads here
  // avoid stale-closure auto-select bugs across agent switches.
  useEffect(() => {
    let cancelled = false
    const run = async () => {
      setLoading(true)
      setError(null)
      setSelectedFile(null)
      setContent('')
      setOriginalContent('')
      try {
        const result = await window.electronAPI?.listWorkspaceFiles?.(selectedAgent)
        if (cancelled) return
        if (result?.success && result.files) {
          setFiles(result.files)
          if (result.files.length > 0) {
            const first = result.files[0].name
            const fileRes = await window.electronAPI?.readWorkspaceFile?.(first, selectedAgent)
            if (cancelled) return
            if (fileRes?.success && fileRes.content !== undefined) {
              setSelectedFile(first)
              setContent(fileRes.content)
              setOriginalContent(fileRes.content)
            }
          }
        } else {
          setError(result?.error || 'Failed to load workspace files')
        }
      } catch (err: any) {
        if (!cancelled) setError(err.message || 'Failed to load workspace files')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    run()
    return () => { cancelled = true }
  }, [selectedAgent])

  // Switch agents, guarding unsaved edits.
  const handleAgentChange = (id: string) => {
    if (id === selectedAgent) return
    if (hasUnsavedChanges && !confirm('You have unsaved changes. Discard them?')) return
    setSelectedAgent(id)
  }

  // Reveal the current agent's workspace dir in Finder/Explorer.
  const handleOpenFolder = async () => {
    const result = await window.electronAPI?.openWorkspaceDir?.(selectedAgent)
    if (!result?.success) {
      addToast(result?.error || 'Failed to open folder', 'error')
    }
  }

  // Keyboard shortcut: Cmd/Ctrl+S to save
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 's') {
        e.preventDefault()
        handleSave()
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [selectedFile, content, originalContent, selectedAgent])

  const formatSize = (bytes: number): string => {
    if (bytes < 1024) return `${bytes} B`
    return `${(bytes / 1024).toFixed(1)} KB`
  }

  const formatDate = (ms: number): string => {
    return new Date(ms).toLocaleDateString(undefined, {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    })
  }

  if (loading && files.length === 0) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 className="h-8 w-8 animate-spin" style={{ color: colors.text.muted }} />
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div
        className="flex-shrink-0 px-6 py-4 border-b flex items-center justify-between"
        style={{ borderColor: colors.bg.tertiary, backgroundColor: colors.bg.secondary }}
      >
        <div className="flex items-baseline gap-2">
          <h2 className="font-display text-lg font-bold tracking-tight" style={{ color: colors.text.header }}>
            {t('workspace.title')}
          </h2>
          <p className="text-sm" style={{ color: colors.text.muted }}>
            {t('workspace.subtitle')}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {agents.length > 0 && (
            <select
              value={selectedAgent}
              onChange={(e) => handleAgentChange(e.target.value)}
              className="px-2 py-1.5 rounded-md text-sm focus:outline-none"
              style={{ backgroundColor: colors.bg.tertiary, color: colors.text.normal, border: 'none' }}
              title={t('workspace.agent', 'Agent')}
              aria-label={t('workspace.agent', 'Agent')}
            >
              {agents.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.id === 'main' ? `${a.name} (main)` : a.name}
                </option>
              ))}
            </select>
          )}
          <button
            onClick={handleOpenFolder}
            className="p-2 rounded-lg transition-colors"
            style={{ color: colors.text.muted }}
            title={t('workspace.openFolder', 'Open folder')}
            aria-label={t('workspace.openFolder', 'Open folder')}
          >
            <FolderOpen className="h-4 w-4" />
          </button>
          <button
            onClick={() => { setNewFileName(''); setShowCreateModal(true) }}
            className="p-2 rounded-lg transition-colors"
            style={{ color: colors.text.muted }}
            title={t('workspace.createNew')}
          >
            <Plus className="h-4 w-4" />
          </button>
          <button
            onClick={refresh}
            className="p-2 rounded-lg transition-colors"
            style={{ color: colors.text.muted }}
            title={t('workspace.refreshFiles')}
            aria-label={t('workspace.refreshFiles')}
          >
            <RefreshCw className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* Error banner */}
      {error && (
        <div
          className="flex-shrink-0 flex items-center gap-2 px-6 py-2 text-sm"
          style={{ backgroundColor: 'rgba(220, 38, 38, 0.25)', color: colors.accent.red }}
        >
          <AlertCircle className="h-4 w-4 flex-shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* Main content */}
      <div className="flex-1 flex overflow-hidden">
        {/* File list (left panel) */}
        <div
          className="w-64 flex-shrink-0 border-r overflow-y-auto"
          style={{ borderColor: colors.bg.tertiary, backgroundColor: colors.bg.secondary }}
        >
          <div className="p-3">
            <p className="text-xs font-semibold uppercase tracking-wider mb-2" style={{ color: colors.text.muted }}>
              {t('workspace.files')}
            </p>
            {files.length === 0 ? (
              <p className="text-sm px-2 py-4" style={{ color: colors.text.muted }}>
                {t('workspace.noFiles')}
              </p>
            ) : (
              <div className="space-y-0.5">
                {files.map((file) => (
                  <div
                    key={file.name}
                    className="group relative flex items-start rounded-md transition-colors"
                    style={{
                      backgroundColor: selectedFile === file.name ? colors.bg.active : 'transparent',
                    }}
                  >
                    <button
                      onClick={() => loadFile(file.name)}
                      className="w-full text-left px-3 py-2.5 flex items-start gap-2.5"
                      style={{
                        color: selectedFile === file.name ? colors.text.header : colors.text.normal,
                      }}
                    >
                      <FileText className="h-4 w-4 flex-shrink-0 mt-0.5" style={{ color: colors.accent.brand }} />
                      <div className="min-w-0 flex-1">
                        <div className="text-sm font-medium truncate">{file.name}</div>
                        <div className="text-xs mt-0.5" style={{ color: colors.text.muted }}>
                          {formatSize(file.size)} · {formatDate(file.modified)}
                        </div>
                      </div>
                    </button>
                    <button
                      onClick={(e) => {
                        e.stopPropagation()
                        setDeleteConfirm({ show: true, fileName: file.name })
                      }}
                      className="absolute right-2 top-1/2 -translate-y-1/2 p-1 rounded opacity-0 group-hover:opacity-100 transition-opacity"
                      style={{ color: colors.text.muted }}
                      title={`Delete ${file.name}`}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Editor (right panel) */}
        <div className="flex-1 flex flex-col min-w-0">
          {selectedFile ? (
            <>
              {/* Editor toolbar */}
              <div
                className="flex-shrink-0 px-4 py-2 flex items-center justify-between border-b"
                style={{ borderColor: colors.bg.tertiary }}
              >
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium" style={{ color: colors.text.header }}>
                    {selectedFile}
                  </span>
                  {hasUnsavedChanges && (
                    <span
                      className="text-xs px-1.5 py-0.5 rounded"
                      style={{ backgroundColor: colors.accent.yellow + '30', color: colors.accent.yellow }}
                    >
                      {t('workspace.unsaved')}
                    </span>
                  )}
                </div>
                <button
                  onClick={handleSave}
                  disabled={!hasUnsavedChanges || saving}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                  style={{
                    backgroundColor: hasUnsavedChanges ? colors.accent.brand : colors.bg.hover,
                    color: colors.button.primaryFg,
                  }}
                >
                  {saving ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Save className="h-3.5 w-3.5" />
                  )}
                  <span>{t('common.save')}</span>
                </button>
              </div>

              {/* Text area */}
              {fileLoading ? (
                <div className="flex-1 flex items-center justify-center">
                  <Loader2 className="h-6 w-6 animate-spin" style={{ color: colors.text.muted }} />
                </div>
              ) : (
                <textarea
                  value={content}
                  onChange={(e) => setContent(e.target.value)}
                  className="flex-1 w-full resize-none p-4 font-mono text-sm focus:outline-none"
                  style={{
                    backgroundColor: colors.bg.tertiary,
                    color: colors.text.normal,
                    tabSize: 2,
                  }}
                  spellCheck={false}
                />
              )}
            </>
          ) : (
            <div className="flex-1 flex items-center justify-center">
              <div className="text-center">
                <FileText className="h-12 w-12 mx-auto mb-3" style={{ color: colors.text.muted }} />
                <p className="text-sm" style={{ color: colors.text.muted }}>
                  {t('workspace.selectFile')}
                </p>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Create File Modal — dismiss suppressed mid-create or once the
          user has typed a filename so a stray Escape doesn't drop input. */}
      <Modal
        open={showCreateModal}
        onClose={() => setShowCreateModal(false)}
        dismissable={!creating && !newFileName.trim()}
        shellClassName="shadow-2xl"
      >
            <div className="flex items-start space-x-3 mb-4">
              <div
                className="p-2 rounded-lg"
                style={{ backgroundColor: colors.bg.tertiary }}
              >
                <Plus className="h-5 w-5" style={{ color: colors.accent.brand }} />
              </div>
              <div className="flex-1">
                <h3 className="font-bold text-lg mb-1" style={{ color: colors.text.header }}>
                  {t('workspace.createTitle')}
                </h3>
                <p className="text-sm" style={{ color: colors.text.muted }}>
                  {t('workspace.createDesc')}
                </p>
              </div>
              <button
                onClick={() => setShowCreateModal(false)}
                className="p-1 rounded"
                style={{ color: colors.text.muted }}
                aria-label={t('common.close', 'Close')}
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <input
              type="text"
              value={newFileName}
              onChange={(e) => setNewFileName(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') handleCreate() }}
              placeholder={t('workspace.createPlaceholder')}
              autoFocus
              className="input-glow w-full px-3 py-2 rounded-lg text-sm mb-4 border focus:outline-none"
              style={{
                backgroundColor: colors.bg.tertiary,
                color: colors.text.normal,
                borderColor: colors.bg.tertiary,
                // @ts-expect-error -- ring color via CSS var
                '--tw-ring-color': colors.accent.brand,
              }}
            />

            {newFileName.trim() && (
              <div
                className="rounded-lg px-3 py-2 mb-4 text-xs font-mono"
                style={{ backgroundColor: colors.bg.tertiary, color: colors.text.muted }}
              >
                {newFileName.trim().toUpperCase().replace(/\.md$/i, '')}.md
              </div>
            )}

            <div className="flex space-x-3">
              <button
                onClick={() => setShowCreateModal(false)}
                disabled={creating}
                className="press-pulse ripple-glow flex-1 px-4 py-2 rounded-lg text-sm font-medium transition-all hover:-translate-y-px hover:shadow-glow active:translate-y-0"
                style={{
                  backgroundColor: colors.bg.tertiary,
                  color: colors.text.normal,
                }}
              >
                {t('common.cancel')}
              </button>
              <button
                onClick={handleCreate}
                disabled={creating || !newFileName.trim()}
                className="press-pulse ripple-glow flex-1 px-4 py-2 rounded-lg text-sm font-medium transition-all hover:-translate-y-px hover:shadow-glow active:translate-y-0"
                style={{
                  backgroundColor: colors.accent.brand,
                  color: colors.button.primaryFg,
                  opacity: creating || !newFileName.trim() ? 0.6 : 1,
                }}
              >
                {creating ? t('common.loading') : t('workspace.createFile')}
              </button>
            </div>
      </Modal>

      {/* Delete Confirmation Dialog — dismiss suppressed mid-delete. */}
      <Modal
        open={deleteConfirm.show}
        onClose={() => setDeleteConfirm({ show: false, fileName: '' })}
        dismissable={!deleting}
        shellClassName="shadow-2xl"
      >
            <div className="flex items-start space-x-3 mb-4">
              <div
                className="p-2 rounded-lg"
                style={{ backgroundColor: colors.bg.tertiary }}
              >
                <Trash2 className="h-5 w-5" style={{ color: colors.accent.red }} />
              </div>
              <div className="flex-1">
                <h3 className="font-bold text-lg mb-1" style={{ color: colors.text.header }}>
                  {t('workspace.deleteTitle')}
                </h3>
                <p className="text-sm" style={{ color: colors.text.muted }}>
                  {t('workspace.deleteConfirm')}
                </p>
              </div>
            </div>

            <div
              className="rounded-lg p-3 mb-4"
              style={{ backgroundColor: colors.bg.tertiary }}
            >
              <div className="text-sm font-medium font-mono" style={{ color: colors.text.header }}>
                {deleteConfirm.fileName}
              </div>
            </div>

            <div className="flex space-x-3">
              <button
                onClick={() => setDeleteConfirm({ show: false, fileName: '' })}
                disabled={deleting}
                className="press-pulse ripple-glow flex-1 px-4 py-2 rounded-lg text-sm font-medium transition-all hover:-translate-y-px hover:shadow-glow active:translate-y-0"
                style={{
                  backgroundColor: colors.bg.tertiary,
                  color: colors.text.normal,
                }}
              >
                {t('common.cancel')}
              </button>
              <button
                onClick={() => handleDelete(deleteConfirm.fileName)}
                disabled={deleting}
                className="press-pulse ripple-glow flex-1 px-4 py-2 rounded-lg text-sm font-medium transition-all hover:-translate-y-px hover:shadow-glow active:translate-y-0"
                style={{
                  backgroundColor: colors.accent.red,
                  color: colors.button.primaryFg,
                  opacity: deleting ? 0.6 : 1,
                }}
              >
                {deleting ? t('common.deleting') : t('workspace.deleteFile')}
              </button>
            </div>
      </Modal>
    </div>
  )
}
