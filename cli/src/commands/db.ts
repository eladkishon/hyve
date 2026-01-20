import { Command } from "commander";
import * as p from "@clack/prompts";
import chalk from "chalk";
import { spawnSync } from "child_process";
import { loadConfig } from "../config.js";
import { listWorkspaces, workspaceExists, getWorkspaceConfig } from "../utils.js";

export const dbCommand = new Command("db")
  .description("Connect to workspace database")
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
      name = result as string;
    }

    if (!workspaceExists(name)) {
      p.log.error(`Workspace not found: ${name}`);
      process.exit(1);
    }

    const config = loadConfig();
    const wsConfig = getWorkspaceConfig(name);

    if (!wsConfig?.database?.port) {
      p.log.error("No database configured for this workspace");
      process.exit(1);
    }

    console.log(chalk.dim(`Connecting to database on port ${wsConfig.database.port}...`));
    console.log();

    // Connect using psql
    spawnSync(
      "psql",
      [
        "-h",
        "localhost",
        "-p",
        String(wsConfig.database.port),
        "-U",
        config.database.user,
        "-d",
        config.database.name,
      ],
      {
        stdio: "inherit",
        env: {
          ...process.env,
          PGPASSWORD: config.database.password,
        },
      }
    );
  });
