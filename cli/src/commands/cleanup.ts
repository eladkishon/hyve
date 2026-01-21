import { Command } from "commander";
import * as p from "@clack/prompts";
import chalk from "chalk";
import { execSync } from "child_process";
import { rmSync, existsSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { getWorkspaceDir, getRepoPath, getProjectRoot } from "../config.js";
import { listWorkspaces, workspaceExists, getWorkspaceConfig } from "../utils.js";

export const cleanupCommand = new Command("remove")
  .alias("cleanup")
  .alias("rm")
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
        message: `Remove workspace "${chalk.bold(name)}"?\n  This will delete worktrees but preserve git branches.`,
      });
      if (p.isCancel(confirmed) || !confirmed) {
        p.cancel("Cancelled");
        process.exit(0);
      }
    }

    console.log(chalk.cyan(`Removing workspace: ${chalk.bold(name)}`));

    // Stop and remove database container
    if (config?.database?.container) {
      try {
        execSync(`docker rm -f ${config.database.container}`, { stdio: "ignore" });
        console.log(chalk.green("  ✓ Database removed"));
      } catch {
        // Container might not exist
      }
    }

    // Remove worktrees - use sync for speed (no async overhead)
    const repos = config?.repos || [];
    console.log(chalk.dim("  Removing worktrees..."));
    for (const repo of repos) {
      try {
        const mainRepoPath = getRepoPath(repo);
        const worktreeDir = join(workspaceDir, repo);

        if (existsSync(mainRepoPath)) {
          execSync(`git worktree remove "${worktreeDir}" --force 2>/dev/null || true`, {
            cwd: mainRepoPath,
            stdio: "ignore",
          });
          console.log(chalk.green(`    ✓ ${repo}`));
        }
      } catch {
        console.log(chalk.yellow(`    ⚠ ${repo} (may not exist)`));
      }
    }

    // Prune all worktrees in one batch after removal
    console.log(chalk.dim("  Pruning git worktrees..."));
    for (const repo of repos) {
      try {
        const mainRepoPath = getRepoPath(repo);
        if (existsSync(mainRepoPath)) {
          execSync("git worktree prune", { cwd: mainRepoPath, stdio: "ignore" });
        }
      } catch {}
    }
    console.log(chalk.green("  ✓ Worktrees pruned"));

    // Remove from VS Code workspace file if it exists
    const projectRoot = getProjectRoot();
    const vscodeWorkspaceFiles = [
      join(projectRoot, "code-workspace.code-workspace"),
      join(projectRoot, ".code-workspace"),
      join(projectRoot, `${projectRoot.split("/").pop()}.code-workspace`),
    ];

    for (const vscodeFile of vscodeWorkspaceFiles) {
      if (existsSync(vscodeFile)) {
        try {
          const vscodeContent = JSON.parse(readFileSync(vscodeFile, "utf-8"));
          if (vscodeContent.folders && Array.isArray(vscodeContent.folders)) {
            const workspaceRelPath = workspaceDir.replace(projectRoot + "/", "");

            // Extract feature ID for matching folder names
            const featureId = name.match(/^([a-z]+-\d+)/i)?.[1]?.toUpperCase() || name.slice(0, 12).toUpperCase();

            // Remove folders that belong to this workspace
            const originalLength = vscodeContent.folders.length;
            vscodeContent.folders = vscodeContent.folders.filter(
              (f: { path?: string; name?: string }) => {
                // Remove by path match or by name pattern "[FEATURE-ID] repo"
                if (f.path?.startsWith(workspaceRelPath + "/")) return false;
                if (f.name?.startsWith(`[${featureId}]`)) return false;
                // Also match old naming patterns
                if (f.name?.includes(`[${featureId}]`)) return false;
                if (f.name?.includes(`⬡ ${featureId}`)) return false;
                return true;
              }
            );

            if (vscodeContent.folders.length < originalLength) {
              writeFileSync(vscodeFile, JSON.stringify(vscodeContent, null, 2) + "\n");
              console.log(chalk.green("  ✓ Removed from VS Code workspace"));
            }
          }
        } catch {
          // Ignore errors
        }
        break;
      }
    }

    // Remove workspace directory
    console.log(chalk.dim("  Removing workspace directory..."));
    rmSync(workspaceDir, { recursive: true, force: true });
    console.log(chalk.green("  ✓ Directory removed"));

    console.log();
    console.log(chalk.green.bold(`✓ Workspace "${name}" removed`));
    console.log(chalk.dim("  Git branches preserved in main repos"));
  });
