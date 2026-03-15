type CommandExecutor = {
  executeCommand(args: string[], timeoutMs?: number): Promise<string | null>
}

/**
 * SessionManager - Manages OpenClaw conversation sessions
 */
export class SessionManager {
  private executor: CommandExecutor

  constructor(executor: CommandExecutor) {
    this.executor = executor
  }

  /**
   * List all sessions or filter by active time
   */
  async listSessions(agentId?: string, activeMinutes?: number): Promise<{
    success: boolean
    sessions?: Array<{
      key: string
      kind: string
      chatType: string
      updatedAt?: number
      inputTokens?: number
      outputTokens?: number
      messageCount?: number
    }>
    error?: string
  }> {
    try {
      console.log('[SessionManager] Listing sessions...')

      // Build command arguments
      const args = ['sessions', '--json']
      if (activeMinutes) {
        args.push('--active', activeMinutes.toString())
      }

      const result = await this.executor.executeCommand(args)

      if (result) {
        const data = JSON.parse(result)
        console.log('[SessionManager] Sessions data:', data)

        // Handle both CLI format and gateway format
        const sessions = data.sessions || []

        // Parse sessions to extract key info
        const parsedSessions = sessions.map((session: any) => ({
          key: session.key || session.sessionKey || '',
          kind: session.kind || session.chatType || 'unknown',
          chatType: session.chatType || 'direct',
          updatedAt: session.updatedAt || session.lastActive || 0,
          inputTokens: session.inputTokens || 0,
          outputTokens: session.outputTokens || 0,
          messageCount: session.messageCount || 0,
        }))

        // Sort by updatedAt descending (most recent first)
        parsedSessions.sort((a: any, b: any) => {
          const timeA = a.updatedAt || 0
          const timeB = b.updatedAt || 0
          return timeB - timeA
        })

        return {
          success: true,
          sessions: parsedSessions,
        }
      }

      return {
        success: false,
        error: 'No session data returned',
      }
    } catch (error: any) {
      console.error('[SessionManager] Error listing sessions:', error)
      return {
        success: false,
        error: error.message || 'Failed to list sessions',
      }
    }
  }

  /**
   * Get details for a specific session using gateway call
   */
  async getSessionDetails(sessionKey: string): Promise<{
    success: boolean
    session?: any
    error?: string
  }> {
    try {
      console.log('[SessionManager] Getting session details for:', sessionKey)

      // Use gateway call to get live session data
      const result = await this.executor.executeCommand([
        'gateway',
        'call',
        'sessions.list',
        '--json',
      ])

      if (result) {
        const data = JSON.parse(result)
        const sessions = data.sessions || []

        // Find the specific session by key
        const session = sessions.find((s: any) => s.key === sessionKey)

        if (session) {
          return {
            success: true,
            session,
          }
        }

        return {
          success: false,
          error: 'Session not found',
        }
      }

      return {
        success: false,
        error: 'No data returned from gateway',
      }
    } catch (error: any) {
      console.error('[SessionManager] Error getting session details:', error)
      return {
        success: false,
        error: error.message || 'Failed to get session details',
      }
    }
  }

  /**
   * Create a new session by sending /new command to the chat
   * Note: This requires an active chat connection
   */
  async createNewSession(agentId: string = 'main'): Promise<{
    success: boolean
    message?: string
    error?: string
  }> {
    try {
      console.log('[SessionManager] Creating new session...')

      // The /new command must be sent through the chat interface
      // This is a placeholder - actual implementation would need chat connection
      return {
        success: true,
        message: 'Send "/new" command in chat to start a new session',
      }
    } catch (error: any) {
      console.error('[SessionManager] Error creating session:', error)
      return {
        success: false,
        error: error.message || 'Failed to create session',
      }
    }
  }

  /**
   * Reset current session by sending /reset command
   * Note: This requires an active chat connection
   */
  async resetSession(agentId: string = 'main'): Promise<{
    success: boolean
    message?: string
    error?: string
  }> {
    try {
      console.log('[SessionManager] Resetting session...')

      // The /reset command must be sent through the chat interface
      return {
        success: true,
        message: 'Send "/reset" command in chat to reset the current session',
      }
    } catch (error: any) {
      console.error('[SessionManager] Error resetting session:', error)
      return {
        success: false,
        error: error.message || 'Failed to reset session',
      }
    }
  }

  /**
   * Delete a session by removing it from sessions.json and deleting its transcript file
   */
  async deleteSession(sessionKey: string, agentId: string = 'main'): Promise<{
    success: boolean
    message?: string
    error?: string
  }> {
    try {
      console.log('[SessionManager] Deleting session:', sessionKey)

      const fs = require('fs').promises
      const path = require('path')
      const os = require('os')

      // Path to sessions store
      const sessionsDir = path.join(os.homedir(), '.openclaw', 'agents', agentId, 'sessions')
      const sessionsStorePath = path.join(sessionsDir, 'sessions.json')

      // Check if sessions store exists
      try {
        await fs.access(sessionsStorePath)
      } catch {
        return {
          success: false,
          error: 'Sessions store not found',
        }
      }

      // Read sessions store
      const storeData = await fs.readFile(sessionsStorePath, 'utf8')
      const store = JSON.parse(storeData)

      // Check if session exists
      if (!store[sessionKey]) {
        return {
          success: false,
          error: 'Session not found in store',
        }
      }

      // Get session file path
      const sessionFile = store[sessionKey].sessionFile
      const sessionId = store[sessionKey].sessionId

      // Delete transcript file if it exists
      if (sessionFile) {
        try {
          await fs.unlink(sessionFile)
          console.log('[SessionManager] Deleted transcript file:', sessionFile)
        } catch (error) {
          console.warn('[SessionManager] Failed to delete transcript file:', error)
          // Continue even if file deletion fails
        }
      }

      // Remove session from store
      delete store[sessionKey]

      // Write updated store back
      await fs.writeFile(sessionsStorePath, JSON.stringify(store, null, 2), 'utf8')

      console.log('[SessionManager] Session deleted successfully:', sessionKey)
      return {
        success: true,
        message: `Session ${sessionKey} deleted successfully`,
      }
    } catch (error: any) {
      console.error('[SessionManager] Error deleting session:', error)
      return {
        success: false,
        error: error.message || 'Failed to delete session',
      }
    }
  }
}
