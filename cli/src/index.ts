#!/usr/bin/env node
import { Command } from "commander";
import chalk from "chalk";
import { createCommand } from "./commands/create.js";
import { cleanupCommand } from "./commands/cleanup.js";
import { listCommand } from "./commands/list.js";
import { statusCommand } from "./commands/status.js";
import { runCommand } from "./commands/run.js";
import { haltCommand } from "./commands/halt.js";
import { dbCommand } from "./commands/db.js";

const VERSION = "2.0.0";

const logo = chalk.yellow(`
    ██╗  ██╗██╗   ██╗██╗   ██╗███████╗
    ██║  ██║╚██╗ ██╔╝██║   ██║██╔════╝
    ███████║ ╚████╔╝ ██║   ██║█████╗
    ██╔══██║  ╚██╔╝  ╚██╗ ██╔╝██╔══╝
    ██║  ██║   ██║    ╚████╔╝ ███████╗
    ╚═╝  ╚═╝   ╚═╝     ╚═══╝  ╚══════╝
`);

const program = new Command();

program
  .name("hyve")
  .description("Autonomous Multi-Repo Agent Workspaces")
  .version(VERSION)
  .addCommand(createCommand)
  .addCommand(cleanupCommand)
  .addCommand(listCommand)
  .addCommand(statusCommand)
  .addCommand(runCommand)
  .addCommand(haltCommand)
  .addCommand(dbCommand);

program.hook("preAction", () => {
  console.log(chalk.yellow("⬡") + " " + chalk.bold("hyve"));
  console.log();
});

program.parse();
