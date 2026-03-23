import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { SqliteStorage } from "./sqlite.js";
import { createHash } from "crypto";
import { mkdtempSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

let storage: SqliteStorage;
let tempDir: string;

beforeEach(async () => {
  tempDir = mkdtempSync(join(tmpdir(), "mcp-gw-test-"));
  storage = new SqliteStorage(join(tempDir, "test.db"));
  await storage.initialize();
});

afterEach(async () => {
  await storage.close();
  rmSync(tempDir, { recursive: true, force: true });
});

describe("SqliteStorage - Users", () => {
  it("should create and retrieve a user", async () => {
    const user = await storage.createUser({ username: "alice", email: "alice@test.com", note: "test" });
    expect(user.username).toBe("alice");
    expect(user.email).toBe("alice@test.com");
    expect(user.status).toBe("active");

    const fetched = await storage.getUser(user.id);
    expect(fetched).not.toBeNull();
    expect(fetched!.username).toBe("alice");
  });

  it("should list users", async () => {
    await storage.createUser({ username: "u1" });
    await storage.createUser({ username: "u2" });
    const users = await storage.listUsers();
    expect(users.length).toBe(2);
  });

  it("should update user status", async () => {
    const user = await storage.createUser({ username: "bob" });
    const updated = await storage.updateUser(user.id, { status: "disabled" });
    expect(updated.status).toBe("disabled");
  });

  it("should enforce unique username", async () => {
    await storage.createUser({ username: "unique" });
    await expect(storage.createUser({ username: "unique" })).rejects.toThrow();
  });

  it("should find user by username", async () => {
    await storage.createUser({ username: "findme" });
    const found = await storage.getUserByUsername("findme");
    expect(found).not.toBeNull();
    expect(found!.username).toBe("findme");
  });
});

describe("SqliteStorage - API Keys", () => {
  function hashKey(key: string): string {
    return createHash("sha256").update(key).digest("hex");
  }

  it("should create and retrieve an API key", async () => {
    const user = await storage.createUser({ username: "keyuser" });
    const apiKey = await storage.createApiKey({
      userId: user.id,
      name: "test-key",
      keyHash: hashKey("secret"),
      keyPrefix: "sk_abc",
      quota: 100,
    });
    expect(apiKey.quota).toBe(100);
    expect(apiKey.status).toBe("active");

    const fetched = await storage.getApiKey(apiKey.id);
    expect(fetched).not.toBeNull();
    expect(fetched!.keyHash).toBe(hashKey("secret"));
  });

  it("should find API key by hash", async () => {
    const user = await storage.createUser({ username: "keyuser2" });
    await storage.createApiKey({
      userId: user.id,
      name: "find-key",
      keyHash: hashKey("find-secret"),
      keyPrefix: "sk_def",
    });
    const found = await storage.getApiKeyByHash(hashKey("find-secret"));
    expect(found).not.toBeNull();
    expect(found!.name).toBe("find-key");
  });

  it("should list API keys by user", async () => {
    const user = await storage.createUser({ username: "keyuser3" });
    await storage.createApiKey({ userId: user.id, name: "k1", keyHash: hashKey("s1"), keyPrefix: "sk_1" });
    await storage.createApiKey({ userId: user.id, name: "k2", keyHash: hashKey("s2"), keyPrefix: "sk_2" });
    const keys = await storage.listApiKeysByUser(user.id);
    expect(keys.length).toBe(2);
  });

  it("should update API key status", async () => {
    const user = await storage.createUser({ username: "keyuser4" });
    const key = await storage.createApiKey({ userId: user.id, name: "disable-key", keyHash: hashKey("s"), keyPrefix: "sk_x" });
    const updated = await storage.updateApiKey(key.id, { status: "disabled" });
    expect(updated.status).toBe("disabled");
  });

  it("should delete API key", async () => {
    const user = await storage.createUser({ username: "keyuser5" });
    const key = await storage.createApiKey({ userId: user.id, name: "del-key", keyHash: hashKey("s"), keyPrefix: "sk_d" });
    await storage.deleteApiKey(key.id);
    const fetched = await storage.getApiKey(key.id);
    expect(fetched).toBeNull();
  });
});

describe("SqliteStorage - Usage Records", () => {
  function hashKey(key: string): string {
    return createHash("sha256").update(key).digest("hex");
  }

  it("should insert and count usage records", async () => {
    const user = await storage.createUser({ username: "usageuser" });
    const apiKey = await storage.createApiKey({ userId: user.id, name: "key", keyHash: hashKey("s"), keyPrefix: "sk_u" });
    await storage.insertUsageRecord({ userId: user.id, apiKeyId: apiKey.id, toolName: "tool1", unitPrice: 1.5, billingMonth: "2026-03" });
    await storage.insertUsageRecord({ userId: user.id, apiKeyId: apiKey.id, toolName: "tool1", unitPrice: 1.5, billingMonth: "2026-03" });
    const count = await storage.getMonthlyUsageCount(user.id, "2026-03");
    expect(count).toBe(2);
  });

  it("should get usage by user and tool", async () => {
    const user = await storage.createUser({ username: "usageuser2" });
    const apiKey = await storage.createApiKey({ userId: user.id, name: "key", keyHash: hashKey("s"), keyPrefix: "sk_u2" });
    await storage.insertUsageRecord({ userId: user.id, apiKeyId: apiKey.id, toolName: "toolA", unitPrice: 2, billingMonth: "2026-03" });
    await storage.insertUsageRecord({ userId: user.id, apiKeyId: apiKey.id, toolName: "toolB", unitPrice: 3, billingMonth: "2026-03" });
    await storage.insertUsageRecord({ userId: user.id, apiKeyId: apiKey.id, toolName: "toolA", unitPrice: 2, billingMonth: "2026-03" });
    const stats = await storage.getUsageByUserAndTool({ userId: user.id, billingMonth: "2026-03" });
    const toolA = stats.find((s) => s.toolName === "toolA");
    const toolB = stats.find((s) => s.toolName === "toolB");
    expect(toolA?.count).toBe(2);
    expect(toolA?.totalCost).toBe(4);
    expect(toolB?.count).toBe(1);
    expect(toolB?.totalCost).toBe(3);
  });

  it("should get usage stats", async () => {
    const user = await storage.createUser({ username: "usageuser3" });
    const apiKey = await storage.createApiKey({ userId: user.id, name: "key", keyHash: hashKey("s"), keyPrefix: "sk_u3" });
    await storage.insertUsageRecord({ userId: user.id, apiKeyId: apiKey.id, toolName: "statTool", unitPrice: 5, billingMonth: "2026-03" });
    const result = await storage.getUsageStats({ userId: user.id, billingMonth: "2026-03" });
    expect(result.data.length).toBe(1);
    expect(result.data[0].toolName).toBe("statTool");
    expect(result.data[0].totalCost).toBe(5);
  });
});

describe("SqliteStorage - Tool Prices", () => {
  it("should set and get tool price", async () => {
    await storage.setToolPrice("server__tool1", 2.5);
    const price = await storage.getToolPrice("server__tool1");
    expect(price).toBe(2.5);
  });

  it("should return 0 for unknown tool", async () => {
    const price = await storage.getToolPrice("unknown_tool");
    expect(price).toBe(0);
  });

  it("should list all tool prices", async () => {
    await storage.setToolPrice("tool_a", 1);
    await storage.setToolPrice("tool_b", 2);
    const prices = await storage.listToolPrices();
    expect(prices.length).toBe(2);
  });

  it("should batch update tool prices", async () => {
    await storage.batchUpdateToolPrices([{ toolName: "batch1", unitPrice: 10 }, { toolName: "batch2", unitPrice: 20 }]);
    const p1 = await storage.getToolPrice("batch1");
    const p2 = await storage.getToolPrice("batch2");
    expect(p1).toBe(10);
    expect(p2).toBe(20);
  });
});

describe("SqliteStorage - Request Logs", () => {
  function hashKey(key: string): string {
    return createHash("sha256").update(key).digest("hex");
  }

  it("should insert and query request logs", async () => {
    const user = await storage.createUser({ username: "loguser" });
    const apiKey = await storage.createApiKey({ userId: user.id, name: "key", keyHash: hashKey("s"), keyPrefix: "sk_l" });
    await storage.insertRequestLog({
      userId: user.id,
      apiKeyId: apiKey.id,
      method: "tools/call",
      toolName: "server__tool1",
      requestSummary: "{}",
      responseStatus: "success",
      responseTimeMs: 100,
      errorMessage: null,
    });
    const logs = await storage.queryRequestLogs({ userId: user.id });
    expect(logs.data.length).toBe(1);
    expect(logs.data[0].method).toBe("tools/call");
  });

  it("should clean expired logs", async () => {
    const user = await storage.createUser({ username: "loguser2" });
    const apiKey = await storage.createApiKey({ userId: user.id, name: "key", keyHash: hashKey("s"), keyPrefix: "sk_l2" });
    const oldDate = new Date("2020-01-01T00:00:00Z");
    const now = new Date();
    await storage.insertRequestLog({
      userId: user.id,
      apiKeyId: apiKey.id,
      method: "tools/call",
      toolName: "tool1",
      requestSummary: "{}",
      responseStatus: "success",
      responseTimeMs: 50,
      errorMessage: null,
      createdAt: oldDate,
    } as any);
    await storage.insertRequestLog({
      userId: user.id,
      apiKeyId: apiKey.id,
      method: "tools/call",
      toolName: "tool2",
      requestSummary: "{}",
      responseStatus: "success",
      responseTimeMs: 60,
      errorMessage: null,
    });
    const deleted = await storage.cleanExpiredLogs(new Date("2021-01-01T00:00:00Z"));
    expect(deleted).toBe(1);
    const remaining = await storage.queryRequestLogs({ userId: user.id });
    expect(remaining.data.length).toBe(1);
  });
});
