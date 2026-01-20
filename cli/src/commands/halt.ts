import { Command } from "commander";
import * as p from "@clack/prompts";
import chalk from "chalk";
import { execa } from "execa";
import { existsSync, readFileSync, rmSync } from "fs";
import { join } from "path";
import { getWorkspaceDir } from "../config.js";
import { listWorkspaces, workspaceExists, getWorkspaceConfig } from "../utils.js";

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

    const wsConfig = getWorkspaceConfig(name);
    const workspaceDir = getWorkspaceDir(name);
    const logsDir = join(workspaceDir, ".hyve", "logs");

    p.intro(chalk.cyan(`Stopping services for ${chalk.bold(name)}`));

    // Stop services by PID
    const repos = wsConfig?.repos || [];
    for (const repo of repos) {
      const pidFile = join(logsDir, `${repo}.pid`);

      if (existsSync(pidFile)) {
        const spinner = p.spinner();
        spinner.start(`Stopping ${repo}...`);

        try {
          const pid = parseInt(readFileSync(pidFile, "utf-8").trim());

          // Kill process group
          try {
            process.kill(-pid, "SIGTERM");
          } catch {
            // Try killing just the process
            try {
              process.kill(pid, "SIGTERM");
            } catch {}
          }

          // Also kill any child processes
          try {
            await execa("pkill", ["-P", String(pid)]);
          } catch {}

          rmSync(pidFile);
          spinner.stop(`${repo} stopped`);
        } catch (error: any) {
          spinner.stop(`${repo} already stopped`);
          rmSync(pidFile, { force: true });
        }
      }
    }

    // Stop database
    if (wsConfig?.database?.container) {
      const dbSpinner = p.spinner();
      dbSpinner.start("Stopping database...");
      try {
        await execa("docker", ["stop", wsConfig.database.container]);
        dbSpinner.stop("Database stopped");
      } catch {
        dbSpinner.stop("Database not running");
      }
    }

    p.outro(chalk.green("All services stopped"));
  });
