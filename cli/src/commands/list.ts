import { Command } from "commander";
import chalk from "chalk";
import { listWorkspaces, getWorkspaceConfig } from "../utils.js";

export const listCommand = new Command("list")
  .alias("ls")
  .description("List all workspaces")
  .action(async () => {
    const workspaces = listWorkspaces();

    if (workspaces.length === 0) {
      console.log(chalk.dim("No workspaces found"));
      console.log();
      console.log("Create one with:", chalk.cyan("hyve create <name>"));
      return;
    }

    console.log(chalk.bold("Workspaces"));
    console.log(chalk.dim("─".repeat(50)));
    console.log();

    for (const ws of workspaces) {
      const config = getWorkspaceConfig(ws);
      const repos = config?.repos?.join(", ") || "unknown";
      const dbPort = config?.database?.port;

      console.log(`  ${chalk.cyan("◆")} ${chalk.bold(ws)}`);
      console.log(`    ${chalk.dim("Branch:")} ${config?.branch || "unknown"}`);
      console.log(`    ${chalk.dim("Repos:")}  ${repos}`);
      if (dbPort) {
        console.log(`    ${chalk.dim("DB:")}     localhost:${dbPort}`);
      }
      console.log();
    }
  });
