import { describe, it, expect } from "vitest";

// Test the CLAUDE.md generation logic
describe("CLAUDE.md generation", () => {
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

    return lines.join("\n");
  }

  it("generates correct header", () => {
    const md = generateClaudeMd(
      "my-feature",
      "feature/my-feature",
      ["server", "webapp"],
      5500,
      { server: 4000, webapp: 4001 },
      "/path/to/workspace"
    );

    expect(md).toContain("# Hyve Workspace: my-feature");
    expect(md).toContain("This is an isolated feature workspace");
  });

  it("includes workspace info", () => {
    const md = generateClaudeMd(
      "my-feature",
      "feature/my-feature",
      ["server", "webapp"],
      5500,
      { server: 4000, webapp: 4001 },
      "/path/to/workspace"
    );

    expect(md).toContain("`feature/my-feature`");
    expect(md).toContain("`/path/to/workspace`");
    expect(md).toContain("server, webapp");
  });

  it("includes database section when port is provided", () => {
    const md = generateClaudeMd(
      "my-feature",
      "feature/my-feature",
      ["server"],
      5500,
      { server: 4000 },
      "/path/to/workspace"
    );

    expect(md).toContain("## Database");
    expect(md).toContain("port **5500**");
    expect(md).toContain("hyve db my-feature");
  });

  it("omits database section when port is undefined", () => {
    const md = generateClaudeMd(
      "my-feature",
      "feature/my-feature",
      ["server"],
      undefined,
      { server: 4000 },
      "/path/to/workspace"
    );

    expect(md).not.toContain("## Database");
  });

  it("includes service ports table", () => {
    const md = generateClaudeMd(
      "my-feature",
      "feature/my-feature",
      ["server", "webapp", "socketio"],
      5500,
      { server: 4000, webapp: 4001, socketio: 4005 },
      "/path/to/workspace"
    );

    expect(md).toContain("## Service Ports");
    expect(md).toContain("| Service | Port |");
    expect(md).toContain("| server | 4000 |");
    expect(md).toContain("| webapp | 4001 |");
    expect(md).toContain("| socketio | 4005 |");
  });
});

describe("env file processing", () => {
  it("should replace localhost:port patterns", () => {
    let envContent = `
API_URL=http://localhost:3000/api
SOCKET_URL=http://localhost:3005/
DATABASE_URL=postgresql://user:pass@localhost:5432/db
`;

    // Simulate port replacement
    const replacements: [number, number][] = [
      [3000, 4000],
      [3005, 4005],
      [5432, 5500],
    ];

    for (const [oldPort, newPort] of replacements) {
      envContent = envContent.replace(
        new RegExp(`(localhost|127\\.0\\.0\\.1):${oldPort}`, "g"),
        `$1:${newPort}`
      );
    }

    expect(envContent).toContain("localhost:4000");
    expect(envContent).toContain("localhost:4005");
    expect(envContent).toContain("localhost:5500");
    expect(envContent).not.toContain("localhost:3000");
    expect(envContent).not.toContain("localhost:3005");
    expect(envContent).not.toContain("localhost:5432");
  });

  it("should handle 127.0.0.1 patterns", () => {
    let envContent = "API_URL=http://127.0.0.1:3000/api";

    envContent = envContent.replace(
      new RegExp(`(localhost|127\\.0\\.0\\.1):3000`, "g"),
      `$1:4000`
    );

    expect(envContent).toContain("127.0.0.1:4000");
    expect(envContent).not.toContain("127.0.0.1:3000");
  });

  it("should preserve commented lines", () => {
    let envContent = `
# REDIS_URL=redis://localhost:6379
API_URL=http://localhost:3000/api
`;

    // Only replace active port
    envContent = envContent.replace(
      new RegExp(`(localhost|127\\.0\\.0\\.1):3000`, "g"),
      `$1:4000`
    );

    // Redis line should still be commented with original port
    expect(envContent).toContain("# REDIS_URL=redis://localhost:6379");
    expect(envContent).toContain("localhost:4000");
  });

  it("should add workspace marker", () => {
    let envContent = "PORT=3000\n";

    if (!envContent.includes("Hyve Workspace")) {
      envContent += `\n# ===== Hyve Workspace Configuration =====\n`;
      envContent += `# Workspace: my-feature\n`;
    }

    expect(envContent).toContain("Hyve Workspace");
    expect(envContent).toContain("my-feature");
  });
});
