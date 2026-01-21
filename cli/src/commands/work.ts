import { Command } from "commander";
import chalk from "chalk";
import { execSync, spawnSync } from "child_process";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "fs";
import { join } from "path";
import { getWorkspaceDir, getProjectRoot, loadConfig } from "../config.js";
import { sanitizeBranchName, workspaceExists, getWorkspaceConfig, calculateServicePort } from "../utils.js";
import { buildMetaAgentPrompt } from "../prompts/meta-agent.js";

export const workCommand = new Command("work")
  .description("Start working on a feature - creates workspace, starts services, launches Claude")
  .argument("<name>", "Feature name (spaces become dashes)")
  .argument("[task...]", "Task description for the agent")
  .option("--no-run", "Don't start services")
  .option("--no-agent", "Don't launch Claude Code agent")
  .action(async (name: string, taskParts: string[], options) => {
    // Sanitize the FULL name - spaces to dashes, lowercase
    const workspaceName = sanitizeBranchName(name);
    const task = taskParts.join(" ");

    console.log(chalk.dim(`Feature: "${name}"`));
    console.log(chalk.dim(`Workspace: ${workspaceName}`));
    if (task) {
      console.log(chalk.dim(`Task: "${task}"`));
    }
    console.log();

    const workspaceDir = getWorkspaceDir(workspaceName);

    // Check if workspace exists
    if (!workspaceExists(workspaceName)) {
      console.log(chalk.yellow(`Workspace doesn't exist. Creating...`));
      console.log();

      try {
        execSync(`hyve create "${workspaceName}"`, {
          stdio: "inherit",
        });
      } catch (error: any) {
        console.error(chalk.red(`Failed to create workspace: ${error.message}`));
        process.exit(1);
      }

      // Verify workspace was actually created
      if (!workspaceExists(workspaceName)) {
        console.error(chalk.red(`Workspace creation failed - directory not found`));
        process.exit(1);
      }
    } else {
      console.log(chalk.green(`✓ Using existing workspace: ${workspaceName}`));
    }

    // Read workspace config
    const config = getWorkspaceConfig(workspaceName);
    if (!config) {
      console.error(chalk.red(`Invalid workspace - no .hyve-workspace.json found`));
      console.log(chalk.dim(`Try removing and recreating: hyve remove ${workspaceName}`));
      process.exit(1);
    }

    console.log();
    console.log(chalk.dim("Branch: ") + config.branch);
    console.log(chalk.dim("Repos:  ") + config.repos.join(", "));
    if (config.database?.enabled) {
      console.log(chalk.dim("DB:     ") + `localhost:${config.database.port}`);
    }

    // Verify repos actually exist
    const missingRepos = config.repos.filter(repo => !existsSync(join(workspaceDir, repo)));
    if (missingRepos.length > 0) {
      console.error(chalk.red(`\nMissing repos: ${missingRepos.join(", ")}`));
      console.log(chalk.dim(`The workspace is incomplete. Try: hyve remove ${workspaceName} && hyve create ${workspaceName}`));
      process.exit(1);
    }

    // Start services unless --no-run
    if (options.run !== false) {
      console.log();
      console.log(chalk.dim("Starting services..."));
      try {
        execSync(`hyve run "${workspaceName}"`, {
          stdio: "inherit",
        });
      } catch (error: any) {
        console.log(chalk.yellow(`Services may already be running or failed to start`));
      }
    }

    // Launch Claude Code agent unless --no-agent
    if (options.agent !== false && task) {
      console.log();
      console.log(chalk.cyan.bold("Launching Claude Code Meta-Agent..."));
      console.log();

      // Build service ports map
      let servicePorts: Record<string, number> = {};
      try {
        const hyveConfig = loadConfig();
        const workspaceIndex = require("../utils.js").getWorkspaceIndex(workspaceName);
        for (const [serviceName, serviceConfig] of Object.entries(hyveConfig.services.definitions)) {
          servicePorts[serviceName] = calculateServicePort(
            serviceName,
            (serviceConfig as any).default_port,
            hyveConfig.services.base_port,
            workspaceIndex,
            hyveConfig.services.port_offset
          );
        }
      } catch {}

      // Build meta-agent prompt
      const prompt = buildMetaAgentPrompt({
        workspaceName,
        workspaceDir,
        branch: config?.branch || "feature/" + workspaceName,
        repos: config?.repos || [],
        task,
        dbPort: config?.database?.enabled ? config.database.port : undefined,
        servicePorts,
      });

      // Save prompt to file for reference
      const promptFile = join(workspaceDir, ".hyve", "current-task.md");
      const hyveDir = join(workspaceDir, ".hyve");
      if (!existsSync(hyveDir)) {
        mkdirSync(hyveDir, { recursive: true });
      }
      writeFileSync(promptFile, prompt);

      // Launch Claude Code in the workspace directory
      try {
        console.log(chalk.dim(`Task saved to: ${promptFile}`));
        console.log();

        // Append task to CLAUDE.md for context
        const claudeMdPath = join(workspaceDir, "CLAUDE.md");
        let existingClaudeMd = "";
        if (existsSync(claudeMdPath)) {
          existingClaudeMd = readFileSync(claudeMdPath, "utf-8");
        }

        // Add or update current task in CLAUDE.md
        if (existingClaudeMd.includes("## Current Task")) {
          // Replace existing task
          existingClaudeMd = existingClaudeMd.replace(
            /## Current Task\n\n[\s\S]*?(?=\n##|$)/,
            `## Current Task\n\n${task}\n`
          );
          writeFileSync(claudeMdPath, existingClaudeMd);
        } else {
          const taskSection = `\n## Current Task\n\n${task}\n`;
          writeFileSync(claudeMdPath, existingClaudeMd + taskSection);
        }

        console.log(chalk.cyan.bold("Launching Claude Code..."));
        console.log();

        // Use spawnSync to block and take over the terminal
        const result = spawnSync("claude", [], {
          cwd: workspaceDir,
          stdio: "inherit",
        });

        if (result.error) {
          console.error(chalk.red(`Failed to launch Claude: ${result.error.message}`));
          console.log(chalk.dim("Make sure Claude Code CLI is installed: npm install -g @anthropic-ai/claude-code"));
        }
      } catch (error: any) {
        console.error(chalk.red(`Failed to launch Claude: ${error.message}`));
      }
    } else if (!task) {
      // No task provided, just show info
      console.log();
      console.log(chalk.green.bold("Workspace ready!"));
      console.log();
      console.log(chalk.dim("Workspace: ") + workspaceDir);
      console.log();
      console.log(chalk.dim("To start working with Claude:"));
      console.log(chalk.cyan(`  cd ${workspaceDir}`));
      console.log(chalk.cyan(`  claude`));
      console.log();
      console.log(chalk.dim("Or run with a task:"));
      console.log(chalk.cyan(`  hyve work "${name}" "Your task description here"`));
      console.log();
    }
  });
