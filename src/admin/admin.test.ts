import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { SqliteStorage } from "../storage/sqlite.js";
import { createAdminRouter } from "./router.js";
import express from "express";
import session from "express-session";
import request from "supertest";
import { mkdtempSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

let storage: SqliteStorage;
let tempDir: string;
let app: express.Express;
let adminCookie: string;

beforeEach(async () => {
  tempDir = mkdtempSync(join(tmpdir(), "mcp-gw-admin-"));
  storage = new SqliteStorage(join(tempDir, "test.db"));
  await storage.initialize();

  // Create express app with admin router
  app = express();
  app.use(express.json());

  // Set test admin credentials via env
  process.env.ADMIN_USERNAME = "testadmin";
  process.env.ADMIN_PASSWORD = "testpass123";

  // Reload config to pick up env changes
  const router = createAdminRouter(storage);
  app.use("/admin", router);
});

afterEach(async () => {
  await storage.close();
  rmSync(tempDir, { recursive: true, force: true });
  delete process.env.ADMIN_USERNAME;
  delete process.env.ADMIN_PASSWORD;
});

// Helper to authenticate and get cookie
async function login(): Promise<string> {
  const res = await request(app)
    .post("/admin/login")
    .send({ username: "testadmin", password: "testpass123" });
  expect(res.status).toBe(200);
  return res.headers["set-cookie"]?.[0] || "";
}

describe("Admin API - Authentication", () => {
  it("should login with valid credentials", async () => {
    const res = await request(app)
      .post("/admin/login")
      .send({ username: "testadmin", password: "testpass123" });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.headers["set-cookie"]).toBeDefined();
  });

  it("should reject login with invalid credentials", async () => {
    const res = await request(app)
      .post("/admin/login")
      .send({ username: "testadmin", password: "wrongpassword" });

    expect(res.status).toBe(401);
    expect(res.body.error).toBe("Invalid credentials");
  });

  it("should logout successfully", async () => {
    const cookie = await login();

    const res = await request(app)
      .post("/admin/logout")
      .set("Cookie", cookie);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  it("should reject protected routes without auth", async () => {
    const res = await request(app)
      .get("/admin/users");

    expect(res.status).toBe(401);
  });
});

describe("Admin API - User Management", () => {
  let cookie: string;

  beforeEach(async () => {
    cookie = await login();
  });

  it("should create a new user", async () => {
    const res = await request(app)
      .post("/admin/users")
      .set("Cookie", cookie)
      .send({ username: "testuser", email: "test@example.com", note: "Test user" });

    expect(res.status).toBe(201);
    expect(res.body.username).toBe("testuser");
    expect(res.body.email).toBe("test@example.com");
    expect(res.body.status).toBe("active");
  });

  it("should reject creating user with duplicate username", async () => {
    await request(app)
      .post("/admin/users")
      .set("Cookie", cookie)
      .send({ username: "duplicateuser" });

    const res = await request(app)
      .post("/admin/users")
      .set("Cookie", cookie)
      .send({ username: "duplicateuser" });

    expect(res.status).toBe(409);
    expect(res.body.error).toBe("Username already exists");
  });

  it("should list users", async () => {
    await request(app)
      .post("/admin/users")
      .set("Cookie", cookie)
      .send({ username: "user1" });

    const res = await request(app)
      .get("/admin/users")
      .set("Cookie", cookie);

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.length).toBeGreaterThanOrEqual(1);
  });

  it("should get user by ID", async () => {
    const createRes = await request(app)
      .post("/admin/users")
      .set("Cookie", cookie)
      .send({ username: "getuser" });

    const res = await request(app)
      .get(`/admin/users/${createRes.body.id}`)
      .set("Cookie", cookie);

    expect(res.status).toBe(200);
    expect(res.body.username).toBe("getuser");
  });

  it("should update user", async () => {
    const createRes = await request(app)
      .post("/admin/users")
      .set("Cookie", cookie)
      .send({ username: "updateuser" });

    const res = await request(app)
      .put(`/admin/users/${createRes.body.id}`)
      .set("Cookie", cookie)
      .send({ status: "disabled" });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe("disabled");
  });

  it("should reject invalid status value", async () => {
    const createRes = await request(app)
      .post("/admin/users")
      .set("Cookie", cookie)
      .send({ username: "invalidstatus" });

    const res = await request(app)
      .put(`/admin/users/${createRes.body.id}`)
      .set("Cookie", cookie)
      .send({ status: "invalid" });

    expect(res.status).toBe(400);
  });
});

describe("Admin API - API Key Management", () => {
  let cookie: string;
  let userId: string;

  beforeEach(async () => {
    cookie = await login();
    const createRes = await request(app)
      .post("/admin/users")
      .set("Cookie", cookie)
      .send({ username: "apikeyuser" });
    userId = createRes.body.id;
  });

  it("should create API key for user", async () => {
    const res = await request(app)
      .post(`/admin/users/${userId}/api-keys`)
      .set("Cookie", cookie)
      .send({ name: "test-key", quota: 100 });

    expect(res.status).toBe(201);
    expect(res.body.name).toBe("test-key");
    expect(res.body.quota).toBe(100);
    expect(res.body.key).toBeDefined(); // Plain text key returned on creation
  });

  it("should reject creating API key for non-existent user", async () => {
    const res = await request(app)
      .post("/admin/users/nonexistent-id/api-keys")
      .set("Cookie", cookie)
      .send({ name: "test-key" });

    expect(res.status).toBe(404);
    expect(res.body.error).toBe("User not found");
  });

  it("should list API keys for user", async () => {
    await request(app)
      .post(`/admin/users/${userId}/api-keys`)
      .set("Cookie", cookie)
      .send({ name: "key1" });

    const res = await request(app)
      .get(`/admin/users/${userId}/api-keys`)
      .set("Cookie", cookie);

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.length).toBeGreaterThanOrEqual(1);
    // Hash should not be returned
    expect(res.body[0].keyHash).toBeUndefined();
  });

  it("should update API key", async () => {
    const createRes = await request(app)
      .post(`/admin/users/${userId}/api-keys`)
      .set("Cookie", cookie)
      .send({ name: "update-key" });

    const res = await request(app)
      .put(`/admin/api-keys/${createRes.body.id}`)
      .set("Cookie", cookie)
      .send({ status: "disabled" });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe("disabled");
  });

  it("should delete API key", async () => {
    const createRes = await request(app)
      .post(`/admin/users/${userId}/api-keys`)
      .set("Cookie", cookie)
      .send({ name: "delete-key" });

    const res = await request(app)
      .delete(`/admin/api-keys/${createRes.body.id}`)
      .set("Cookie", cookie);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });
});

describe("Admin API - Tool Pricing", () => {
  let cookie: string;

  beforeEach(async () => {
    cookie = await login();
  });

  it("should set tool price", async () => {
    const res = await request(app)
      .put("/admin/tool-prices/testTool")
      .set("Cookie", cookie)
      .send({ unitPrice: 1.5 });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.toolName).toBe("testTool");
    expect(res.body.unitPrice).toBe(1.5);
  });

  it("should reject negative unit price", async () => {
    const res = await request(app)
      .put("/admin/tool-prices/testTool")
      .set("Cookie", cookie)
      .send({ unitPrice: -1 });

    expect(res.status).toBe(400);
  });

  it("should list all tool prices", async () => {
    await request(app)
      .put("/admin/tool-prices/tool1")
      .set("Cookie", cookie)
      .send({ unitPrice: 1.0 });

    await request(app)
      .put("/admin/tool-prices/tool2")
      .set("Cookie", cookie)
      .send({ unitPrice: 2.0 });

    const res = await request(app)
      .get("/admin/tool-prices")
      .set("Cookie", cookie);

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.length).toBeGreaterThanOrEqual(2);
  });

  it("should batch update tool prices", async () => {
    const res = await request(app)
      .put("/admin/tool-prices")
      .set("Cookie", cookie)
      .send({
        prices: [
          { toolName: "batchTool1", unitPrice: 0.5 },
          { toolName: "batchTool2", unitPrice: 1.5 },
        ],
      });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.count).toBe(2);
  });
});
