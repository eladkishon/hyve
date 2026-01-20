import { Command } from "commander";
import * as p from "@clack/prompts";
import chalk from "chalk";
import { execa } from "execa";
import { existsSync, mkdirSync, writeFileSync, readFileSync, copyFileSync } from "fs";
import { join } from "path";
import {
  loadConfig,
  getProjectRoot,
  getWorkspacesDir,
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
  .option("--snapshot <name>", "Restore database from snapshot instead of cloning")
  .option("--no-db", "Skip database creation")
  .action(async (name: string | undefined, repos: string[], options) => {
    const config = loadConfig();
    const projectRoot = getProjectRoot();

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
      p.log.info(`Sanitized: ${chalk.dim(originalName)} → ${chalk.cyan(name)}`);
    }

    if (workspaceExists(name)) {
      p.log.error(`Workspace already exists: ${name}`);
      process.exit(1);
    }

    // Merge required repos with user-specified repos
    const allRepos = [...new Set([...config.required_repos, ...repos])];

    if (allRepos.length === 0) {
      p.log.error("No repos specified and no required_repos configured");
      process.exit(1);
    }

    const branchName = `${config.branches.prefix}${name}`;
    const workspaceDir = getWorkspaceDir(name);

    p.intro(chalk.cyan(`Creating workspace: ${chalk.bold(name)}`));

    // Create workspace directory
    mkdirSync(workspaceDir, { recursive: true });

    // Create worktrees in parallel
    const worktreeSpinner = p.spinner();
    worktreeSpinner.start("Creating git worktrees...");

    const worktreeResults = await Promise.all(
      allRepos.map(async (repo) => {
        try {
          const repoPath = getRepoPath(repo);
          const worktreeDir = join(workspaceDir, repo);

          // Get base branch
          let baseBranch = config.branches.base;
          try {
            const { stdout } = await execa("git", ["symbolic-ref", "refs/remotes/origin/HEAD"], {
              cwd: repoPath,
            });
            baseBranch = stdout.replace("refs/remotes/origin/", "").trim();
          } catch {
            // Try common defaults
            for (const branch of ["main", "master"]) {
              try {
                await execa("git", ["show-ref", "--verify", `refs/heads/${branch}`], {
                  cwd: repoPath,
                });
                baseBranch = branch;
                break;
              } catch {}
            }
          }

          // Pull latest
          try {
            await execa("git", ["fetch", "origin", baseBranch], { cwd: repoPath });
          } catch {}

          // Check if branch exists
          let branchExists = false;
          try {
            await execa("git", ["show-ref", "--verify", `refs/heads/${branchName}`], {
              cwd: repoPath,
            });
            branchExists = true;
          } catch {}

          if (!branchExists) {
            try {
              await execa("git", ["show-ref", "--verify", `refs/remotes/origin/${branchName}`], {
                cwd: repoPath,
              });
              branchExists = true;
            } catch {}
          }

          // Create worktree
          if (branchExists || options.from) {
            await execa("git", ["worktree", "add", worktreeDir, branchName], {
              cwd: repoPath,
            });
          } else {
            await execa("git", ["worktree", "add", "-b", branchName, worktreeDir, baseBranch], {
              cwd: repoPath,
            });
          }

          return { repo, success: true, message: branchExists ? "existing" : `new from ${baseBranch}` };
        } catch (error: any) {
          return { repo, success: false, message: error.message };
        }
      })
    );

    worktreeSpinner.stop("Git worktrees created");

    // Log results
    const successfulRepos: string[] = [];
    for (const result of worktreeResults) {
      if (result.success) {
        p.log.success(`${result.repo} → ${branchName} (${result.message})`);
        successfulRepos.push(result.repo);
      } else {
        p.log.error(`${result.repo}: ${result.message}`);
      }
    }

    if (successfulRepos.length === 0) {
      p.log.error("No worktrees created");
      process.exit(1);
    }

    // Run setup scripts in parallel
    const setupSpinner = p.spinner();
    setupSpinner.start("Running setup scripts (parallel)...");

    const setupResults = await Promise.all(
      successfulRepos.map(async (repo) => {
        const repoConfig = config.repos[repo];
        if (!repoConfig?.setup_script) {
          return { repo, success: true, message: "no setup script" };
        }

        const worktreeDir = join(workspaceDir, repo);
        const shellWrapper = config.services.shell_wrapper || "";
        const command = shellWrapper
          ? `${shellWrapper} ${repoConfig.setup_script}`
          : repoConfig.setup_script;

        try {
          await execa("bash", ["-l", "-c", `cd '${worktreeDir}' && ${command}`], {
            cwd: worktreeDir,
            timeout: 600000, // 10 minute timeout
          });
          return { repo, success: true, message: "complete" };
        } catch (error: any) {
          return { repo, success: false, message: error.shortMessage || error.message };
        }
      })
    );

    setupSpinner.stop("Setup scripts completed");

    for (const result of setupResults) {
      if (result.success) {
        p.log.success(`${result.repo} → setup ${result.message}`);
      } else {
        p.log.warn(`${result.repo} → setup failed: ${result.message}`);
      }
    }

    // Start database if enabled
    let dbPort: number | undefined;
    let dbContainer: string | undefined;

    if (config.database.enabled) {
      const dbSpinner = p.spinner();
      dbSpinner.start("Starting database...");

      const workspaceIndex = getWorkspaceIndex(name);
      dbPort = config.database.base_port + workspaceIndex;
      dbContainer = `hyve-db-${name}`;

      try {
        // Check if container exists
        try {
          await execa("docker", ["rm", "-f", dbContainer]);
        } catch {}

        // Start new container
        await execa("docker", [
          "run",
          "-d",
          "--name",
          dbContainer,
          "-p",
          `${dbPort}:5432`,
          "-e",
          `POSTGRES_USER=${config.database.user}`,
          "-e",
          `POSTGRES_PASSWORD=${config.database.password}`,
          "-e",
          `POSTGRES_DB=${config.database.name}`,
          config.database.image || "postgres:15",
        ]);

        // Wait for database to be ready
        await new Promise((resolve) => setTimeout(resolve, 3000));

        // Restore from snapshot or clone from source database
        const snapshotName = options.snapshot;
        const snapshotsDir = join(projectRoot, ".snapshots");
        const snapshotPath = snapshotName ? join(snapshotsDir, `${snapshotName}.dump`) : null;

        if (snapshotPath && existsSync(snapshotPath)) {
          dbSpinner.message(`Restoring from snapshot: ${snapshotName}...`);
          await execa("bash", [
            "-c",
            `PGPASSWORD=${config.database.password} pg_restore -h localhost -p ${dbPort} -U ${config.database.user} -d ${config.database.name} --no-owner --no-acl "${snapshotPath}" 2>&1 | grep -v "WARNING:" || true`,
          ]);
        } else if (snapshotName) {
          // Check if default snapshot exists
          const defaultSnapshot = join(snapshotsDir, "default.dump");
          if (existsSync(defaultSnapshot)) {
            dbSpinner.message("Restoring from default snapshot...");
            await execa("bash", [
              "-c",
              `PGPASSWORD=${config.database.password} pg_restore -h localhost -p ${dbPort} -U ${config.database.user} -d ${config.database.name} --no-owner --no-acl "${defaultSnapshot}" 2>&1 | grep -v "WARNING:" || true`,
            ]);
          } else {
            dbSpinner.message("No snapshot found, cloning from source...");
            await execa("bash", [
              "-c",
              `PGPASSWORD=${config.database.password} pg_dump -h localhost -p ${config.database.source_port} -U ${config.database.user} ${config.database.name} | PGPASSWORD=${config.database.password} psql -h localhost -p ${dbPort} -U ${config.database.user} ${config.database.name}`,
            ]);
          }
        } else {
          // Check for default snapshot first, fall back to source clone
          const defaultSnapshot = join(snapshotsDir, "default.dump");
          if (existsSync(defaultSnapshot)) {
            dbSpinner.message("Restoring from default snapshot...");
            await execa("bash", [
              "-c",
              `PGPASSWORD=${config.database.password} pg_restore -h localhost -p ${dbPort} -U ${config.database.user} -d ${config.database.name} --no-owner --no-acl "${defaultSnapshot}" 2>&1 | grep -v "WARNING:" || true`,
            ]);
          } else {
            dbSpinner.message("Cloning database from source...");
            await execa("bash", [
              "-c",
              `PGPASSWORD=${config.database.password} pg_dump -h localhost -p ${config.database.source_port} -U ${config.database.user} ${config.database.name} | PGPASSWORD=${config.database.password} psql -h localhost -p ${dbPort} -U ${config.database.user} ${config.database.name}`,
            ]);
          }
        }

        dbSpinner.stop("Database ready");
        p.log.success(`Database running on port ${dbPort}`);
      } catch (error: any) {
        dbSpinner.stop("Database setup failed");
        p.log.warn(`Database: ${error.message}`);
      }
    }

    // Generate .env files
    const envSpinner = p.spinner();
    envSpinner.start("Generating .env files...");

    const workspaceIndex = getWorkspaceIndex(name);
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

      // Replace DATABASE_URL
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
          // Add PORT if not present
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

    envSpinner.stop(".env files generated");

    // Save workspace config
    const workspaceConfig = {
      name,
      branch: branchName,
      repos: successfulRepos,
      database: {
        enabled: config.database.enabled,
        port: dbPort,
        container: dbContainer,
      },
      created: new Date().toISOString(),
      status: "active",
    };
    writeFileSync(
      join(workspaceDir, ".hyve-workspace.json"),
      JSON.stringify(workspaceConfig, null, 2)
    );

    // Summary
    p.outro(chalk.green.bold("Workspace Ready!"));
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
