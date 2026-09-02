import * as fs from 'fs'
import * as path from 'path'

/**
 * Upstream retired the JSON credential stores in favor of the per-agent
 * SQLite auth store. While any of these files exist, `gateway start`/`restart`
 * refuse preflight and the running gateway fails model-runtime refresh with
 * AuthProfileMigrationRequiredError — detection is by file NAME only, never
 * contents (upstream src/agents/auth-profiles/legacy-source-diagnostic.ts).
 * The names are a frozen upstream contract, safe to mirror here.
 */
const LEGACY_AUTH_CREDENTIAL_FILES = ['auth-profiles.json', 'auth.json'] as const

/** Gateway boot-refusal exit code (upstream EXIT_CONFIG_ERROR, sysexits EX_CONFIG). */
export const GATEWAY_EXIT_CONFIG_ERROR = 78

/**
 * True when a dead gateway's exit matches upstream's "run doctor --fix"
 * migration gate: legacy auth stores, agent-DB schema cutovers, or invalid
 * config. Matching the remediation marker (not specific error names) keeps
 * this working for future migration gates upstream adds.
 */
export function isMigrationRequiredGatewayFailure(
  exitCode: number | null,
  outputTail: string
): boolean {
  if (exitCode === GATEWAY_EXIT_CONFIG_ERROR) return true
  // Upstream quotes the remediation command inconsistently across gates —
  // backticks in the auth/schema messages, double quotes in the config-validation
  // one (`Run "openclaw doctor --fix" to repair`). Accept either (or neither) so a
  // future gate that exits with something other than 78 still self-repairs.
  return /run\s+["'`]?openclaw doctor --fix["'`]?/i.test(outputTail)
}

/**
 * Name-only scan for retired credential files that make the gateway refuse
 * or degrade at boot. Only `agents/<id>/agent/` files are candidates —
 * upstream ignores a root-level ~/.openclaw/auth-profiles.json (verified
 * live 2026-07-31: gateway boots with one present), and scanning it here
 * would trigger a useless doctor run on every launch since doctor never
 * migrates it away.
 */
export function findLegacyAuthCredentialFiles(openclawDir: string): string[] {
  const candidates: string[] = []
  const agentsDir = path.join(openclawDir, 'agents')
  let agentIds: string[] = []
  try {
    agentIds = fs
      .readdirSync(agentsDir, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name)
  } catch {
    // no agents dir yet — root candidates still apply
  }
  for (const id of agentIds) {
    for (const f of LEGACY_AUTH_CREDENTIAL_FILES) {
      candidates.push(path.join(agentsDir, id, 'agent', f))
    }
  }
  const found: string[] = []
  for (const candidate of candidates) {
    try {
      if (fs.statSync(candidate).isFile()) found.push(candidate)
    } catch {
      // absent — fine
    }
  }
  return found
}
