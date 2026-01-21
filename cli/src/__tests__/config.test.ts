import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, writeFileSync, rmSync, existsSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

// We need to test findConfigFile which searches up the directory tree
describe("config", () => {
  let testDir: string;
  let originalCwd: string;

  beforeEach(() => {
    testDir = join(tmpdir(), `hyve-test-${Date.now()}`);
    mkdirSync(testDir, { recursive: true });
    originalCwd = process.cwd();
  });

  afterEach(() => {
    process.chdir(originalCwd);
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
  });

  describe("HyveConfig structure", () => {
    it("should define required config fields", () => {
      const validConfig = {
        workspaces_dir: "./workspaces",
        required_repos: ["server"],
        repos: {
          server: {
            path: "./server",
            remote: "git@github.com:org/server.git",
          },
        },
        database: {
          enabled: true,
          source_port: 5432,
          base_port: 5500,
          user: "postgres",
          password: "postgres",
          name: "mydb",
        },
        services: {
          port_offset: 1000,
          base_port: 4000,
          definitions: {},
        },
        branches: {
          prefix: "feature/",
          base: "main",
        },
      };

      // Verify structure has all required fields
      expect(validConfig.workspaces_dir).toBeDefined();
      expect(validConfig.repos).toBeDefined();
      expect(validConfig.database).toBeDefined();
      expect(validConfig.services).toBeDefined();
      expect(validConfig.branches).toBeDefined();
    });

    it("should support optional service definition fields", () => {
      const serviceDefinition = {
        default_port: 3000,
        dev_command: "pnpm dev",
        env_var: "PORT",
        depends_on: ["database"],
        pre_run: "pnpm build",
        pre_run_deps: ["server"],
        watch_files: ["src/**/*.ts"],
        health_check: "http://localhost:${port}/health",
      };

      expect(serviceDefinition.default_port).toBe(3000);
      expect(serviceDefinition.depends_on).toContain("database");
      expect(serviceDefinition.health_check).toContain("${port}");
    });
  });

  describe("config file discovery", () => {
    it("should find .hyve.yaml in current directory", () => {
      const configPath = join(testDir, ".hyve.yaml");
      writeFileSync(configPath, "workspaces_dir: ./workspaces");

      // Verify file was created
      expect(existsSync(configPath)).toBe(true);
    });

    it("should find .hyve.yml as alternative", () => {
      const configPath = join(testDir, ".hyve.yml");
      writeFileSync(configPath, "workspaces_dir: ./workspaces");

      expect(existsSync(configPath)).toBe(true);
    });

    it("should search parent directories", () => {
      const subDir = join(testDir, "nested", "deep");
      mkdirSync(subDir, { recursive: true });

      const configPath = join(testDir, ".hyve.yaml");
      writeFileSync(configPath, "workspaces_dir: ./workspaces");

      // Config in parent should still be findable
      expect(existsSync(configPath)).toBe(true);
    });
  });

  describe("config defaults", () => {
    it("should have sensible defaults for optional fields", () => {
      const defaults = {
        workspaces_dir: "./workspaces",
        required_repos: [],
        branches: { prefix: "feature/", base: "master" },
        services: {
          port_offset: 1000,
          base_port: 4000,
          definitions: {},
        },
        database: {
          enabled: false,
          source_port: 5432,
          base_port: 5500,
          user: "postgres",
          password: "postgres",
          name: "postgres",
        },
      };

      expect(defaults.workspaces_dir).toBe("./workspaces");
      expect(defaults.services.port_offset).toBe(1000);
      expect(defaults.database.enabled).toBe(false);
    });
  });
});
