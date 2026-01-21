import { Command } from "commander";
import chalk from "chalk";
import { existsSync, readFileSync, readdirSync } from "fs";
import { join } from "path";
import { getWorkspacesDir, getWorkspaceDir, getProjectRoot } from "../config.js";
import { getWorkspaceConfig, listWorkspaces } from "../utils.js";
import { execSync } from "child_process";

interface AgentSession {
  id: string;
  workspace: string;
  started: string;
  description?: string;
  pid?: number;
  repo?: string;
  status?: "running" | "completed" | "failed";
}

function getAgentFile(): string {
  const projectRoot = getProjectRoot();
  return join(projectRoot, ".hyve", "agents.json");
}

function loadAgents(): AgentSession[] {
  const file = getAgentFile();
  if (!existsSync(file)) {
    return [];
  }
  try {
    return JSON.parse(readFileSync(file, "utf-8"));
  } catch {
    return [];
  }
}

function isProcessRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function timeSince(date: Date): string {
  const seconds = Math.floor((Date.now() - date.getTime()) / 1000);
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h`;
  return `${Math.floor(seconds / 86400)}d`;
}

function getGitStatus(repoDir: string): { modified: number; staged: number; untracked: number } {
  try {
    const status = execSync("git status --porcelain", {
      cwd: repoDir,
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "ignore"],
    });
    const lines = status.trim().split("\n").filter(Boolean);
    let modified = 0, staged = 0, untracked = 0;
    for (const line of lines) {
      if (line.startsWith("??")) untracked++;
      else if (line.startsWith(" M") || line.startsWith(" D")) modified++;
      else if (line.startsWith("M") || line.startsWith("A") || line.startsWith("D")) staged++;
    }
    return { modified, staged, untracked };
  } catch {
    return { modified: 0, staged: 0, untracked: 0 };
  }
}

export const dashboardCommand = new Command("dashboard")
  .alias("dash")
  .description("Show overview of all workspaces and agent activity")
  .option("-w, --workspace <name>", "Show detailed view for specific workspace")
  .action((options) => {
    if (options.workspace) {
      showWorkspaceDetail(options.workspace);
    } else {
      showOverview();
    }
  });

function showOverview() {
  const workspaces = listWorkspaces();
  const agents = loadAgents();

  console.log();
  console.log(chalk.red("⬡") + chalk.bold(" Hyve Dashboard"));
  console.log(chalk.dim("━".repeat(60)));
  console.log();

  if (workspaces.length === 0) {
    console.log(chalk.dim("  No active workspaces"));
    console.log();
    console.log(chalk.dim("  Create one with: hyve work \"Feature Name\" \"Task description\""));
    return;
  }

  // Show each workspace
  for (const ws of workspaces) {
    const config = getWorkspaceConfig(ws);
    const wsAgents = agents.filter(a => a.workspace === ws);
    const workspaceDir = getWorkspaceDir(ws);

    // Check for current task
    const taskFile = join(workspaceDir, ".hyve", "current-task.md");
    const hasActiveTask = existsSync(taskFile);

    // Status indicator
    let statusIcon = chalk.green("●");
    let statusText = "idle";

    if (wsAgents.some(a => a.pid && isProcessRunning(a.pid))) {
      statusIcon = chalk.cyan("◉");
      statusText = "agent active";
    } else if (hasActiveTask) {
      statusIcon = chalk.yellow("○");
      statusText = "task pending";
    }

    console.log(`${statusIcon} ${chalk.bold(ws)} ${chalk.dim(`(${statusText})`)}`);

    if (config) {
      console.log(chalk.dim(`  Branch: ${config.branch}`));
      console.log(chalk.dim(`  Repos:  ${config.repos.join(", ")}`));

      // Show git status per repo
      for (const repo of config.repos) {
        const repoDir = join(workspaceDir, repo);
        if (existsSync(repoDir)) {
          const git = getGitStatus(repoDir);
          const changes = [];
          if (git.staged > 0) changes.push(chalk.green(`+${git.staged}`));
          if (git.modified > 0) changes.push(chalk.yellow(`~${git.modified}`));
          if (git.untracked > 0) changes.push(chalk.dim(`?${git.untracked}`));

          if (changes.length > 0) {
            console.log(chalk.dim(`    ${repo}: `) + changes.join(" "));
          }
        }
      }
    }

    // Show active agents
    for (const agent of wsAgents) {
      const running = agent.pid && isProcessRunning(agent.pid);
      const icon = running ? chalk.cyan("↳") : chalk.dim("↳");
      const duration = timeSince(new Date(agent.started));
      console.log(`  ${icon} Agent ${agent.id} ${chalk.dim(`(${duration})`)}${agent.repo ? chalk.dim(` → ${agent.repo}`) : ""}`);
      if (agent.description) {
        console.log(chalk.dim(`      ${agent.description.slice(0, 50)}...`));
      }
    }

    console.log();
  }

  console.log(chalk.dim("━".repeat(60)));
  console.log(chalk.dim("  hyve dashboard -w <name>  ") + "Detailed workspace view");
  console.log(chalk.dim("  hyve work \"Name\" \"Task\"   ") + "Start new work");
  console.log();
}

function showWorkspaceDetail(name: string) {
  const workspaceDir = getWorkspaceDir(name);
  if (!existsSync(workspaceDir)) {
    console.error(chalk.red(`Workspace not found: ${name}`));
    process.exit(1);
  }

  const config = getWorkspaceConfig(name);
  const agents = loadAgents().filter(a => a.workspace === name);

  console.log();
  console.log(chalk.red("⬡") + chalk.bold(` Workspace: ${name}`));
  console.log(chalk.dim("━".repeat(60)));
  console.log();

  if (config) {
    console.log(chalk.dim("Branch:   ") + config.branch);
    console.log(chalk.dim("Created:  ") + new Date(config.created).toLocaleString());
    console.log(chalk.dim("Location: ") + workspaceDir);
    if (config.database?.enabled) {
      console.log(chalk.dim("Database: ") + `localhost:${config.database.port}`);
    }
    console.log();

    // Repo details
    console.log(chalk.bold("Repositories"));
    console.log();

    for (const repo of config.repos) {
      const repoDir = join(workspaceDir, repo);
      console.log(`  ${chalk.cyan("■")} ${chalk.bold(repo)}`);
      console.log(chalk.dim(`    ${repoDir}`));

      if (existsSync(repoDir)) {
        const git = getGitStatus(repoDir);
        console.log(chalk.dim("    Git: ") +
          chalk.green(`${git.staged} staged`) + ", " +
          chalk.yellow(`${git.modified} modified`) + ", " +
          chalk.dim(`${git.untracked} untracked`));
      }
      console.log();
    }
  }

  // Current task
  const taskFile = join(workspaceDir, ".hyve", "current-task.md");
  if (existsSync(taskFile)) {
    console.log(chalk.bold("Current Task"));
    console.log();
    const taskContent = readFileSync(taskFile, "utf-8");
    // Extract just the task line
    const taskMatch = taskContent.match(/## Task\n\n([^\n]+)/);
    if (taskMatch) {
      console.log(chalk.dim("  ") + taskMatch[1]);
    }
    console.log();
  }

  // Agent activity
  if (agents.length > 0) {
    console.log(chalk.bold("Agent Activity"));
    console.log();

    for (const agent of agents) {
      const running = agent.pid && isProcessRunning(agent.pid);
      const icon = running ? chalk.green("●") : chalk.dim("○");
      const status = running ? chalk.green("running") : chalk.dim("stopped");
      const duration = timeSince(new Date(agent.started));

      console.log(`  ${icon} ${agent.id} ${chalk.dim(`(${status}, ${duration})`)}`);
      if (agent.repo) {
        console.log(chalk.dim(`    Repo: ${agent.repo}`));
      }
      if (agent.description) {
        console.log(chalk.dim(`    Task: ${agent.description}`));
      }
      console.log();
    }
  }

  console.log(chalk.dim("━".repeat(60)));
  console.log(chalk.dim("  hyve run " + name + "     ") + "Start services");
  console.log(chalk.dim("  hyve halt " + name + "    ") + "Stop services");
  console.log(chalk.dim("  hyve cleanup " + name + " ") + "Remove workspace");
  console.log();
}
