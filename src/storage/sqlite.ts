import Database from "better-sqlite3";
import { v4 as uuidv4 } from "uuid";
import type {
  IStorage,
  User,
  ApiKey,
  RequestLog,
  UsageRecord,
  ToolPrice,
  CreateUserInput,
  CreateApiKeyInput,
  ListOptions,
  LogFilter,
  UsageFilter,
  UserToolFilter,
  UsageStats,
  UserToolStats,
} from "./interface.js";

export class SqliteStorage implements IStorage {
  private db: Database.Database;

  constructor(dbPath: string) {
    this.db = new Database(dbPath);
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("foreign_keys = ON");
  }

  async initialize(): Promise<void> {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        username TEXT NOT NULL UNIQUE,
        email TEXT,
        note TEXT,
        status TEXT NOT NULL DEFAULT 'active',
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS api_keys (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        name TEXT NOT NULL,
        key_hash TEXT NOT NULL UNIQUE,
        key_prefix TEXT NOT NULL,
        quota INTEGER NOT NULL DEFAULT 0,
        status TEXT NOT NULL DEFAULT 'active',
        expires_at TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        FOREIGN KEY (user_id) REFERENCES users(id)
      );

      CREATE TABLE IF NOT EXISTS request_logs (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        api_key_id TEXT NOT NULL,
        method TEXT NOT NULL,
        tool_name TEXT,
        request_summary TEXT NOT NULL DEFAULT '',
        response_status TEXT NOT NULL,
        response_time_ms INTEGER NOT NULL DEFAULT 0,
        error_message TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_request_logs_user_created
        ON request_logs(user_id, created_at);

      CREATE TABLE IF NOT EXISTS usage_records (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        api_key_id TEXT NOT NULL,
        tool_name TEXT NOT NULL,
        unit_price REAL NOT NULL DEFAULT 0,
        billing_month TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_usage_user_month
        ON usage_records(user_id, billing_month);
      CREATE INDEX IF NOT EXISTS idx_usage_tool_month
        ON usage_records(tool_name, billing_month);

      CREATE TABLE IF NOT EXISTS tool_prices (
        tool_name TEXT PRIMARY KEY,
        unit_price REAL NOT NULL DEFAULT 0,
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
    `);
  }

  // PLACEHOLDER_METHODS

  private toUser(row: Record<string, unknown>): User {
    return {
      id: row.id as string,
      username: row.username as string,
      email: (row.email as string) ?? null,
      note: (row.note as string) ?? null,
      status: row.status as "active" | "disabled",
      createdAt: new Date(row.created_at as string),
      updatedAt: new Date(row.updated_at as string),
    };
  }

  private toApiKey(row: Record<string, unknown>): ApiKey {
    return {
      id: row.id as string,
      userId: row.user_id as string,
      name: row.name as string,
      keyHash: row.key_hash as string,
      keyPrefix: row.key_prefix as string,
      quota: row.quota as number,
      status: row.status as "active" | "disabled",
      expiresAt: row.expires_at ? new Date(row.expires_at as string) : null,
      createdAt: new Date(row.created_at as string),
    };
  }

  private toRequestLog(row: Record<string, unknown>): RequestLog {
    return {
      id: row.id as string,
      userId: row.user_id as string,
      apiKeyId: row.api_key_id as string,
      method: row.method as string,
      toolName: (row.tool_name as string) ?? null,
      requestSummary: row.request_summary as string,
      responseStatus: row.response_status as "success" | "error",
      responseTimeMs: row.response_time_ms as number,
      errorMessage: (row.error_message as string) ?? null,
      createdAt: new Date(row.created_at as string),
    };
  }

  private toUsageRecord(row: Record<string, unknown>): UsageRecord {
    return {
      id: row.id as string,
      userId: row.user_id as string,
      apiKeyId: row.api_key_id as string,
      toolName: row.tool_name as string,
      unitPrice: row.unit_price as number,
      billingMonth: row.billing_month as string,
      createdAt: new Date(row.created_at as string),
    };
  }

  // --- User Management ---

  async createUser(input: CreateUserInput): Promise<User> {
    const id = uuidv4();
    const now = new Date().toISOString();
    this.db.prepare(
      `INSERT INTO users (id, username, email, note, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'active', ?, ?)`
    ).run(id, input.username, input.email ?? null, input.note ?? null, now, now);
    return (await this.getUser(id))!;
  }

  async getUser(id: string): Promise<User | null> {
    const row = this.db.prepare("SELECT * FROM users WHERE id = ?").get(id) as Record<string, unknown> | undefined;
    return row ? this.toUser(row) : null;
  }

  async getUserByUsername(username: string): Promise<User | null> {
    const row = this.db.prepare("SELECT * FROM users WHERE username = ?").get(username) as Record<string, unknown> | undefined;
    return row ? this.toUser(row) : null;
  }

  async listUsers(opts?: ListOptions): Promise<User[]> {
    const limit = opts?.limit ?? 100;
    const offset = opts?.offset ?? 0;
    const rows = this.db.prepare("SELECT * FROM users ORDER BY created_at DESC LIMIT ? OFFSET ?").all(limit, offset) as Record<string, unknown>[];
    return rows.map((r) => this.toUser(r));
  }

  async updateUser(id: string, data: Partial<Pick<User, "username" | "email" | "note" | "status">>): Promise<User> {
    const sets: string[] = [];
    const values: unknown[] = [];
    if (data.username !== undefined) { sets.push("username = ?"); values.push(data.username); }
    if (data.email !== undefined) { sets.push("email = ?"); values.push(data.email); }
    if (data.note !== undefined) { sets.push("note = ?"); values.push(data.note); }
    if (data.status !== undefined) { sets.push("status = ?"); values.push(data.status); }
    sets.push("updated_at = ?");
    values.push(new Date().toISOString());
    values.push(id);
    this.db.prepare(`UPDATE users SET ${sets.join(", ")} WHERE id = ?`).run(...values);
    return (await this.getUser(id))!;
  }

  // --- API Key Management ---

  async createApiKey(input: CreateApiKeyInput): Promise<ApiKey> {
    const id = uuidv4();
    const now = new Date().toISOString();
    const status = input.status ?? "active";
    this.db.prepare(
      `INSERT INTO api_keys (id, user_id, name, key_hash, key_prefix, quota, status, expires_at, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(id, input.userId, input.name, input.keyHash, input.keyPrefix, input.quota ?? 0, status, input.expiresAt?.toISOString() ?? null, now);
    return (await this.getApiKey(id))!;
  }

  async getApiKey(id: string): Promise<ApiKey | null> {
    const row = this.db.prepare("SELECT * FROM api_keys WHERE id = ?").get(id) as Record<string, unknown> | undefined;
    return row ? this.toApiKey(row) : null;
  }

  async getApiKeyByHash(keyHash: string): Promise<ApiKey | null> {
    const row = this.db.prepare("SELECT * FROM api_keys WHERE key_hash = ?").get(keyHash) as Record<string, unknown> | undefined;
    return row ? this.toApiKey(row) : null;
  }

  async listApiKeysByUser(userId: string): Promise<ApiKey[]> {
    const rows = this.db.prepare("SELECT * FROM api_keys WHERE user_id = ? ORDER BY created_at DESC").all(userId) as Record<string, unknown>[];
    return rows.map((r) => this.toApiKey(r));
  }

  async updateApiKey(id: string, data: Partial<Pick<ApiKey, "name" | "quota" | "status" | "expiresAt">>): Promise<ApiKey> {
    const sets: string[] = [];
    const values: unknown[] = [];
    if (data.name !== undefined) { sets.push("name = ?"); values.push(data.name); }
    if (data.quota !== undefined) { sets.push("quota = ?"); values.push(data.quota); }
    if (data.status !== undefined) { sets.push("status = ?"); values.push(data.status); }
    if (data.expiresAt !== undefined) { sets.push("expires_at = ?"); values.push(data.expiresAt?.toISOString() ?? null); }
    values.push(id);
    if (sets.length > 0) {
      this.db.prepare(`UPDATE api_keys SET ${sets.join(", ")} WHERE id = ?`).run(...values);
    }
    return (await this.getApiKey(id))!;
  }

  async deleteApiKey(id: string): Promise<void> {
    this.db.prepare("DELETE FROM api_keys WHERE id = ?").run(id);
  }

  // --- Request Logs ---

  async insertRequestLog(log: Omit<RequestLog, "id" | "createdAt"> & { createdAt?: Date }): Promise<void> {
    const id = uuidv4();
    const now = (log.createdAt ?? new Date()).toISOString();
    this.db.prepare(
      `INSERT INTO request_logs (id, user_id, api_key_id, method, tool_name, request_summary, response_status, response_time_ms, error_message, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(id, log.userId, log.apiKeyId, log.method, log.toolName, log.requestSummary, log.responseStatus, log.responseTimeMs, log.errorMessage, now);
  }

  async queryRequestLogs(filter: LogFilter): Promise<RequestLog[]> {
    const conditions: string[] = [];
    const values: unknown[] = [];
    if (filter.userId) { conditions.push("user_id = ?"); values.push(filter.userId); }
    if (filter.apiKeyId) { conditions.push("api_key_id = ?"); values.push(filter.apiKeyId); }
    if (filter.method) { conditions.push("method = ?"); values.push(filter.method); }
    if (filter.startDate) { conditions.push("created_at >= ?"); values.push(filter.startDate.toISOString()); }
    if (filter.endDate) { conditions.push("created_at <= ?"); values.push(filter.endDate.toISOString()); }
    const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
    const limit = filter.limit ?? 100;
    const offset = filter.offset ?? 0;
    const rows = this.db.prepare(
      `SELECT * FROM request_logs ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`
    ).all(...values, limit, offset) as Record<string, unknown>[];
    return rows.map((r) => this.toRequestLog(r));
  }

  async cleanExpiredLogs(beforeDate: Date): Promise<number> {
    const result = this.db.prepare("DELETE FROM request_logs WHERE created_at < ?").run(beforeDate.toISOString());
    return result.changes;
  }

  // --- Usage Records ---

  async insertUsageRecord(record: Omit<UsageRecord, "id" | "createdAt">): Promise<void> {
    const id = uuidv4();
    const now = new Date().toISOString();
    this.db.prepare(
      `INSERT INTO usage_records (id, user_id, api_key_id, tool_name, unit_price, billing_month, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).run(id, record.userId, record.apiKeyId, record.toolName, record.unitPrice, record.billingMonth, now);
  }

  async getUsageStats(filter: UsageFilter): Promise<UsageStats[]> {
    const conditions: string[] = [];
    const values: unknown[] = [];
    if (filter.userId) { conditions.push("user_id = ?"); values.push(filter.userId); }
    if (filter.toolName) { conditions.push("tool_name = ?"); values.push(filter.toolName); }
    if (filter.billingMonth) { conditions.push("billing_month = ?"); values.push(filter.billingMonth); }
    if (filter.startDate) { conditions.push("created_at >= ?"); values.push(filter.startDate.toISOString()); }
    if (filter.endDate) { conditions.push("created_at <= ?"); values.push(filter.endDate.toISOString()); }
    const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
    const rows = this.db.prepare(
      `SELECT user_id, tool_name, COUNT(*) as count, SUM(unit_price) as total_cost
       FROM usage_records ${where}
       GROUP BY user_id, tool_name
       ORDER BY count DESC`
    ).all(...values) as Record<string, unknown>[];
    return rows.map((r) => ({
      userId: r.user_id as string,
      toolName: r.tool_name as string,
      count: r.count as number,
      totalCost: (r.total_cost as number) ?? 0,
    }));
  }

  async getUsageByUserAndTool(filter: UserToolFilter): Promise<UserToolStats[]> {
    const conditions: string[] = ["user_id = ?"];
    const values: unknown[] = [filter.userId];
    if (filter.billingMonth) { conditions.push("billing_month = ?"); values.push(filter.billingMonth); }
    if (filter.startDate) { conditions.push("created_at >= ?"); values.push(filter.startDate.toISOString()); }
    if (filter.endDate) { conditions.push("created_at <= ?"); values.push(filter.endDate.toISOString()); }
    const where = `WHERE ${conditions.join(" AND ")}`;
    const rows = this.db.prepare(
      `SELECT tool_name, COUNT(*) as count, SUM(unit_price) as total_cost
       FROM usage_records ${where}
       GROUP BY tool_name
       ORDER BY count DESC`
    ).all(...values) as Record<string, unknown>[];
    return rows.map((r) => ({
      toolName: r.tool_name as string,
      count: r.count as number,
      totalCost: (r.total_cost as number) ?? 0,
    }));
  }

  async getMonthlyUsageCount(userId: string, month: string): Promise<number> {
    const row = this.db.prepare(
      "SELECT COUNT(*) as count FROM usage_records WHERE user_id = ? AND billing_month = ?"
    ).get(userId, month) as Record<string, unknown>;
    return (row.count as number) ?? 0;
  }

  // --- Tool Pricing ---

  async setToolPrice(toolName: string, unitPrice: number): Promise<void> {
    const now = new Date().toISOString();
    this.db.prepare(
      `INSERT INTO tool_prices (tool_name, unit_price, updated_at) VALUES (?, ?, ?)
       ON CONFLICT(tool_name) DO UPDATE SET unit_price = excluded.unit_price, updated_at = excluded.updated_at`
    ).run(toolName, unitPrice, now);
  }

  async getToolPrice(toolName: string): Promise<number> {
    const row = this.db.prepare("SELECT unit_price FROM tool_prices WHERE tool_name = ?").get(toolName) as Record<string, unknown> | undefined;
    return row ? (row.unit_price as number) : 0;
  }

  async listToolPrices(): Promise<ToolPrice[]> {
    const rows = this.db.prepare("SELECT * FROM tool_prices ORDER BY tool_name").all() as Record<string, unknown>[];
    return rows.map((r) => ({
      toolName: r.tool_name as string,
      unitPrice: r.unit_price as number,
      updatedAt: new Date(r.updated_at as string),
    }));
  }

  async batchUpdateToolPrices(prices: { toolName: string; unitPrice: number }[]): Promise<void> {
    const now = new Date().toISOString();
    const stmt = this.db.prepare(
      `INSERT INTO tool_prices (tool_name, unit_price, updated_at) VALUES (?, ?, ?)
       ON CONFLICT(tool_name) DO UPDATE SET unit_price = excluded.unit_price, updated_at = excluded.updated_at`
    );
    const transaction = this.db.transaction((items: { toolName: string; unitPrice: number }[]) => {
      for (const item of items) {
        stmt.run(item.toolName, item.unitPrice, now);
      }
    });
    transaction(prices);
  }

  // --- Lifecycle ---

  async close(): Promise<void> {
    this.db.close();
  }
}
