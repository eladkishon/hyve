#!/usr/bin/env node
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __esm = (fn, res) => function __init() {
  return fn && (res = (0, fn[__getOwnPropNames(fn)[0]])(fn = 0)), res;
};
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

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
var cachedConfig, cachedConfigPath;
var init_config = __esm({
  "src/config.ts"() {
    "use strict";
    cachedConfig = null;
    cachedConfigPath = null;
  }
});

// src/utils.ts
var utils_exports = {};
__export(utils_exports, {
  calculateServicePort: () => calculateServicePort,
  getWorkspaceConfig: () => getWorkspaceConfig,
  getWorkspaceIndex: () => getWorkspaceIndex,
  listWorkspaces: () => listWorkspaces,
  sanitizeBranchName: () => sanitizeBranchName,
  workspaceExists: () => workspaceExists
});
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
var init_utils = __esm({
  "src/utils.ts"() {
    "use strict";
    init_config();
  }
});

// src/index.ts
import { Command as Command13 } from "commander";
import chalk13 from "chalk";

// src/commands/create.ts
init_config();
init_utils();
import { Command } from "commander";
import * as p from "@clack/prompts";
import chalk from "chalk";
import { execSync } from "child_process";
import { existsSync as existsSync3, mkdirSync, writeFileSync, readFileSync as readFileSync3, copyFileSync } from "fs";
import { join as join3 } from "path";
function generateClaudeMd(name, branch, repos, dbPort, servicePorts, workspaceDir) {
  const lines = [];
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
  lines.push("2. **Order** changes correctly: backend/API first \u2192 schema/types \u2192 frontend");
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
  console.log(chalk.dim("Pruning stale worktrees..."));
  for (const repo of allRepos) {
    try {
      const repoPath = getRepoPath(repo);
      if (existsSync3(repoPath)) {
        execSync("git worktree prune", { cwd: repoPath, stdio: "ignore" });
      }
    } catch {
    }
  }
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
      try {
        if (branchExists || options.from) {
          execSync(`git worktree add "${worktreeDir}" "${branchName}" 2>&1`, {
            cwd: repoPath,
            encoding: "utf-8"
          });
        } else {
          execSync(`git worktree add -b "${branchName}" "${worktreeDir}" "${baseBranch}" 2>&1`, {
            cwd: repoPath,
            encoding: "utf-8"
          });
        }
      } catch (wtError) {
        const output = wtError.stdout || wtError.stderr || wtError.message || "";
        if (output.includes("already checked out") || output.includes("is already being used")) {
          try {
            execSync("git worktree prune", { cwd: repoPath, stdio: "ignore" });
            execSync(`git worktree add --force "${worktreeDir}" "${branchName}" 2>&1`, {
              cwd: repoPath,
              encoding: "utf-8"
            });
          } catch (retryError) {
            const retryOutput = retryError.stdout || retryError.stderr || "";
            throw new Error(retryOutput.split("\n").filter(Boolean).pop() || "Branch in use elsewhere");
          }
        } else if (output.includes("already exists")) {
          throw new Error(`Worktree path already exists`);
        } else {
          const errorLine = output.split("\n").filter((l) => l.trim() && !l.includes("Preparing")).pop();
          throw new Error(errorLine || output.slice(0, 100) || "git worktree failed");
        }
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
    console.log(chalk.dim("Installing dependencies..."));
    const shellWrapper = config.services.shell_wrapper || "";
    for (const repo of successfulRepos) {
      const worktreeDir = join3(workspaceDir, repo);
      const packageJson = join3(worktreeDir, "package.json");
      if (!existsSync3(packageJson)) continue;
      const installCmd = shellWrapper ? `${shellWrapper} pnpm install --prefer-offline` : "pnpm install --prefer-offline";
      try {
        execSync(`bash -l -c 'cd "${worktreeDir}" && ${installCmd}'`, {
          cwd: worktreeDir,
          stdio: "pipe",
          // Suppress output for cleaner logs
          timeout: 6e5
          // 10 minute timeout
        });
        console.log(chalk.green(`  \u2713 ${repo} dependencies installed`));
      } catch (error) {
        console.log(chalk.yellow(`  \u26A0 ${repo} dependencies failed`));
      }
    }
    const reposWithSetupScripts = successfulRepos.filter((repo) => {
      const repoConfig = config.repos[repo];
      return repoConfig?.setup_script && repoConfig.setup_script !== "pnpm install";
    });
    if (reposWithSetupScripts.length > 0) {
      console.log(chalk.dim("Running setup scripts..."));
      for (const repo of reposWithSetupScripts) {
        const repoConfig = config.repos[repo];
        const worktreeDir = join3(workspaceDir, repo);
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
        const shellWrapper = config.services.shell_wrapper || "";
        let seedCommand = config.database.seed_command.replace(/\$\{port\}/g, String(dbPort));
        if (shellWrapper) {
          seedCommand = `${shellWrapper} ${seedCommand}`;
        }
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
            const exists = vscodeContent.folders.some(
              (f) => f.path === folderPath
            );
            if (!exists) {
              vscodeContent.folders.push({
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
  console.log(chalk.dim("Generating CLAUDE.md..."));
  const servicePorts = {};
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
  writeFileSync(join3(workspaceDir, "CLAUDE.md"), claudeMd);
  console.log(chalk.green(`  \u2713 CLAUDE.md generated`));
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
init_config();
init_utils();
import { Command as Command2 } from "commander";
import * as p2 from "@clack/prompts";
import chalk2 from "chalk";
import { execSync as execSync2 } from "child_process";
import { rmSync, existsSync as existsSync4, readFileSync as readFileSync4, writeFileSync as writeFileSync2 } from "fs";
import { join as join4 } from "path";
var cleanupCommand = new Command2("remove").alias("cleanup").alias("rm").description("Remove a workspace").argument("[name]", "Workspace name").option("-f, --force", "Skip confirmation").action(async (name, options) => {
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
  console.log(chalk2.dim("  Removing worktrees..."));
  for (const repo of repos) {
    try {
      const mainRepoPath = getRepoPath(repo);
      const worktreeDir = join4(workspaceDir, repo);
      if (existsSync4(mainRepoPath)) {
        execSync2(`git worktree remove "${worktreeDir}" --force 2>/dev/null || true`, {
          cwd: mainRepoPath,
          stdio: "ignore"
        });
        console.log(chalk2.green(`    \u2713 ${repo}`));
      }
    } catch {
      console.log(chalk2.yellow(`    \u26A0 ${repo} (may not exist)`));
    }
  }
  console.log(chalk2.dim("  Pruning git worktrees..."));
  for (const repo of repos) {
    try {
      const mainRepoPath = getRepoPath(repo);
      if (existsSync4(mainRepoPath)) {
        execSync2("git worktree prune", { cwd: mainRepoPath, stdio: "ignore" });
      }
    } catch {
    }
  }
  console.log(chalk2.green("  \u2713 Worktrees pruned"));
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
          const featureId = name.match(/^([a-z]+-\d+)/i)?.[1]?.toUpperCase() || name.slice(0, 12).toUpperCase();
          const originalLength = vscodeContent.folders.length;
          vscodeContent.folders = vscodeContent.folders.filter(
            (f) => {
              if (f.path?.startsWith(workspaceRelPath + "/")) return false;
              if (f.name?.startsWith(`[${featureId}]`)) return false;
              if (f.name?.includes(`[${featureId}]`)) return false;
              if (f.name?.includes(`\u2B21 ${featureId}`)) return false;
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
  console.log(chalk2.dim("  Removing workspace directory..."));
  rmSync(workspaceDir, { recursive: true, force: true });
  console.log(chalk2.green("  \u2713 Directory removed"));
  console.log();
  console.log(chalk2.green.bold(`\u2713 Workspace "${name}" removed`));
  console.log(chalk2.dim("  Git branches preserved in main repos"));
});

// src/commands/list.ts
init_utils();
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
init_config();
init_utils();
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
init_config();
init_utils();
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
      const serverConfig = config.services.definitions["server"];
      if (serverConfig) {
        const serverPort = calculateServicePort(
          "server",
          serverConfig.default_port,
          config.services.base_port,
          workspaceIndex,
          config.services.port_offset
        );
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
async function startFileWatcher(workspaceName, config, workspaceDir, runningServices) {
  const serviceConfigs = config.services.definitions;
  const shellWrapper = config.services.shell_wrapper || "";
  const workspaceIndex = getWorkspaceIndex(workspaceName);
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
        const serverConfig = config.services.definitions["server"];
        if (serverConfig) {
          const serverPort = calculateServicePort(
            "server",
            serverConfig.default_port,
            config.services.base_port,
            workspaceIndex,
            config.services.port_offset
          );
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
init_config();
init_utils();
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
init_config();
init_utils();
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

// src/commands/install-commands.ts
init_config();
import { Command as Command8 } from "commander";
import chalk8 from "chalk";
import { existsSync as existsSync7, mkdirSync as mkdirSync3, copyFileSync as copyFileSync2, readdirSync as readdirSync2 } from "fs";
import { join as join7, dirname as dirname2 } from "path";
import { fileURLToPath } from "url";
var __filename = fileURLToPath(import.meta.url);
var __dirname = dirname2(__filename);
var installCommandsCommand = new Command8("install-commands").description("Install Claude Code slash commands").action(async () => {
  const projectRoot = getProjectRoot();
  const claudeDir = join7(projectRoot, ".claude", "commands");
  const hyveRoot = join7(__dirname, "..", "..", "..");
  const commandsSource = join7(hyveRoot, "commands");
  if (!existsSync7(commandsSource)) {
    console.error(chalk8.red("Commands source directory not found"));
    console.error(chalk8.dim(`Expected: ${commandsSource}`));
    process.exit(1);
  }
  if (!existsSync7(claudeDir)) {
    mkdirSync3(claudeDir, { recursive: true });
    console.log(chalk8.dim(`Created ${claudeDir}`));
  }
  const files = readdirSync2(commandsSource).filter((f) => f.endsWith(".md"));
  if (files.length === 0) {
    console.error(chalk8.yellow("No command files found to install"));
    process.exit(0);
  }
  console.log(chalk8.dim("Installing Claude Code commands..."));
  for (const file of files) {
    const source = join7(commandsSource, file);
    const dest = join7(claudeDir, file);
    copyFileSync2(source, dest);
    const commandName = file.replace(".md", "");
    console.log(chalk8.green(`  \u2713 /${commandName}`));
  }
  console.log();
  console.log(chalk8.green.bold("Commands installed!"));
  console.log();
  console.log(chalk8.dim("Available commands:"));
  for (const file of files) {
    const commandName = file.replace(".md", "");
    console.log(chalk8.cyan(`  /${commandName}`));
  }
  console.log();
  console.log(chalk8.dim("Usage in Claude Code: Type the command name, e.g., /hyve-create my-feature"));
});

// src/commands/agent.ts
init_config();
import { Command as Command9 } from "commander";
import chalk9 from "chalk";
import { existsSync as existsSync8, readFileSync as readFileSync6, writeFileSync as writeFileSync4, mkdirSync as mkdirSync4 } from "fs";
import { join as join8 } from "path";
function getAgentFile() {
  const projectRoot = getProjectRoot();
  return join8(projectRoot, ".hyve", "agents.json");
}
function loadAgents() {
  const file = getAgentFile();
  if (!existsSync8(file)) {
    return [];
  }
  try {
    return JSON.parse(readFileSync6(file, "utf-8"));
  } catch {
    return [];
  }
}
function saveAgents(agents) {
  const file = getAgentFile();
  const dir = join8(getProjectRoot(), ".hyve");
  if (!existsSync8(dir)) {
    mkdirSync4(dir, { recursive: true });
  }
  writeFileSync4(file, JSON.stringify(agents, null, 2));
}
function generateId() {
  return Math.random().toString(36).substring(2, 10);
}
var agentCommand = new Command9("agent").description("Manage agent sessions on workspaces").addCommand(
  new Command9("start").description("Register an agent session on a workspace").argument("<workspace>", "Workspace name").option("-d, --description <desc>", "Description of what the agent is working on").action((workspace, options) => {
    const workspaceDir = getWorkspaceDir(workspace);
    if (!existsSync8(workspaceDir)) {
      console.error(chalk9.red(`Workspace not found: ${workspace}`));
      process.exit(1);
    }
    const agents = loadAgents();
    const session = {
      id: generateId(),
      workspace,
      started: (/* @__PURE__ */ new Date()).toISOString(),
      description: options.description,
      pid: process.ppid
      // Parent process (likely the agent)
    };
    agents.push(session);
    saveAgents(agents);
    console.log(chalk9.green(`Agent session started: ${session.id}`));
    console.log(chalk9.dim(`  Workspace: ${workspace}`));
    if (options.description) {
      console.log(chalk9.dim(`  Task: ${options.description}`));
    }
  })
).addCommand(
  new Command9("stop").description("End an agent session").argument("<id>", "Session ID").action((id) => {
    const agents = loadAgents();
    const index = agents.findIndex((a) => a.id === id);
    if (index === -1) {
      console.error(chalk9.red(`Session not found: ${id}`));
      process.exit(1);
    }
    const session = agents[index];
    agents.splice(index, 1);
    saveAgents(agents);
    console.log(chalk9.green(`Agent session ended: ${id}`));
    console.log(chalk9.dim(`  Workspace: ${session.workspace}`));
  })
).addCommand(
  new Command9("list").description("List active agent sessions").action(() => {
    const agents = loadAgents();
    if (agents.length === 0) {
      console.log(chalk9.dim("No active agent sessions"));
      return;
    }
    console.log(chalk9.bold("Active Agent Sessions"));
    console.log();
    for (const agent of agents) {
      const duration = timeSince(new Date(agent.started));
      console.log(
        chalk9.cyan(`  ${agent.id}`) + chalk9.dim(` \u2192 `) + chalk9.white(agent.workspace) + chalk9.dim(` (${duration})`)
      );
      if (agent.description) {
        console.log(chalk9.dim(`    ${agent.description}`));
      }
    }
  })
).addCommand(
  new Command9("clean").description("Remove stale agent sessions").action(() => {
    const agents = loadAgents();
    const active = [];
    let removed = 0;
    for (const agent of agents) {
      if (agent.pid) {
        try {
          process.kill(agent.pid, 0);
          active.push(agent);
        } catch {
          removed++;
        }
      } else {
        const age = Date.now() - new Date(agent.started).getTime();
        if (age < 24 * 60 * 60 * 1e3) {
          active.push(agent);
        } else {
          removed++;
        }
      }
    }
    saveAgents(active);
    console.log(chalk9.green(`Cleaned ${removed} stale session(s)`));
    console.log(chalk9.dim(`${active.length} active session(s) remaining`));
  })
);
function timeSince(date) {
  const seconds = Math.floor((Date.now() - date.getTime()) / 1e3);
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h`;
  return `${Math.floor(seconds / 86400)}d`;
}

// src/commands/attach.ts
init_config();
init_utils();
import { Command as Command10 } from "commander";
import * as p7 from "@clack/prompts";
import chalk10 from "chalk";
import { execSync as execSync4 } from "child_process";
import { existsSync as existsSync9, writeFileSync as writeFileSync5, readFileSync as readFileSync7, copyFileSync as copyFileSync3 } from "fs";
import { join as join9 } from "path";
var attachCommand = new Command10("attach").description("Attach a new repo/service to an existing workspace").argument("[workspace]", "Workspace name").argument("[repos...]", "Repos to attach").option("--no-setup", "Skip running setup scripts").action(async (workspaceName, repos, options) => {
  const config = loadConfig();
  const workspaces = listWorkspaces();
  if (workspaces.length === 0) {
    console.error(chalk10.red("No workspaces found"));
    console.log(chalk10.dim("Run 'hyve create <name>' to create a workspace first"));
    process.exit(1);
  }
  if (!workspaceName) {
    const result = await p7.select({
      message: "Select workspace to attach to:",
      options: workspaces.map((ws) => ({ value: ws, label: ws }))
    });
    if (p7.isCancel(result)) {
      p7.cancel("Cancelled");
      process.exit(0);
    }
    workspaceName = result;
  }
  if (!workspaceExists(workspaceName)) {
    console.error(chalk10.red(`Workspace not found: ${workspaceName}`));
    console.log(chalk10.dim("Run 'hyve list' to see available workspaces"));
    process.exit(1);
  }
  const wsConfig = getWorkspaceConfig(workspaceName);
  if (!wsConfig) {
    console.error(chalk10.red(`Workspace config not found: ${workspaceName}`));
    process.exit(1);
  }
  if (repos.length === 0) {
    const availableRepos = Object.keys(config.repos).filter(
      (r) => !wsConfig.repos.includes(r)
    );
    if (availableRepos.length === 0) {
      console.log(chalk10.yellow("All configured repos are already attached to this workspace"));
      process.exit(0);
    }
    const result = await p7.multiselect({
      message: "Select repos to attach:",
      options: availableRepos.map((r) => ({
        value: r,
        label: r,
        hint: config.repos[r].path
      }))
    });
    if (p7.isCancel(result)) {
      p7.cancel("Cancelled");
      process.exit(0);
    }
    repos = result;
  }
  for (const repo of repos) {
    if (!config.repos[repo]) {
      console.error(chalk10.red(`Unknown repo: ${repo}`));
      console.log(chalk10.dim("Available repos:"), Object.keys(config.repos).join(", "));
      process.exit(1);
    }
    if (wsConfig.repos.includes(repo)) {
      console.error(chalk10.red(`Repo already attached: ${repo}`));
      process.exit(1);
    }
  }
  const workspaceDir = getWorkspaceDir(workspaceName);
  const branchName = wsConfig.branch;
  const workspaceIndex = getWorkspaceIndex(workspaceName);
  const dbPort = wsConfig.database?.enabled ? wsConfig.database.port : void 0;
  console.log(chalk10.cyan(`Attaching to workspace: ${chalk10.bold(workspaceName)}`));
  console.log(chalk10.dim("Creating git worktrees..."));
  const successfulRepos = [];
  for (const repo of repos) {
    try {
      const repoPath = getRepoPath(repo);
      const worktreeDir = join9(workspaceDir, repo);
      let baseBranch = config.branches.base;
      try {
        const stdout = execSync4("git symbolic-ref refs/remotes/origin/HEAD", {
          cwd: repoPath,
          encoding: "utf-8",
          stdio: ["pipe", "pipe", "ignore"]
        });
        baseBranch = stdout.replace("refs/remotes/origin/", "").trim();
      } catch {
        for (const branch of ["main", "master"]) {
          try {
            execSync4(`git show-ref --verify refs/heads/${branch}`, {
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
        execSync4(`git fetch origin ${baseBranch}`, { cwd: repoPath, stdio: "ignore" });
      } catch {
      }
      let branchExists = false;
      try {
        execSync4(`git show-ref --verify refs/heads/${branchName}`, {
          cwd: repoPath,
          stdio: "ignore"
        });
        branchExists = true;
      } catch {
      }
      if (!branchExists) {
        try {
          execSync4(`git show-ref --verify refs/remotes/origin/${branchName}`, {
            cwd: repoPath,
            stdio: "ignore"
          });
          branchExists = true;
        } catch {
        }
      }
      if (branchExists) {
        execSync4(`git worktree add "${worktreeDir}" "${branchName}"`, {
          cwd: repoPath,
          stdio: "ignore"
        });
      } else {
        execSync4(`git worktree add -b "${branchName}" "${worktreeDir}" "${baseBranch}"`, {
          cwd: repoPath,
          stdio: "ignore"
        });
      }
      console.log(chalk10.green(`  \u2713 ${repo}`) + chalk10.dim(` \u2192 ${branchName}`));
      successfulRepos.push(repo);
    } catch (error) {
      console.log(chalk10.red(`  \u2717 ${repo}`) + chalk10.dim(` - ${error.message}`));
    }
  }
  if (successfulRepos.length === 0) {
    console.error(chalk10.red("No repos attached"));
    process.exit(1);
  }
  if (options.setup !== false) {
    console.log(chalk10.dim("Running setup scripts..."));
    for (const repo of successfulRepos) {
      const repoConfig = config.repos[repo];
      if (!repoConfig?.setup_script) continue;
      const worktreeDir = join9(workspaceDir, repo);
      const shellWrapper = config.services.shell_wrapper || "";
      const command = shellWrapper ? `${shellWrapper} ${repoConfig.setup_script}` : repoConfig.setup_script;
      try {
        execSync4(`bash -l -c 'cd "${worktreeDir}" && ${command}'`, {
          cwd: worktreeDir,
          stdio: "inherit",
          timeout: 6e5
        });
        console.log(chalk10.green(`  \u2713 ${repo} setup complete`));
      } catch (error) {
        console.log(chalk10.yellow(`  \u26A0 ${repo} setup failed`));
      }
    }
  }
  console.log(chalk10.dim("Generating .env files..."));
  for (const repo of successfulRepos) {
    const worktreeDir = join9(workspaceDir, repo);
    const mainRepoPath = getRepoPath(repo);
    const envFile = join9(worktreeDir, ".env");
    const mainEnvFile = join9(mainRepoPath, ".env");
    const envExample = join9(worktreeDir, ".env.example");
    if (existsSync9(mainEnvFile)) {
      copyFileSync3(mainEnvFile, envFile);
    } else if (existsSync9(envExample)) {
      copyFileSync3(envExample, envFile);
    } else {
      writeFileSync5(envFile, "");
    }
    let envContent = readFileSync7(envFile, "utf-8");
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
      envContent += `# Workspace: ${workspaceName}
`;
    }
    writeFileSync5(envFile, envContent);
  }
  const updatedRepos = [...wsConfig.repos, ...successfulRepos];
  const updatedConfig = {
    ...wsConfig,
    repos: updatedRepos
  };
  writeFileSync5(
    join9(workspaceDir, ".hyve-workspace.json"),
    JSON.stringify(updatedConfig, null, 2)
  );
  console.log(chalk10.dim("Updating CLAUDE.md..."));
  const claudeMdPath = join9(workspaceDir, "CLAUDE.md");
  if (existsSync9(claudeMdPath)) {
    let claudeMd = readFileSync7(claudeMdPath, "utf-8");
    claudeMd = claudeMd.replace(
      /^- \*\*Repos:\*\* .*/m,
      `- **Repos:** ${updatedRepos.join(", ")}`
    );
    writeFileSync5(claudeMdPath, claudeMd);
  }
  console.log();
  console.log(chalk10.green.bold("\u2713 Repos Attached!"));
  console.log();
  console.log(chalk10.dim("  Attached:"), successfulRepos.join(", "));
  console.log(chalk10.dim("  Workspace:"), workspaceDir);
  console.log();
});

// src/commands/work.ts
init_config();
init_utils();
import { Command as Command11 } from "commander";
import chalk11 from "chalk";
import { execSync as execSync5, spawnSync as spawnSync2 } from "child_process";
import { existsSync as existsSync10, readFileSync as readFileSync8, writeFileSync as writeFileSync6, mkdirSync as mkdirSync5, rmSync as rmSync3 } from "fs";
import { join as join10 } from "path";

// src/prompts/meta-agent.ts
function buildMetaAgentPrompt(config) {
  const repoList = config.repos.map((r) => `  - ${r}: ${config.workspaceDir}/${r}`).join("\n");
  return `# Hyve Meta-Agent: Workspace Orchestrator

You are the **orchestrator** for Hyve workspace: \`${config.workspaceName}\`

## Your Role

You coordinate work across multiple repositories. You can:
1. **Analyze** the task and determine which repos need changes
2. **Spawn sub-agents** to work on individual repos in parallel
3. **Coordinate** changes that span multiple repos (API changes, schema updates, etc.)
4. **Track status** of all work being done
5. **Checkpoint** before any commits - get user approval

## Workspace Info

- **Workspace:** ${config.workspaceName}
- **Branch:** ${config.branch}
- **Location:** ${config.workspaceDir}
${config.dbPort ? `- **Database:** localhost:${config.dbPort}` : ""}

## Repositories

${repoList}

## Task

${config.task}

## Orchestration Protocol

### Phase 1: Analysis
1. Read the task carefully
2. Explore relevant code in each repo to understand the scope
3. Determine which repos need changes
4. Identify dependencies between repos (e.g., backend API \u2192 frontend consumer)

### Phase 2: Planning
1. Break down the task by repo
2. Identify the correct order of changes:
   - Backend/API changes first
   - Schema/type generation
   - Frontend/consumer changes after
3. Present your plan to the user for approval

### Phase 3: Execution
For each repo that needs work, you can either:

**Option A: Work directly** (for small changes)
- Make changes yourself in the repo directory

**Option B: Spawn sub-agent** (for complex repo-specific work)
Use the Task tool to spawn a sub-agent:
\`\`\`
Task tool with:
- subagent_type: "general-purpose"
- prompt: "Work in repo X on task Y..."
- run_in_background: true (if parallel work is safe)
\`\`\`

### Phase 4: Coordination
1. After backend changes, regenerate types/schemas if needed
2. Ensure frontend changes use updated types
3. Run tests in each repo
4. Coordinate commit messages across repos

### Phase 5: Checkpoint
Before ANY commits:
1. Summarize all changes per repo
2. Show files modified
3. Show test results
4. Propose commit messages
5. **WAIT for user approval**

## Status Tracking

Report status regularly:
\`\`\`
\u{1F4CA} Workspace Status: ${config.workspaceName}
\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501
[repo-name]     \u2713 Complete / \u23F3 In Progress / \u23F8 Waiting
  \u2514\u2500 Brief description of status
\`\`\`

## Cross-Repo Coordination Rules

1. **API Changes**: Always update backend first, then run codegen, then update consumers
2. **Database Changes**: Run migrations before dependent code changes
3. **Shared Types**: Update source of truth, regenerate, then update consumers
4. **Breaking Changes**: Coordinate version bumps across repos

## Commands Available

- \`hyve status ${config.workspaceName}\` - Check workspace status
- \`hyve run ${config.workspaceName}\` - Start services
- \`hyve halt ${config.workspaceName}\` - Stop services

## Important

- You are the coordinator - maintain awareness of ALL repos
- Don't let sub-agents commit without your approval
- Always checkpoint before commits
- Keep the user informed of progress
`;
}

// src/commands/work.ts
var workCommand = new Command11("work").description("Start working on a feature - creates workspace, starts services, launches Claude").argument("<name>", "Feature name (spaces become dashes)").argument("[task...]", "Task description for the agent").option("--no-run", "Don't start services").option("--no-agent", "Don't launch Claude Code agent").action(async (name, taskParts, options) => {
  const workspaceName = sanitizeBranchName(name);
  const task = taskParts.join(" ");
  console.log(chalk11.dim(`Feature: "${name}"`));
  console.log(chalk11.dim(`Workspace: ${workspaceName}`));
  if (task) {
    console.log(chalk11.dim(`Task: "${task}"`));
  }
  console.log();
  const workspaceDir = getWorkspaceDir(workspaceName);
  if (!workspaceExists(workspaceName)) {
    console.log(chalk11.yellow(`Workspace doesn't exist. Creating...`));
    console.log();
    try {
      execSync5(`hyve create "${workspaceName}"`, {
        stdio: "inherit"
      });
    } catch (error) {
      console.error(chalk11.red(`Failed to create workspace: ${error.message}`));
      process.exit(1);
    }
    if (!workspaceExists(workspaceName)) {
      console.error(chalk11.red(`Workspace creation failed - directory not found`));
      process.exit(1);
    }
  } else {
    const existingConfig = getWorkspaceConfig(workspaceName);
    if (!existingConfig) {
      console.log(chalk11.yellow(`Invalid workspace detected (missing config). Auto-cleaning...`));
      try {
        execSync5(`hyve cleanup "${workspaceName}" --force`, { stdio: "pipe" });
      } catch {
        rmSync3(workspaceDir, { recursive: true, force: true });
      }
      console.log(chalk11.dim(`Removed invalid workspace. Creating fresh...`));
      console.log();
      try {
        execSync5(`hyve create "${workspaceName}"`, {
          stdio: "inherit"
        });
      } catch (error) {
        console.error(chalk11.red(`Failed to create workspace: ${error.message}`));
        process.exit(1);
      }
    } else {
      console.log(chalk11.green(`\u2713 Using existing workspace: ${workspaceName}`));
    }
  }
  const config = getWorkspaceConfig(workspaceName);
  if (!config) {
    console.error(chalk11.red(`Failed to create valid workspace`));
    process.exit(1);
  }
  console.log();
  console.log(chalk11.dim("Branch: ") + config.branch);
  console.log(chalk11.dim("Repos:  ") + config.repos.join(", "));
  if (config.database?.enabled) {
    console.log(chalk11.dim("DB:     ") + `localhost:${config.database.port}`);
  }
  const missingRepos = config.repos.filter((repo) => !existsSync10(join10(workspaceDir, repo)));
  if (missingRepos.length > 0) {
    console.error(chalk11.red(`
Missing repos: ${missingRepos.join(", ")}`));
    console.log(chalk11.dim(`The workspace is incomplete. Try: hyve remove ${workspaceName} && hyve create ${workspaceName}`));
    process.exit(1);
  }
  if (options.run !== false) {
    console.log();
    console.log(chalk11.dim("Starting services..."));
    try {
      execSync5(`hyve run "${workspaceName}"`, {
        stdio: "inherit"
      });
    } catch (error) {
      console.log(chalk11.yellow(`Services may already be running or failed to start`));
    }
  }
  if (options.agent !== false && task) {
    console.log();
    console.log(chalk11.cyan.bold("Launching Claude Code Meta-Agent..."));
    console.log();
    let servicePorts = {};
    try {
      const hyveConfig = loadConfig();
      const workspaceIndex = (init_utils(), __toCommonJS(utils_exports)).getWorkspaceIndex(workspaceName);
      for (const [serviceName, serviceConfig] of Object.entries(hyveConfig.services.definitions)) {
        servicePorts[serviceName] = calculateServicePort(
          serviceName,
          serviceConfig.default_port,
          hyveConfig.services.base_port,
          workspaceIndex,
          hyveConfig.services.port_offset
        );
      }
    } catch {
    }
    const prompt = buildMetaAgentPrompt({
      workspaceName,
      workspaceDir,
      branch: config?.branch || "feature/" + workspaceName,
      repos: config?.repos || [],
      task,
      dbPort: config?.database?.enabled ? config.database.port : void 0,
      servicePorts
    });
    const promptFile = join10(workspaceDir, ".hyve", "current-task.md");
    const hyveDir = join10(workspaceDir, ".hyve");
    if (!existsSync10(hyveDir)) {
      mkdirSync5(hyveDir, { recursive: true });
    }
    writeFileSync6(promptFile, prompt);
    try {
      console.log(chalk11.dim(`Task saved to: ${promptFile}`));
      console.log();
      const claudeMdPath = join10(workspaceDir, "CLAUDE.md");
      let existingClaudeMd = "";
      if (existsSync10(claudeMdPath)) {
        existingClaudeMd = readFileSync8(claudeMdPath, "utf-8");
      }
      if (existingClaudeMd.includes("## Current Task")) {
        existingClaudeMd = existingClaudeMd.replace(
          /## Current Task\n\n[\s\S]*?(?=\n##|$)/,
          `## Current Task

${task}
`
        );
        writeFileSync6(claudeMdPath, existingClaudeMd);
      } else {
        const taskSection = `
## Current Task

${task}
`;
        writeFileSync6(claudeMdPath, existingClaudeMd + taskSection);
      }
      console.log(chalk11.cyan.bold("Launching Claude Code..."));
      console.log();
      process.on("SIGINT", () => {
      });
      process.on("SIGTERM", () => {
      });
      const result = spawnSync2("claude", [task], {
        cwd: workspaceDir,
        stdio: "inherit"
      });
      if (result.error) {
        console.error(chalk11.red(`Failed to launch Claude: ${result.error.message}`));
        console.log(chalk11.dim("Make sure Claude Code CLI is installed: npm install -g @anthropic-ai/claude-code"));
      }
    } catch (error) {
      console.error(chalk11.red(`Failed to launch Claude: ${error.message}`));
    }
  } else if (!task) {
    console.log();
    console.log(chalk11.green.bold("Workspace ready!"));
    console.log();
    console.log(chalk11.dim("Workspace: ") + workspaceDir);
    console.log();
    console.log(chalk11.dim("To start working with Claude:"));
    console.log(chalk11.cyan(`  cd ${workspaceDir}`));
    console.log(chalk11.cyan(`  claude`));
    console.log();
    console.log(chalk11.dim("Or run with a task:"));
    console.log(chalk11.cyan(`  hyve work "${name}" "Your task description here"`));
    console.log();
  }
});

// src/commands/dashboard.ts
init_config();
init_utils();
import { Command as Command12 } from "commander";
import chalk12 from "chalk";
import { existsSync as existsSync11, readFileSync as readFileSync9 } from "fs";
import { join as join11 } from "path";
import { execSync as execSync6 } from "child_process";
function getAgentFile2() {
  const projectRoot = getProjectRoot();
  return join11(projectRoot, ".hyve", "agents.json");
}
function loadAgents2() {
  const file = getAgentFile2();
  if (!existsSync11(file)) {
    return [];
  }
  try {
    return JSON.parse(readFileSync9(file, "utf-8"));
  } catch {
    return [];
  }
}
function isProcessRunning(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}
function timeSince2(date) {
  const seconds = Math.floor((Date.now() - date.getTime()) / 1e3);
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h`;
  return `${Math.floor(seconds / 86400)}d`;
}
function getGitStatus(repoDir) {
  try {
    const status = execSync6("git status --porcelain", {
      cwd: repoDir,
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "ignore"]
    });
    const lines = status.trim().split("\n").filter(Boolean);
    let modified = 0, staged = 0, untracked = 0;
    for (const line of lines) {
      if (line.startsWith("??")) untracked++;
      else if (line.startsWith(" M") || line.startsWith(" D")) modified++;
      else if (line.startsWith("M") || line.startsWith("A") || line.startsWith("D")) staged++;
    }
    return { modified, staged, untracked };
  } catch {
    return { modified: 0, staged: 0, untracked: 0 };
  }
}
var dashboardCommand = new Command12("dashboard").alias("dash").description("Show overview of all workspaces and agent activity").option("-w, --workspace <name>", "Show detailed view for specific workspace").action((options) => {
  if (options.workspace) {
    showWorkspaceDetail(options.workspace);
  } else {
    showOverview();
  }
});
function showOverview() {
  const workspaces = listWorkspaces();
  const agents = loadAgents2();
  console.log();
  console.log(chalk12.red("\u2B21") + chalk12.bold(" Hyve Dashboard"));
  console.log(chalk12.dim("\u2501".repeat(60)));
  console.log();
  if (workspaces.length === 0) {
    console.log(chalk12.dim("  No active workspaces"));
    console.log();
    console.log(chalk12.dim('  Create one with: hyve work "Feature Name" "Task description"'));
    return;
  }
  for (const ws of workspaces) {
    const config = getWorkspaceConfig(ws);
    const wsAgents = agents.filter((a) => a.workspace === ws);
    const workspaceDir = getWorkspaceDir(ws);
    const taskFile = join11(workspaceDir, ".hyve", "current-task.md");
    const hasActiveTask = existsSync11(taskFile);
    let statusIcon = chalk12.green("\u25CF");
    let statusText = "idle";
    if (wsAgents.some((a) => a.pid && isProcessRunning(a.pid))) {
      statusIcon = chalk12.cyan("\u25C9");
      statusText = "agent active";
    } else if (hasActiveTask) {
      statusIcon = chalk12.yellow("\u25CB");
      statusText = "task pending";
    }
    console.log(`${statusIcon} ${chalk12.bold(ws)} ${chalk12.dim(`(${statusText})`)}`);
    if (config) {
      console.log(chalk12.dim(`  Branch: ${config.branch}`));
      console.log(chalk12.dim(`  Repos:  ${config.repos.join(", ")}`));
      for (const repo of config.repos) {
        const repoDir = join11(workspaceDir, repo);
        if (existsSync11(repoDir)) {
          const git = getGitStatus(repoDir);
          const changes = [];
          if (git.staged > 0) changes.push(chalk12.green(`+${git.staged}`));
          if (git.modified > 0) changes.push(chalk12.yellow(`~${git.modified}`));
          if (git.untracked > 0) changes.push(chalk12.dim(`?${git.untracked}`));
          if (changes.length > 0) {
            console.log(chalk12.dim(`    ${repo}: `) + changes.join(" "));
          }
        }
      }
    }
    for (const agent of wsAgents) {
      const running = agent.pid && isProcessRunning(agent.pid);
      const icon = running ? chalk12.cyan("\u21B3") : chalk12.dim("\u21B3");
      const duration = timeSince2(new Date(agent.started));
      console.log(`  ${icon} Agent ${agent.id} ${chalk12.dim(`(${duration})`)}${agent.repo ? chalk12.dim(` \u2192 ${agent.repo}`) : ""}`);
      if (agent.description) {
        console.log(chalk12.dim(`      ${agent.description.slice(0, 50)}...`));
      }
    }
    console.log();
  }
  console.log(chalk12.dim("\u2501".repeat(60)));
  console.log(chalk12.dim("  hyve dashboard -w <name>  ") + "Detailed workspace view");
  console.log(chalk12.dim('  hyve work "Name" "Task"   ') + "Start new work");
  console.log();
}
function showWorkspaceDetail(name) {
  const workspaceDir = getWorkspaceDir(name);
  if (!existsSync11(workspaceDir)) {
    console.error(chalk12.red(`Workspace not found: ${name}`));
    process.exit(1);
  }
  const config = getWorkspaceConfig(name);
  const agents = loadAgents2().filter((a) => a.workspace === name);
  console.log();
  console.log(chalk12.red("\u2B21") + chalk12.bold(` Workspace: ${name}`));
  console.log(chalk12.dim("\u2501".repeat(60)));
  console.log();
  if (config) {
    console.log(chalk12.dim("Branch:   ") + config.branch);
    console.log(chalk12.dim("Created:  ") + new Date(config.created).toLocaleString());
    console.log(chalk12.dim("Location: ") + workspaceDir);
    if (config.database?.enabled) {
      console.log(chalk12.dim("Database: ") + `localhost:${config.database.port}`);
    }
    console.log();
    console.log(chalk12.bold("Repositories"));
    console.log();
    for (const repo of config.repos) {
      const repoDir = join11(workspaceDir, repo);
      console.log(`  ${chalk12.cyan("\u25A0")} ${chalk12.bold(repo)}`);
      console.log(chalk12.dim(`    ${repoDir}`));
      if (existsSync11(repoDir)) {
        const git = getGitStatus(repoDir);
        console.log(chalk12.dim("    Git: ") + chalk12.green(`${git.staged} staged`) + ", " + chalk12.yellow(`${git.modified} modified`) + ", " + chalk12.dim(`${git.untracked} untracked`));
      }
      console.log();
    }
  }
  const taskFile = join11(workspaceDir, ".hyve", "current-task.md");
  if (existsSync11(taskFile)) {
    console.log(chalk12.bold("Current Task"));
    console.log();
    const taskContent = readFileSync9(taskFile, "utf-8");
    const taskMatch = taskContent.match(/## Task\n\n([^\n]+)/);
    if (taskMatch) {
      console.log(chalk12.dim("  ") + taskMatch[1]);
    }
    console.log();
  }
  if (agents.length > 0) {
    console.log(chalk12.bold("Agent Activity"));
    console.log();
    for (const agent of agents) {
      const running = agent.pid && isProcessRunning(agent.pid);
      const icon = running ? chalk12.green("\u25CF") : chalk12.dim("\u25CB");
      const status = running ? chalk12.green("running") : chalk12.dim("stopped");
      const duration = timeSince2(new Date(agent.started));
      console.log(`  ${icon} ${agent.id} ${chalk12.dim(`(${status}, ${duration})`)}`);
      if (agent.repo) {
        console.log(chalk12.dim(`    Repo: ${agent.repo}`));
      }
      if (agent.description) {
        console.log(chalk12.dim(`    Task: ${agent.description}`));
      }
      console.log();
    }
  }
  console.log(chalk12.dim("\u2501".repeat(60)));
  console.log(chalk12.dim("  hyve run " + name + "     ") + "Start services");
  console.log(chalk12.dim("  hyve halt " + name + "    ") + "Stop services");
  console.log(chalk12.dim("  hyve cleanup " + name + " ") + "Remove workspace");
  console.log();
}

// src/index.ts
var VERSION = "2.0.0";
var logo = `
${chalk13.red(`            \u2584\u2584\u2584\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2584\u2584\u2584
         \u2584\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2584
       \u2584\u2588\u2588\u2588\u2588`)}${chalk13.black(`\u2580\u2580\u2580`)}${chalk13.red(`\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588`)}${chalk13.black(`\u2580\u2580\u2580`)}${chalk13.red(`\u2588\u2588\u2588\u2588\u2584
      \u2588\u2588\u2588\u2588`)}${chalk13.black(`\u2580`)}${chalk13.red(`\u2588\u2588\u2588`)}${chalk13.black(`\u2580`)}${chalk13.red(`\u2588\u2588\u2588\u2588\u2588\u2588`)}${chalk13.black(`\u2580`)}${chalk13.red(`\u2588\u2588\u2588`)}${chalk13.black(`\u2580`)}${chalk13.red(`\u2588\u2588\u2588\u2588
     \u2588\u2588\u2588\u2588`)}${chalk13.black(`\u2580`)}${chalk13.red(`\u2588\u2588\u2588\u2588`)}${chalk13.black(`\u2580\u2580`)}${chalk13.red(`\u2588\u2588\u2588\u2588`)}${chalk13.black(`\u2580\u2580`)}${chalk13.red(`\u2588\u2588\u2588\u2588`)}${chalk13.black(`\u2580`)}${chalk13.red(`\u2588\u2588\u2588\u2588
    \u2588\u2588\u2588\u2588`)}${chalk13.black(`\u2580`)}${chalk13.red(`\u2588\u2588\u2588\u2588\u2588\u2588`)}${chalk13.black(`\u2580\u2584\u2588\u2588\u2584\u2580`)}${chalk13.red(`\u2588\u2588\u2588\u2588\u2588\u2588`)}${chalk13.black(`\u2580`)}${chalk13.red(`\u2588\u2588\u2588\u2588
   \u2580\u2588\u2588\u2588\u2588`)}${chalk13.black(`\u2580`)}${chalk13.red(`\u2588\u2588\u2588\u2588\u2588\u2588\u2588`)}${chalk13.black(`\u2580\u2588\u2588\u2580`)}${chalk13.red(`\u2588\u2588\u2588\u2588\u2588\u2588\u2588`)}${chalk13.black(`\u2580`)}${chalk13.red(`\u2588\u2588\u2588\u2588\u2580
    \u2580\u2588\u2588\u2588\u2588\u2588`)}${chalk13.black(`\u2580`)}${chalk13.red(`\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588`)}${chalk13.black(`\u2580`)}${chalk13.red(`\u2588\u2588\u2588\u2588\u2588\u2580
     \u2580\u2588\u2588\u2588\u2588\u2588\u2588`)}${chalk13.black(`\u2580\u2580`)}${chalk13.red(`\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588`)}${chalk13.black(`\u2580\u2580`)}${chalk13.red(`\u2588\u2588\u2588\u2588\u2588\u2588\u2580
       \u2580\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2580
         \u2580\u2580\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2580\u2580`)}
${chalk13.white.bold(`
    \u2588\u2588\u2557  \u2588\u2588\u2557\u2588\u2588\u2557   \u2588\u2588\u2557\u2588\u2588\u2557   \u2588\u2588\u2557\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2557
    \u2588\u2588\u2551  \u2588\u2588\u2551\u255A\u2588\u2588\u2557 \u2588\u2588\u2554\u255D\u2588\u2588\u2551   \u2588\u2588\u2551\u2588\u2588\u2554\u2550\u2550\u2550\u2550\u255D
    \u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2551 \u255A\u2588\u2588\u2588\u2588\u2554\u255D \u2588\u2588\u2551   \u2588\u2588\u2551\u2588\u2588\u2588\u2588\u2588\u2557
    \u2588\u2588\u2554\u2550\u2550\u2588\u2588\u2551  \u255A\u2588\u2588\u2554\u255D  \u255A\u2588\u2588\u2557 \u2588\u2588\u2554\u255D\u2588\u2588\u2554\u2550\u2550\u255D
    \u2588\u2588\u2551  \u2588\u2588\u2551   \u2588\u2588\u2551    \u255A\u2588\u2588\u2588\u2588\u2554\u255D \u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2557
    \u255A\u2550\u255D  \u255A\u2550\u255D   \u255A\u2550\u255D     \u255A\u2550\u2550\u2550\u255D  \u255A\u2550\u2550\u2550\u2550\u2550\u2550\u255D`)}
`;
var program = new Command13();
program.name("hyve").description("Autonomous Multi-Repo Agent Workspaces").version(VERSION).addCommand(workCommand).addCommand(dashboardCommand).addCommand(createCommand).addCommand(attachCommand).addCommand(cleanupCommand).addCommand(listCommand).addCommand(statusCommand).addCommand(runCommand).addCommand(haltCommand).addCommand(dbCommand).addCommand(installCommandsCommand).addCommand(agentCommand);
program.hook("preAction", () => {
  console.log(chalk13.red("\u2B21") + " " + chalk13.white.bold("hyve"));
  console.log();
});
program.parse();
