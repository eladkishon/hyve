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
        if (branchExists || options.from) {
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
      console.error(chalk.red("No worktrees created"));
      process.exit(1);
    }

    // Run setup scripts if not skipped
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
            timeout: 600000, // 10 minute timeout
          });
          console.log(chalk.green(`  ✓ ${repo} setup complete`));
        } catch (error: any) {
          console.log(chalk.yellow(`  ⚠ ${repo} setup failed`));
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
        envContent = envContent.replace(
          new RegExp(`localhost:${defaultPort}`, "g"),
          `localhost:${workspacePort}`
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
              const folderName = `[${name}] ${repo}`;

              // Check if already exists
              const exists = vscodeContent.folders.some(
                (f: { path?: string; name?: string }) =>
                  f.path === folderPath || f.name === folderName
              );

              if (!exists) {
                // Find where to insert (after the "." folder which is usually last of main repos)
                const dotIndex = vscodeContent.folders.findIndex(
                  (f: { path?: string }) => f.path === "."
                );
                const insertIndex = dotIndex !== -1 ? dotIndex : vscodeContent.folders.length;

                vscodeContent.folders.splice(insertIndex, 0, {
                  name: folderName,
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
