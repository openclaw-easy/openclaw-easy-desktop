import React, { useState, useEffect } from 'react'
import { Button } from './ui/button'
import {
  ChevronDown,
  ChevronUp,
  GripVertical,
  Trash2,
  Plus,
  AlertCircle,
  ArrowDown,
  Shield
} from 'lucide-react'
import { useElectronAPI } from '../hooks/useElectronAPI'

interface ModelFallbackManagerProps {
  primaryModel: string
  fallbackModels: string[]
  onFallbackModelsChange: (fallbacks: string[]) => void
  availableModels: { value: string; label: string; type: 'cloud' | 'local' }[]
  colors: {
    bg: { primary: string; secondary: string; tertiary: string }
    text: { header: string; normal: string; muted: string }
    accent: { blue: string; green: string; yellow: string; purple: string }
  }
}

export const ModelFallbackManager: React.FC<ModelFallbackManagerProps> = ({
  primaryModel,
  fallbackModels,
  onFallbackModelsChange,
  availableModels,
  colors
}) => {
  const electronAPI = useElectronAPI()
  const [isExpanded, setIsExpanded] = useState(false)
  const [newModelSelection, setNewModelSelection] = useState('')
  const [draggedIndex, setDraggedIndex] = useState<number | null>(null)

  // Filter available models to exclude primary and already selected fallbacks
  const selectableModels = availableModels.filter(
    model => model.value !== primaryModel && !fallbackModels.includes(model.value)
  )

  const handleAddFallback = () => {
    if (newModelSelection && !fallbackModels.includes(newModelSelection)) {
      const updatedFallbacks = [...fallbackModels, newModelSelection]
      onFallbackModelsChange(updatedFallbacks)
      setNewModelSelection('')
    }
  }

  const handleRemoveFallback = (index: number) => {
    const updatedFallbacks = fallbackModels.filter((_, i) => i !== index)
    onFallbackModelsChange(updatedFallbacks)
  }

  const handleReorderFallback = (fromIndex: number, toIndex: number) => {
    const updatedFallbacks = [...fallbackModels]
    const [moved] = updatedFallbacks.splice(fromIndex, 1)
    updatedFallbacks.splice(toIndex, 0, moved)
    onFallbackModelsChange(updatedFallbacks)
  }

  const handleDragStart = (index: number) => {
    setDraggedIndex(index)
  }

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault()
  }

  const handleDrop = (e: React.DragEvent, dropIndex: number) => {
    e.preventDefault()
    if (draggedIndex !== null) {
      handleReorderFallback(draggedIndex, dropIndex)
      setDraggedIndex(null)
    }
  }

  const getModelDisplayName = (modelId: string) => {
    const model = availableModels.find(m => m.value === modelId)
    return model?.label || modelId
  }

  const getModelType = (modelId: string): 'cloud' | 'local' => {
    const model = availableModels.find(m => m.value === modelId)
    return model?.type || 'cloud'
  }

  return (
    <div
      className="border rounded-lg p-4 space-y-4"
      style={{
        borderColor: colors.bg.tertiary,
        backgroundColor: colors.bg.secondary
      }}
    >
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center space-x-2">
          <Shield className="h-5 w-5" style={{ color: colors.accent.blue }} />
          <h3 className="text-lg font-semibold" style={{ color: colors.text.header }}>
            Model Fallback Configuration
          </h3>
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setIsExpanded(!isExpanded)}
          className="p-2"
        >
          {isExpanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
        </Button>
      </div>

      {/* Description */}
      <div className="bg-blue-50 dark:bg-blue-900/20 p-3 rounded-lg">
        <div className="flex items-start space-x-2">
          <AlertCircle className="h-4 w-4 mt-0.5 text-blue-600 dark:text-blue-400" />
          <div className="text-sm text-blue-800 dark:text-blue-200">
            <p className="font-medium">Model Failover Protection</p>
            <p className="text-xs mt-1 text-blue-700 dark:text-blue-300">
              Configure backup models that OpenClaw will automatically use if the primary model fails due to rate limits, authentication issues, or downtime.
            </p>
          </div>
        </div>
      </div>

      {/* Current Primary Model */}
      <div className="space-y-2">
        <label className="text-sm font-medium" style={{ color: colors.text.normal }}>
          Primary Model
        </label>
        <div
          className="flex items-center p-3 rounded-lg border-2"
          style={{
            borderColor: colors.accent.green,
            backgroundColor: colors.bg.tertiary
          }}
        >
          <div className="flex items-center space-x-2 flex-1">
            <div
              className="w-2 h-2 rounded-full bg-green-500"
              title="Primary model - used first"
            ></div>
            <span className="font-medium" style={{ color: colors.text.header }}>
              1. {getModelDisplayName(primaryModel)}
            </span>
            <span className="text-xs px-2 py-1 bg-green-100 dark:bg-green-800 text-green-700 dark:text-green-300 rounded-full">
              {getModelType(primaryModel) === 'local' ? 'Local' : 'Cloud'}
            </span>
          </div>
        </div>
      </div>

      {isExpanded && (
        <>
          {/* Fallback Models List */}
          <div className="space-y-2">
            <label className="text-sm font-medium" style={{ color: colors.text.normal }}>
              Fallback Models (in order of preference)
            </label>

            {fallbackModels.length === 0 ? (
              <div
                className="text-center py-6 border-2 border-dashed rounded-lg"
                style={{
                  borderColor: colors.bg.tertiary,
                  color: colors.text.muted
                }}
              >
                <AlertCircle className="h-8 w-8 mx-auto mb-2 opacity-50" />
                <p className="text-sm">No fallback models configured</p>
                <p className="text-xs mt-1">Add backup models to improve reliability</p>
              </div>
            ) : (
              <div className="space-y-2">
                {fallbackModels.map((modelId, index) => (
                  <div
                    key={`${modelId}-${index}`}
                    draggable
                    onDragStart={() => handleDragStart(index)}
                    onDragOver={handleDragOver}
                    onDrop={(e) => handleDrop(e, index)}
                    className="flex items-center p-3 rounded-lg border cursor-move hover:shadow-md transition-shadow"
                    style={{
                      borderColor: colors.bg.tertiary,
                      backgroundColor: draggedIndex === index ? colors.accent.blue + '10' : colors.bg.tertiary
                    }}
                  >
                    <div className="flex items-center space-x-3 flex-1">
                      <GripVertical className="h-4 w-4" style={{ color: colors.text.muted }} />
                      <div
                        className="w-2 h-2 rounded-full bg-yellow-500"
                        title={`Fallback ${index + 1} - used if primary fails`}
                      ></div>
                      <span className="font-medium" style={{ color: colors.text.header }}>
                        {index + 2}. {getModelDisplayName(modelId)}
                      </span>
                      <span className="text-xs px-2 py-1 bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-400 rounded-full">
                        {getModelType(modelId) === 'local' ? 'Local' : 'Cloud'}
                      </span>
                      {index === 0 && (
                        <ArrowDown className="h-4 w-4" style={{ color: colors.text.muted }} />
                      )}
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => handleRemoveFallback(index)}
                      className="text-red-600 hover:text-red-700 hover:bg-red-50"
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Add New Fallback */}
          <div className="space-y-2">
            <label className="text-sm font-medium" style={{ color: colors.text.normal }}>
              Add Fallback Model
            </label>
            <div className="flex gap-2">
              <select
                value={newModelSelection}
                onChange={(e) => setNewModelSelection(e.target.value)}
                className="flex-1 px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                style={{
                  backgroundColor: colors.bg.tertiary,
                  borderColor: colors.bg.tertiary,
                  color: colors.text.normal
                }}
                disabled={selectableModels.length === 0}
              >
                <option value="">
                  {selectableModels.length === 0
                    ? "No additional models available"
                    : "Select a fallback model..."}
                </option>
                <optgroup label="☁️ Cloud Models">
                  {selectableModels
                    .filter(model => model.type === 'cloud')
                    .map(model => (
                      <option key={model.value} value={model.value}>
                        {model.label}
                      </option>
                    ))
                  }
                </optgroup>
                <optgroup label="🏠 Local Models">
                  {selectableModels
                    .filter(model => model.type === 'local')
                    .map(model => (
                      <option key={model.value} value={model.value}>
                        {model.label}
                      </option>
                    ))
                  }
                </optgroup>
              </select>
              <Button
                onClick={handleAddFallback}
                disabled={!newModelSelection}
                className="px-4 py-2"
              >
                <Plus className="h-4 w-4 mr-1" />
                Add
              </Button>
            </div>
          </div>

          {/* Fallback Chain Visualization */}
          {fallbackModels.length > 0 && (
            <div className="bg-gray-50 dark:bg-gray-900/20 p-4 rounded-lg">
              <h4 className="text-sm font-medium mb-3" style={{ color: colors.text.header }}>
                Fallback Chain Preview
              </h4>
              <div className="text-xs space-y-1" style={{ color: colors.text.muted }}>
                <p>• If <span className="font-medium">{getModelDisplayName(primaryModel)}</span> fails → try <span className="font-medium">{getModelDisplayName(fallbackModels[0])}</span></p>
                {fallbackModels.slice(1).map((modelId, index) => (
                  <p key={modelId}>
                    • If <span className="font-medium">{getModelDisplayName(fallbackModels[index])}</span> fails → try <span className="font-medium">{getModelDisplayName(modelId)}</span>
                  </p>
                ))}
                <p>• If all fallbacks fail → return to <span className="font-medium">{getModelDisplayName(primaryModel)}</span></p>
              </div>
            </div>
          )}

          {/* Recommendations */}
          <div className="bg-yellow-50 dark:bg-yellow-900/20 p-3 rounded-lg">
            <div className="flex items-start space-x-2">
              <AlertCircle className="h-4 w-4 mt-0.5 text-yellow-600 dark:text-yellow-400" />
              <div className="text-sm">
                <p className="font-medium text-yellow-800 dark:text-yellow-200">
                  Best Practices
                </p>
                <ul className="text-xs mt-1 space-y-1 text-yellow-700 dark:text-yellow-300">
                  <li>• Mix cloud and local models for maximum reliability</li>
                  <li>• Order from highest to lowest quality/preference</li>
                  <li>• Include at least one local model for offline capability</li>
                  <li>• Test each model before adding as fallback</li>
                </ul>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  )
}