import { describe, it, expect } from "vitest";
import { sanitizeBranchName, calculateServicePort } from "../utils.js";

describe("sanitizeBranchName", () => {
  it("converts spaces to dashes", () => {
    expect(sanitizeBranchName("my feature name")).toBe("my-feature-name");
  });

  it("converts to lowercase", () => {
    expect(sanitizeBranchName("MyFeature")).toBe("myfeature");
  });

  it("removes invalid characters", () => {
    expect(sanitizeBranchName("feature@#$%name")).toBe("featurename");
  });

  it("removes leading dashes and dots", () => {
    expect(sanitizeBranchName("-feature")).toBe("feature");
    expect(sanitizeBranchName(".feature")).toBe("feature");
  });

  it("removes trailing dashes and dots", () => {
    expect(sanitizeBranchName("feature-")).toBe("feature");
    expect(sanitizeBranchName("feature.")).toBe("feature");
  });

  it("collapses multiple dashes", () => {
    expect(sanitizeBranchName("feature--name")).toBe("feature-name");
    expect(sanitizeBranchName("feature   name")).toBe("feature-name");
  });

  it("preserves slashes for nested branches", () => {
    expect(sanitizeBranchName("feature/sub-feature")).toBe("feature/sub-feature");
  });

  it("preserves underscores", () => {
    expect(sanitizeBranchName("feature_name")).toBe("feature_name");
  });

  it("handles ticket numbers", () => {
    expect(sanitizeBranchName("DEV-1234-add-feature")).toBe("dev-1234-add-feature");
  });

  it("handles empty string", () => {
    expect(sanitizeBranchName("")).toBe("");
  });
});

describe("calculateServicePort", () => {
  it("calculates correct port for first workspace", () => {
    // Workspace 0, server (default 3000), base 4000, offset 1000
    // workspaceBase = 4000 + 0 * 1000 = 4000
    // serviceOffset = 3000 - 3000 = 0
    // result = 4000 + 0 = 4000
    expect(calculateServicePort("server", 3000, 4000, 0, 1000)).toBe(4000);
  });

  it("calculates correct port for webapp in first workspace", () => {
    // Workspace 0, webapp (default 3001), base 4000, offset 1000
    // workspaceBase = 4000 + 0 * 1000 = 4000
    // serviceOffset = 3001 - 3000 = 1
    // result = 4000 + 1 = 4001
    expect(calculateServicePort("webapp", 3001, 4000, 0, 1000)).toBe(4001);
  });

  it("calculates correct port for second workspace", () => {
    // Workspace 1, server (default 3000), base 4000, offset 1000
    // workspaceBase = 4000 + 1 * 1000 = 5000
    // serviceOffset = 3000 - 3000 = 0
    // result = 5000 + 0 = 5000
    expect(calculateServicePort("server", 3000, 4000, 1, 1000)).toBe(5000);
  });

  it("calculates correct port for webapp in second workspace", () => {
    // Workspace 1, webapp (default 3001), base 4000, offset 1000
    // workspaceBase = 4000 + 1 * 1000 = 5000
    // serviceOffset = 3001 - 3000 = 1
    // result = 5000 + 1 = 5001
    expect(calculateServicePort("webapp", 3001, 4000, 1, 1000)).toBe(5001);
  });

  it("handles services with larger default ports", () => {
    // Workspace 0, socketio (default 3005), base 4000, offset 1000
    // workspaceBase = 4000 + 0 * 1000 = 4000
    // serviceOffset = 3005 - 3000 = 5
    // result = 4000 + 5 = 4005
    expect(calculateServicePort("socketio", 3005, 4000, 0, 1000)).toBe(4005);
  });

  it("handles custom port offsets", () => {
    // Workspace 2, server (default 3000), base 4000, offset 500
    // workspaceBase = 4000 + 2 * 500 = 5000
    // serviceOffset = 3000 - 3000 = 0
    // result = 5000 + 0 = 5000
    expect(calculateServicePort("server", 3000, 4000, 2, 500)).toBe(5000);
  });

  it("handles custom base ports", () => {
    // Workspace 0, server (default 3000), base 8000, offset 1000
    // workspaceBase = 8000 + 0 * 1000 = 8000
    // serviceOffset = 3000 - 3000 = 0
    // result = 8000 + 0 = 8000
    expect(calculateServicePort("server", 3000, 8000, 0, 1000)).toBe(8000);
  });
});
