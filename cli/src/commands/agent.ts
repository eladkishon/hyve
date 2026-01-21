import { Command } from "commander";
import chalk from "chalk";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "fs";
import { join } from "path";
import { getProjectRoot, getWorkspaceDir } from "../config.js";

interface AgentSession {
  id: string;
  workspace: string;
  started: string;
  description?: string;
  pid?: number;
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

function saveAgents(agents: AgentSession[]): void {
  const file = getAgentFile();
  const dir = join(getProjectRoot(), ".hyve");
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  writeFileSync(file, JSON.stringify(agents, null, 2));
}

function generateId(): string {
  return Math.random().toString(36).substring(2, 10);
}

export const agentCommand = new Command("agent")
  .description("Manage agent sessions on workspaces")
  .addCommand(
    new Command("start")
      .description("Register an agent session on a workspace")
      .argument("<workspace>", "Workspace name")
      .option("-d, --description <desc>", "Description of what the agent is working on")
      .action((workspace: string, options) => {
        const workspaceDir = getWorkspaceDir(workspace);
        if (!existsSync(workspaceDir)) {
          console.error(chalk.red(`Workspace not found: ${workspace}`));
          process.exit(1);
        }

        const agents = loadAgents();
        const session: AgentSession = {
          id: generateId(),
          workspace,
          started: new Date().toISOString(),
          description: options.description,
          pid: process.ppid, // Parent process (likely the agent)
        };
        agents.push(session);
        saveAgents(agents);

        console.log(chalk.green(`Agent session started: ${session.id}`));
        console.log(chalk.dim(`  Workspace: ${workspace}`));
        if (options.description) {
          console.log(chalk.dim(`  Task: ${options.description}`));
        }
      })
  )
  .addCommand(
    new Command("stop")
      .description("End an agent session")
      .argument("<id>", "Session ID")
      .action((id: string) => {
        const agents = loadAgents();
        const index = agents.findIndex((a) => a.id === id);
        if (index === -1) {
          console.error(chalk.red(`Session not found: ${id}`));
          process.exit(1);
        }
        const session = agents[index];
        agents.splice(index, 1);
        saveAgents(agents);
        console.log(chalk.green(`Agent session ended: ${id}`));
        console.log(chalk.dim(`  Workspace: ${session.workspace}`));
      })
  )
  .addCommand(
    new Command("list")
      .description("List active agent sessions")
      .action(() => {
        const agents = loadAgents();

        if (agents.length === 0) {
          console.log(chalk.dim("No active agent sessions"));
          return;
        }

        console.log(chalk.bold("Active Agent Sessions"));
        console.log();

        for (const agent of agents) {
          const duration = timeSince(new Date(agent.started));
          console.log(
            chalk.cyan(`  ${agent.id}`) +
              chalk.dim(` → `) +
              chalk.white(agent.workspace) +
              chalk.dim(` (${duration})`)
          );
          if (agent.description) {
            console.log(chalk.dim(`    ${agent.description}`));
          }
        }
      })
  )
  .addCommand(
    new Command("clean")
      .description("Remove stale agent sessions")
      .action(() => {
        const agents = loadAgents();
        const active: AgentSession[] = [];
        let removed = 0;

        for (const agent of agents) {
          // Check if process is still running
          if (agent.pid) {
            try {
              process.kill(agent.pid, 0); // Check if process exists
              active.push(agent);
            } catch {
              removed++;
            }
          } else {
            // No PID, keep if less than 24 hours old
            const age = Date.now() - new Date(agent.started).getTime();
            if (age < 24 * 60 * 60 * 1000) {
              active.push(agent);
            } else {
              removed++;
            }
          }
        }

        saveAgents(active);
        console.log(chalk.green(`Cleaned ${removed} stale session(s)`));
        console.log(chalk.dim(`${active.length} active session(s) remaining`));
      })
  );

function timeSince(date: Date): string {
  const seconds = Math.floor((Date.now() - date.getTime()) / 1000);

  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h`;
  return `${Math.floor(seconds / 86400)}d`;
}
