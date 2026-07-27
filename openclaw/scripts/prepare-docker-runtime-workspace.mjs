#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import YAML from "yaml";

const workspacePath = path.resolve("pnpm-workspace.yaml");
const bundledPluginDir = process.env.OPENCLAW_BUNDLED_PLUGIN_DIR?.trim() || "extensions";
const selectedPluginIds = new Set(
  (process.env.OPENCLAW_EXTENSIONS ?? "")
    .split(/[\s,]+/u)
    .map((entry) => entry.trim())
    .filter(Boolean),
);

function isSelectedPluginWorkspacePackage(pattern) {
  if (!pattern.startsWith(`${bundledPluginDir}/`)) {
    return false;
  }
  const pluginId = pattern.slice(bundledPluginDir.length + 1).split("/")[0];
  return selectedPluginIds.has(pluginId);
}

if (!fs.existsSync(workspacePath)) {
  throw new Error(`missing workspace manifest: ${workspacePath}`);
}

const workspace = YAML.parse(fs.readFileSync(workspacePath, "utf8"));
if (!workspace || typeof workspace !== "object" || !Array.isArray(workspace.packages)) {
  throw new Error("invalid pnpm-workspace.yaml: packages must be an array");
}

const selectedPluginPackages = [...selectedPluginIds]
  .toSorted((left, right) => left.localeCompare(right))
  .map((pluginId) => `${bundledPluginDir}/${pluginId}`)
  .filter((packagePath) => fs.existsSync(path.join(packagePath, "package.json")));

workspace.packages = workspace.packages
  .flatMap((entry) => {
    if (entry === `${bundledPluginDir}/*`) {
      return selectedPluginPackages;
    }
    return typeof entry === "string" && isSelectedPluginWorkspacePackage(entry) ? [entry] : [entry];
  })
  .filter((entry, index, entries) => typeof entry === "string" && entries.indexOf(entry) === index);

fs.writeFileSync(workspacePath, YAML.stringify(workspace), "utf8");
