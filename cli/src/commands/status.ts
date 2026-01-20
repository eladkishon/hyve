import { Command } from "commander";
import * as p from "@clack/prompts";
import chalk from "chalk";
import { execa } from "execa";
import { existsSync } from "fs";
import { join } from "path";
import { loadConfig, getWorkspaceDir } from "../config.js";
import { listWorkspaces, workspaceExists, getWorkspaceConfig, calculateServicePort, getWorkspaceIndex } from "../utils.js";

export const statusCommand = new Command("status")
  .description("Show workspace status")
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
        message: "Select workspace:",
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
    const workspaceDir = getWorkspaceDir(name);
    const workspaceIndex = getWorkspaceIndex(name);

    console.log();
    console.log(chalk.bold(`Workspace: ${name}`));
    console.log(chalk.dim("─".repeat(50)));
    console.log();

    // Basic info
    console.log(chalk.dim("  Location:"), workspaceDir);
    console.log(chalk.dim("  Branch:  "), wsConfig?.branch || "unknown");
    console.log(chalk.dim("  Created: "), wsConfig?.created || "unknown");
    console.log();

    // Database status
    if (wsConfig?.database?.container) {
      let dbStatus = chalk.red("stopped");
      try {
        const { stdout } = await execa("docker", [
          "inspect",
          "-f",
          "{{.State.Running}}",
          wsConfig.database.container,
        ]);
        if (stdout.trim() === "true") {
          dbStatus = chalk.green("running");
        }
      } catch {}
      console.log(chalk.dim("  Database:"), `${dbStatus} (port ${wsConfig.database.port})`);
    }

    // Services status
    console.log();
    console.log(chalk.bold("  Services:"));
    for (const repo of wsConfig?.repos || []) {
      const serviceConfig = config.services.definitions[repo];
      if (!serviceConfig) continue;

      const port = calculateServicePort(
        repo,
        serviceConfig.default_port,
        config.services.base_port,
        workspaceIndex,
        config.services.port_offset
      );

      // Check if port is in use
      let status = chalk.dim("stopped");
      try {
        await execa("lsof", ["-i", `:${port}`]);
        status = chalk.green("running");
      } catch {}

      console.log(`    ${chalk.cyan(repo)}: ${status} (port ${port})`);
    }
    console.log();
  });
