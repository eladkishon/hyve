import { Command } from "commander";
import * as p from "@clack/prompts";
import chalk from "chalk";
import { execSync } from "child_process";
import { existsSync, readFileSync, rmSync } from "fs";
import { join } from "path";
import { loadConfig, getWorkspaceDir } from "../config.js";
import { listWorkspaces, workspaceExists, getWorkspaceConfig, getWorkspaceIndex, calculateServicePort } from "../utils.js";

export const haltCommand = new Command("halt")
  .alias("stop")
  .description("Stop all services for a workspace")
  .argument("[name]", "Workspace name")
  .action(async (name: string | undefined) => {
    const workspaces = listWorkspaces();

    if (workspaces.length === 0) {
      p.log.error("No workspaces found");
      process.exit(1);
    }

    // Interactive selection if no name provided
    if (!name) {
      const result = await p.select({
        message: "Select workspace to stop:",
        options: workspaces.map((ws) => ({ value: ws, label: ws })),
      });
      if (p.isCancel(result)) {
        p.cancel("Cancelled");
        process.exit(0);
      }
      name = result;
    }

    if (!workspaceExists(name)) {
      p.log.error(`Workspace not found: ${name}`);
      process.exit(1);
    }

    const config = loadConfig();
    const wsConfig = getWorkspaceConfig(name);
    const workspaceDir = getWorkspaceDir(name!);
    const logsDir = join(workspaceDir, ".hyve", "logs");
    const workspaceIndex = getWorkspaceIndex(name!);

    console.log(chalk.cyan(`Stopping services for ${chalk.bold(name)}`));

    // Stop services by PID and by port
    const repos = wsConfig?.repos || [];
    for (const repo of repos) {
      const pidFile = join(logsDir, `${repo}.pid`);
      let stopped = false;

      // First try by PID
      if (existsSync(pidFile)) {
        try {
          const pid = parseInt(readFileSync(pidFile, "utf-8").trim());

          // Kill process group
          try {
            process.kill(-pid, "SIGTERM");
            stopped = true;
          } catch {
            try {
              process.kill(pid, "SIGTERM");
              stopped = true;
            } catch {}
          }

          // Also kill any child processes
          try {
            execSync(`pkill -P ${pid}`, { stdio: "ignore" });
          } catch {}

          rmSync(pidFile);
        } catch {
          rmSync(pidFile, { force: true });
        }
      }

      // Also kill by port (in case PID is stale or process was restarted)
      const serviceConfig = config.services.definitions[repo];
      if (serviceConfig) {
        const port = calculateServicePort(
          repo,
          serviceConfig.default_port,
          config.services.base_port,
          workspaceIndex,
          config.services.port_offset
        );

        try {
          const { stdout } = { stdout: execSync(`lsof -ti :${port}`, { encoding: "utf-8", stdio: ["pipe", "pipe", "ignore"] }) };
          const pids = stdout.trim().split("\n").filter(Boolean);
          for (const pid of pids) {
            try {
              execSync(`kill -9 ${pid}`, { stdio: "ignore" });
              stopped = true;
            } catch {}
          }
        } catch {
          // No process on this port
        }
      }

      if (stopped) {
        console.log(chalk.green(`  ✓ ${repo} stopped`));
      } else {
        console.log(chalk.dim(`  - ${repo} not running`));
      }
    }

    console.log(chalk.green("✓ All services stopped"));
  });
