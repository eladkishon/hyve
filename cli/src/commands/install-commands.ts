import { Command } from "commander";
import chalk from "chalk";
import { existsSync, mkdirSync, copyFileSync, readdirSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { getProjectRoot } from "../config.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export const installCommandsCommand = new Command("install-commands")
  .description("Install Claude Code slash commands")
  .action(async () => {
    const projectRoot = getProjectRoot();
    const claudeDir = join(projectRoot, ".claude", "commands");

    // Find hyve commands directory (relative to CLI)
    const hyveRoot = join(__dirname, "..", "..", "..");
    const commandsSource = join(hyveRoot, "commands");

    if (!existsSync(commandsSource)) {
      console.error(chalk.red("Commands source directory not found"));
      console.error(chalk.dim(`Expected: ${commandsSource}`));
      process.exit(1);
    }

    // Create .claude/commands if it doesn't exist
    if (!existsSync(claudeDir)) {
      mkdirSync(claudeDir, { recursive: true });
      console.log(chalk.dim(`Created ${claudeDir}`));
    }

    // Copy all .md files from commands/
    const files = readdirSync(commandsSource).filter(f => f.endsWith(".md"));

    if (files.length === 0) {
      console.error(chalk.yellow("No command files found to install"));
      process.exit(0);
    }

    console.log(chalk.dim("Installing Claude Code commands..."));

    for (const file of files) {
      const source = join(commandsSource, file);
      const dest = join(claudeDir, file);
      copyFileSync(source, dest);
      const commandName = file.replace(".md", "");
      console.log(chalk.green(`  ✓ /${commandName}`));
    }

    console.log();
    console.log(chalk.green.bold("Commands installed!"));
    console.log();
    console.log(chalk.dim("Available commands:"));
    for (const file of files) {
      const commandName = file.replace(".md", "");
      console.log(chalk.cyan(`  /${commandName}`));
    }
    console.log();
    console.log(chalk.dim("Usage in Claude Code: Type the command name, e.g., /hyve-create my-feature"));
  });
