import { Command } from "commander";
import * as p from "@clack/prompts";
import chalk from "chalk";
import { execSync } from "child_process";
import { existsSync, writeFileSync, readFileSync, copyFileSync } from "fs";
import { join } from "path";
import {
  loadConfig,
  getWorkspaceDir,
  getRepoPath,
} from "../config.js";
import {
  workspaceExists,
  getWorkspaceConfig,
  getWorkspaceIndex,
  calculateServicePort,
  listWorkspaces,
  WorkspaceConfig,
} from "../utils.js";

export const attachCommand = new Command("attach")
  .description("Attach a new repo/service to an existing workspace")
  .argument("[workspace]", "Workspace name")
  .argument("[repos...]", "Repos to attach")
  .option("--no-setup", "Skip running setup scripts")
  .action(async (workspaceName: string | undefined, repos: string[], options) => {
    const config = loadConfig();
    const workspaces = listWorkspaces();

    if (workspaces.length === 0) {
      console.error(chalk.red("No workspaces found"));
      console.log(chalk.dim("Run 'hyve create <name>' to create a workspace first"));
      process.exit(1);
    }

    // Interactive workspace selection if not provided
    if (!workspaceName) {
      const result = await p.select({
        message: "Select workspace to attach to:",
        options: workspaces.map((ws) => ({ value: ws, label: ws })),
      });
      if (p.isCancel(result)) {
        p.cancel("Cancelled");
        process.exit(0);
      }
      workspaceName = result;
    }

    // Verify workspace exists
    if (!workspaceExists(workspaceName)) {
      console.error(chalk.red(`Workspace not found: ${workspaceName}`));
      console.log(chalk.dim("Run 'hyve list' to see available workspaces"));
      process.exit(1);
    }

    // Load workspace config
    const wsConfig = getWorkspaceConfig(workspaceName);
    if (!wsConfig) {
      console.error(chalk.red(`Workspace config not found: ${workspaceName}`));
      process.exit(1);
    }

    // Interactive repo selection if not provided
    if (repos.length === 0) {
      const availableRepos = Object.keys(config.repos).filter(
        (r) => !wsConfig.repos.includes(r)
      );

      if (availableRepos.length === 0) {
        console.log(chalk.yellow("All configured repos are already attached to this workspace"));
        process.exit(0);
      }

      const result = await p.multiselect({
        message: "Select repos to attach:",
        options: availableRepos.map((r) => ({
          value: r,
          label: r,
          hint: config.repos[r].path,
        })),
      });

      if (p.isCancel(result)) {
        p.cancel("Cancelled");
        process.exit(0);
      }

      repos = result as string[];
    }

    // Validate repos
    for (const repo of repos) {
      if (!config.repos[repo]) {
        console.error(chalk.red(`Unknown repo: ${repo}`));
        console.log(chalk.dim("Available repos:"), Object.keys(config.repos).join(", "));
        process.exit(1);
      }

      if (wsConfig.repos.includes(repo)) {
        console.error(chalk.red(`Repo already attached: ${repo}`));
        process.exit(1);
      }
    }

    const workspaceDir = getWorkspaceDir(workspaceName);
    const branchName = wsConfig.branch;
    const workspaceIndex = getWorkspaceIndex(workspaceName);
    const dbPort = wsConfig.database?.enabled ? wsConfig.database.port : undefined;

    console.log(chalk.cyan(`Attaching to workspace: ${chalk.bold(workspaceName)}`));

    // Create worktrees
    console.log(chalk.dim("Creating git worktrees..."));
    const successfulRepos: string[] = [];

    for (const repo of repos) {
      try {
        const repoPath = getRepoPath(repo);
        const worktreeDir = join(workspaceDir, repo);

        // Get base branch
        let baseBranch = config.branches.base;
        try {
          const stdout = execSync("git symbolic-ref refs/remotes/origin/HEAD", {
            cwd: repoPath,
            encoding: "utf-8",
            stdio: ["pipe", "pipe", "ignore"],
          });
          baseBranch = stdout.replace("refs/remotes/origin/", "").trim();
        } catch {
          for (const branch of ["main", "master"]) {
            try {
              execSync(`git show-ref --verify refs/heads/${branch}`, {
                cwd: repoPath,
                stdio: "ignore",
              });
              baseBranch = branch;
              break;
            } catch {}
          }
        }

        // Fetch latest
        try {
          execSync(`git fetch origin ${baseBranch}`, { cwd: repoPath, stdio: "ignore" });
        } catch {}

        // Check if branch exists
        let branchExists = false;
        try {
          execSync(`git show-ref --verify refs/heads/${branchName}`, {
            cwd: repoPath,
            stdio: "ignore",
          });
          branchExists = true;
        } catch {}

        if (!branchExists) {
          try {
            execSync(`git show-ref --verify refs/remotes/origin/${branchName}`, {
              cwd: repoPath,
              stdio: "ignore",
            });
            branchExists = true;
          } catch {}
        }

        // Create worktree
        if (branchExists) {
          execSync(`git worktree add "${worktreeDir}" "${branchName}"`, {
            cwd: repoPath,
            stdio: "ignore",
          });
        } else {
          execSync(`git worktree add -b "${branchName}" "${worktreeDir}" "${baseBranch}"`, {
            cwd: repoPath,
            stdio: "ignore",
          });
        }

        console.log(chalk.green(`  ✓ ${repo}`) + chalk.dim(` → ${branchName}`));
        successfulRepos.push(repo);
      } catch (error: any) {
        console.log(chalk.red(`  ✗ ${repo}`) + chalk.dim(` - ${error.message}`));
      }
    }

    if (successfulRepos.length === 0) {
      console.error(chalk.red("No repos attached"));
      process.exit(1);
    }

    // Run setup scripts
    if (options.setup !== false) {
      console.log(chalk.dim("Running setup scripts..."));

      for (const repo of successfulRepos) {
        const repoConfig = config.repos[repo];
        if (!repoConfig?.setup_script) continue;

        const worktreeDir = join(workspaceDir, repo);
        const shellWrapper = config.services.shell_wrapper || "";
        const command = shellWrapper
          ? `${shellWrapper} ${repoConfig.setup_script}`
          : repoConfig.setup_script;

        try {
          execSync(`bash -l -c 'cd "${worktreeDir}" && ${command}'`, {
            cwd: worktreeDir,
            stdio: "inherit",
            timeout: 600000,
          });
          console.log(chalk.green(`  ✓ ${repo} setup complete`));
        } catch (error: any) {
          console.log(chalk.yellow(`  ⚠ ${repo} setup failed`));
        }
      }
    }

    // Generate .env files
    console.log(chalk.dim("Generating .env files..."));

    for (const repo of successfulRepos) {
      const worktreeDir = join(workspaceDir, repo);
      const mainRepoPath = getRepoPath(repo);
      const envFile = join(worktreeDir, ".env");
      const mainEnvFile = join(mainRepoPath, ".env");
      const envExample = join(worktreeDir, ".env.example");

      // Copy .env from main repo or .env.example
      if (existsSync(mainEnvFile)) {
        copyFileSync(mainEnvFile, envFile);
      } else if (existsSync(envExample)) {
        copyFileSync(envExample, envFile);
      } else {
        writeFileSync(envFile, "");
      }

      // Read and modify
      let envContent = readFileSync(envFile, "utf-8");

      // Replace DATABASE_URL if workspace has database
      if (dbPort) {
        const newDbUrl = `postgresql://${config.database.user}:${config.database.password}@localhost:${dbPort}/${config.database.name}`;
        envContent = envContent.replace(/^DATABASE_URL=.*/m, `DATABASE_URL=${newDbUrl}`);
        envContent = envContent.replace(/^POSTGRES_PORT=.*/m, `POSTGRES_PORT=${dbPort}`);
      }

      // Replace or add service PORT
      const repoServiceConfig = config.services.definitions[repo];
      if (repoServiceConfig) {
        const newPort = calculateServicePort(
          repo,
          repoServiceConfig.default_port,
          config.services.base_port,
          workspaceIndex,
          config.services.port_offset
        );
        if (/^PORT=/m.test(envContent)) {
          envContent = envContent.replace(/^PORT=.*/m, `PORT=${newPort}`);
        } else {
          envContent = `PORT=${newPort}\n${envContent}`;
        }
      }

      // Replace localhost:default_port with localhost:workspace_port for all services
      for (const [serviceName, serviceConfig] of Object.entries(config.services.definitions)) {
        const defaultPort = serviceConfig.default_port;
        const workspacePort = calculateServicePort(
          serviceName,
          defaultPort,
          config.services.base_port,
          workspaceIndex,
          config.services.port_offset
        );
        envContent = envContent.replace(
          new RegExp(`(localhost|127\\.0\\.0\\.1):${defaultPort}`, "g"),
          `$1:${workspacePort}`
        );
      }

      // Replace database source port with workspace database port
      if (dbPort && config.database.source_port) {
        envContent = envContent.replace(
          new RegExp(`(localhost|127\\.0\\.0\\.1):${config.database.source_port}`, "g"),
          `$1:${dbPort}`
        );
      }

      // Add workspace marker
      if (!envContent.includes("Hyve Workspace")) {
        envContent += `\n# ===== Hyve Workspace Configuration =====\n`;
        envContent += `# Workspace: ${workspaceName}\n`;
      }

      writeFileSync(envFile, envContent);
    }

    // Update workspace config
    const updatedRepos = [...wsConfig.repos, ...successfulRepos];
    const updatedConfig: WorkspaceConfig = {
      ...wsConfig,
      repos: updatedRepos,
    };
    writeFileSync(
      join(workspaceDir, ".hyve-workspace.json"),
      JSON.stringify(updatedConfig, null, 2)
    );

    // Update CLAUDE.md
    console.log(chalk.dim("Updating CLAUDE.md..."));
    const claudeMdPath = join(workspaceDir, "CLAUDE.md");
    if (existsSync(claudeMdPath)) {
      let claudeMd = readFileSync(claudeMdPath, "utf-8");

      // Update repos line
      claudeMd = claudeMd.replace(
        /^- \*\*Repos:\*\* .*/m,
        `- **Repos:** ${updatedRepos.join(", ")}`
      );

      writeFileSync(claudeMdPath, claudeMd);
    }

    // Summary
    console.log();
    console.log(chalk.green.bold("✓ Repos Attached!"));
    console.log();
    console.log(chalk.dim("  Attached:"), successfulRepos.join(", "));
    console.log(chalk.dim("  Workspace:"), workspaceDir);
    console.log();
  });
