import { describe, it, expect } from "vitest";
import { parseOpenClawHelp } from "./commands-discovery";

describe("parseOpenClawHelp", () => {
  it("returns [] for empty input", () => {
    expect(parseOpenClawHelp("")).toEqual([]);
  });

  it("returns [] when the help output lacks a Commands: block", () => {
    expect(
      parseOpenClawHelp(
        "OpenClaw 2026.6.2 — All your chats, one OpenClaw.\n\nUsage: openclaw [options] [command]\n\nOptions:\n  -h, --help   Display help for command\n",
      ),
    ).toEqual([]);
  });

  it("parses a single-line command entry", () => {
    const help = [
      "Commands:",
      "  doctor               Diagnose and repair config",
      "",
    ].join("\n");
    const result = parseOpenClawHelp(help);
    expect(result).toEqual([
      { name: "doctor", description: "Diagnose and repair config", hasSubcommands: false },
    ]);
  });

  it("marks commands suffixed with * as having subcommands", () => {
    const help = [
      "Commands:",
      "  agents *             Manage isolated agents (workspaces, auth, routing)",
    ].join("\n");
    const result = parseOpenClawHelp(help);
    expect(result).toEqual([
      {
        name: "agents",
        description: "Manage isolated agents (workspaces, auth, routing)",
        hasSubcommands: true,
      },
    ]);
  });

  it("joins wrapped descriptions across continuation lines", () => {
    const help = [
      "Commands:",
      "  backup *             Create and verify local backup archives for OpenClaw",
      "                       state",
    ].join("\n");
    const result = parseOpenClawHelp(help);
    expect(result).toEqual([
      {
        name: "backup",
        description: "Create and verify local backup archives for OpenClaw state",
        hasSubcommands: true,
      },
    ]);
  });

  it("ignores the 'Hint:' decoration line", () => {
    const help = [
      "Commands:",
      "  Hint: commands suffixed with * have subcommands. Run <command> --help for details.",
      "  doctor               Diagnose",
    ].join("\n");
    const result = parseOpenClawHelp(help);
    expect(result.map((c) => c.name)).toEqual(["doctor"]);
  });

  it("terminates at the Docs: footer", () => {
    const help = [
      "Commands:",
      "  doctor               Diagnose",
      "  update               Update OpenClaw",
      "",
      "Docs: https://docs.openclaw.ai/cli",
      "  something:           that looks like a command but isn't",
    ].join("\n");
    const result = parseOpenClawHelp(help);
    expect(result.map((c) => c.name)).toEqual(["doctor", "update"]);
  });

  it("parses a real-world fixture (15 commands across single+wrapped+starred shapes)", () => {
    const help = [
      "OpenClaw 2026.6.2 — All your chats, one OpenClaw.",
      "",
      "Usage: openclaw [options] [command]",
      "",
      "Options:",
      "  -h, --help           Display help for command",
      "  --no-color           Disable ANSI colors",
      "",
      "Commands:",
      "  Hint: commands suffixed with * have subcommands. Run <command> --help for details.",
      "  acp *                Run and manage ACP-backed coding agents",
      "  agent                Run one agent turn via the Gateway",
      "  agents *             Manage isolated agents (workspaces, auth, routing)",
      "  approvals *          Manage exec approvals (gateway or node host)",
      "  backup *             Create and verify local backup archives for OpenClaw",
      "                       state",
      "  capability *         Run provider capability commands (fallback alias: infer)",
      "  channels *           Add, remove, login, and inspect messaging channels",
      "  chat                 Open a local terminal UI (alias for tui --local)",
      "  clawbot *            Legacy clawbot command aliases",
      "  commitments *        List and manage inferred follow-up commitments",
      "  completion           Generate shell completion script",
      "  config *             Non-interactive config helpers",
      "                       (get/set/unset/file/validate). Default: starts guided",
      "                       setup.",
      "  configure            Interactive configuration for credentials, channels,",
      "                       gateway, and agent defaults",
      "  crestodian           Open the interactive setup and repair assistant",
      "  doctor               Diagnose and repair config, Gateway, plugin, and channel",
      "                       problems",
      "",
      "Docs: https://docs.openclaw.ai/cli",
    ].join("\n");

    const result = parseOpenClawHelp(help);
    const names = result.map((c) => c.name);
    expect(names).toEqual([
      "acp",
      "agent",
      "agents",
      "approvals",
      "backup",
      "capability",
      "channels",
      "chat",
      "clawbot",
      "commitments",
      "completion",
      "config",
      "configure",
      "crestodian",
      "doctor",
    ]);

    // Spot-check a wrapped description.
    const backup = result.find((c) => c.name === "backup")!;
    expect(backup.description).toBe(
      "Create and verify local backup archives for OpenClaw state",
    );
    expect(backup.hasSubcommands).toBe(true);

    // Spot-check a 3-line wrap.
    const config = result.find((c) => c.name === "config")!;
    expect(config.description).toBe(
      "Non-interactive config helpers (get/set/unset/file/validate). Default: starts guided setup.",
    );

    // Spot-check a no-subcommand entry.
    const doctor = result.find((c) => c.name === "doctor")!;
    expect(doctor.hasSubcommands).toBe(false);
    expect(doctor.description).toBe(
      "Diagnose and repair config, Gateway, plugin, and channel problems",
    );
  });

  it("rejects lines whose name doesn't match the lowercase-hyphen shape", () => {
    const help = [
      "Commands:",
      "  doctor               Real command",
      "  Banana               Capitalized — not an openclaw command",
      "  *invalid             Starts with *",
      "  has space            Has space in name",
    ].join("\n");
    const result = parseOpenClawHelp(help);
    expect(result.map((c) => c.name)).toEqual(["doctor"]);
  });

  it("never throws on malformed input — returns [] gracefully", () => {
    expect(() => parseOpenClawHelp("Commands:\n  garbage\n  more garbage\n")).not.toThrow();
    expect(parseOpenClawHelp("Commands:\n  garbage\n").length).toBe(0);
  });
});
