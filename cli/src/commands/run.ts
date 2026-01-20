import { Command } from "commander";
import * as p from "@clack/prompts";
import chalk from "chalk";
import { execa } from "execa";
import { spawn } from "child_process";
import { existsSync, mkdirSync, writeFileSync, openSync, watch } from "fs";
import { join } from "path";
import { loadConfig, getWorkspaceDir } from "../config.js";
import {
  listWorkspaces,
  workspaceExists,
  getWorkspaceConfig,
  calculateServicePort,
  getWorkspaceIndex,
} from "../utils.js";

interface ServiceInfo {
  name: string;
  port: number;
  pid?: number;
  error?: string;
}

// Track spawned PIDs only during startup phase for Ctrl+C cleanup
let startupPhase = true;
const startupPids: number[] = [];

// Handle Ctrl+C during startup - kill processes that didn't fully start
function setupSignalHandlers() {
  const cleanup = () => {
    if (startupPhase) {
      console.log("\n\nStartup interrupted, stopping services...");
      for (const pid of startupPids) {
        try {
          process.kill(-pid, "SIGTERM"); // Kill process group
        } catch {
          try {
            process.kill(pid, "SIGTERM");
          } catch {}
        }
      }
    }
    process.exit(0);
  };

  process.on("SIGINT", cleanup);
  process.on("SIGTERM", cleanup);
}

export const runCommand = new Command("run")
  .description("Start all services for a workspace")
  .argument("[name]", "Workspace name")
  .argument("[services...]", "Specific services to run")
  .option("--watch", "Watch for file changes and re-run pre_run on dependent services")
  .action(async (name: string | undefined, services: string[], options: { watch?: boolean }) => {
    setupSignalHandlers();
    const workspaces = listWorkspaces();

    if (workspaces.length === 0) {
      p.log.error("No workspaces found");
      process.exit(1);
    }

    // Interactive selection if no name provided
    if (!name) {
      const result = await p.select({
        message: "Select workspace to run:",
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

    const config = loadConfig();
    const wsConfig = getWorkspaceConfig(name);
    const workspaceDir = getWorkspaceDir(name);
    const workspaceIndex = getWorkspaceIndex(name);

    // Get repos to run
    const allRepos = services.length > 0 ? services : wsConfig?.repos || [];

    p.intro(chalk.cyan(`Starting services for ${chalk.bold(name)}`));

    // Ensure logs directory exists
    const logsDir = join(workspaceDir, ".hyve", "logs");
    mkdirSync(logsDir, { recursive: true });

    // Start database if configured
    if (wsConfig?.database?.container) {
      const dbSpinner = p.spinner();
      dbSpinner.start("Starting database...");
      try {
        const { stdout } = await execa("docker", [
          "inspect",
          "-f",
          "{{.State.Running}}",
          wsConfig.database.container,
        ]);
        if (stdout.trim() !== "true") {
          await execa("docker", ["start", wsConfig.database.container]);
        }
        dbSpinner.stop("Database running");
      } catch {
        dbSpinner.stop("Database not found - run 'hyve create' again");
      }
    }

    // Kill any processes on default ports (cleanup stale processes)
    const cleanupSpinner = p.spinner();
    cleanupSpinner.start("Cleaning up stale processes...");
    const portsToClean = new Set<number>();
    for (const repo of allRepos) {
      const svcConfig = config.services.definitions[repo];
      if (svcConfig) {
        // Add both default port and workspace port
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
        const { stdout } = await execa("lsof", ["-ti", `:${port}`]);
        const pids = stdout.trim().split("\n").filter(Boolean);
        for (const pid of pids) {
          try {
            await execa("kill", ["-9", pid]);
            killedCount++;
          } catch {}
        }
      } catch {
        // No process on this port
      }
    }
    cleanupSpinner.stop(killedCount > 0 ? `Killed ${killedCount} stale process(es)` : "No stale processes");

    // Build dependency graph and determine start order
    const serviceConfigs = config.services.definitions;
    const startOrder = topologicalSort(allRepos, serviceConfigs);

    p.log.info(`Start order: ${startOrder.join(" → ")}`);

    // Group services by dependency level
    const levels = groupByDependencyLevel(startOrder, serviceConfigs);
    const serviceResults: ServiceInfo[] = [];
    const runningServices = new Map<string, number>(); // name -> port

    // Start services level by level
    for (const level of levels) {
      // Start all services in this level in parallel
      const levelResults = await Promise.all(
        level.map((repo) => startService(repo, {
          config,
          workspaceDir,
          workspaceIndex,
          logsDir,
          runningServices,
        }))
      );

      // Check results and update running services
      for (const result of levelResults) {
        serviceResults.push(result);
        if (result.pid) {
          runningServices.set(result.name, result.port);
        }
      }

      // If any service in this level failed and others depend on it, warn
      const failedServices = levelResults.filter((r) => !r.pid).map((r) => r.name);
      if (failedServices.length > 0) {
        const dependents = startOrder.filter((s) => {
          const deps = serviceConfigs[s]?.depends_on || [];
          return deps.some((d) => failedServices.includes(d));
        });
        if (dependents.length > 0) {
          p.log.warn(`Services depending on failed services may not work: ${dependents.join(", ")}`);
        }
      }

      // Wait a bit between levels to let services start
      if (level !== levels[levels.length - 1]) {
        await new Promise((resolve) => setTimeout(resolve, 3000));
      }
    }

    // Summary
    console.log();
    console.log(chalk.dim("─".repeat(50)));
    console.log();
    console.log(chalk.bold.green("Services Running"));
    console.log();

    for (const result of serviceResults) {
      if (result.pid) {
        console.log(`  ${chalk.cyan(result.name)}  →  http://localhost:${result.port}`);
      } else {
        console.log(`  ${chalk.red(result.name)}  →  ${result.error}`);
      }
    }

    console.log();
    console.log(chalk.dim("  Logs:"), logsDir);
    console.log(chalk.dim("  Stop:"), `hyve halt ${name}`);
    console.log();

    // Open browsers
    const frontends = ["webapp", "rn-platform-website", "mobile"];
    const openUrls: string[] = [];
    for (const result of serviceResults) {
      if (result.pid && frontends.includes(result.name)) {
        openUrls.push(`http://localhost:${result.port}`);
      }
    }

    if (openUrls.length > 0) {
      const shouldOpen = await p.confirm({
        message: `Open ${openUrls.length} browser tab(s)?`,
        initialValue: true,
      });

      if (!p.isCancel(shouldOpen) && shouldOpen) {
        for (const url of openUrls) {
          await execa("open", [url]);
        }
      }
    }

    // Mark startup complete - Ctrl+C after this won't kill services
    startupPhase = false;

    // Start file watcher if --watch flag is set
    if (options.watch) {
      await startFileWatcher(name!, config, workspaceDir, runningServices);
      // File watcher runs indefinitely, don't exit
    } else {
      // Exit cleanly - services continue running in background
      process.exit(0);
    }
  });

// Wait for a health check URL to respond
async function waitForHealth(url: string, timeoutMs: number): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(2000) });
      if (response.ok) {
        return true;
      }
    } catch {
      // Ignore errors, keep trying
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  return false;
}

// Topological sort for dependency order
function topologicalSort(
  repos: string[],
  serviceConfigs: Record<string, { depends_on?: string[] }>
): string[] {
  const visited = new Set<string>();
  const result: string[] = [];
  const repoSet = new Set(repos);

  function visit(repo: string) {
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

// Group services by dependency level (services with same level can start together)
function groupByDependencyLevel(
  sortedRepos: string[],
  serviceConfigs: Record<string, { depends_on?: string[] }>
): string[][] {
  const levels: string[][] = [];
  const assigned = new Set<string>();

  while (assigned.size < sortedRepos.length) {
    const level: string[] = [];
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

// Start a single service
async function startService(
  repo: string,
  ctx: {
    config: ReturnType<typeof loadConfig>;
    workspaceDir: string;
    workspaceIndex: number;
    logsDir: string;
    runningServices: Map<string, number>;
  }
): Promise<ServiceInfo> {
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

  const serviceDir = join(workspaceDir, repo);
  if (!existsSync(serviceDir)) {
    return { name: repo, port, error: "Directory not found" };
  }

  const logFile = join(logsDir, `${repo}.log`);
  const pidFile = join(logsDir, `${repo}.pid`);
  const shellWrapper = config.services.shell_wrapper || "";

  const spinner = p.spinner();

  // Wait for dependencies to be healthy before pre_run
  const deps = serviceConfig.depends_on || [];
  if (deps.length > 0) {
    for (const dep of deps) {
      const depConfig = config.services.definitions[dep];
      const depPort = runningServices.get(dep);
      if (depConfig?.health_check && depPort) {
        const healthUrl = depConfig.health_check.replace("${port}", String(depPort));
        spinner.start(`Waiting for ${chalk.cyan(dep)} to be healthy...`);
        const healthy = await waitForHealth(healthUrl, 30000);
        if (healthy) {
          spinner.stop(`${dep} is healthy`);
        } else {
          spinner.stop(`${dep} health check timed out (continuing anyway)`);
        }
      }
    }
  }

  // Run pre_run hook if defined
  if (serviceConfig.pre_run) {
    spinner.start(`Running pre-run for ${chalk.cyan(repo)}...`);
    try {
      // Replace ${server_port} with actual server port from running services
      let preRunCommand = serviceConfig.pre_run;
      const serverPort = runningServices.get("server");
      if (serverPort) {
        preRunCommand = preRunCommand.replace(/\$\{server_port\}/g, String(serverPort));
      }

      const preRunCmd = shellWrapper
        ? `${shellWrapper} ${preRunCommand}`
        : preRunCommand;

      await execa("bash", ["-l", "-c", `cd '${serviceDir}' && ${preRunCmd}`], {
        cwd: serviceDir,
        timeout: 120000, // 2 minute timeout for pre-run
        env: {
          ...process.env,
          PORT: String(port),
        },
      });
      spinner.stop(`Pre-run complete for ${repo}`);
    } catch (error: any) {
      spinner.stop(`Pre-run failed for ${repo}: ${error.shortMessage || error.message}`);
      // Continue anyway, pre-run failure shouldn't block startup
    }
  }

  spinner.start(`Starting ${chalk.cyan(repo)} on port ${chalk.yellow(port)}...`);

  try {
    let devCommand = serviceConfig.dev_command || "pnpm dev";
    // Replace ${port} placeholder with actual port
    devCommand = devCommand.replace(/\$\{port\}/g, String(port));
    const command = shellWrapper ? `${shellWrapper} ${devCommand}` : devCommand;

    // Open log file for writing
    const logFd = openSync(logFile, "a");

    // Start process in background using nohup for proper detachment
    // nohup ensures process survives terminal closure
    const child = spawn("nohup", ["bash", "-l", "-c", `cd '${serviceDir}' && ${command}`], {
      detached: true,
      stdio: ["ignore", logFd, logFd],
      env: {
        ...process.env,
        PORT: String(port),
      },
    });

    // Unref to allow parent to exit without killing children
    child.unref();

    // Save PID and track for cleanup during startup
    if (child.pid) {
      writeFileSync(pidFile, String(child.pid));
      startupPids.push(child.pid);
    }

    // Wait and check if still running
    await new Promise((resolve) => setTimeout(resolve, 2000));

    try {
      process.kill(child.pid!, 0);
      spinner.stop(`${chalk.cyan(repo)} started (PID ${child.pid})`);
      return { name: repo, port, pid: child.pid };
    } catch {
      spinner.stop(`${chalk.red(repo)} failed to start`);
      return { name: repo, port, error: "Process exited" };
    }
  } catch (error: any) {
    spinner.stop(`${chalk.red(repo)} failed: ${error.message}`);
    return { name: repo, port, error: error.message };
  }
}

// File watcher for --watch mode
async function startFileWatcher(
  _workspaceName: string,
  config: ReturnType<typeof loadConfig>,
  workspaceDir: string,
  runningServices: Map<string, number>
) {
  const serviceConfigs = config.services.definitions;
  const shellWrapper = config.services.shell_wrapper || "";

  // Find services with watch_files config (trigger services)
  const triggerServices: Array<{
    name: string;
    watchFiles: string[];
    dir: string;
  }> = [];

  for (const [name, cfg] of Object.entries(serviceConfigs)) {
    if (cfg.watch_files && cfg.watch_files.length > 0) {
      const serviceDir = join(workspaceDir, name);
      if (existsSync(serviceDir)) {
        triggerServices.push({
          name,
          watchFiles: cfg.watch_files,
          dir: serviceDir,
        });
      }
    }
  }

  if (triggerServices.length === 0) {
    p.log.warn("No services have watch_files configured. Nothing to watch.");
    process.exit(0);
  }

  // Find services with pre_run_deps (dependent services)
  const dependentServices: Array<{
    name: string;
    preRun: string;
    preRunDeps: string[];
    dir: string;
  }> = [];

  for (const [name, cfg] of Object.entries(serviceConfigs)) {
    if (cfg.pre_run_deps && cfg.pre_run_deps.length > 0 && cfg.pre_run) {
      const serviceDir = join(workspaceDir, name);
      if (existsSync(serviceDir)) {
        dependentServices.push({
          name,
          preRun: cfg.pre_run,
          preRunDeps: cfg.pre_run_deps,
          dir: serviceDir,
        });
      }
    }
  }

  if (dependentServices.length === 0) {
    p.log.warn("No services have pre_run_deps configured. Nothing to trigger.");
    process.exit(0);
  }

  console.log();
  console.log(chalk.dim("─".repeat(50)));
  console.log();
  console.log(chalk.bold.cyan("File Watcher Active"));
  console.log();

  for (const trigger of triggerServices) {
    console.log(`  ${chalk.cyan(trigger.name)} watching:`);
    for (const pattern of trigger.watchFiles) {
      console.log(`    - ${pattern}`);
    }
  }

  console.log();
  console.log(chalk.dim("  Will trigger pre_run on:"));
  for (const dep of dependentServices) {
    console.log(`    - ${dep.name} (deps: ${dep.preRunDeps.join(", ")})`);
  }

  console.log();
  console.log(chalk.dim("  Press Ctrl+C to stop watching"));
  console.log();

  // Track last run time to debounce
  let lastRunTime = 0;
  const debounceMs = 2000;
  let pendingRun: NodeJS.Timeout | null = null;

  // Function to run pre_run on dependent services
  async function runPreRunForTrigger(triggerName: string, changedFile: string) {
    const now = Date.now();
    if (now - lastRunTime < debounceMs) {
      // Debounce - schedule for later
      if (pendingRun) clearTimeout(pendingRun);
      pendingRun = setTimeout(() => runPreRunForTrigger(triggerName, changedFile), debounceMs);
      return;
    }
    lastRunTime = now;

    const timestamp = new Date().toLocaleTimeString();
    console.log();
    console.log(chalk.yellow(`[${timestamp}]`), `Change in ${chalk.cyan(triggerName)}:`, changedFile);

    // Find dependent services that depend on this trigger
    const toRun = dependentServices.filter((dep) => dep.preRunDeps.includes(triggerName));

    if (toRun.length === 0) {
      console.log(chalk.dim("  No services depend on this trigger"));
      return;
    }

    // Wait for the trigger service to be healthy before running pre_run
    const triggerConfig = serviceConfigs[triggerName];
    const triggerPort = runningServices.get(triggerName);
    if (triggerConfig?.health_check && triggerPort) {
      const healthUrl = triggerConfig.health_check.replace("${port}", String(triggerPort));
      process.stdout.write(`  ${chalk.dim("Waiting for")} ${triggerName} ${chalk.dim("to be healthy...")}`);

      const maxWaitMs = 300000; // 5 minutes - server rebuild can take time
      const startTime = Date.now();
      let healthy = false;
      let dots = 0;

      while (Date.now() - startTime < maxWaitMs) {
        try {
          const response = await fetch(healthUrl, { signal: AbortSignal.timeout(3000) });
          if (response.ok) {
            healthy = true;
            break;
          }
        } catch {
          // Keep trying
        }
        // Show progress dots
        dots++;
        if (dots % 5 === 0) {
          process.stdout.write(".");
        }
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }

      if (!healthy) {
        console.log();
        console.log(`  ${chalk.yellow("⚠")} ${triggerName} health check timed out after 5 minutes`);
        console.log(`  ${chalk.dim("Skipping pre_run - service may still be starting")}`);
        return; // Don't run pre_run if service isn't healthy
      } else {
        const elapsed = Math.round((Date.now() - startTime) / 1000);
        console.log(` ${chalk.green("✓")} ${chalk.dim(`(${elapsed}s)`)}`);
      }
    }

    for (const dep of toRun) {
      console.log(`  ${chalk.cyan("→")} Running pre_run for ${chalk.bold(dep.name)}...`);

      try {
        // Replace ${server_port} with actual port
        let preRunCmd = dep.preRun;
        const serverPort = runningServices.get("server");
        if (serverPort) {
          preRunCmd = preRunCmd.replace(/\$\{server_port\}/g, String(serverPort));
        }

        const fullCmd = shellWrapper ? `${shellWrapper} ${preRunCmd}` : preRunCmd;

        await execa("bash", ["-l", "-c", `cd '${dep.dir}' && ${fullCmd}`], {
          cwd: dep.dir,
          timeout: 120000,
          env: process.env,
        });

        console.log(`  ${chalk.green("✓")} ${dep.name} complete`);
      } catch (error: any) {
        console.log(`  ${chalk.red("✗")} ${dep.name} failed:`, error.shortMessage || error.message);
      }
    }

    console.log();
    console.log(chalk.dim(`[${timestamp}] Watching for changes...`));
  }

  // Start watching each trigger service
  for (const trigger of triggerServices) {
    // Use chokidar for better file watching (fallback to fs.watch)
    try {
      const chokidar = await import("chokidar");

      const watcher = chokidar.watch(trigger.watchFiles, {
        cwd: trigger.dir,
        ignoreInitial: true,
        ignored: ["**/node_modules/**", "**/.git/**", "**/dist/**", "**/build/**"],
      });

      watcher.on("change", (path: string) => {
        runPreRunForTrigger(trigger.name, path);
      });

      watcher.on("add", (path: string) => {
        runPreRunForTrigger(trigger.name, path);
      });

      p.log.success(`Watching ${trigger.name} with chokidar`);
    } catch {
      // Fallback to basic fs.watch (less reliable for globs)
      p.log.warn(`chokidar not available, using basic fs.watch for ${trigger.name}`);

      watch(trigger.dir, { recursive: true }, (_eventType, filename) => {
        if (!filename) return;

        // Check if filename matches any watch pattern
        const matches = trigger.watchFiles.some((pattern) => {
          // Simple glob matching
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

  // Keep the process running
  await new Promise(() => {}); // Never resolves
}
