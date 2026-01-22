import { Command } from "commander";
import * as p from "@clack/prompts";
import chalk from "chalk";
import { execSync } from "child_process";
import { existsSync, mkdirSync, writeFileSync, readFileSync, copyFileSync } from "fs";
import { join } from "path";
import {
  loadConfig,
  getProjectRoot,
  getWorkspaceDir,
  getRepoPath,
} from "../config.js";
import {
  sanitizeBranchName,
  workspaceExists,
  getWorkspaceIndex,
  calculateServicePort,
} from "../utils.js";

function generateClaudeMd(
  name: string,
  branch: string,
  repos: string[],
  dbPort: number | undefined,
  servicePorts: Record<string, number>,
  workspaceDir: string
): string {
  const lines: string[] = [];

  lines.push(`# Hyve Workspace: ${name}`);
  lines.push("");
  lines.push("This is an isolated feature workspace created by Hyve.");
  lines.push("");
  lines.push("## Workspace Info");
  lines.push("");
  lines.push(`- **Branch:** \`${branch}\``);
  lines.push(`- **Location:** \`${workspaceDir}\``);
  lines.push(`- **Repos:** ${repos.join(", ")}`);
  lines.push("");

  if (dbPort) {
    lines.push("## Database");
    lines.push("");
    lines.push(`This workspace has an isolated PostgreSQL database on port **${dbPort}**.`);
    lines.push("");
    lines.push("```bash");
    lines.push(`# Connect to workspace database`);
    lines.push(`hyve db ${name}`);
    lines.push("```");
    lines.push("");
  }

  lines.push("## Service Ports");
  lines.push("");
  lines.push("| Service | Port |");
  lines.push("|---------|------|");
  for (const [service, port] of Object.entries(servicePorts)) {
    lines.push(`| ${service} | ${port} |`);
  }
  lines.push("");

  lines.push("## Commands");
  lines.push("");
  lines.push("```bash");
  lines.push(`# Start all services`);
  lines.push(`hyve run ${name}`);
  lines.push("");
  lines.push(`# Stop all services`);
  lines.push(`hyve halt ${name}`);
  lines.push("");
  lines.push(`# Check status`);
  lines.push(`hyve status ${name}`);
  lines.push("");
  lines.push(`# Remove workspace when done`);
  lines.push(`hyve remove ${name}`);
  lines.push("```");
  lines.push("");

  lines.push("## Working in This Workspace");
  lines.push("");
  lines.push("Each repo directory is a git worktree on the feature branch.");
  lines.push("Changes made here are isolated from other workspaces and the main repos.");
  lines.push("");
  lines.push("The `.env` files have been configured with workspace-specific ports.");
  lines.push("You can run the full stack without conflicting with other workspaces.");
  lines.push("");

  lines.push("## Multi-Repo Orchestration");
  lines.push("");
  lines.push("When working across multiple repos:");
  lines.push("");
  lines.push("1. **Analyze** which repos need changes for the task");
  lines.push("2. **Order** changes correctly: backend/API first → schema/types → frontend");
  lines.push("3. **Coordinate** commits with cross-references between repos");
  lines.push("4. **Checkpoint** before committing - summarize changes and wait for approval");
  lines.push("");
  lines.push("### Cross-Repo Rules");
  lines.push("");
  lines.push("- API changes: Update backend first, regenerate types, then update consumers");
  lines.push("- Database changes: Run migrations before dependent code changes");
  lines.push("- Shared types: Update source, regenerate, then update consumers");
  lines.push("");
  lines.push("**DO NOT COMMIT without user approval.**");
  lines.push("");

  return lines.join("\n");
}

export const createCommand = new Command("create")
  .description("Create a new feature workspace")
  .argument("[name]", "Feature name")
  .argument("[repos...]", "Additional repos to include")
  .option("--from <branch>", "Create from existing branch")
  .option("--existing", "Select from existing branches")
  .option("--no-setup", "Skip running setup scripts")
  .action(async (name: string | undefined, repos: string[], options) => {
    const config = loadConfig();

    // Interactive name selection if not provided
    if (!name) {
      const result = await p.text({
        message: "Enter feature name:",
        placeholder: "my-feature",
        validate: (value) => {
          if (!value) return "Name is required";
          if (workspaceExists(sanitizeBranchName(value))) {
            return "Workspace already exists";
          }
        },
      });
      if (p.isCancel(result)) {
        p.cancel("Cancelled");
        process.exit(0);
      }
      name = result;
    }

    // Sanitize name
    const originalName = name;
    name = sanitizeBranchName(name);
    if (originalName !== name) {
      console.log(chalk.dim(`Sanitized: ${originalName} → ${name}`));
    }

    if (workspaceExists(name)) {
      console.error(chalk.red(`Workspace already exists: ${name}`));
      process.exit(1);
    }

    // Merge required repos with user-specified repos
    const allRepos = [...new Set([...config.required_repos, ...repos])];

    if (allRepos.length === 0) {
      console.error(chalk.red("No repos specified and no required_repos configured"));
      process.exit(1);
    }

    const branchName = `${config.branches.prefix}${name}`;
    const workspaceDir = getWorkspaceDir(name);

    console.log(chalk.cyan(`Creating workspace: ${chalk.bold(name)}`));

    // Pre-emptively prune stale worktrees from all repos
    console.log(chalk.dim("Pruning stale worktrees..."));
    for (const repo of allRepos) {
      try {
        const repoPath = getRepoPath(repo);
        if (existsSync(repoPath)) {
          execSync("git worktree prune", { cwd: repoPath, stdio: "ignore" });
        }
      } catch {}
    }

    // Create workspace directory
    mkdirSync(workspaceDir, { recursive: true });

    // Create worktrees - use sync for predictable output
    console.log(chalk.dim("Creating git worktrees..."));
    const successfulRepos: string[] = [];

    for (const repo of allRepos) {
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
          // Try common defaults
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

        // Fetch latest (silent)
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
        try {
          if (branchExists || options.from) {
            execSync(`git worktree add "${worktreeDir}" "${branchName}" 2>&1`, {
              cwd: repoPath,
              encoding: "utf-8",
            });
          } else {
            execSync(`git worktree add -b "${branchName}" "${worktreeDir}" "${baseBranch}" 2>&1`, {
              cwd: repoPath,
              encoding: "utf-8",
            });
          }
        } catch (wtError: any) {
          const output = wtError.stdout || wtError.stderr || wtError.message || "";

          // Check if branch is already checked out elsewhere
          if (output.includes("already checked out") || output.includes("is already being used")) {
            // Try with --force to detach HEAD in the other worktree
            try {
              execSync("git worktree prune", { cwd: repoPath, stdio: "ignore" });
              // Retry with force
              execSync(`git worktree add --force "${worktreeDir}" "${branchName}" 2>&1`, {
                cwd: repoPath,
                encoding: "utf-8",
              });
            } catch (retryError: any) {
              const retryOutput = retryError.stdout || retryError.stderr || "";
              throw new Error(retryOutput.split("\n").filter(Boolean).pop() || "Branch in use elsewhere");
            }
          } else if (output.includes("already exists")) {
            throw new Error(`Worktree path already exists`);
          } else {
            // Get last meaningful line of error
            const errorLine = output.split("\n").filter((l: string) => l.trim() && !l.includes("Preparing")).pop();
            throw new Error(errorLine || output.slice(0, 100) || "git worktree failed");
          }
        }

        console.log(chalk.green(`  ✓ ${repo}`) + chalk.dim(` → ${branchName}`));
        successfulRepos.push(repo);
      } catch (error: any) {
        console.log(chalk.red(`  ✗ ${repo}`) + chalk.dim(` - ${error.message}`));
      }
    }

    if (successfulRepos.length === 0) {
      console.error(chalk.red("No worktrees created"));
      process.exit(1);
    }

    // Install dependencies for repos with package.json
    if (options.setup !== false) {
      console.log(chalk.dim("Installing dependencies..."));
      const shellWrapper = config.services.shell_wrapper || "";

      for (const repo of successfulRepos) {
        const worktreeDir = join(workspaceDir, repo);
        const packageJson = join(worktreeDir, "package.json");

        if (!existsSync(packageJson)) continue;

        const installCmd = shellWrapper
          ? `${shellWrapper} pnpm install --prefer-offline`
          : "pnpm install --prefer-offline";

        try {
          execSync(`bash -l -c 'cd "${worktreeDir}" && ${installCmd}'`, {
            cwd: worktreeDir,
            stdio: "pipe", // Suppress output for cleaner logs
            timeout: 600000, // 10 minute timeout
          });
          console.log(chalk.green(`  ✓ ${repo} dependencies installed`));
        } catch (error: any) {
          console.log(chalk.yellow(`  ⚠ ${repo} dependencies failed`));
        }
      }

      // Run setup scripts (for non-pnpm tasks like builds, migrations, etc.)
      const reposWithSetupScripts = successfulRepos.filter((repo) => {
        const repoConfig = config.repos[repo];
        return repoConfig?.setup_script && repoConfig.setup_script !== "pnpm install";
      });

      if (reposWithSetupScripts.length > 0) {
        console.log(chalk.dim("Running setup scripts..."));

        for (const repo of reposWithSetupScripts) {
          const repoConfig = config.repos[repo];
          const worktreeDir = join(workspaceDir, repo);
          const command = shellWrapper
            ? `${shellWrapper} ${repoConfig.setup_script}`
            : repoConfig.setup_script;

          try {
            execSync(`bash -l -c 'cd "${worktreeDir}" && ${command}'`, {
              cwd: worktreeDir,
              stdio: "inherit",
              timeout: 600000, // 10 minute timeout
            });
            console.log(chalk.green(`  ✓ ${repo} setup complete`));
          } catch (error: any) {
            console.log(chalk.yellow(`  ⚠ ${repo} setup failed`));
          }
        }
      }
    }

    // Start database container if enabled
    let dbPort: number | undefined;
    let dbContainer: string | undefined;
    const workspaceIndex = getWorkspaceIndex(name);

    if (config.database.enabled) {
      console.log(chalk.dim("Starting database..."));

      dbPort = config.database.base_port + workspaceIndex;
      dbContainer = `hyve-db-${name}`;
      const projectRoot = getProjectRoot();

      try {
        // Remove existing container if any
        try {
          execSync(`docker rm -f ${dbContainer}`, { stdio: "ignore" });
        } catch {}

        // Start new container
        execSync(
          `docker run -d --name ${dbContainer} -p ${dbPort}:5432 ` +
            `-e POSTGRES_USER=${config.database.user} ` +
            `-e POSTGRES_PASSWORD=${config.database.password} ` +
            `-e POSTGRES_DB=${config.database.name} ` +
            `postgres:15`,
          { stdio: "ignore" }
        );

        // Wait for database to be ready
        console.log(chalk.dim("  Waiting for database to be ready..."));
        execSync("sleep 3");

        // Check for default snapshot first, fall back to source clone
        const snapshotsDir = join(projectRoot, ".snapshots");
        const defaultSnapshot = join(snapshotsDir, "default.dump");

        if (existsSync(defaultSnapshot)) {
          console.log(chalk.dim("  Restoring from default snapshot..."));
          execSync(
            `PGPASSWORD=${config.database.password} pg_restore -h localhost -p ${dbPort} ` +
              `-U ${config.database.user} -d ${config.database.name} --no-owner --no-acl ` +
              `"${defaultSnapshot}" 2>&1 | grep -v "WARNING:" || true`,
            { stdio: "ignore" }
          );
        } else {
          console.log(chalk.dim("  Cloning database from source..."));
          execSync(
            `PGPASSWORD=${config.database.password} pg_dump -h localhost -p ${config.database.source_port} ` +
              `-U ${config.database.user} ${config.database.name} | ` +
              `PGPASSWORD=${config.database.password} psql -h localhost -p ${dbPort} ` +
              `-U ${config.database.user} ${config.database.name}`,
            { stdio: "ignore" }
          );
        }

        console.log(chalk.green(`  ✓ Database ready on port ${dbPort}`));

        // Run seed command if configured
        if (config.database.seed_command) {
          console.log(chalk.dim("  Running database seed command..."));
          const shellWrapper = config.services.shell_wrapper || "";
          let seedCommand = config.database.seed_command.replace(/\$\{port\}/g, String(dbPort));
          if (shellWrapper) {
            seedCommand = `${shellWrapper} ${seedCommand}`;
          }
          try {
            execSync(`bash -l -c '${seedCommand}'`, {
              cwd: projectRoot,
              stdio: "inherit",
              timeout: 300000, // 5 minute timeout
            });
            console.log(chalk.green(`  ✓ Database seeded`));
          } catch (error: any) {
            console.log(chalk.yellow(`  ⚠ Database seeding failed: ${error.message}`));
          }
        }
      } catch (error: any) {
        console.log(chalk.yellow(`  ⚠ Database setup failed: ${error.message}`));
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

      // Replace DATABASE_URL if we have a workspace database
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
        // Replace both localhost:port and 127.0.0.1:port patterns
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
        envContent += `# Workspace: ${name}\n`;
      }

      writeFileSync(envFile, envContent);
    }

    // Save workspace config
    const workspaceConfig = {
      name,
      branch: branchName,
      repos: successfulRepos,
      database: dbPort
        ? {
            enabled: true,
            port: dbPort,
            container: dbContainer,
          }
        : { enabled: false },
      created: new Date().toISOString(),
      status: "active",
    };
    writeFileSync(
      join(workspaceDir, ".hyve-workspace.json"),
      JSON.stringify(workspaceConfig, null, 2)
    );

    // Add to VS Code workspace file if it exists
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
            // Add workspace folders for each repo
            const workspaceRelPath = workspaceDir.replace(projectRoot + "/", "");
            let added = false;

            for (const repo of successfulRepos) {
              const folderPath = `${workspaceRelPath}/${repo}`;

              // Check if already exists
              const exists = vscodeContent.folders.some(
                (f: { path?: string; name?: string }) => f.path === folderPath
              );

              if (!exists) {
                // Add at the END of the list to group workspaces together
                // Just use the path, no custom name needed
                vscodeContent.folders.push({
                  path: folderPath,
                });
                added = true;
              }
            }

            if (added) {
              writeFileSync(vscodeFile, JSON.stringify(vscodeContent, null, 2) + "\n");
              console.log(chalk.green(`  ✓ Added to VS Code workspace`));
            }
          }
        } catch (error: any) {
          console.log(chalk.yellow(`  ⚠ Could not update VS Code workspace: ${error.message}`));
        }
        break; // Only update the first workspace file found
      }
    }

    // Generate CLAUDE.md for the workspace
    console.log(chalk.dim("Generating CLAUDE.md..."));
    const servicePorts: Record<string, number> = {};
    for (const [serviceName, serviceConfig] of Object.entries(config.services.definitions)) {
      servicePorts[serviceName] = calculateServicePort(
        serviceName,
        serviceConfig.default_port,
        config.services.base_port,
        workspaceIndex,
        config.services.port_offset
      );
    }

    const claudeMd = generateClaudeMd(name, branchName, successfulRepos, dbPort, servicePorts, workspaceDir);
    writeFileSync(join(workspaceDir, "CLAUDE.md"), claudeMd);
    console.log(chalk.green(`  ✓ CLAUDE.md generated`));

    // Summary
    console.log();
    console.log(chalk.green.bold("✓ Workspace Ready!"));
    console.log();
    console.log(chalk.dim("  Location:"), workspaceDir);
    console.log(chalk.dim("  Branch:  "), branchName);
    console.log(chalk.dim("  Repos:   "), successfulRepos.join(", "));
    if (dbPort) {
      console.log(chalk.dim("  Database:"), `localhost:${dbPort}`);
    }
    console.log();
    console.log(chalk.dim("  cd"), workspaceDir);
    console.log();
  });
