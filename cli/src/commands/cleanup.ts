import { Command } from "commander";
import * as p from "@clack/prompts";
import chalk from "chalk";
import { execa } from "execa";
import { rmSync, existsSync } from "fs";
import { join } from "path";
import { loadConfig, getWorkspaceDir, getRepoPath } from "../config.js";
import { listWorkspaces, workspaceExists, getWorkspaceConfig } from "../utils.js";

export const cleanupCommand = new Command("cleanup")
  .description("Remove a workspace")
  .argument("[name]", "Workspace name")
  .option("-f, --force", "Skip confirmation")
  .action(async (name: string | undefined, options) => {
    const workspaces = listWorkspaces();

    if (workspaces.length === 0) {
      p.log.error("No workspaces found");
      process.exit(1);
    }

    // Interactive selection if no name provided
    if (!name) {
      const result = await p.select({
        message: "Select workspace to remove:",
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

    const workspaceDir = getWorkspaceDir(name);
    const config = getWorkspaceConfig(name);

    // Confirm
    if (!options.force) {
      const confirmed = await p.confirm({
        message: `Remove workspace "${chalk.bold(name)}"?\n  This will delete worktrees and database but preserve git branches.`,
      });
      if (p.isCancel(confirmed) || !confirmed) {
        p.cancel("Cancelled");
        process.exit(0);
      }
    }

    p.intro(chalk.cyan(`Removing workspace: ${chalk.bold(name)}`));

    // Stop and remove database container
    if (config?.database?.container) {
      const dbSpinner = p.spinner();
      dbSpinner.start("Removing database...");
      try {
        await execa("docker", ["rm", "-f", config.database.container]);
        dbSpinner.stop("Database removed");
      } catch {
        dbSpinner.stop("Database not found");
      }
    }

    // Remove worktrees in parallel
    const repos = config?.repos || [];
    if (repos.length > 0) {
      const worktreeSpinner = p.spinner();
      worktreeSpinner.start("Removing worktrees...");

      await Promise.all(
        repos.map(async (repo) => {
          try {
            const mainRepoPath = getRepoPath(repo);
            const worktreeDir = join(workspaceDir, repo);

            if (existsSync(mainRepoPath)) {
              await execa("git", ["worktree", "remove", worktreeDir, "--force"], {
                cwd: mainRepoPath,
              });
              await execa("git", ["worktree", "prune"], { cwd: mainRepoPath });
            }
          } catch {}
        })
      );

      worktreeSpinner.stop("Worktrees removed");
    }

    // Remove workspace directory
    rmSync(workspaceDir, { recursive: true, force: true });

    p.outro(chalk.green(`Workspace "${name}" removed`));
  });
