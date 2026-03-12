import React, { useState, useEffect, useCallback } from 'react'
import { FileText, Save, Loader2, AlertCircle, RefreshCw, Plus, Trash2, X } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useToast } from '../../../contexts/ToastContext'

interface ColorScheme {
  bg: {
    primary: string
    secondary: string
    tertiary: string
    hover: string
    active: string
  }
  text: {
    normal: string
    muted: string
    header: string
    link: string
    danger: string
  }
  accent: {
    brand: string
    green: string
    yellow: string
    red: string
    purple: string
  }
}

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

  const hasUnsavedChanges = content !== originalContent

  const loadFiles = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const result = await window.electronAPI?.listWorkspaceFiles?.()
      if (result?.success && result.files) {
        setFiles(result.files)
        // Auto-select first file if nothing selected
        if (!selectedFile && result.files.length > 0) {
          loadFile(result.files[0].name)
        }
      } else {
        setError(result?.error || 'Failed to load workspace files')
      }
    } catch (err: any) {
      setError(err.message || 'Failed to load workspace files')
    } finally {
      setLoading(false)
    }
  }, [])

  const loadFile = async (name: string) => {
    // Warn about unsaved changes
    if (hasUnsavedChanges) {
      const discard = confirm('You have unsaved changes. Discard them?')
      if (!discard) return
    }

    setFileLoading(true)
    setError(null)
    try {
      const result = await window.electronAPI?.readWorkspaceFile?.(name)
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
      const result = await window.electronAPI?.writeWorkspaceFile?.(selectedFile, content)
      if (result?.success) {
        setOriginalContent(content)
        loadFiles()
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
      const result = await window.electronAPI.createWorkspaceFile(filename)
      if (result?.success) {
        addToast(`Created ${filename}`, 'success')
        setShowCreateModal(false)
        setNewFileName('')
        // Refresh and auto-select the new file
        const listResult = await window.electronAPI?.listWorkspaceFiles?.()
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
      const result = await window.electronAPI.deleteWorkspaceFile(fileName)
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
        const listResult = await window.electronAPI?.listWorkspaceFiles?.()
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

  useEffect(() => {
    loadFiles()
  }, [loadFiles])

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
  }, [selectedFile, content, originalContent])

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
          <h2 className="text-lg font-bold" style={{ color: colors.text.header }}>
            {t('workspace.title')}
          </h2>
          <p className="text-sm" style={{ color: colors.text.muted }}>
            {t('workspace.subtitle')}
          </p>
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={() => { setNewFileName(''); setShowCreateModal(true) }}
            className="p-2 rounded-lg transition-colors"
            style={{ color: colors.text.muted }}
            title={t('workspace.createNew')}
          >
            <Plus className="h-4 w-4" />
          </button>
          <button
            onClick={loadFiles}
            className="p-2 rounded-lg transition-colors"
            style={{ color: colors.text.muted }}
            title={t('workspace.refreshFiles')}
          >
            <RefreshCw className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* Error banner */}
      {error && (
        <div
          className="flex-shrink-0 flex items-center gap-2 px-6 py-2 text-sm"
          style={{ backgroundColor: '#7f1d1d40', color: colors.accent.red }}
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
                    color: '#ffffff',
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
                    backgroundColor: colors.bg.primary,
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

      {/* Create File Modal */}
      {showCreateModal && (
        <div
          className="fixed inset-0 flex items-center justify-center z-50"
          style={{ backgroundColor: 'rgba(0, 0, 0, 0.7)' }}
          onClick={() => !creating && setShowCreateModal(false)}
        >
          <div
            className="rounded-xl p-6 max-w-md w-full mx-4 shadow-2xl"
            style={{ backgroundColor: colors.bg.secondary }}
            onClick={(e) => e.stopPropagation()}
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
              className="w-full px-3 py-2 rounded-lg text-sm mb-4 focus:outline-none focus:ring-2"
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
                className="flex-1 px-4 py-2 rounded-lg text-sm font-medium transition-colors"
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
                className="flex-1 px-4 py-2 rounded-lg text-sm font-medium transition-colors"
                style={{
                  backgroundColor: colors.accent.brand,
                  color: '#FFFFFF',
                  opacity: creating || !newFileName.trim() ? 0.6 : 1,
                }}
              >
                {creating ? t('common.loading') : t('workspace.createFile')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete Confirmation Dialog */}
      {deleteConfirm.show && (
        <div
          className="fixed inset-0 flex items-center justify-center z-50"
          style={{ backgroundColor: 'rgba(0, 0, 0, 0.7)' }}
          onClick={() => !deleting && setDeleteConfirm({ show: false, fileName: '' })}
        >
          <div
            className="rounded-xl p-6 max-w-md w-full mx-4 shadow-2xl"
            style={{ backgroundColor: colors.bg.secondary }}
            onClick={(e) => e.stopPropagation()}
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
                className="flex-1 px-4 py-2 rounded-lg text-sm font-medium transition-colors"
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
                className="flex-1 px-4 py-2 rounded-lg text-sm font-medium transition-colors"
                style={{
                  backgroundColor: colors.accent.red,
                  color: '#FFFFFF',
                  opacity: deleting ? 0.6 : 1,
                }}
              >
                {deleting ? t('common.deleting') : t('workspace.deleteFile')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
