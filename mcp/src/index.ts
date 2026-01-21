#!/usr/bin/env node
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { execSync } from "child_process";

const server = new Server(
  {
    name: "hyve",
    version: "1.0.0",
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

// Define available tools
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: "hyve_list",
        description: "List all Hyve workspaces",
        inputSchema: {
          type: "object",
          properties: {},
        },
      },
      {
        name: "hyve_status",
        description: "Get status of a Hyve workspace",
        inputSchema: {
          type: "object",
          properties: {
            workspace: {
              type: "string",
              description: "Workspace name (optional, shows all if omitted)",
            },
          },
        },
      },
      {
        name: "hyve_create",
        description: "Create a new Hyve workspace with isolated git worktrees and database",
        inputSchema: {
          type: "object",
          properties: {
            name: {
              type: "string",
              description: "Workspace/feature name",
            },
            repos: {
              type: "array",
              items: { type: "string" },
              description: "Additional repos to include (required repos are auto-included)",
            },
          },
          required: ["name"],
        },
      },
      {
        name: "hyve_run",
        description: "Start services for a Hyve workspace",
        inputSchema: {
          type: "object",
          properties: {
            workspace: {
              type: "string",
              description: "Workspace name",
            },
            services: {
              type: "array",
              items: { type: "string" },
              description: "Specific services to start (optional, starts all if omitted)",
            },
          },
          required: ["workspace"],
        },
      },
      {
        name: "hyve_halt",
        description: "Stop services for a Hyve workspace",
        inputSchema: {
          type: "object",
          properties: {
            workspace: {
              type: "string",
              description: "Workspace name",
            },
          },
          required: ["workspace"],
        },
      },
      {
        name: "hyve_cleanup",
        description: "Remove a Hyve workspace (keeps git branches)",
        inputSchema: {
          type: "object",
          properties: {
            workspace: {
              type: "string",
              description: "Workspace name",
            },
          },
          required: ["workspace"],
        },
      },
      {
        name: "hyve_db",
        description: "Get database connection info for a workspace",
        inputSchema: {
          type: "object",
          properties: {
            workspace: {
              type: "string",
              description: "Workspace name",
            },
          },
          required: ["workspace"],
        },
      },
    ],
  };
});

// Handle tool calls
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    let command: string;
    let result: string;

    switch (name) {
      case "hyve_list":
        command = "hyve list";
        break;

      case "hyve_status":
        command = args?.workspace ? `hyve status ${args.workspace}` : "hyve status";
        break;

      case "hyve_create":
        const repos = (args?.repos as string[])?.join(" ") || "";
        command = `hyve create ${args?.name} ${repos}`.trim();
        break;

      case "hyve_run":
        const services = (args?.services as string[])?.join(" ") || "";
        command = `hyve run ${args?.workspace} ${services}`.trim();
        break;

      case "hyve_halt":
        command = `hyve halt ${args?.workspace}`;
        break;

      case "hyve_cleanup":
        command = `hyve cleanup ${args?.workspace}`;
        break;

      case "hyve_db":
        command = `hyve db ${args?.workspace} --info`;
        break;

      default:
        return {
          content: [{ type: "text", text: `Unknown tool: ${name}` }],
          isError: true,
        };
    }

    try {
      result = execSync(command, {
        encoding: "utf-8",
        timeout: 300000, // 5 minutes
        stdio: ["pipe", "pipe", "pipe"],
      });
    } catch (error: any) {
      result = error.stdout || error.stderr || error.message;
    }

    return {
      content: [{ type: "text", text: result }],
    };
  } catch (error: any) {
    return {
      content: [{ type: "text", text: `Error: ${error.message}` }],
      isError: true,
    };
  }
});

// Start server
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("Hyve MCP server running on stdio");
}

main().catch(console.error);
