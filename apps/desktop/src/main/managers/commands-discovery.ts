/**
 * Commands-discovery parser.
 *
 * Parses the human-readable output of `openclaw --help` into a structured
 * list of top-level CLI commands. Used by the renderer's "Discovered"
 * section so commands shipped by upstream after our static catalog was
 * authored (acp, commitments, crestodian, message, onboard, setup,
 * transcripts, …) are still surfaced — the user can run them from the
 * desktop without us having to refresh the catalog on every upstream merge.
 *
 * Why not `openclaw --help --json`? Upstream doesn't ship that yet, and
 * the human-readable format is stable enough (clack/commander-style):
 *
 *   Commands:
 *     Hint: commands suffixed with * have subcommands. Run <command> --help for details.
 *     acp *                Run and manage ACP-backed coding agents
 *     agent                Run one agent turn via the Gateway
 *     ...
 *     doctor               Diagnose and repair config, Gateway, plugin, and channel
 *                          problems
 *
 * Key shape details we depend on:
 *   - The block starts with a line that is exactly "Commands:".
 *   - The block ends at a blank line, a docs hint, or another section header.
 *   - Each entry is a continuation-aware row: `^  <name>(\*)?\s{2,}<description>`,
 *     and descriptions wrap onto subsequent lines that start with deep indent.
 *   - The first "Hint:" line is decoration, not a command.
 *
 * Pure — pass the output text in, get back a list. No IO.
 */

export interface DiscoveredCommand {
  /** Top-level command name (e.g. "doctor", "agents"). No subcommand path. */
  name: string;
  /** Human-readable description from the help text. May be empty. */
  description: string;
  /** True if upstream marked this with `*` (it has subcommands). */
  hasSubcommands: boolean;
}

/**
 * Lines we never treat as command entries even if their column shape
 * would match. The `Hint:` line is documentation, not a command name.
 */
const NON_COMMAND_LINE_PREFIXES = ["Hint:"] as const;

/** Match a Commands-block entry's first line, capturing name + description prefix. */
const ENTRY_FIRST_LINE_RE = /^ {2}([a-z][a-z0-9-]*)(\s+\*)?\s{2,}(.*)$/;
/** Match a continuation line (a wrap of the previous entry's description). */
const ENTRY_CONTINUATION_RE = /^ {20,}(\S.*)$/;

/**
 * Parse `openclaw --help` output and return the top-level commands list.
 * Returns `[]` if the Commands: block can't be located — callers can
 * still fall back to the static catalog without surfacing an error.
 */
export function parseOpenClawHelp(output: string): DiscoveredCommand[] {
  const lines = output.split("\n");
  const commands: DiscoveredCommand[] = [];

  // Find the Commands block. Match exactly "Commands:" — `Options:` and
  // `Usage:` look superficially similar but their entries follow a
  // different shape (flags, not bare names).
  let inBlock = false;
  let current: DiscoveredCommand | null = null;
  let blockTerminated = false;

  for (const line of lines) {
    if (!inBlock) {
      if (line.trim() === "Commands:") inBlock = true;
      continue;
    }
    if (blockTerminated) break;

    // Block terminators: blank line followed by a non-indented section
    // header (e.g. "Docs:"), or a `Docs:` line directly.
    if (/^[A-Z][A-Za-z0-9 ]+:$/.test(line.trim())) {
      blockTerminated = true;
      break;
    }
    if (/^Docs:/.test(line)) {
      blockTerminated = true;
      break;
    }

    // Skip the help-block decoration line.
    if (NON_COMMAND_LINE_PREFIXES.some((p) => line.trim().startsWith(p))) continue;

    const m = line.match(ENTRY_FIRST_LINE_RE);
    if (m) {
      // Flush previous entry.
      if (current) commands.push(current);
      current = {
        name: m[1],
        hasSubcommands: !!m[2],
        description: m[3].trim(),
      };
      continue;
    }

    // Continuation of the prior entry's description.
    const c = line.match(ENTRY_CONTINUATION_RE);
    if (c && current) {
      current.description = (current.description + " " + c[1].trim()).trim();
      continue;
    }
  }
  if (current) commands.push(current);

  return commands;
}
