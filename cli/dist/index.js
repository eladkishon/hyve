#!/usr/bin/env node

// src/index.ts
import { Command as Command8 } from "commander";
import chalk8 from "chalk";

// src/commands/create.ts
import { Command } from "commander";
import * as p from "@clack/prompts";
import chalk from "chalk";
import { execa } from "execa";
import { existsSync as existsSync3, mkdirSync, writeFileSync, readFileSync as readFileSync3, copyFileSync } from "fs";
import { join as join3 } from "path";

// src/config.ts
import { readFileSync, existsSync } from "fs";
import { parse } from "yaml";
import { join, dirname } from "path";
function findConfigFile(startDir = process.cwd()) {
  let dir = startDir;
  while (dir !== "/") {
    const configPath = join(dir, ".hyve.yaml");
    if (existsSync(configPath)) {
      return configPath;
    }
    const configPathYml = join(dir, ".hyve.yml");
    if (existsSync(configPathYml)) {
      return configPathYml;
    }
    dir = dirname(dir);
  }
  return null;
}
function loadConfig() {
  const configPath = findConfigFile();
  if (!configPath) {
    throw new Error("No .hyve.yaml found. Run 'hyve init' first.");
  }
  const content = readFileSync(configPath, "utf-8");
  const config = parse(content);
  config.workspaces_dir = config.workspaces_dir || "./workspaces";
  config.required_repos = config.required_repos || [];
  config.branches = config.branches || { prefix: "feature/", base: "master" };
  config.services = config.services || {
    port_offset: 1e3,
    base_port: 4e3,
    definitions: {}
  };
  config.database = config.database || {
    enabled: false,
    source_port: 5432,
    base_port: 5500,
    user: "postgres",
    password: "postgres",
    name: "postgres"
  };
  return config;
}
function getProjectRoot() {
  const configPath = findConfigFile();
  if (!configPath) {
    throw new Error("No .hyve.yaml found");
  }
  return dirname(configPath);
}
function getWorkspacesDir() {
  const config = loadConfig();
  const projectRoot = getProjectRoot();
  return join(projectRoot, config.workspaces_dir);
}
function getWorkspaceDir(name) {
  return join(getWorkspacesDir(), name);
}
function getRepoPath(repoName) {
  const config = loadConfig();
  const projectRoot = getProjectRoot();
  const repoConfig = config.repos[repoName];
  if (!repoConfig) {
    throw new Error(`Unknown repo: ${repoName}`);
  }
  return join(projectRoot, repoConfig.path);
}

// src/utils.ts
import { existsSync as existsSync2, readdirSync, readFileSync as readFileSync2 } from "fs";
import { join as join2 } from "path";
function listWorkspaces() {
  const dir = getWorkspacesDir();
  if (!existsSync2(dir)) {
    return [];
  }
  return readdirSync(dir, { withFileTypes: true }).filter((d) => d.isDirectory() && !d.name.startsWith(".")).map((d) => d.name);
}
function workspaceExists(name) {
  return existsSync2(getWorkspaceDir(name));
}
function getWorkspaceConfig(name) {
  const configPath = join2(getWorkspaceDir(name), ".hyve-workspace.json");
  if (!existsSync2(configPath)) {
    return null;
  }
  return JSON.parse(readFileSync2(configPath, "utf-8"));
}
function sanitizeBranchName(name) {
  return name.replace(/\s+/g, "-").replace(/-+/g, "-").replace(/[^a-zA-Z0-9._/-]/g, "").replace(/^[-.]/, "").replace(/[-.]+$/, "").toLowerCase();
}
function calculateServicePort(serviceName, defaultPort, basePort, workspaceIndex, portOffset) {
  const workspaceBase = basePort + workspaceIndex * portOffset;
  const serviceOffset = defaultPort - 3e3;
  return workspaceBase + serviceOffset;
}
function getWorkspaceIndex(name) {
  const workspaces = listWorkspaces().sort();
  const index = workspaces.indexOf(name);
  return index >= 0 ? index : workspaces.length;
}

// src/commands/create.ts
var createCommand = new Command("create").description("Create a new feature workspace").argument("[name]", "Feature name").argument("[repos...]", "Additional repos to include").option("--from <branch>", "Create from existing branch").option("--existing", "Select from existing branches").option("--snapshot <name>", "Restore database from snapshot instead of cloning").option("--no-db", "Skip database creation").action(async (name, repos, options) => {
  const config = loadConfig();
  const projectRoot = getProjectRoot();
  if (!name) {
    const result = await p.text({
      message: "Enter feature name:",
      placeholder: "my-feature",
      validate: (value) => {
        if (!value) return "Name is required";
        if (workspaceExists(sanitizeBranchName(value))) {
          return "Workspace already exists";
        }
      }
    });
    if (p.isCancel(result)) {
      p.cancel("Cancelled");
      process.exit(0);
    }
    name = result;
  }
  const originalName = name;
  name = sanitizeBranchName(name);
  if (originalName !== name) {
    p.log.info(`Sanitized: ${chalk.dim(originalName)} \u2192 ${chalk.cyan(name)}`);
  }
  if (workspaceExists(name)) {
    p.log.error(`Workspace already exists: ${name}`);
    process.exit(1);
  }
  const allRepos = [.../* @__PURE__ */ new Set([...config.required_repos, ...repos])];
  if (allRepos.length === 0) {
    p.log.error("No repos specified and no required_repos configured");
    process.exit(1);
  }
  const branchName = `${config.branches.prefix}${name}`;
  const workspaceDir = getWorkspaceDir(name);
  p.intro(chalk.cyan(`Creating workspace: ${chalk.bold(name)}`));
  mkdirSync(workspaceDir, { recursive: true });
  const worktreeSpinner = p.spinner();
  worktreeSpinner.start("Creating git worktrees...");
  const worktreeResults = await Promise.all(
    allRepos.map(async (repo) => {
      try {
        const repoPath = getRepoPath(repo);
        const worktreeDir = join3(workspaceDir, repo);
        let baseBranch = config.branches.base;
        try {
          const { stdout } = await execa("git", ["symbolic-ref", "refs/remotes/origin/HEAD"], {
            cwd: repoPath
          });
          baseBranch = stdout.replace("refs/remotes/origin/", "").trim();
        } catch {
          for (const branch of ["main", "master"]) {
            try {
              await execa("git", ["show-ref", "--verify", `refs/heads/${branch}`], {
                cwd: repoPath
              });
              baseBranch = branch;
              break;
            } catch {
            }
          }
        }
        try {
          await execa("git", ["fetch", "origin", baseBranch], { cwd: repoPath });
        } catch {
        }
        let branchExists = false;
        try {
          await execa("git", ["show-ref", "--verify", `refs/heads/${branchName}`], {
            cwd: repoPath
          });
          branchExists = true;
        } catch {
        }
        if (!branchExists) {
          try {
            await execa("git", ["show-ref", "--verify", `refs/remotes/origin/${branchName}`], {
              cwd: repoPath
            });
            branchExists = true;
          } catch {
          }
        }
        if (branchExists || options.from) {
          await execa("git", ["worktree", "add", worktreeDir, branchName], {
            cwd: repoPath
          });
        } else {
          await execa("git", ["worktree", "add", "-b", branchName, worktreeDir, baseBranch], {
            cwd: repoPath
          });
        }
        return { repo, success: true, message: branchExists ? "existing" : `new from ${baseBranch}` };
      } catch (error) {
        return { repo, success: false, message: error.message };
      }
    })
  );
  worktreeSpinner.stop("Git worktrees created");
  const successfulRepos = [];
  for (const result of worktreeResults) {
    if (result.success) {
      p.log.success(`${result.repo} \u2192 ${branchName} (${result.message})`);
      successfulRepos.push(result.repo);
    } else {
      p.log.error(`${result.repo}: ${result.message}`);
    }
  }
  if (successfulRepos.length === 0) {
    p.log.error("No worktrees created");
    process.exit(1);
  }
  const setupSpinner = p.spinner();
  setupSpinner.start("Running setup scripts (parallel)...");
  const setupResults = await Promise.all(
    successfulRepos.map(async (repo) => {
      const repoConfig = config.repos[repo];
      if (!repoConfig?.setup_script) {
        return { repo, success: true, message: "no setup script" };
      }
      const worktreeDir = join3(workspaceDir, repo);
      const shellWrapper = config.services.shell_wrapper || "";
      const command = shellWrapper ? `${shellWrapper} ${repoConfig.setup_script}` : repoConfig.setup_script;
      try {
        await execa("bash", ["-l", "-c", `cd '${worktreeDir}' && ${command}`], {
          cwd: worktreeDir,
          timeout: 6e5
          // 10 minute timeout
        });
        return { repo, success: true, message: "complete" };
      } catch (error) {
        return { repo, success: false, message: error.shortMessage || error.message };
      }
    })
  );
  setupSpinner.stop("Setup scripts completed");
  for (const result of setupResults) {
    if (result.success) {
      p.log.success(`${result.repo} \u2192 setup ${result.message}`);
    } else {
      p.log.warn(`${result.repo} \u2192 setup failed: ${result.message}`);
    }
  }
  let dbPort;
  let dbContainer;
  if (config.database.enabled) {
    const dbSpinner = p.spinner();
    dbSpinner.start("Starting database...");
    const workspaceIndex2 = getWorkspaceIndex(name);
    dbPort = config.database.base_port + workspaceIndex2;
    dbContainer = `hyve-db-${name}`;
    try {
      try {
        await execa("docker", ["rm", "-f", dbContainer]);
      } catch {
      }
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
        config.database.image || "postgres:15"
      ]);
      await new Promise((resolve) => setTimeout(resolve, 3e3));
      const snapshotName = options.snapshot;
      const snapshotsDir = join3(projectRoot, ".snapshots");
      const snapshotPath = snapshotName ? join3(snapshotsDir, `${snapshotName}.dump`) : null;
      if (snapshotPath && existsSync3(snapshotPath)) {
        dbSpinner.message(`Restoring from snapshot: ${snapshotName}...`);
        await execa("bash", [
          "-c",
          `PGPASSWORD=${config.database.password} pg_restore -h localhost -p ${dbPort} -U ${config.database.user} -d ${config.database.name} --no-owner --no-acl "${snapshotPath}" 2>&1 | grep -v "WARNING:" || true`
        ]);
      } else if (snapshotName) {
        const defaultSnapshot = join3(snapshotsDir, "default.dump");
        if (existsSync3(defaultSnapshot)) {
          dbSpinner.message("Restoring from default snapshot...");
          await execa("bash", [
            "-c",
            `PGPASSWORD=${config.database.password} pg_restore -h localhost -p ${dbPort} -U ${config.database.user} -d ${config.database.name} --no-owner --no-acl "${defaultSnapshot}" 2>&1 | grep -v "WARNING:" || true`
          ]);
        } else {
          dbSpinner.message("No snapshot found, cloning from source...");
          await execa("bash", [
            "-c",
            `PGPASSWORD=${config.database.password} pg_dump -h localhost -p ${config.database.source_port} -U ${config.database.user} ${config.database.name} | PGPASSWORD=${config.database.password} psql -h localhost -p ${dbPort} -U ${config.database.user} ${config.database.name}`
          ]);
        }
      } else {
        const defaultSnapshot = join3(snapshotsDir, "default.dump");
        if (existsSync3(defaultSnapshot)) {
          dbSpinner.message("Restoring from default snapshot...");
          await execa("bash", [
            "-c",
            `PGPASSWORD=${config.database.password} pg_restore -h localhost -p ${dbPort} -U ${config.database.user} -d ${config.database.name} --no-owner --no-acl "${defaultSnapshot}" 2>&1 | grep -v "WARNING:" || true`
          ]);
        } else {
          dbSpinner.message("Cloning database from source...");
          await execa("bash", [
            "-c",
            `PGPASSWORD=${config.database.password} pg_dump -h localhost -p ${config.database.source_port} -U ${config.database.user} ${config.database.name} | PGPASSWORD=${config.database.password} psql -h localhost -p ${dbPort} -U ${config.database.user} ${config.database.name}`
          ]);
        }
      }
      dbSpinner.stop("Database ready");
      p.log.success(`Database running on port ${dbPort}`);
    } catch (error) {
      dbSpinner.stop("Database setup failed");
      p.log.warn(`Database: ${error.message}`);
    }
  }
  const envSpinner = p.spinner();
  envSpinner.start("Generating .env files...");
  const workspaceIndex = getWorkspaceIndex(name);
  for (const repo of successfulRepos) {
    const worktreeDir = join3(workspaceDir, repo);
    const mainRepoPath = getRepoPath(repo);
    const envFile = join3(worktreeDir, ".env");
    const mainEnvFile = join3(mainRepoPath, ".env");
    const envExample = join3(worktreeDir, ".env.example");
    if (existsSync3(mainEnvFile)) {
      copyFileSync(mainEnvFile, envFile);
    } else if (existsSync3(envExample)) {
      copyFileSync(envExample, envFile);
    } else {
      writeFileSync(envFile, "");
    }
    let envContent = readFileSync3(envFile, "utf-8");
    if (dbPort) {
      const newDbUrl = `postgresql://${config.database.user}:${config.database.password}@localhost:${dbPort}/${config.database.name}`;
      envContent = envContent.replace(/^DATABASE_URL=.*/m, `DATABASE_URL=${newDbUrl}`);
      envContent = envContent.replace(/^POSTGRES_PORT=.*/m, `POSTGRES_PORT=${dbPort}`);
    }
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
        envContent = `PORT=${newPort}
${envContent}`;
      }
    }
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
    if (!envContent.includes("Hyve Workspace")) {
      envContent += `
# ===== Hyve Workspace Configuration =====
`;
      envContent += `# Workspace: ${name}
`;
    }
    writeFileSync(envFile, envContent);
  }
  envSpinner.stop(".env files generated");
  const workspaceConfig = {
    name,
    branch: branchName,
    repos: successfulRepos,
    database: {
      enabled: config.database.enabled,
      port: dbPort,
      container: dbContainer
    },
    created: (/* @__PURE__ */ new Date()).toISOString(),
    status: "active"
  };
  writeFileSync(
    join3(workspaceDir, ".hyve-workspace.json"),
    JSON.stringify(workspaceConfig, null, 2)
  );
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

// src/commands/cleanup.ts
import { Command as Command2 } from "commander";
import * as p2 from "@clack/prompts";
import chalk2 from "chalk";
import { execa as execa2 } from "execa";
import { rmSync, existsSync as existsSync4 } from "fs";
import { join as join4 } from "path";
var cleanupCommand = new Command2("cleanup").description("Remove a workspace").argument("[name]", "Workspace name").option("-f, --force", "Skip confirmation").action(async (name, options) => {
  const workspaces = listWorkspaces();
  if (workspaces.length === 0) {
    p2.log.error("No workspaces found");
    process.exit(1);
  }
  if (!name) {
    const result = await p2.select({
      message: "Select workspace to remove:",
      options: workspaces.map((ws) => ({ value: ws, label: ws }))
    });
    if (p2.isCancel(result)) {
      p2.cancel("Cancelled");
      process.exit(0);
    }
    name = result;
  }
  if (!workspaceExists(name)) {
    p2.log.error(`Workspace not found: ${name}`);
    process.exit(1);
  }
  const workspaceDir = getWorkspaceDir(name);
  const config = getWorkspaceConfig(name);
  if (!options.force) {
    const confirmed = await p2.confirm({
      message: `Remove workspace "${chalk2.bold(name)}"?
  This will delete worktrees and database but preserve git branches.`
    });
    if (p2.isCancel(confirmed) || !confirmed) {
      p2.cancel("Cancelled");
      process.exit(0);
    }
  }
  p2.intro(chalk2.cyan(`Removing workspace: ${chalk2.bold(name)}`));
  if (config?.database?.container) {
    const dbSpinner = p2.spinner();
    dbSpinner.start("Removing database...");
    try {
      await execa2("docker", ["rm", "-f", config.database.container]);
      dbSpinner.stop("Database removed");
    } catch {
      dbSpinner.stop("Database not found");
    }
  }
  const repos = config?.repos || [];
  if (repos.length > 0) {
    const worktreeSpinner = p2.spinner();
    worktreeSpinner.start("Removing worktrees...");
    await Promise.all(
      repos.map(async (repo) => {
        try {
          const mainRepoPath = getRepoPath(repo);
          const worktreeDir = join4(workspaceDir, repo);
          if (existsSync4(mainRepoPath)) {
            await execa2("git", ["worktree", "remove", worktreeDir, "--force"], {
              cwd: mainRepoPath
            });
            await execa2("git", ["worktree", "prune"], { cwd: mainRepoPath });
          }
        } catch {
        }
      })
    );
    worktreeSpinner.stop("Worktrees removed");
  }
  rmSync(workspaceDir, { recursive: true, force: true });
  p2.outro(chalk2.green(`Workspace "${name}" removed`));
});

// src/commands/list.ts
import { Command as Command3 } from "commander";
import chalk3 from "chalk";
var listCommand = new Command3("list").alias("ls").description("List all workspaces").action(async () => {
  const workspaces = listWorkspaces();
  if (workspaces.length === 0) {
    console.log(chalk3.dim("No workspaces found"));
    console.log();
    console.log("Create one with:", chalk3.cyan("hyve create <name>"));
    return;
  }
  console.log(chalk3.bold("Workspaces"));
  console.log(chalk3.dim("\u2500".repeat(50)));
  console.log();
  for (const ws of workspaces) {
    const config = getWorkspaceConfig(ws);
    const repos = config?.repos?.join(", ") || "unknown";
    const dbPort = config?.database?.port;
    console.log(`  ${chalk3.cyan("\u25C6")} ${chalk3.bold(ws)}`);
    console.log(`    ${chalk3.dim("Branch:")} ${config?.branch || "unknown"}`);
    console.log(`    ${chalk3.dim("Repos:")}  ${repos}`);
    if (dbPort) {
      console.log(`    ${chalk3.dim("DB:")}     localhost:${dbPort}`);
    }
    console.log();
  }
});

// src/commands/status.ts
import { Command as Command4 } from "commander";
import * as p3 from "@clack/prompts";
import chalk4 from "chalk";
import { execa as execa3 } from "execa";
var statusCommand = new Command4("status").description("Show workspace status").argument("[name]", "Workspace name").action(async (name) => {
  const workspaces = listWorkspaces();
  if (workspaces.length === 0) {
    p3.log.error("No workspaces found");
    process.exit(1);
  }
  if (!name) {
    const result = await p3.select({
      message: "Select workspace:",
      options: workspaces.map((ws) => ({ value: ws, label: ws }))
    });
    if (p3.isCancel(result)) {
      p3.cancel("Cancelled");
      process.exit(0);
    }
    name = result;
  }
  if (!workspaceExists(name)) {
    p3.log.error(`Workspace not found: ${name}`);
    process.exit(1);
  }
  const config = loadConfig();
  const wsConfig = getWorkspaceConfig(name);
  const workspaceDir = getWorkspaceDir(name);
  const workspaceIndex = getWorkspaceIndex(name);
  console.log();
  console.log(chalk4.bold(`Workspace: ${name}`));
  console.log(chalk4.dim("\u2500".repeat(50)));
  console.log();
  console.log(chalk4.dim("  Location:"), workspaceDir);
  console.log(chalk4.dim("  Branch:  "), wsConfig?.branch || "unknown");
  console.log(chalk4.dim("  Created: "), wsConfig?.created || "unknown");
  console.log();
  if (wsConfig?.database?.container) {
    let dbStatus = chalk4.red("stopped");
    try {
      const { stdout } = await execa3("docker", [
        "inspect",
        "-f",
        "{{.State.Running}}",
        wsConfig.database.container
      ]);
      if (stdout.trim() === "true") {
        dbStatus = chalk4.green("running");
      }
    } catch {
    }
    console.log(chalk4.dim("  Database:"), `${dbStatus} (port ${wsConfig.database.port})`);
  }
  console.log();
  console.log(chalk4.bold("  Services:"));
  for (const repo of wsConfig?.repos || []) {
    const serviceConfig = config.services.definitions[repo];
    if (!serviceConfig) continue;
    const port = calculateServicePort(
      repo,
      serviceConfig.default_port,
      config.services.base_port,
      workspaceIndex,
      config.services.port_offset
    );
    let status = chalk4.dim("stopped");
    try {
      await execa3("lsof", ["-i", `:${port}`]);
      status = chalk4.green("running");
    } catch {
    }
    console.log(`    ${chalk4.cyan(repo)}: ${status} (port ${port})`);
  }
  console.log();
});

// src/commands/run.ts
import { Command as Command5 } from "commander";
import * as p4 from "@clack/prompts";
import chalk5 from "chalk";
import { execa as execa4 } from "execa";
import { spawn } from "child_process";
import { existsSync as existsSync5, mkdirSync as mkdirSync2, writeFileSync as writeFileSync2, openSync } from "fs";
import { join as join5 } from "path";
var startupPhase = true;
var startupPids = [];
function setupSignalHandlers() {
  const cleanup = () => {
    if (startupPhase) {
      console.log("\n\nStartup interrupted, stopping services...");
      for (const pid of startupPids) {
        try {
          process.kill(-pid, "SIGTERM");
        } catch {
          try {
            process.kill(pid, "SIGTERM");
          } catch {
          }
        }
      }
    }
    process.exit(0);
  };
  process.on("SIGINT", cleanup);
  process.on("SIGTERM", cleanup);
}
var runCommand = new Command5("run").description("Start all services for a workspace").argument("[name]", "Workspace name").argument("[services...]", "Specific services to run").action(async (name, services) => {
  setupSignalHandlers();
  const workspaces = listWorkspaces();
  if (workspaces.length === 0) {
    p4.log.error("No workspaces found");
    process.exit(1);
  }
  if (!name) {
    const result = await p4.select({
      message: "Select workspace to run:",
      options: workspaces.map((ws) => ({ value: ws, label: ws }))
    });
    if (p4.isCancel(result)) {
      p4.cancel("Cancelled");
      process.exit(0);
    }
    name = result;
  }
  if (!workspaceExists(name)) {
    p4.log.error(`Workspace not found: ${name}`);
    process.exit(1);
  }
  const config = loadConfig();
  const wsConfig = getWorkspaceConfig(name);
  const workspaceDir = getWorkspaceDir(name);
  const workspaceIndex = getWorkspaceIndex(name);
  const allRepos = services.length > 0 ? services : wsConfig?.repos || [];
  p4.intro(chalk5.cyan(`Starting services for ${chalk5.bold(name)}`));
  const logsDir = join5(workspaceDir, ".hyve", "logs");
  mkdirSync2(logsDir, { recursive: true });
  if (wsConfig?.database?.container) {
    const dbSpinner = p4.spinner();
    dbSpinner.start("Starting database...");
    try {
      const { stdout } = await execa4("docker", [
        "inspect",
        "-f",
        "{{.State.Running}}",
        wsConfig.database.container
      ]);
      if (stdout.trim() !== "true") {
        await execa4("docker", ["start", wsConfig.database.container]);
      }
      dbSpinner.stop("Database running");
    } catch {
      dbSpinner.stop("Database not found - run 'hyve create' again");
    }
  }
  const cleanupSpinner = p4.spinner();
  cleanupSpinner.start("Cleaning up stale processes...");
  const portsToClean = /* @__PURE__ */ new Set();
  for (const repo of allRepos) {
    const svcConfig = config.services.definitions[repo];
    if (svcConfig) {
      portsToClean.add(svcConfig.default_port);
      const wsPort = calculateServicePort(
        repo,
        svcConfig.default_port,
        config.services.base_port,
        workspaceIndex,
        config.services.port_offset
      );
      portsToClean.add(wsPort);
    }
  }
  let killedCount = 0;
  for (const port of portsToClean) {
    try {
      const { stdout } = await execa4("lsof", ["-ti", `:${port}`]);
      const pids = stdout.trim().split("\n").filter(Boolean);
      for (const pid of pids) {
        try {
          await execa4("kill", ["-9", pid]);
          killedCount++;
        } catch {
        }
      }
    } catch {
    }
  }
  cleanupSpinner.stop(killedCount > 0 ? `Killed ${killedCount} stale process(es)` : "No stale processes");
  const serviceConfigs = config.services.definitions;
  const startOrder = topologicalSort(allRepos, serviceConfigs);
  p4.log.info(`Start order: ${startOrder.join(" \u2192 ")}`);
  const levels = groupByDependencyLevel(startOrder, serviceConfigs);
  const serviceResults = [];
  const runningServices = /* @__PURE__ */ new Map();
  for (const level of levels) {
    const levelResults = await Promise.all(
      level.map((repo) => startService(repo, {
        config,
        workspaceDir,
        workspaceIndex,
        logsDir,
        runningServices
      }))
    );
    for (const result of levelResults) {
      serviceResults.push(result);
      if (result.pid) {
        runningServices.set(result.name, result.port);
      }
    }
    const failedServices = levelResults.filter((r) => !r.pid).map((r) => r.name);
    if (failedServices.length > 0) {
      const dependents = startOrder.filter((s) => {
        const deps = serviceConfigs[s]?.depends_on || [];
        return deps.some((d) => failedServices.includes(d));
      });
      if (dependents.length > 0) {
        p4.log.warn(`Services depending on failed services may not work: ${dependents.join(", ")}`);
      }
    }
    if (level !== levels[levels.length - 1]) {
      await new Promise((resolve) => setTimeout(resolve, 3e3));
    }
  }
  console.log();
  console.log(chalk5.dim("\u2500".repeat(50)));
  console.log();
  console.log(chalk5.bold.green("Services Running"));
  console.log();
  for (const result of serviceResults) {
    if (result.pid) {
      console.log(`  ${chalk5.cyan(result.name)}  \u2192  http://localhost:${result.port}`);
    } else {
      console.log(`  ${chalk5.red(result.name)}  \u2192  ${result.error}`);
    }
  }
  console.log();
  console.log(chalk5.dim("  Logs:"), logsDir);
  console.log(chalk5.dim("  Stop:"), `hyve halt ${name}`);
  console.log();
  const frontends = ["webapp", "rn-platform-website", "mobile"];
  const openUrls = [];
  for (const result of serviceResults) {
    if (result.pid && frontends.includes(result.name)) {
      openUrls.push(`http://localhost:${result.port}`);
    }
  }
  if (openUrls.length > 0) {
    const shouldOpen = await p4.confirm({
      message: `Open ${openUrls.length} browser tab(s)?`,
      initialValue: true
    });
    if (!p4.isCancel(shouldOpen) && shouldOpen) {
      for (const url of openUrls) {
        await execa4("open", [url]);
      }
    }
  }
  startupPhase = false;
  process.exit(0);
});
async function waitForHealth(url, timeoutMs) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(2e3) });
      if (response.ok) {
        return true;
      }
    } catch {
    }
    await new Promise((resolve) => setTimeout(resolve, 1e3));
  }
  return false;
}
function topologicalSort(repos, serviceConfigs) {
  const visited = /* @__PURE__ */ new Set();
  const result = [];
  const repoSet = new Set(repos);
  function visit(repo) {
    if (visited.has(repo)) return;
    visited.add(repo);
    const deps = serviceConfigs[repo]?.depends_on || [];
    for (const dep of deps) {
      if (repoSet.has(dep)) {
        visit(dep);
      }
    }
    result.push(repo);
  }
  for (const repo of repos) {
    visit(repo);
  }
  return result;
}
function groupByDependencyLevel(sortedRepos, serviceConfigs) {
  const levels = [];
  const assigned = /* @__PURE__ */ new Set();
  while (assigned.size < sortedRepos.length) {
    const level = [];
    for (const repo of sortedRepos) {
      if (assigned.has(repo)) continue;
      const deps = serviceConfigs[repo]?.depends_on || [];
      const depsInList = deps.filter((d) => sortedRepos.includes(d));
      const allDepsSatisfied = depsInList.every((d) => assigned.has(d));
      if (allDepsSatisfied) {
        level.push(repo);
      }
    }
    for (const repo of level) {
      assigned.add(repo);
    }
    levels.push(level);
  }
  return levels;
}
async function startService(repo, ctx) {
  const { config, workspaceDir, workspaceIndex, logsDir, runningServices } = ctx;
  const serviceConfig = config.services.definitions[repo];
  if (!serviceConfig) {
    return { name: repo, port: 0, error: "No service config" };
  }
  const port = calculateServicePort(
    repo,
    serviceConfig.default_port,
    config.services.base_port,
    workspaceIndex,
    config.services.port_offset
  );
  const serviceDir = join5(workspaceDir, repo);
  if (!existsSync5(serviceDir)) {
    return { name: repo, port, error: "Directory not found" };
  }
  const logFile = join5(logsDir, `${repo}.log`);
  const pidFile = join5(logsDir, `${repo}.pid`);
  const shellWrapper = config.services.shell_wrapper || "";
  const spinner5 = p4.spinner();
  const deps = serviceConfig.depends_on || [];
  if (deps.length > 0) {
    for (const dep of deps) {
      const depConfig = config.services.definitions[dep];
      const depPort = runningServices.get(dep);
      if (depConfig?.health_check && depPort) {
        const healthUrl = depConfig.health_check.replace("${port}", String(depPort));
        spinner5.start(`Waiting for ${chalk5.cyan(dep)} to be healthy...`);
        const healthy = await waitForHealth(healthUrl, 3e4);
        if (healthy) {
          spinner5.stop(`${dep} is healthy`);
        } else {
          spinner5.stop(`${dep} health check timed out (continuing anyway)`);
        }
      }
    }
  }
  if (serviceConfig.pre_run) {
    spinner5.start(`Running pre-run for ${chalk5.cyan(repo)}...`);
    try {
      let preRunCommand = serviceConfig.pre_run;
      const serverPort = runningServices.get("server");
      if (serverPort) {
        preRunCommand = preRunCommand.replace(/\$\{server_port\}/g, String(serverPort));
      }
      const preRunCmd = shellWrapper ? `${shellWrapper} ${preRunCommand}` : preRunCommand;
      await execa4("bash", ["-l", "-c", `cd '${serviceDir}' && ${preRunCmd}`], {
        cwd: serviceDir,
        timeout: 12e4,
        // 2 minute timeout for pre-run
        env: {
          ...process.env,
          PORT: String(port)
        }
      });
      spinner5.stop(`Pre-run complete for ${repo}`);
    } catch (error) {
      spinner5.stop(`Pre-run failed for ${repo}: ${error.shortMessage || error.message}`);
    }
  }
  spinner5.start(`Starting ${chalk5.cyan(repo)} on port ${chalk5.yellow(port)}...`);
  try {
    let devCommand = serviceConfig.dev_command || "pnpm dev";
    devCommand = devCommand.replace(/\$\{port\}/g, String(port));
    const command = shellWrapper ? `${shellWrapper} ${devCommand}` : devCommand;
    const logFd = openSync(logFile, "a");
    const child = spawn("nohup", ["bash", "-l", "-c", `cd '${serviceDir}' && ${command}`], {
      detached: true,
      stdio: ["ignore", logFd, logFd],
      env: {
        ...process.env,
        PORT: String(port)
      }
    });
    child.unref();
    if (child.pid) {
      writeFileSync2(pidFile, String(child.pid));
      startupPids.push(child.pid);
    }
    await new Promise((resolve) => setTimeout(resolve, 2e3));
    try {
      process.kill(child.pid, 0);
      spinner5.stop(`${chalk5.cyan(repo)} started (PID ${child.pid})`);
      return { name: repo, port, pid: child.pid };
    } catch {
      spinner5.stop(`${chalk5.red(repo)} failed to start`);
      return { name: repo, port, error: "Process exited" };
    }
  } catch (error) {
    spinner5.stop(`${chalk5.red(repo)} failed: ${error.message}`);
    return { name: repo, port, error: error.message };
  }
}

// src/commands/halt.ts
import { Command as Command6 } from "commander";
import * as p5 from "@clack/prompts";
import chalk6 from "chalk";
import { execa as execa5 } from "execa";
import { existsSync as existsSync6, readFileSync as readFileSync4, rmSync as rmSync2 } from "fs";
import { join as join6 } from "path";
var haltCommand = new Command6("halt").alias("stop").description("Stop all services for a workspace").argument("[name]", "Workspace name").action(async (name) => {
  const workspaces = listWorkspaces();
  if (workspaces.length === 0) {
    p5.log.error("No workspaces found");
    process.exit(1);
  }
  if (!name) {
    const result = await p5.select({
      message: "Select workspace to stop:",
      options: workspaces.map((ws) => ({ value: ws, label: ws }))
    });
    if (p5.isCancel(result)) {
      p5.cancel("Cancelled");
      process.exit(0);
    }
    name = result;
  }
  if (!workspaceExists(name)) {
    p5.log.error(`Workspace not found: ${name}`);
    process.exit(1);
  }
  const wsConfig = getWorkspaceConfig(name);
  const workspaceDir = getWorkspaceDir(name);
  const logsDir = join6(workspaceDir, ".hyve", "logs");
  p5.intro(chalk6.cyan(`Stopping services for ${chalk6.bold(name)}`));
  const repos = wsConfig?.repos || [];
  for (const repo of repos) {
    const pidFile = join6(logsDir, `${repo}.pid`);
    if (existsSync6(pidFile)) {
      const spinner5 = p5.spinner();
      spinner5.start(`Stopping ${repo}...`);
      try {
        const pid = parseInt(readFileSync4(pidFile, "utf-8").trim());
        try {
          process.kill(-pid, "SIGTERM");
        } catch {
          try {
            process.kill(pid, "SIGTERM");
          } catch {
          }
        }
        try {
          await execa5("pkill", ["-P", String(pid)]);
        } catch {
        }
        rmSync2(pidFile);
        spinner5.stop(`${repo} stopped`);
      } catch (error) {
        spinner5.stop(`${repo} already stopped`);
        rmSync2(pidFile, { force: true });
      }
    }
  }
  if (wsConfig?.database?.container) {
    const dbSpinner = p5.spinner();
    dbSpinner.start("Stopping database...");
    try {
      await execa5("docker", ["stop", wsConfig.database.container]);
      dbSpinner.stop("Database stopped");
    } catch {
      dbSpinner.stop("Database not running");
    }
  }
  p5.outro(chalk6.green("All services stopped"));
});

// src/commands/db.ts
import { Command as Command7 } from "commander";
import * as p6 from "@clack/prompts";
import chalk7 from "chalk";
import { execa as execa6 } from "execa";
var dbCommand = new Command7("db").description("Connect to workspace database").argument("[name]", "Workspace name").action(async (name) => {
  const workspaces = listWorkspaces();
  if (workspaces.length === 0) {
    p6.log.error("No workspaces found");
    process.exit(1);
  }
  if (!name) {
    const result = await p6.select({
      message: "Select workspace:",
      options: workspaces.map((ws) => ({ value: ws, label: ws }))
    });
    if (p6.isCancel(result)) {
      p6.cancel("Cancelled");
      process.exit(0);
    }
    name = result;
  }
  if (!workspaceExists(name)) {
    p6.log.error(`Workspace not found: ${name}`);
    process.exit(1);
  }
  const config = loadConfig();
  const wsConfig = getWorkspaceConfig(name);
  if (!wsConfig?.database?.port) {
    p6.log.error("No database configured for this workspace");
    process.exit(1);
  }
  console.log(chalk7.dim(`Connecting to database on port ${wsConfig.database.port}...`));
  console.log();
  await execa6(
    "psql",
    [
      "-h",
      "localhost",
      "-p",
      String(wsConfig.database.port),
      "-U",
      config.database.user,
      "-d",
      config.database.name
    ],
    {
      stdio: "inherit",
      env: {
        ...process.env,
        PGPASSWORD: config.database.password
      }
    }
  );
});

// src/index.ts
var VERSION = "2.0.0";
var logo = chalk8.yellow(`
    \u2588\u2588\u2557  \u2588\u2588\u2557\u2588\u2588\u2557   \u2588\u2588\u2557\u2588\u2588\u2557   \u2588\u2588\u2557\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2557
    \u2588\u2588\u2551  \u2588\u2588\u2551\u255A\u2588\u2588\u2557 \u2588\u2588\u2554\u255D\u2588\u2588\u2551   \u2588\u2588\u2551\u2588\u2588\u2554\u2550\u2550\u2550\u2550\u255D
    \u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2551 \u255A\u2588\u2588\u2588\u2588\u2554\u255D \u2588\u2588\u2551   \u2588\u2588\u2551\u2588\u2588\u2588\u2588\u2588\u2557
    \u2588\u2588\u2554\u2550\u2550\u2588\u2588\u2551  \u255A\u2588\u2588\u2554\u255D  \u255A\u2588\u2588\u2557 \u2588\u2588\u2554\u255D\u2588\u2588\u2554\u2550\u2550\u255D
    \u2588\u2588\u2551  \u2588\u2588\u2551   \u2588\u2588\u2551    \u255A\u2588\u2588\u2588\u2588\u2554\u255D \u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2557
    \u255A\u2550\u255D  \u255A\u2550\u255D   \u255A\u2550\u255D     \u255A\u2550\u2550\u2550\u255D  \u255A\u2550\u2550\u2550\u2550\u2550\u2550\u255D
`);
var program = new Command8();
program.name("hyve").description("Autonomous Multi-Repo Agent Workspaces").version(VERSION).addCommand(createCommand).addCommand(cleanupCommand).addCommand(listCommand).addCommand(statusCommand).addCommand(runCommand).addCommand(haltCommand).addCommand(dbCommand);
program.hook("preAction", () => {
  console.log(chalk8.yellow("\u2B21") + " " + chalk8.bold("hyve"));
  console.log();
});
program.parse();
