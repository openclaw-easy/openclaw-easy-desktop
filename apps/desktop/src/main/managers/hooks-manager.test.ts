import { describe, it, expect, vi } from 'vitest'
import { HooksManager } from './hooks-manager'
import type { ConfigManager } from './config-manager'

/**
 * Enabling a hook used to rewrite the whole ~/.openclaw/openclaw.json with a
 * raw readFile/writeFile pair — outside the desktop's config write lock and
 * without an atomic replace. A concurrent write (channel add, model change)
 * could lose either update, and a crash mid-write left a truncated config,
 * which stops the gateway booting at all. These tests pin the write onto
 * ConfigManager.mutateConfig, which locks, backs up, and writes atomically.
 */
function makeConfigManager(config: any) {
  const mutateConfig = vi.fn(async (mutator: (c: any) => boolean | void) => {
    const result = mutator(config)
    return result === undefined ? true : result
  })
  return { mutateConfig } as unknown as ConfigManager & { mutateConfig: typeof mutateConfig }
}

function makeExecutor() {
  const executeCommand = vi.fn(async () => '')
  return { executeCommand } as any
}

describe('HooksManager.setHookEnabled', () => {
  it('enables through the locked config path, never a raw file write', async () => {
    const config = { hooks: { internal: { entries: { 'my-hook': { disabled: true } } } } }
    const configManager = makeConfigManager(config)
    const mgr = new HooksManager(makeExecutor(), configManager)

    const result = await mgr.setHookEnabled('my-hook', true)

    expect(result.success).toBe(true)
    expect(configManager.mutateConfig).toHaveBeenCalledOnce()
    // Absence of the entry is what "enabled" means.
    expect(config.hooks.internal.entries).toBeUndefined()
  })

  it('keeps sibling hook entries when removing one', async () => {
    const config = {
      hooks: { internal: { entries: { 'my-hook': { disabled: true }, other: { disabled: true } } } },
    }
    const configManager = makeConfigManager(config)
    const mgr = new HooksManager(makeExecutor(), configManager)

    await mgr.setHookEnabled('my-hook', true)

    expect(config.hooks.internal.entries).toEqual({ other: { disabled: true } })
  })

  it('reports no change when the hook is already enabled by default', async () => {
    const config = { hooks: { internal: {} } }
    const configManager = makeConfigManager(config)
    const mgr = new HooksManager(makeExecutor(), configManager)

    const result = await mgr.setHookEnabled('absent-hook', true)

    // Still a success for the caller — the hook IS enabled — but the mutator
    // must return false so mutateConfig skips a pointless backup + rewrite.
    expect(result.success).toBe(true)
    expect(await configManager.mutateConfig.mock.results[0].value).toBe(false)
  })

  it('disables through the CLI, not the config', async () => {
    const config = { hooks: { internal: { entries: {} } } }
    const configManager = makeConfigManager(config)
    const executor = makeExecutor()
    const mgr = new HooksManager(executor, configManager)

    const result = await mgr.setHookEnabled('my-hook', false)

    expect(result.success).toBe(true)
    expect(executor.executeCommand).toHaveBeenCalledWith(['hooks', 'disable', 'my-hook'], 15000)
    expect(configManager.mutateConfig).not.toHaveBeenCalled()
  })
})
