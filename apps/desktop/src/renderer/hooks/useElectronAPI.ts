// Hook to access Electron API methods

export function useElectronAPI() {
  return {
    // Agent Management
    listAgents: () => window.electronAPI.listAgents(),
    getAgentInfo: (agentId: string) => window.electronAPI.getAgentInfo(agentId),
    createAgent: (agentName: string, config: any) => window.electronAPI.createAgent(agentName, config),
    updateAgent: (agentId: string, config: any) => window.electronAPI.updateAgent(agentId, config),
    deleteAgent: (agentId: string) => window.electronAPI.deleteAgent(agentId),

    // Other APIs can be added here as needed
    getConfig: () => window.electronAPI.getConfig(),
    saveConfig: (config: any) => window.electronAPI.saveConfig(config),
    startOpenClaw: () => window.electronAPI.startOpenClaw(),
    stopOpenClaw: () => window.electronAPI.stopOpenClaw(),
    getStatus: () => window.electronAPI.getStatus(),
    validateApiKey: (provider: 'anthropic' | 'openai' | 'google', apiKey: string) =>
      window.electronAPI.validateApiKey(provider, apiKey),
  }
}