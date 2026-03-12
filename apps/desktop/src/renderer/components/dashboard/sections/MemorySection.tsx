import React, { useState, useEffect, useCallback, useRef } from 'react'
import { Calendar, Search, Loader2, RefreshCw, FileText } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { ColorTheme } from '../types'
import { MarkdownRenderer } from '../../chat/MarkdownRenderer'

interface MemoryFile {
  name: string
  path: string
  date: string
  size: number
  modified: number
}

interface MemorySectionProps {
  colors: ColorTheme
}

export function MemorySection({ colors }: MemorySectionProps) {
  const { t } = useTranslation()
  const [files, setFiles] = useState<MemoryFile[]>([])
  const [selectedPath, setSelectedPath] = useState<string | null>(null)
  const [content, setContent] = useState('')
  const [loading, setLoading] = useState(true)
  const [fileLoading, setFileLoading] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const scrollContainerRef = useRef<HTMLDivElement>(null)

  const loadFiles = useCallback(async () => {
    setLoading(true)
    try {
      const result = await window.electronAPI?.listMemoryFiles?.()
      if (result?.success && result.files) {
        setFiles(result.files)
        if (!selectedPath && result.files.length > 0) {
          loadFile(result.files[0].path)
        }
      }
    } catch (err) {
      console.error('[MemorySection] Failed to load files:', err)
    } finally {
      setLoading(false)
    }
  }, [])

  const loadFile = async (path: string) => {
    setFileLoading(true)
    try {
      const result = await window.electronAPI?.readMemoryFile?.(path)
      if (result?.success && result.content !== undefined) {
        setSelectedPath(path)
        setContent(result.content)
      }
    } catch (err) {
      console.error('[MemorySection] Failed to read file:', err)
    } finally {
      setFileLoading(false)
    }
  }

  useEffect(() => {
    loadFiles()
  }, [loadFiles])

  const filteredFiles = files.filter((f) =>
    f.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    f.date.includes(searchQuery) ||
    f.path.toLowerCase().includes(searchQuery.toLowerCase())
  )

  const formatSize = (bytes: number): string => {
    if (bytes < 1024) return `${bytes} B`
    return `${(bytes / 1024).toFixed(1)} KB`
  }

  const formatLabel = (file: MemoryFile): string => {
    if (file.date) {
      try {
        const d = new Date(file.date + 'T00:00:00')
        const dateLabel = d.toLocaleDateString(undefined, {
          weekday: 'short',
          month: 'short',
          day: 'numeric',
          year: 'numeric',
        })
        // If filename has a slug beyond the date (e.g. "2026-03-10-session-notes.md"), show it
        const slug = file.name.replace(/^\d{4}-\d{2}-\d{2}-?/, '').replace(/\.md$/, '')
        return slug ? `${dateLabel} — ${slug}` : dateLabel
      } catch {
        return file.name
      }
    }
    // Non-dated files: show filename without extension
    return file.name.replace(/\.md$/, '')
  }

  const formatSelectedLabel = (path: string): string => {
    const file = files.find(f => f.path === path)
    return file ? formatLabel(file) : path
  }

  const totalEntries = files.length
  const totalSize = files.reduce((sum, f) => sum + f.size, 0)

  return (
    <div className="p-8 h-full flex flex-col">
      <div
        className="rounded-lg flex-1 flex flex-col min-h-0"
        style={{ backgroundColor: colors.bg.secondary }}
      >
        {/* Header */}
        <div className="p-6 pb-4 flex-shrink-0">
          <div className="flex items-center justify-between">
            <div className="flex items-baseline gap-3">
              <h3
                className="text-lg font-semibold"
                style={{ color: colors.text.header }}
              >
                {t('memory.title')}
              </h3>
              <span className="text-sm" style={{ color: colors.text.muted }}>
                {t('memory.entries', { count: totalEntries, size: formatSize(totalSize) })}
              </span>
            </div>
            <button
              onClick={loadFiles}
              className="p-2 rounded-lg transition-colors hover:opacity-80"
              style={{ color: colors.text.muted }}
              title={t('common.refresh')}
            >
              <RefreshCw className="h-4 w-4" />
            </button>
          </div>

          {/* Search */}
          <div className="relative mt-3">
            <Search
              className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4"
              style={{ color: colors.text.muted }}
            />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder={t('memory.filterPlaceholder')}
              className="w-full pl-9 pr-3 py-2 rounded-lg text-sm focus:outline-none"
              style={{
                backgroundColor: colors.bg.primary,
                color: colors.text.normal,
              }}
            />
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 px-6 pb-6 min-h-0 flex gap-4">
          {/* File list (left) */}
          <div
            className="w-56 flex-shrink-0 rounded-lg overflow-y-auto"
            style={{ backgroundColor: colors.bg.primary }}
          >
            <div className="p-3 space-y-0.5">
              {loading ? (
                <div className="flex items-center justify-center py-8">
                  <Loader2 className="h-5 w-5 animate-spin" style={{ color: colors.text.muted }} />
                </div>
              ) : filteredFiles.length === 0 ? (
                <p className="text-sm px-2 py-4 text-center" style={{ color: colors.text.muted }}>
                  {files.length === 0
                    ? t('memory.noEntries')
                    : t('memory.noMatch')}
                </p>
              ) : (
                filteredFiles.map((file) => (
                  <button
                    key={file.path}
                    onClick={() => loadFile(file.path)}
                    className="w-full text-left px-3 py-2 rounded-md transition-colors flex items-center gap-2"
                    style={{
                      backgroundColor: selectedPath === file.path ? colors.bg.active : 'transparent',
                      color: selectedPath === file.path ? colors.text.header : colors.text.normal,
                    }}
                  >
                    {file.date ? (
                      <Calendar className="h-3.5 w-3.5 flex-shrink-0" style={{ color: colors.accent.purple }} />
                    ) : (
                      <FileText className="h-3.5 w-3.5 flex-shrink-0" style={{ color: colors.accent.purple }} />
                    )}
                    <div className="min-w-0 flex-1">
                      <div className="text-sm truncate">{formatLabel(file)}</div>
                      <div className="text-xs" style={{ color: colors.text.muted }}>
                        {formatSize(file.size)}
                      </div>
                    </div>
                  </button>
                ))
              )}
            </div>
          </div>

          {/* Content viewer (right) */}
          <div
            className="flex-1 rounded-lg relative min-w-0"
            style={{ backgroundColor: colors.bg.primary }}
          >
            {selectedPath ? (
              <>
                {/* Selected file label */}
                <div className="px-4 pt-3 pb-2 flex-shrink-0">
                  <span className="text-sm font-medium" style={{ color: colors.text.header }}>
                    {formatSelectedLabel(selectedPath)}
                  </span>
                  <span className="text-xs ml-2" style={{ color: colors.text.muted }}>
                    {t('memory.readOnly')}
                  </span>
                </div>

                {fileLoading ? (
                  <div className="flex items-center justify-center h-32">
                    <Loader2 className="h-5 w-5 animate-spin" style={{ color: colors.text.muted }} />
                  </div>
                ) : (
                  <div
                    ref={scrollContainerRef}
                    className="absolute left-0 right-0 bottom-0 overflow-y-auto px-4 pb-4"
                    style={{ top: '44px' }}
                  >
                    <div
                      className="text-sm break-all"
                      style={{ color: colors.text.normal }}
                    >
                      <MarkdownRenderer content={content} />
                    </div>
                  </div>
                )}
              </>
            ) : (
              <div className="flex items-center justify-center h-full">
                <p className="text-sm" style={{ color: colors.text.muted }}>
                  {t('memory.selectDate')}
                </p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
