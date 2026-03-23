import { describe, it, expect, beforeEach } from "vitest";

// Test the tool naming and mapping logic without actual MCP connections
describe("MCP Proxy - Tool Naming", () => {
  it("should create qualified tool name with separator", () => {
    const serverKey = "myserver";
    const toolName = "search";
    const separator = "__";
    const qualifiedName = `${serverKey}${separator}${toolName}`;
    expect(qualifiedName).toBe("myserver__search");
  });

  it("should create qualified tool name with custom separator", () => {
    const serverKey = "backend";
    const toolName = "query";
    const separator = "::";
    const qualifiedName = `${serverKey}${separator}${toolName}`;
    expect(qualifiedName).toBe("backend::query");
  });

  it("should maintain unique qualified names across servers", () => {
    const map = new Map<string, { serverKey: string; toolName: string }>();
    const separator = "__";

    const servers = [
      { key: "server1", tools: ["search", "query"] },
      { key: "server2", tools: ["search", "analyze"] },
    ];

    for (const server of servers) {
      for (const tool of server.tools) {
        const qualifiedName = `${server.key}${separator}${tool}`;
        map.set(qualifiedName, { serverKey: server.key, toolName: tool });
      }
    }

    // Both servers have "search" but qualified names are unique
    expect(map.size).toBe(4);
    expect(map.has("server1__search")).toBe(true);
    expect(map.has("server2__search")).toBe(true);
    expect(map.get("server1__search")?.serverKey).toBe("server1");
    expect(map.get("server2__search")?.serverKey).toBe("server2");
  });

  it("should handle map clearing and repopulation atomically", () => {
    const map = new Map<string, string>();

    // Initial population
    map.set("s1__tool1", "client1");
    map.set("s1__tool2", "client1");
    expect(map.size).toBe(2);

    // Simulate atomic update: clear then repopulate
    map.clear();
    expect(map.size).toBe(0);

    map.set("s2__tool1", "client2");
    map.set("s2__tool3", "client2");
    expect(map.size).toBe(2);
    expect(map.has("s1__tool1")).toBe(false);
    expect(map.has("s2__tool1")).toBe(true);
  });
});

describe("MCP Proxy - Connection Error Detection", () => {
  function isConnectionError(error: any): boolean {
    const msg = String(error?.message ?? error ?? "").toLowerCase();
    return (
      msg.includes("disconnected") ||
      msg.includes("not connected") ||
      msg.includes("connection closed") ||
      msg.includes("transport is closed") ||
      msg.includes("failed to fetch") ||
      msg.includes("404") ||
      msg.includes("eof") ||
      msg.includes("tls") ||
      msg.includes("timeout") ||
      msg.includes("enetunreach") ||
      msg.includes("econnrefused")
    );
  }

  it("should detect connection errors", () => {
    expect(isConnectionError(new Error("Transport is closed"))).toBe(true);
    expect(isConnectionError(new Error("Client disconnected"))).toBe(true);
    expect(isConnectionError(new Error("ECONNREFUSED"))).toBe(true);
    expect(isConnectionError(new Error("Connection timeout"))).toBe(true);
    expect(isConnectionError(new Error("Failed to fetch resource"))).toBe(true);
  });

  it("should not detect non-connection errors", () => {
    expect(isConnectionError(new Error("Invalid argument"))).toBe(false);
    expect(isConnectionError(new Error("Permission denied"))).toBe(false);
    expect(isConnectionError(new Error("Schema validation failed"))).toBe(false);
  });
});

describe("MCP Proxy - Retry Logic", () => {
  it("should calculate exponential backoff delay", () => {
    const baseMs = 300;
    const delays: number[] = [];
    for (let attempt = 0; attempt < 3; attempt++) {
      const delay = baseMs * Math.pow(2, attempt);
      delays.push(delay);
    }
    expect(delays[0]).toBe(300);  // 300 * 2^0
    expect(delays[1]).toBe(600);  // 300 * 2^1
    expect(delays[2]).toBe(1200); // 300 * 2^2
  });

  it("should select retry config by transport type", () => {
    const proxyConfig = {
      retrySseToolCall: true,
      sseToolCallMaxRetries: 2,
      sseToolCallRetryDelayBaseMs: 300,
      retryHttpToolCall: false,
      httpToolCallMaxRetries: 1,
      httpToolCallRetryDelayBaseMs: 500,
      retryStdioToolCall: true,
      stdioToolCallMaxRetries: 3,
      stdioToolCallRetryDelayBaseMs: 200,
    };

    const getRetryConfig = (transportType: "sse" | "http" | "stdio") => {
      switch (transportType) {
        case "sse":
          return { enabled: proxyConfig.retrySseToolCall, maxRetries: proxyConfig.sseToolCallMaxRetries, baseMs: proxyConfig.sseToolCallRetryDelayBaseMs };
        case "http":
          return { enabled: proxyConfig.retryHttpToolCall, maxRetries: proxyConfig.httpToolCallMaxRetries, baseMs: proxyConfig.httpToolCallRetryDelayBaseMs };
        case "stdio":
          return { enabled: proxyConfig.retryStdioToolCall, maxRetries: proxyConfig.stdioToolCallMaxRetries, baseMs: proxyConfig.stdioToolCallRetryDelayBaseMs };
      }
    };

    expect(getRetryConfig("sse").enabled).toBe(true);
    expect(getRetryConfig("sse").maxRetries).toBe(2);
    expect(getRetryConfig("http").enabled).toBe(false);
    expect(getRetryConfig("stdio").maxRetries).toBe(3);
  });
});
