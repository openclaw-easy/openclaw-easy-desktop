/**
 * Logger - Centralized logging for OpenClaw Manager
 */
export class Logger {
  private logs: string[] = []
  private logStreamInterval: NodeJS.Timeout | null = null
  private rotationInterval: NodeJS.Timeout | null = null

  constructor() {
    this.setupLogRotation()
    this.startLogStreaming()
  }

  addLog(message: string): void {
    const timestamp = new Date().toISOString()
    const logEntry = `[${timestamp}] ${message}`
    this.logs.push(logEntry)
    console.log('[OpenClawManager Log]', message)

    // Keep only last 1000 logs
    if (this.logs.length > 1000) {
      this.logs = this.logs.slice(-500)
    }
  }

  getLogs(): string[] {
    return [...this.logs]
  }

  private setupLogRotation(): void {
    this.rotationInterval = setInterval(() => {
      if (this.logs.length > 500) {
        this.logs = this.logs.slice(-250)
      }
    }, 60000) // Every minute
  }

  private startLogStreaming(): void {
    this.logStreamInterval = setInterval(() => {
      // Log streaming is now handled by individual managers
    }, 5000) // Every 5 seconds
  }

  destroy(): void {
    if (this.logStreamInterval) {
      clearInterval(this.logStreamInterval)
      this.logStreamInterval = null
    }
    if (this.rotationInterval) {
      clearInterval(this.rotationInterval)
      this.rotationInterval = null
    }
  }
}
