import { readFileSync, existsSync } from "fs";
import { parse } from "yaml";
import { join, dirname } from "path";

export interface RepoConfig {
  path: string;
  remote?: string;
  setup_script?: string;
}

export interface ServiceDefinition {
  default_port: number;
  dev_command?: string;
  env_var?: string;
  depends_on?: string[];
  pre_run?: string;
  health_check?: string;
}

export interface HyveConfig {
  workspaces_dir: string;
  required_repos: string[];
  repos: Record<string, RepoConfig>;
  database: {
    enabled: boolean;
    image?: string;
    source_port: number;
    base_port: number;
    user: string;
    password: string;
    name: string;
  };
  services: {
    port_offset: number;
    base_port: number;
    shell_wrapper?: string;
    definitions: Record<string, ServiceDefinition>;
  };
  branches: {
    prefix: string;
    base: string;
  };
}

export function findConfigFile(startDir: string = process.cwd()): string | null {
  let dir = startDir;
  while (dir !== "/") {
    const configPath = join(dir, ".hyve.yaml");
    if (existsSync(configPath)) {
      return configPath;
    }
    const configPathYml = join(dir, ".hyve.yml");
    if (existsSync(configPathYml)) {
      return configPathYml;
    }
    dir = dirname(dir);
  }
  return null;
}

export function loadConfig(): HyveConfig {
  const configPath = findConfigFile();
  if (!configPath) {
    throw new Error("No .hyve.yaml found. Run 'hyve init' first.");
  }

  const content = readFileSync(configPath, "utf-8");
  const config = parse(content) as HyveConfig;

  // Set defaults
  config.workspaces_dir = config.workspaces_dir || "./workspaces";
  config.required_repos = config.required_repos || [];
  config.branches = config.branches || { prefix: "feature/", base: "master" };
  config.services = config.services || {
    port_offset: 1000,
    base_port: 4000,
    definitions: {},
  };
  config.database = config.database || {
    enabled: false,
    source_port: 5432,
    base_port: 5500,
    user: "postgres",
    password: "postgres",
    name: "postgres",
  };

  return config;
}

export function getProjectRoot(): string {
  const configPath = findConfigFile();
  if (!configPath) {
    throw new Error("No .hyve.yaml found");
  }
  return dirname(configPath);
}

export function getWorkspacesDir(): string {
  const config = loadConfig();
  const projectRoot = getProjectRoot();
  return join(projectRoot, config.workspaces_dir);
}

export function getWorkspaceDir(name: string): string {
  return join(getWorkspacesDir(), name);
}

export function getRepoPath(repoName: string): string {
  const config = loadConfig();
  const projectRoot = getProjectRoot();
  const repoConfig = config.repos[repoName];
  if (!repoConfig) {
    throw new Error(`Unknown repo: ${repoName}`);
  }
  return join(projectRoot, repoConfig.path);
}
