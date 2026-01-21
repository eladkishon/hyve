#!/usr/bin/env node

// src/index.ts
import { Command as Command8 } from "commander";
import chalk8 from "chalk";

// src/commands/create.ts
import { Command } from "commander";
import * as p from "@clack/prompts";
import chalk from "chalk";
import { execSync } from "child_process";
import { existsSync as existsSync3, mkdirSync, writeFileSync, readFileSync as readFileSync3, copyFileSync } from "fs";
import { join as join3 } from "path";

// src/config.ts
import { readFileSync, existsSync } from "fs";
import { parse } from "yaml";
import { join, dirname } from "path";
var cachedConfig = null;
var cachedConfigPath = null;
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
  if (cachedConfig && cachedConfigPath === configPath) {
    return cachedConfig;
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
  cachedConfig = config;
  cachedConfigPath = configPath;
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
var createCommand = new Command("create").description("Create a new feature workspace").argument("[name]", "Feature name").argument("[repos...]", "Additional repos to include").option("--from <branch>", "Create from existing branch").option("--existing", "Select from existing branches").option("--no-setup", "Skip running setup scripts").action(async (name, repos, options) => {
  const config = loadConfig();
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
    console.log(chalk.dim(`Sanitized: ${originalName} \u2192 ${name}`));
  }
  if (workspaceExists(name)) {
    console.error(chalk.red(`Workspace already exists: ${name}`));
    process.exit(1);
  }
  const allRepos = [.../* @__PURE__ */ new Set([...config.required_repos, ...repos])];
  if (allRepos.length === 0) {
    console.error(chalk.red("No repos specified and no required_repos configured"));
    process.exit(1);
  }
  const branchName = `${config.branches.prefix}${name}`;
  const workspaceDir = getWorkspaceDir(name);
  console.log(chalk.cyan(`Creating workspace: ${chalk.bold(name)}`));
  mkdirSync(workspaceDir, { recursive: true });
  console.log(chalk.dim("Creating git worktrees..."));
  const successfulRepos = [];
  for (const repo of allRepos) {
    try {
      const repoPath = getRepoPath(repo);
      const worktreeDir = join3(workspaceDir, repo);
      let baseBranch = config.branches.base;
      try {
        const stdout = execSync("git symbolic-ref refs/remotes/origin/HEAD", {
          cwd: repoPath,
          encoding: "utf-8",
          stdio: ["pipe", "pipe", "ignore"]
        });
        baseBranch = stdout.replace("refs/remotes/origin/", "").trim();
      } catch {
        for (const branch of ["main", "master"]) {
          try {
            execSync(`git show-ref --verify refs/heads/${branch}`, {
              cwd: repoPath,
              stdio: "ignore"
            });
            baseBranch = branch;
            break;
          } catch {
          }
        }
      }
      try {
        execSync(`git fetch origin ${baseBranch}`, { cwd: repoPath, stdio: "ignore" });
      } catch {
      }
      let branchExists = false;
      try {
        execSync(`git show-ref --verify refs/heads/${branchName}`, {
          cwd: repoPath,
          stdio: "ignore"
        });
        branchExists = true;
      } catch {
      }
      if (!branchExists) {
        try {
          execSync(`git show-ref --verify refs/remotes/origin/${branchName}`, {
            cwd: repoPath,
            stdio: "ignore"
          });
          branchExists = true;
        } catch {
        }
      }
      if (branchExists || options.from) {
        execSync(`git worktree add "${worktreeDir}" "${branchName}"`, {
          cwd: repoPath,
          stdio: "ignore"
        });
      } else {
        execSync(`git worktree add -b "${branchName}" "${worktreeDir}" "${baseBranch}"`, {
          cwd: repoPath,
          stdio: "ignore"
        });
      }
      console.log(chalk.green(`  \u2713 ${repo}`) + chalk.dim(` \u2192 ${branchName}`));
      successfulRepos.push(repo);
    } catch (error) {
      console.log(chalk.red(`  \u2717 ${repo}`) + chalk.dim(` - ${error.message}`));
    }
  }
  if (successfulRepos.length === 0) {
    console.error(chalk.red("No worktrees created"));
    process.exit(1);
  }
  if (options.setup !== false) {
    console.log(chalk.dim("Running setup scripts..."));
    for (const repo of successfulRepos) {
      const repoConfig = config.repos[repo];
      if (!repoConfig?.setup_script) continue;
      const worktreeDir = join3(workspaceDir, repo);
      const shellWrapper = config.services.shell_wrapper || "";
      const command = shellWrapper ? `${shellWrapper} ${repoConfig.setup_script}` : repoConfig.setup_script;
      try {
        execSync(`bash -l -c 'cd "${worktreeDir}" && ${command}'`, {
          cwd: worktreeDir,
          stdio: "inherit",
          timeout: 6e5
          // 10 minute timeout
        });
        console.log(chalk.green(`  \u2713 ${repo} setup complete`));
      } catch (error) {
        console.log(chalk.yellow(`  \u26A0 ${repo} setup failed`));
      }
    }
  }
  let dbPort;
  let dbContainer;
  const workspaceIndex = getWorkspaceIndex(name);
  if (config.database.enabled) {
    console.log(chalk.dim("Starting database..."));
    dbPort = config.database.base_port + workspaceIndex;
    dbContainer = `hyve-db-${name}`;
    const projectRoot2 = getProjectRoot();
    try {
      try {
        execSync(`docker rm -f ${dbContainer}`, { stdio: "ignore" });
      } catch {
      }
      execSync(
        `docker run -d --name ${dbContainer} -p ${dbPort}:5432 -e POSTGRES_USER=${config.database.user} -e POSTGRES_PASSWORD=${config.database.password} -e POSTGRES_DB=${config.database.name} postgres:15`,
        { stdio: "ignore" }
      );
      console.log(chalk.dim("  Waiting for database to be ready..."));
      execSync("sleep 3");
      const snapshotsDir = join3(projectRoot2, ".snapshots");
      const defaultSnapshot = join3(snapshotsDir, "default.dump");
      if (existsSync3(defaultSnapshot)) {
        console.log(chalk.dim("  Restoring from default snapshot..."));
        execSync(
          `PGPASSWORD=${config.database.password} pg_restore -h localhost -p ${dbPort} -U ${config.database.user} -d ${config.database.name} --no-owner --no-acl "${defaultSnapshot}" 2>&1 | grep -v "WARNING:" || true`,
          { stdio: "ignore" }
        );
      } else {
        console.log(chalk.dim("  Cloning database from source..."));
        execSync(
          `PGPASSWORD=${config.database.password} pg_dump -h localhost -p ${config.database.source_port} -U ${config.database.user} ${config.database.name} | PGPASSWORD=${config.database.password} psql -h localhost -p ${dbPort} -U ${config.database.user} ${config.database.name}`,
          { stdio: "ignore" }
        );
      }
      console.log(chalk.green(`  \u2713 Database ready on port ${dbPort}`));
      if (config.database.seed_command) {
        console.log(chalk.dim("  Running database seed command..."));
        const seedCommand = config.database.seed_command.replace(/\$\{port\}/g, String(dbPort));
        try {
          execSync(`bash -l -c '${seedCommand}'`, {
            cwd: projectRoot2,
            stdio: "inherit",
            timeout: 3e5
            // 5 minute timeout
          });
          console.log(chalk.green(`  \u2713 Database seeded`));
        } catch (error) {
          console.log(chalk.yellow(`  \u26A0 Database seeding failed: ${error.message}`));
        }
      }
    } catch (error) {
      console.log(chalk.yellow(`  \u26A0 Database setup failed: ${error.message}`));
    }
  }
  console.log(chalk.dim("Generating .env files..."));
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
        new RegExp(`(localhost|127\\.0\\.0\\.1):${defaultPort}`, "g"),
        `$1:${workspacePort}`
      );
    }
    if (dbPort && config.database.source_port) {
      envContent = envContent.replace(
        new RegExp(`(localhost|127\\.0\\.0\\.1):${config.database.source_port}`, "g"),
        `$1:${dbPort}`
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
  const workspaceConfig = {
    name,
    branch: branchName,
    repos: successfulRepos,
    database: dbPort ? {
      enabled: true,
      port: dbPort,
      container: dbContainer
    } : { enabled: false },
    created: (/* @__PURE__ */ new Date()).toISOString(),
    status: "active"
  };
  writeFileSync(
    join3(workspaceDir, ".hyve-workspace.json"),
    JSON.stringify(workspaceConfig, null, 2)
  );
  const projectRoot = getProjectRoot();
  const vscodeWorkspaceFiles = [
    join3(projectRoot, "code-workspace.code-workspace"),
    join3(projectRoot, ".code-workspace"),
    join3(projectRoot, `${projectRoot.split("/").pop()}.code-workspace`)
  ];
  for (const vscodeFile of vscodeWorkspaceFiles) {
    if (existsSync3(vscodeFile)) {
      try {
        const vscodeContent = JSON.parse(readFileSync3(vscodeFile, "utf-8"));
        if (vscodeContent.folders && Array.isArray(vscodeContent.folders)) {
          const workspaceRelPath = workspaceDir.replace(projectRoot + "/", "");
          let added = false;
          for (const repo of successfulRepos) {
            const folderPath = `${workspaceRelPath}/${repo}`;
            const folderName = `[${name}] ${repo}`;
            const exists = vscodeContent.folders.some(
              (f) => f.path === folderPath || f.name === folderName
            );
            if (!exists) {
              const dotIndex = vscodeContent.folders.findIndex(
                (f) => f.path === "."
              );
              const insertIndex = dotIndex !== -1 ? dotIndex : vscodeContent.folders.length;
              vscodeContent.folders.splice(insertIndex, 0, {
                name: folderName,
                path: folderPath
              });
              added = true;
            }
          }
          if (added) {
            writeFileSync(vscodeFile, JSON.stringify(vscodeContent, null, 2) + "\n");
            console.log(chalk.green(`  \u2713 Added to VS Code workspace`));
          }
        }
      } catch (error) {
        console.log(chalk.yellow(`  \u26A0 Could not update VS Code workspace: ${error.message}`));
      }
      break;
    }
  }
  console.log();
  console.log(chalk.green.bold("\u2713 Workspace Ready!"));
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
import { execSync as execSync2 } from "child_process";
import { rmSync, existsSync as existsSync4, readFileSync as readFileSync4, writeFileSync as writeFileSync2 } from "fs";
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
  This will delete worktrees but preserve git branches.`
    });
    if (p2.isCancel(confirmed) || !confirmed) {
      p2.cancel("Cancelled");
      process.exit(0);
    }
  }
  console.log(chalk2.cyan(`Removing workspace: ${chalk2.bold(name)}`));
  if (config?.database?.container) {
    try {
      execSync2(`docker rm -f ${config.database.container}`, { stdio: "ignore" });
      console.log(chalk2.green("  \u2713 Database removed"));
    } catch {
    }
  }
  const repos = config?.repos || [];
  for (const repo of repos) {
    try {
      const mainRepoPath = getRepoPath(repo);
      const worktreeDir = join4(workspaceDir, repo);
      if (existsSync4(mainRepoPath)) {
        execSync2(`git worktree remove "${worktreeDir}" --force 2>/dev/null || true`, {
          cwd: mainRepoPath,
          stdio: "ignore"
        });
      }
    } catch {
    }
  }
  for (const repo of repos) {
    try {
      const mainRepoPath = getRepoPath(repo);
      if (existsSync4(mainRepoPath)) {
        execSync2("git worktree prune", { cwd: mainRepoPath, stdio: "ignore" });
      }
    } catch {
    }
  }
  const projectRoot = getProjectRoot();
  const vscodeWorkspaceFiles = [
    join4(projectRoot, "code-workspace.code-workspace"),
    join4(projectRoot, ".code-workspace"),
    join4(projectRoot, `${projectRoot.split("/").pop()}.code-workspace`)
  ];
  for (const vscodeFile of vscodeWorkspaceFiles) {
    if (existsSync4(vscodeFile)) {
      try {
        const vscodeContent = JSON.parse(readFileSync4(vscodeFile, "utf-8"));
        if (vscodeContent.folders && Array.isArray(vscodeContent.folders)) {
          const workspaceRelPath = workspaceDir.replace(projectRoot + "/", "");
          const originalLength = vscodeContent.folders.length;
          vscodeContent.folders = vscodeContent.folders.filter(
            (f) => {
              if (f.path?.startsWith(workspaceRelPath + "/")) return false;
              if (f.name?.startsWith(`[${name}]`)) return false;
              return true;
            }
          );
          if (vscodeContent.folders.length < originalLength) {
            writeFileSync2(vscodeFile, JSON.stringify(vscodeContent, null, 2) + "\n");
            console.log(chalk2.green("  \u2713 Removed from VS Code workspace"));
          }
        }
      } catch {
      }
      break;
    }
  }
  rmSync(workspaceDir, { recursive: true, force: true });
  console.log(chalk2.green(`\u2713 Workspace "${name}" removed`));
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
import { execa } from "execa";
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
      const { stdout } = await execa("docker", [
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
      await execa("lsof", ["-i", `:${port}`]);
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
import { execa as execa2 } from "execa";
import { spawn } from "child_process";
import { existsSync as existsSync5, mkdirSync as mkdirSync2, writeFileSync as writeFileSync3, openSync, watch } from "fs";
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
var runCommand = new Command5("run").description("Start all services for a workspace").argument("[name]", "Workspace name").argument("[services...]", "Specific services to run").option("--watch", "Watch for file changes and re-run pre_run on dependent services").action(async (name, services, options) => {
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
    try {
      const { stdout } = await execa2("docker", [
        "inspect",
        "-f",
        "{{.State.Running}}",
        wsConfig.database.container
      ]);
      if (stdout.trim() !== "true") {
        const dbSpinner = p4.spinner();
        dbSpinner.start("Starting database...");
        await execa2("docker", ["start", wsConfig.database.container]);
        dbSpinner.stop("Database started");
      } else {
        p4.log.success("Database already running");
      }
    } catch {
      p4.log.warn("Database not found - run 'hyve create' again");
    }
  }
  const cleanupSpinner = p4.spinner();
  cleanupSpinner.start("Cleaning up stale processes...");
  let killedCount = 0;
  try {
    const { stdout } = await execa2("pgrep", ["-f", workspaceDir]).catch(() => ({ stdout: "" }));
    const pids = stdout.trim().split("\n").filter(Boolean);
    for (const pid of pids) {
      try {
        await execa2("kill", ["-9", pid]);
        killedCount++;
      } catch {
      }
    }
  } catch {
  }
  if (killedCount > 0) {
    await new Promise((resolve) => setTimeout(resolve, 1e3));
  }
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
  for (const port of portsToClean) {
    try {
      const { stdout } = await execa2("lsof", ["-ti", `:${port}`]).catch(() => ({ stdout: "" }));
      const pids = stdout.trim().split("\n").filter(Boolean);
      for (const pid of pids) {
        await execa2("kill", ["-9", pid]).catch(() => {
        });
        killedCount++;
      }
    } catch {
    }
  }
  await new Promise((resolve) => setTimeout(resolve, 500));
  let finalKillCount = 0;
  for (const port of portsToClean) {
    try {
      const { stdout } = await execa2("lsof", ["-ti", `:${port}`]).catch(() => ({ stdout: "" }));
      const pids = stdout.trim().split("\n").filter(Boolean);
      for (const pid of pids) {
        await execa2("kill", ["-9", pid]).catch(() => {
        });
        finalKillCount++;
      }
    } catch {
    }
  }
  if (finalKillCount > 0) {
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  const totalKilled = killedCount + finalKillCount;
  cleanupSpinner.stop(totalKilled > 0 ? `Killed ${totalKilled} stale process(es)` : "No stale processes");
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
      const [firstUrl, ...restUrls] = openUrls;
      await execa2("open", ["-na", "Google Chrome", "--args", "--new-window", firstUrl]);
      await new Promise((resolve) => setTimeout(resolve, 500));
      for (const url of restUrls) {
        await execa2("open", ["-a", "Google Chrome", url]);
      }
    }
  }
  startupPhase = false;
  if (options.watch) {
    await startFileWatcher(name, config, workspaceDir, runningServices);
  } else {
    process.exit(0);
  }
});
async function waitForHealth(url, timeoutMs) {
  const start = Date.now();
  let attempts = 0;
  while (Date.now() - start < timeoutMs) {
    attempts++;
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(5e3) });
      if (response.ok) {
        return true;
      }
    } catch (err) {
      if (attempts % 10 === 1) {
        console.log(`  [health check] ${url} - attempt ${attempts}: ${err.message || "failed"}`);
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 1e3));
  }
  console.log(`  [health check] ${url} - timed out after ${attempts} attempts`);
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
  writeFileSync3(logFile, "");
  const spinner2 = p4.spinner();
  const deps = serviceConfig.depends_on || [];
  if (deps.length > 0) {
    for (const dep of deps) {
      const depConfig = config.services.definitions[dep];
      const depPort = runningServices.get(dep);
      if (depConfig?.health_check && depPort) {
        const healthUrl = depConfig.health_check.replace("${port}", String(depPort));
        spinner2.start(`Waiting for ${chalk5.cyan(dep)} to be healthy (up to 5 min)...`);
        const healthy = await waitForHealth(healthUrl, 3e5);
        if (healthy) {
          spinner2.stop(`${dep} is healthy`);
        } else {
          spinner2.stop(`${chalk5.red(dep)} health check failed - dependency not running`);
          return { name: repo, port, error: `Dependency ${dep} is not healthy` };
        }
      }
    }
  }
  if (serviceConfig.pre_run) {
    spinner2.start(`Running pre-run for ${chalk5.cyan(repo)}...`);
    try {
      let preRunCommand = serviceConfig.pre_run;
      const serverPort = runningServices.get("server");
      if (serverPort) {
        preRunCommand = preRunCommand.replace(/\$\{server_port\}/g, String(serverPort));
      }
      const preRunCmd = shellWrapper ? `${shellWrapper} ${preRunCommand}` : preRunCommand;
      await execa2("bash", ["-l", "-c", `cd '${serviceDir}' && ${preRunCmd}`], {
        cwd: serviceDir,
        timeout: 12e4,
        // 2 minute timeout for pre-run
        env: {
          ...process.env,
          PORT: String(port)
        }
      });
      spinner2.stop(`Pre-run complete for ${repo}`);
    } catch (error) {
      spinner2.stop(`Pre-run failed for ${repo}: ${error.shortMessage || error.message}`);
    }
  }
  spinner2.start(`Starting ${chalk5.cyan(repo)} on port ${chalk5.yellow(port)}...`);
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
      writeFileSync3(pidFile, String(child.pid));
      startupPids.push(child.pid);
    }
    await new Promise((resolve) => setTimeout(resolve, 2e3));
    try {
      process.kill(child.pid, 0);
      if (serviceConfig.health_check) {
        const healthUrl = serviceConfig.health_check.replace("${port}", String(port));
        spinner2.stop(`${chalk5.cyan(repo)} process started, waiting for health check...`);
        spinner2.start(`Waiting for ${chalk5.cyan(repo)} to be healthy (up to 5 min)...`);
        const healthy = await waitForHealth(healthUrl, 3e5);
        if (healthy) {
          spinner2.stop(`${chalk5.cyan(repo)} is healthy (PID ${child.pid})`);
          return { name: repo, port, pid: child.pid };
        } else {
          spinner2.stop(`${chalk5.red(repo)} health check failed`);
          return { name: repo, port, error: "Health check timeout" };
        }
      }
      spinner2.stop(`${chalk5.cyan(repo)} started (PID ${child.pid})`);
      return { name: repo, port, pid: child.pid };
    } catch {
      spinner2.stop(`${chalk5.red(repo)} failed to start`);
      return { name: repo, port, error: "Process exited" };
    }
  } catch (error) {
    spinner2.stop(`${chalk5.red(repo)} failed: ${error.message}`);
    return { name: repo, port, error: error.message };
  }
}
async function startFileWatcher(_workspaceName, config, workspaceDir, runningServices) {
  const serviceConfigs = config.services.definitions;
  const shellWrapper = config.services.shell_wrapper || "";
  const triggerServices = [];
  for (const [name, cfg] of Object.entries(serviceConfigs)) {
    if (cfg.watch_files && cfg.watch_files.length > 0) {
      const serviceDir = join5(workspaceDir, name);
      if (existsSync5(serviceDir)) {
        triggerServices.push({
          name,
          watchFiles: cfg.watch_files,
          dir: serviceDir
        });
      }
    }
  }
  if (triggerServices.length === 0) {
    p4.log.warn("No services have watch_files configured. Nothing to watch.");
    process.exit(0);
  }
  const dependentServices = [];
  for (const [name, cfg] of Object.entries(serviceConfigs)) {
    if (cfg.pre_run_deps && cfg.pre_run_deps.length > 0 && cfg.pre_run) {
      const serviceDir = join5(workspaceDir, name);
      if (existsSync5(serviceDir)) {
        dependentServices.push({
          name,
          preRun: cfg.pre_run,
          preRunDeps: cfg.pre_run_deps,
          dir: serviceDir
        });
      }
    }
  }
  if (dependentServices.length === 0) {
    p4.log.warn("No services have pre_run_deps configured. Nothing to trigger.");
    process.exit(0);
  }
  console.log();
  console.log(chalk5.dim("\u2500".repeat(50)));
  console.log();
  console.log(chalk5.bold.cyan("File Watcher Active"));
  console.log();
  for (const trigger of triggerServices) {
    console.log(`  ${chalk5.cyan(trigger.name)} watching:`);
    for (const pattern of trigger.watchFiles) {
      console.log(`    - ${pattern}`);
    }
  }
  console.log();
  console.log(chalk5.dim("  Will trigger pre_run on:"));
  for (const dep of dependentServices) {
    console.log(`    - ${dep.name} (deps: ${dep.preRunDeps.join(", ")})`);
  }
  console.log();
  console.log(chalk5.dim("  Press Ctrl+C to stop watching"));
  console.log();
  let lastRunTime = 0;
  const debounceMs = 2e3;
  let pendingRun = null;
  async function runPreRunForTrigger(triggerName, changedFile) {
    const now = Date.now();
    if (now - lastRunTime < debounceMs) {
      if (pendingRun) clearTimeout(pendingRun);
      pendingRun = setTimeout(() => runPreRunForTrigger(triggerName, changedFile), debounceMs);
      return;
    }
    lastRunTime = now;
    const timestamp = (/* @__PURE__ */ new Date()).toLocaleTimeString();
    console.log();
    console.log(chalk5.yellow(`[${timestamp}]`), `Change in ${chalk5.cyan(triggerName)}:`, changedFile);
    const toRun = dependentServices.filter((dep) => dep.preRunDeps.includes(triggerName));
    if (toRun.length === 0) {
      console.log(chalk5.dim("  No services depend on this trigger"));
      return;
    }
    const triggerConfig = serviceConfigs[triggerName];
    const triggerPort = runningServices.get(triggerName);
    if (triggerConfig?.health_check && triggerPort) {
      const healthUrl = triggerConfig.health_check.replace("${port}", String(triggerPort));
      process.stdout.write(`  ${chalk5.dim("Waiting for")} ${triggerName} ${chalk5.dim("to be healthy...")}`);
      const maxWaitMs = 3e5;
      const startTime = Date.now();
      let healthy = false;
      let dots = 0;
      while (Date.now() - startTime < maxWaitMs) {
        try {
          const response = await fetch(healthUrl, { signal: AbortSignal.timeout(3e3) });
          if (response.ok) {
            healthy = true;
            break;
          }
        } catch {
        }
        dots++;
        if (dots % 5 === 0) {
          process.stdout.write(".");
        }
        await new Promise((resolve) => setTimeout(resolve, 1e3));
      }
      if (!healthy) {
        console.log();
        console.log(`  ${chalk5.yellow("\u26A0")} ${triggerName} health check timed out after 5 minutes`);
        console.log(`  ${chalk5.dim("Skipping pre_run - service may still be starting")}`);
        return;
      } else {
        const elapsed = Math.round((Date.now() - startTime) / 1e3);
        console.log(` ${chalk5.green("\u2713")} ${chalk5.dim(`(${elapsed}s)`)}`);
      }
    }
    for (const dep of toRun) {
      console.log(`  ${chalk5.cyan("\u2192")} Running pre_run for ${chalk5.bold(dep.name)}...`);
      try {
        let preRunCmd = dep.preRun;
        const serverPort = runningServices.get("server");
        if (serverPort) {
          preRunCmd = preRunCmd.replace(/\$\{server_port\}/g, String(serverPort));
        }
        const fullCmd = shellWrapper ? `${shellWrapper} ${preRunCmd}` : preRunCmd;
        await execa2("bash", ["-l", "-c", `cd '${dep.dir}' && ${fullCmd}`], {
          cwd: dep.dir,
          timeout: 12e4,
          env: process.env
        });
        console.log(`  ${chalk5.green("\u2713")} ${dep.name} complete`);
      } catch (error) {
        console.log(`  ${chalk5.red("\u2717")} ${dep.name} failed:`, error.shortMessage || error.message);
      }
    }
    console.log();
    console.log(chalk5.dim(`[${timestamp}] Watching for changes...`));
  }
  for (const trigger of triggerServices) {
    try {
      const chokidar = await import("chokidar");
      const watcher = chokidar.watch(trigger.watchFiles, {
        cwd: trigger.dir,
        ignoreInitial: true,
        ignored: ["**/node_modules/**", "**/.git/**", "**/dist/**", "**/build/**"]
      });
      watcher.on("change", (path) => {
        runPreRunForTrigger(trigger.name, path);
      });
      watcher.on("add", (path) => {
        runPreRunForTrigger(trigger.name, path);
      });
      p4.log.success(`Watching ${trigger.name} with chokidar`);
    } catch {
      p4.log.warn(`chokidar not available, using basic fs.watch for ${trigger.name}`);
      watch(trigger.dir, { recursive: true }, (_eventType, filename) => {
        if (!filename) return;
        const matches = trigger.watchFiles.some((pattern) => {
          if (pattern.includes("**")) {
            const regex = new RegExp(
              pattern.replace(/\*\*/g, ".*").replace(/\*/g, "[^/]*").replace(/\//g, "\\/")
            );
            return regex.test(filename);
          }
          return filename.includes(pattern.replace(/\*/g, ""));
        });
        if (matches) {
          runPreRunForTrigger(trigger.name, filename);
        }
      });
    }
  }
  await new Promise(() => {
  });
}

// src/commands/halt.ts
import { Command as Command6 } from "commander";
import * as p5 from "@clack/prompts";
import chalk6 from "chalk";
import { execSync as execSync3 } from "child_process";
import { existsSync as existsSync6, readFileSync as readFileSync5, rmSync as rmSync2 } from "fs";
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
  const config = loadConfig();
  const wsConfig = getWorkspaceConfig(name);
  const workspaceDir = getWorkspaceDir(name);
  const logsDir = join6(workspaceDir, ".hyve", "logs");
  const workspaceIndex = getWorkspaceIndex(name);
  console.log(chalk6.cyan(`Stopping services for ${chalk6.bold(name)}`));
  const repos = wsConfig?.repos || [];
  for (const repo of repos) {
    const pidFile = join6(logsDir, `${repo}.pid`);
    let stopped = false;
    if (existsSync6(pidFile)) {
      try {
        const pid = parseInt(readFileSync5(pidFile, "utf-8").trim());
        try {
          process.kill(-pid, "SIGTERM");
          stopped = true;
        } catch {
          try {
            process.kill(pid, "SIGTERM");
            stopped = true;
          } catch {
          }
        }
        try {
          execSync3(`pkill -P ${pid}`, { stdio: "ignore" });
        } catch {
        }
        rmSync2(pidFile);
      } catch {
        rmSync2(pidFile, { force: true });
      }
    }
    const serviceConfig = config.services.definitions[repo];
    if (serviceConfig) {
      const port = calculateServicePort(
        repo,
        serviceConfig.default_port,
        config.services.base_port,
        workspaceIndex,
        config.services.port_offset
      );
      try {
        const { stdout } = { stdout: execSync3(`lsof -ti :${port}`, { encoding: "utf-8", stdio: ["pipe", "pipe", "ignore"] }) };
        const pids = stdout.trim().split("\n").filter(Boolean);
        for (const pid of pids) {
          try {
            execSync3(`kill -9 ${pid}`, { stdio: "ignore" });
            stopped = true;
          } catch {
          }
        }
      } catch {
      }
    }
    if (stopped) {
      console.log(chalk6.green(`  \u2713 ${repo} stopped`));
    } else {
      console.log(chalk6.dim(`  - ${repo} not running`));
    }
  }
  console.log(chalk6.green("\u2713 All services stopped"));
});

// src/commands/db.ts
import { Command as Command7 } from "commander";
import * as p6 from "@clack/prompts";
import chalk7 from "chalk";
import { spawnSync } from "child_process";
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
  spawnSync(
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
var logo = `
${chalk8.red(`            \u2584\u2584\u2584\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2584\u2584\u2584
         \u2584\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2584
       \u2584\u2588\u2588\u2588\u2588`)}${chalk8.black(`\u2580\u2580\u2580`)}${chalk8.red(`\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588`)}${chalk8.black(`\u2580\u2580\u2580`)}${chalk8.red(`\u2588\u2588\u2588\u2588\u2584
      \u2588\u2588\u2588\u2588`)}${chalk8.black(`\u2580`)}${chalk8.red(`\u2588\u2588\u2588`)}${chalk8.black(`\u2580`)}${chalk8.red(`\u2588\u2588\u2588\u2588\u2588\u2588`)}${chalk8.black(`\u2580`)}${chalk8.red(`\u2588\u2588\u2588`)}${chalk8.black(`\u2580`)}${chalk8.red(`\u2588\u2588\u2588\u2588
     \u2588\u2588\u2588\u2588`)}${chalk8.black(`\u2580`)}${chalk8.red(`\u2588\u2588\u2588\u2588`)}${chalk8.black(`\u2580\u2580`)}${chalk8.red(`\u2588\u2588\u2588\u2588`)}${chalk8.black(`\u2580\u2580`)}${chalk8.red(`\u2588\u2588\u2588\u2588`)}${chalk8.black(`\u2580`)}${chalk8.red(`\u2588\u2588\u2588\u2588
    \u2588\u2588\u2588\u2588`)}${chalk8.black(`\u2580`)}${chalk8.red(`\u2588\u2588\u2588\u2588\u2588\u2588`)}${chalk8.black(`\u2580\u2584\u2588\u2588\u2584\u2580`)}${chalk8.red(`\u2588\u2588\u2588\u2588\u2588\u2588`)}${chalk8.black(`\u2580`)}${chalk8.red(`\u2588\u2588\u2588\u2588
   \u2580\u2588\u2588\u2588\u2588`)}${chalk8.black(`\u2580`)}${chalk8.red(`\u2588\u2588\u2588\u2588\u2588\u2588\u2588`)}${chalk8.black(`\u2580\u2588\u2588\u2580`)}${chalk8.red(`\u2588\u2588\u2588\u2588\u2588\u2588\u2588`)}${chalk8.black(`\u2580`)}${chalk8.red(`\u2588\u2588\u2588\u2588\u2580
    \u2580\u2588\u2588\u2588\u2588\u2588`)}${chalk8.black(`\u2580`)}${chalk8.red(`\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588`)}${chalk8.black(`\u2580`)}${chalk8.red(`\u2588\u2588\u2588\u2588\u2588\u2580
     \u2580\u2588\u2588\u2588\u2588\u2588\u2588`)}${chalk8.black(`\u2580\u2580`)}${chalk8.red(`\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588`)}${chalk8.black(`\u2580\u2580`)}${chalk8.red(`\u2588\u2588\u2588\u2588\u2588\u2588\u2580
       \u2580\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2580
         \u2580\u2580\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2580\u2580`)}
${chalk8.white.bold(`
    \u2588\u2588\u2557  \u2588\u2588\u2557\u2588\u2588\u2557   \u2588\u2588\u2557\u2588\u2588\u2557   \u2588\u2588\u2557\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2557
    \u2588\u2588\u2551  \u2588\u2588\u2551\u255A\u2588\u2588\u2557 \u2588\u2588\u2554\u255D\u2588\u2588\u2551   \u2588\u2588\u2551\u2588\u2588\u2554\u2550\u2550\u2550\u2550\u255D
    \u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2551 \u255A\u2588\u2588\u2588\u2588\u2554\u255D \u2588\u2588\u2551   \u2588\u2588\u2551\u2588\u2588\u2588\u2588\u2588\u2557
    \u2588\u2588\u2554\u2550\u2550\u2588\u2588\u2551  \u255A\u2588\u2588\u2554\u255D  \u255A\u2588\u2588\u2557 \u2588\u2588\u2554\u255D\u2588\u2588\u2554\u2550\u2550\u255D
    \u2588\u2588\u2551  \u2588\u2588\u2551   \u2588\u2588\u2551    \u255A\u2588\u2588\u2588\u2588\u2554\u255D \u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2557
    \u255A\u2550\u255D  \u255A\u2550\u255D   \u255A\u2550\u255D     \u255A\u2550\u2550\u2550\u255D  \u255A\u2550\u2550\u2550\u2550\u2550\u2550\u255D`)}
`;
var program = new Command8();
program.name("hyve").description("Autonomous Multi-Repo Agent Workspaces").version(VERSION).addCommand(createCommand).addCommand(cleanupCommand).addCommand(listCommand).addCommand(statusCommand).addCommand(runCommand).addCommand(haltCommand).addCommand(dbCommand);
program.hook("preAction", () => {
  console.log(chalk8.red("\u2B21") + " " + chalk8.white.bold("hyve"));
  console.log();
});
program.parse();
