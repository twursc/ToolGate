import { describe, it, expect, beforeEach } from "vitest";
import { SqliteStorage } from "../storage/sqlite.js";
import { createAuthMiddleware } from "./auth.js";
import { createBillingMiddleware } from "./billing.js";
import { createHash } from "crypto";
import { mkdtempSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

let storage: SqliteStorage;
let tempDir: string;

beforeEach(async () => {
  tempDir = mkdtempSync(join(tmpdir(), "mcp-gw-middleware-"));
  storage = new SqliteStorage(join(tempDir, "test.db"));
  await storage.initialize();
});

afterEach(async () => {
  await storage.close();
  rmSync(tempDir, { recursive: true, force: true });
});

describe("Auth Middleware", () => {
  function hashKey(key: string): string {
    return createHash("sha256").update(key).digest("hex");
  }

  it("should reject request without API key", async () => {
    const middleware = createAuthMiddleware(storage);
    const req = { headers: {} } as any;
    const res = { status: () => res, json: () => {} } as any;
    const jsonSpy = vi.spyOn(res, "json");
    const statusSpy = vi.spyOn(res, "status").mockReturnValue(res);

    await middleware(req, res, () => {});

    expect(statusSpy).toHaveBeenCalledWith(401);
    expect(jsonSpy).toHaveBeenCalledWith(expect.objectContaining({ error: expect.any(String) }));
  });

  it("should reject request with invalid API key", async () => {
    const middleware = createAuthMiddleware(storage);
    const req = { headers: { authorization: "Bearer invalid-key" } } as any;
    const res = { status: () => res, json: () => {} } as any;
    const jsonSpy = vi.spyOn(res, "json");
    const statusSpy = vi.spyOn(res, "status").mockReturnValue(res);

    await middleware(req, res, () => {});

    expect(statusSpy).toHaveBeenCalledWith(401);
    expect(jsonSpy).toHaveBeenCalledWith(expect.objectContaining({ error: expect.any(String) }));
  });

  it("should accept request with valid API key", async () => {
    const user = await storage.createUser({ username: "auth-test-user" });
    const apiKey = await storage.createApiKey({
      userId: user.id,
      name: "test-key",
      keyHash: hashKey("valid-key"),
      keyPrefix: "sk_test",
      quota: 100,
    });

    const middleware = createAuthMiddleware(storage);
    const req = { headers: { authorization: "Bearer valid-key" } } as any;
    const res = {} as any;
    let nextCalled = false;

    await middleware(req, res, () => { nextCalled = true; });

    expect(nextCalled).toBe(true);
    expect(req.authContext).toBeDefined();
    expect(req.authContext?.userId).toBe(user.id);
    expect(req.authContext?.apiKeyId).toBe(apiKey.id);
  });

  it("should reject request with disabled API key", async () => {
    const user = await storage.createUser({ username: "disabled-key-user" });
    const apiKey = await storage.createApiKey({
      userId: user.id,
      name: "disabled-key",
      keyHash: hashKey("disabled-key"),
      keyPrefix: "sk_dis",
      quota: 100,
      status: "disabled",
    });

    // Verify the API key was created with disabled status
    const fetchedKey = await storage.getApiKey(apiKey.id);
    expect(fetchedKey?.status).toBe("disabled");

    const middleware = createAuthMiddleware(storage);
    const callLog: string[] = [];
    const req = { headers: { authorization: "Bearer disabled-key" } } as any;
    const res = {
      statusCode: 200,
      status: (code: number) => { callLog.push(`status(${code})`); return res; },
      json: (body: any) => { callLog.push(`json(${JSON.stringify(body)})`); },
    } as any;

    await middleware(req, res, () => {});

    // Check that status and json were called
    expect(callLog).toContainEqual(expect.stringContaining("status(401)"));
  });

  it("should reject request when user is disabled", async () => {
    const user = await storage.createUser({ username: "disabled-user" });
    await storage.updateUser(user.id, { status: "disabled" });
    await storage.createApiKey({
      userId: user.id,
      name: "user-disabled-key",
      keyHash: hashKey("user-disabled"),
      keyPrefix: "sk_ud",
    });

    const middleware = createAuthMiddleware(storage);
    const req = { headers: { authorization: "Bearer user-disabled" } } as any;
    const res = { status: () => res, json: () => {} } as any;
    const statusSpy = vi.spyOn(res, "status").mockReturnValue(res);

    await middleware(req, res, () => {});

    expect(statusSpy).toHaveBeenCalledWith(401);
  });

  it("should reject request with expired API key", async () => {
    const user = await storage.createUser({ username: "expired-key-user" });
    await storage.createApiKey({
      userId: user.id,
      name: "expired-key",
      keyHash: hashKey("expired-key"),
      keyPrefix: "sk_exp",
      expiresAt: new Date("2020-01-01T00:00:00Z"),
    });

    const middleware = createAuthMiddleware(storage);
    const req = { headers: { authorization: "Bearer expired-key" } } as any;
    const res = { status: () => res, json: () => {} } as any;
    const statusSpy = vi.spyOn(res, "status").mockReturnValue(res);

    await middleware(req, res, () => {});

    expect(statusSpy).toHaveBeenCalledWith(401);
  });

  it("should accept API key via X-Api-Key header", async () => {
    const user = await storage.createUser({ username: "xapi-key-user" });
    await storage.createApiKey({
      userId: user.id,
      name: "xapi-key",
      keyHash: hashKey("xapi-key-value"),
      keyPrefix: "sk_xapi",
    });

    const middleware = createAuthMiddleware(storage);
    const req = { headers: { "x-api-key": "xapi-key-value" } } as any;
    let nextCalled = false;

    await middleware(req, {} as any, () => { nextCalled = true; });

    expect(nextCalled).toBe(true);
    expect(req.authContext).toBeDefined();
  });
});

describe("Billing Middleware", () => {
  function hashKey(key: string): string {
    return createHash("sha256").update(key).digest("hex");
  }

  it("should pass through non-tools/call requests", async () => {
    const middleware = createBillingMiddleware(storage);
    const req = { body: { method: "tools/list" } } as any;
    let nextCalled = false;

    await middleware(req, {} as any, () => { nextCalled = true; });

    expect(nextCalled).toBe(true);
  });

  it("should allow tools/call when under quota", async () => {
    const user = await storage.createUser({ username: "billing-test-user" });
    const apiKey = await storage.createApiKey({
      userId: user.id,
      name: "billing-key",
      keyHash: hashKey("billing-key"),
      keyPrefix: "sk_bill",
      quota: 10,
    });

    await storage.setToolPrice("server__testTool", 1.5);

    const middleware = createBillingMiddleware(storage);
    const req = {
      body: { method: "tools/call", params: { name: "server__testTool" } },
      authContext: { userId: user.id, apiKeyId: apiKey.id, apiKeyRecord: { quota: 10 } },
    } as any;
    let nextCalled = false;

    await middleware(req, {} as any, () => { nextCalled = true; });

    expect(nextCalled).toBe(true);
  });

  it("should reject tools/call when quota exceeded", async () => {
    const user = await storage.createUser({ username: "quota-exceeded-user" });
    const apiKey = await storage.createApiKey({
      userId: user.id,
      name: "quota-key",
      keyHash: hashKey("quota-key"),
      keyPrefix: "sk_quota",
      quota: 2,
    });

    // Insert usage records to exceed quota
    const currentMonth = new Date().toISOString().slice(0, 7);
    await storage.insertUsageRecord({ userId: user.id, apiKeyId: apiKey.id, toolName: "tool1", unitPrice: 1, billingMonth: currentMonth });
    await storage.insertUsageRecord({ userId: user.id, apiKeyId: apiKey.id, toolName: "tool1", unitPrice: 1, billingMonth: currentMonth });

    const middleware = createBillingMiddleware(storage);
    const req = {
      body: { method: "tools/call", params: { name: "server__tool" } },
      authContext: { userId: user.id, apiKeyId: apiKey.id, apiKeyRecord: { quota: 2 } },
    } as any;
    const res = { status: () => res, json: () => {} } as any;
    const statusSpy = vi.spyOn(res, "status").mockReturnValue(res);
    const jsonSpy = vi.spyOn(res, "json");

    await middleware(req, res, () => {});

    expect(statusSpy).toHaveBeenCalledWith(429);
    expect(jsonSpy).toHaveBeenCalledWith(expect.objectContaining({ error: "Monthly quota exceeded" }));
  });

  it("should allow unlimited quota (quota=0)", async () => {
    const user = await storage.createUser({ username: "unlimited-user" });
    const apiKey = await storage.createApiKey({
      userId: user.id,
      name: "unlimited-key",
      keyHash: hashKey("unlimited-key"),
      keyPrefix: "sk_unlim",
      quota: 0, // 0 means unlimited
    });

    // Insert many usage records
    const currentMonth = new Date().toISOString().slice(0, 7);
    for (let i = 0; i < 100; i++) {
      await storage.insertUsageRecord({ userId: user.id, apiKeyId: apiKey.id, toolName: "tool1", unitPrice: 1, billingMonth: currentMonth });
    }

    const middleware = createBillingMiddleware(storage);
    const req = {
      body: { method: "tools/call", params: { name: "server__tool" } },
      authContext: { userId: user.id, apiKeyId: apiKey.id, apiKeyRecord: { quota: 0 } },
    } as any;
    let nextCalled = false;

    await middleware(req, { json: function() {} } as any, () => { nextCalled = true; });

    expect(nextCalled).toBe(true);
  });
});
