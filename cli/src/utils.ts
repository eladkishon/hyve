import { existsSync, readdirSync, readFileSync } from "fs";
import { join } from "path";
import { getWorkspacesDir, getWorkspaceDir } from "./config.js";

export interface WorkspaceConfig {
  name: string;
  branch: string;
  repos: string[];
  database: {
    enabled: boolean;
    port: number;
    container: string;
  };
  created: string;
  status: string;
}

export function listWorkspaces(): string[] {
  const dir = getWorkspacesDir();
  if (!existsSync(dir)) {
    return [];
  }
  return readdirSync(dir, { withFileTypes: true })
    .filter((d) => d.isDirectory() && !d.name.startsWith("."))
    .map((d) => d.name);
}

export function workspaceExists(name: string): boolean {
  return existsSync(getWorkspaceDir(name));
}

export function getWorkspaceConfig(name: string): WorkspaceConfig | null {
  const configPath = join(getWorkspaceDir(name), ".hyve-workspace.json");
  if (!existsSync(configPath)) {
    return null;
  }
  return JSON.parse(readFileSync(configPath, "utf-8"));
}

export function sanitizeBranchName(name: string): string {
  return name
    .replace(/\s+/g, "-") // spaces to dashes
    .replace(/-+/g, "-") // multiple dashes to single
    .replace(/[^a-zA-Z0-9._/-]/g, "") // remove invalid chars
    .replace(/^[-.]/, "") // no leading dash/dot
    .replace(/[-.]+$/, "") // no trailing dash/dot
    .toLowerCase();
}

export function calculateServicePort(
  serviceName: string,
  defaultPort: number,
  basePort: number,
  workspaceIndex: number,
  portOffset: number
): number {
  const workspaceBase = basePort + workspaceIndex * portOffset;
  const serviceOffset = defaultPort - 3000;
  return workspaceBase + serviceOffset;
}

export function getWorkspaceIndex(name: string): number {
  const workspaces = listWorkspaces().sort();
  const index = workspaces.indexOf(name);
  return index >= 0 ? index : workspaces.length;
}
