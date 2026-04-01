import Database from "better-sqlite3";
import { v4 as uuidv4 } from "uuid";
import type {
  IStorage,
  User,
  ApiKey,
  RequestLog,
  RequestLogWithUser,
  UsageRecord,
  ToolPrice,
  ConnectionLog,
  UserGroup,
  GroupMember,
  CreateUserInput,
  CreateApiKeyInput,
  CreateUserGroupInput,
  CreateConnectionLogInput,
  ConnectionLogFilter,
  ListOptions,
  LogFilter,
  UsageFilter,
  UserToolFilter,
  UsageStats,
  UserToolStats,
  PaginatedResult,
  DashboardStats,
  DashboardToolStats,
  DashboardUserStats,
  DashboardRecentError,
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
        provider_key TEXT NOT NULL DEFAULT '',
        tool_name TEXT NOT NULL,
        unit_price REAL NOT NULL DEFAULT 0,
        updated_at TEXT NOT NULL DEFAULT (datetime('now')),
        PRIMARY KEY (provider_key, tool_name)
      );
    `);

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS user_groups (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL UNIQUE,
        description TEXT,
        allowed_tools TEXT,
        status TEXT NOT NULL DEFAULT 'active',
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS user_group_members (
        group_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        PRIMARY KEY (group_id, user_id),
        FOREIGN KEY (group_id) REFERENCES user_groups(id),
        FOREIGN KEY (user_id) REFERENCES users(id)
      );
      CREATE INDEX IF NOT EXISTS idx_ugm_user ON user_group_members(user_id);
    `);

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS connection_logs (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        api_key_id TEXT NOT NULL,
        session_id TEXT NOT NULL,
        transport_type TEXT NOT NULL,
        client_name TEXT,
        client_version TEXT,
        user_agent TEXT,
        ip_address TEXT,
        status TEXT NOT NULL DEFAULT 'online',
        connected_at TEXT NOT NULL DEFAULT (datetime('now')),
        disconnected_at TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_conn_logs_user ON connection_logs(user_id, status);
      CREATE INDEX IF NOT EXISTS idx_conn_logs_session ON connection_logs(session_id);
    `);

    // Migrations: add new columns if they don't exist
    const apiKeyCols = this.db.prepare("PRAGMA table_info(api_keys)").all() as { name: string }[];
    const apiKeyColNames = apiKeyCols.map((c) => c.name);
    if (!apiKeyColNames.includes("allowed_tools")) {
      this.db.exec("ALTER TABLE api_keys ADD COLUMN allowed_tools TEXT DEFAULT NULL");
    }
    if (!apiKeyColNames.includes("balance")) {
      this.db.exec("ALTER TABLE api_keys ADD COLUMN balance REAL DEFAULT -1");
    }

    const logCols = this.db.prepare("PRAGMA table_info(request_logs)").all() as { name: string }[];
    const logColNames = logCols.map((c) => c.name);
    if (!logColNames.includes("cost")) {
      this.db.exec("ALTER TABLE request_logs ADD COLUMN cost REAL DEFAULT 0");
    }
    if (!logColNames.includes("profile_key")) {
      this.db.exec("ALTER TABLE request_logs ADD COLUMN profile_key TEXT DEFAULT NULL");
    }
    if (!logColNames.includes("provider_key")) {
      this.db.exec("ALTER TABLE request_logs ADD COLUMN provider_key TEXT DEFAULT NULL");
    }

    const usageCols = this.db.prepare("PRAGMA table_info(usage_records)").all() as { name: string }[];
    const usageColNames = usageCols.map((c) => c.name);
    if (!usageColNames.includes("provider_key")) {
      this.db.exec("ALTER TABLE usage_records ADD COLUMN provider_key TEXT NOT NULL DEFAULT ''");
    }

    // Migrate tool_prices to composite primary key if needed
    const tpCols = this.db.prepare("PRAGMA table_info(tool_prices)").all() as { name: string }[];
    const tpColNames = tpCols.map((c) => c.name);
    if (!tpColNames.includes("provider_key")) {
      this.db.exec(`
        CREATE TABLE tool_prices_new (
          provider_key TEXT NOT NULL DEFAULT '',
          tool_name TEXT NOT NULL,
          unit_price REAL NOT NULL DEFAULT 0,
          updated_at TEXT NOT NULL DEFAULT (datetime('now')),
          PRIMARY KEY (provider_key, tool_name)
        );
        INSERT INTO tool_prices_new (provider_key, tool_name, unit_price, updated_at)
          SELECT '', tool_name, unit_price, updated_at FROM tool_prices;
        DROP TABLE tool_prices;
        ALTER TABLE tool_prices_new RENAME TO tool_prices;
      `);
    }
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
    const allowedToolsRaw = row.allowed_tools as string | null;
    return {
      id: row.id as string,
      userId: row.user_id as string,
      name: row.name as string,
      keyHash: row.key_hash as string,
      keyPrefix: row.key_prefix as string,
      quota: row.quota as number,
      allowedTools: allowedToolsRaw ? JSON.parse(allowedToolsRaw) : null,
      balance: (row.balance as number) ?? -1,
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
      providerKey: (row.provider_key as string) ?? null,
      toolName: (row.tool_name as string) ?? null,
      requestSummary: row.request_summary as string,
      responseStatus: row.response_status as "success" | "error",
      responseTimeMs: row.response_time_ms as number,
      errorMessage: (row.error_message as string) ?? null,
      cost: (row.cost as number) ?? 0,
      profileKey: (row.profile_key as string) ?? null,
      createdAt: new Date(row.created_at as string),
    };
  }

  private toRequestLogWithUser(row: Record<string, unknown>): RequestLogWithUser {
    return {
      ...this.toRequestLog(row),
      username: (row.username as string) ?? null,
    };
  }

  private toUsageRecord(row: Record<string, unknown>): UsageRecord {
    return {
      id: row.id as string,
      userId: row.user_id as string,
      apiKeyId: row.api_key_id as string,
      providerKey: (row.provider_key as string) ?? "",
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
    const allowedTools = input.allowedTools ? JSON.stringify(input.allowedTools) : null;
    const balance = input.balance ?? -1;
    this.db.prepare(
      `INSERT INTO api_keys (id, user_id, name, key_hash, key_prefix, quota, allowed_tools, balance, status, expires_at, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(id, input.userId, input.name, input.keyHash, input.keyPrefix, input.quota ?? 0, allowedTools, balance, status, input.expiresAt?.toISOString() ?? null, now);
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

  async updateApiKey(id: string, data: Partial<Pick<ApiKey, "name" | "quota" | "status" | "expiresAt" | "allowedTools" | "balance">>): Promise<ApiKey> {
    const sets: string[] = [];
    const values: unknown[] = [];
    if (data.name !== undefined) { sets.push("name = ?"); values.push(data.name); }
    if (data.quota !== undefined) { sets.push("quota = ?"); values.push(data.quota); }
    if (data.status !== undefined) { sets.push("status = ?"); values.push(data.status); }
    if (data.expiresAt !== undefined) { sets.push("expires_at = ?"); values.push(data.expiresAt?.toISOString() ?? null); }
    if (data.allowedTools !== undefined) { sets.push("allowed_tools = ?"); values.push(data.allowedTools ? JSON.stringify(data.allowedTools) : null); }
    if (data.balance !== undefined) { sets.push("balance = ?"); values.push(data.balance); }
    values.push(id);
    if (sets.length > 0) {
      this.db.prepare(`UPDATE api_keys SET ${sets.join(", ")} WHERE id = ?`).run(...values);
    }
    return (await this.getApiKey(id))!;
  }

  async regenerateApiKey(id: string, newKeyHash: string, newKeyPrefix: string): Promise<void> {
    this.db.prepare("UPDATE api_keys SET key_hash = ?, key_prefix = ? WHERE id = ?").run(newKeyHash, newKeyPrefix, id);
  }

  async deductBalance(apiKeyId: string, amount: number): Promise<void> {
    this.db.prepare("UPDATE api_keys SET balance = balance - ? WHERE id = ? AND balance > 0").run(amount, apiKeyId);
  }

  async deleteApiKey(id: string): Promise<void> {
    this.db.prepare("DELETE FROM api_keys WHERE id = ?").run(id);
  }

  // --- Request Logs ---

  async insertRequestLog(log: Omit<RequestLog, "id" | "createdAt"> & { createdAt?: Date }): Promise<void> {
    const id = uuidv4();
    const now = (log.createdAt ?? new Date()).toISOString();
    this.db.prepare(
      `INSERT INTO request_logs (id, user_id, api_key_id, method, provider_key, tool_name, request_summary, response_status, response_time_ms, error_message, cost, profile_key, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(id, log.userId, log.apiKeyId, log.method, log.providerKey ?? null, log.toolName, log.requestSummary, log.responseStatus, log.responseTimeMs, log.errorMessage, log.cost ?? 0, log.profileKey ?? null, now);
  }

  async queryRequestLogs(filter: LogFilter): Promise<PaginatedResult<RequestLogWithUser>> {
    const conditions: string[] = [];
    const values: unknown[] = [];
    if (filter.userId) { conditions.push("r.user_id = ?"); values.push(filter.userId); }
    if (filter.apiKeyId) { conditions.push("r.api_key_id = ?"); values.push(filter.apiKeyId); }
    if (filter.method) { conditions.push("r.method = ?"); values.push(filter.method); }
    if (filter.startDate) { conditions.push("r.created_at >= ?"); values.push(filter.startDate.toISOString()); }
    if (filter.endDate) { conditions.push("r.created_at <= ?"); values.push(filter.endDate.toISOString()); }
    const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
    const limit = filter.limit ?? 100;
    const offset = filter.offset ?? 0;
    const totalRow = this.db.prepare(`SELECT COUNT(*) as cnt FROM request_logs r ${where}`).get(...values) as Record<string, unknown>;
    const total = (totalRow?.cnt as number) ?? 0;
    const rows = this.db.prepare(
      `SELECT r.*, u.username FROM request_logs r LEFT JOIN users u ON r.user_id = u.id ${where} ORDER BY r.created_at DESC LIMIT ? OFFSET ?`
    ).all(...values, limit, offset) as Record<string, unknown>[];
    return { data: rows.map((r) => this.toRequestLogWithUser(r)), total };
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
      `INSERT INTO usage_records (id, user_id, api_key_id, provider_key, tool_name, unit_price, billing_month, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(id, record.userId, record.apiKeyId, record.providerKey, record.toolName, record.unitPrice, record.billingMonth, now);
  }

  async getUsageStats(filter: UsageFilter): Promise<PaginatedResult<UsageStats>> {
    const conditions: string[] = [];
    const values: unknown[] = [];
    if (filter.userId) { conditions.push("r.user_id = ?"); values.push(filter.userId); }
    if (filter.providerKey) { conditions.push("r.provider_key = ?"); values.push(filter.providerKey); }
    if (filter.toolName) { conditions.push("r.tool_name = ?"); values.push(filter.toolName); }
    if (filter.billingMonth) { conditions.push("r.billing_month = ?"); values.push(filter.billingMonth); }
    if (filter.startDate) { conditions.push("r.created_at >= ?"); values.push(filter.startDate.toISOString()); }
    if (filter.endDate) { conditions.push("r.created_at <= ?"); values.push(filter.endDate.toISOString()); }
    const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
    const limit = filter.limit ?? 100;
    const offset = filter.offset ?? 0;
    const totalRow = this.db.prepare(
      `SELECT COUNT(*) as cnt FROM (SELECT 1 FROM usage_records r ${where} GROUP BY r.user_id, r.provider_key, r.tool_name)`
    ).get(...values) as Record<string, unknown>;
    const total = (totalRow?.cnt as number) ?? 0;
    const rows = this.db.prepare(
      `SELECT r.user_id, r.provider_key, r.tool_name, COUNT(*) as count, SUM(r.unit_price) as total_cost, u.username
       FROM usage_records r LEFT JOIN users u ON r.user_id = u.id ${where}
       GROUP BY r.user_id, r.provider_key, r.tool_name
       ORDER BY count DESC LIMIT ? OFFSET ?`
    ).all(...values, limit, offset) as Record<string, unknown>[];
    return {
      data: rows.map((r) => ({
        userId: r.user_id as string,
        username: (r.username as string) ?? null,
        providerKey: (r.provider_key as string) ?? "",
        toolName: r.tool_name as string,
        count: r.count as number,
        totalCost: (r.total_cost as number) ?? 0,
      })),
      total,
    };
  }

  async getUsageByUserAndTool(filter: UserToolFilter): Promise<UserToolStats[]> {
    const conditions: string[] = ["user_id = ?"];
    const values: unknown[] = [filter.userId];
    if (filter.billingMonth) { conditions.push("billing_month = ?"); values.push(filter.billingMonth); }
    if (filter.startDate) { conditions.push("created_at >= ?"); values.push(filter.startDate.toISOString()); }
    if (filter.endDate) { conditions.push("created_at <= ?"); values.push(filter.endDate.toISOString()); }
    const where = `WHERE ${conditions.join(" AND ")}`;
    const rows = this.db.prepare(
      `SELECT provider_key, tool_name, COUNT(*) as count, SUM(unit_price) as total_cost
       FROM usage_records ${where}
       GROUP BY provider_key, tool_name
       ORDER BY count DESC`
    ).all(...values) as Record<string, unknown>[];
    return rows.map((r) => ({
      providerKey: (r.provider_key as string) ?? "",
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

  // --- Profile Stats ---

  async getProfileStats(providerKey: string, billingMonth: string): Promise<{ profileKey: string; count: number; totalCost: number }[]> {
    const rows = this.db.prepare(
      `SELECT profile_key, COUNT(*) as count, COALESCE(SUM(cost), 0) as total_cost
       FROM request_logs
       WHERE provider_key = ? AND created_at >= ? AND created_at < ? AND profile_key IS NOT NULL
       GROUP BY profile_key`
    ).all(providerKey, billingMonth + "-01", billingMonth + "-32") as Record<string, unknown>[];
    return rows.map((r) => ({
      profileKey: r.profile_key as string,
      count: r.count as number,
      totalCost: (r.total_cost as number) ?? 0,
    }));
  }

  async getProfileMonthlyCost(providerKey: string, profileKey: string, billingMonth: string): Promise<number> {
    const row = this.db.prepare(
      `SELECT COALESCE(SUM(cost), 0) as total_cost
       FROM request_logs
       WHERE provider_key = ? AND profile_key = ? AND created_at >= ? AND created_at < ?`
    ).get(providerKey, profileKey, billingMonth + "-01", billingMonth + "-32") as Record<string, unknown> | undefined;
    return (row?.total_cost as number) ?? 0;
  }

  // --- Tool Pricing ---

  async setToolPrice(providerKey: string, toolName: string, unitPrice: number): Promise<void> {
    const now = new Date().toISOString();
    this.db.prepare(
      `INSERT INTO tool_prices (provider_key, tool_name, unit_price, updated_at) VALUES (?, ?, ?, ?)
       ON CONFLICT(provider_key, tool_name) DO UPDATE SET unit_price = excluded.unit_price, updated_at = excluded.updated_at`
    ).run(providerKey, toolName, unitPrice, now);
  }

  async getToolPrice(providerKey: string, toolName: string): Promise<number> {
    const row = this.db.prepare("SELECT unit_price FROM tool_prices WHERE provider_key = ? AND tool_name = ?").get(providerKey, toolName) as Record<string, unknown> | undefined;
    return row ? (row.unit_price as number) : 0;
  }

  async listToolPrices(): Promise<ToolPrice[]> {
    const rows = this.db.prepare("SELECT * FROM tool_prices ORDER BY provider_key, tool_name").all() as Record<string, unknown>[];
    return rows.map((r) => ({
      providerKey: (r.provider_key as string) ?? "",
      toolName: r.tool_name as string,
      unitPrice: r.unit_price as number,
      updatedAt: new Date(r.updated_at as string),
    }));
  }

  async batchUpdateToolPrices(prices: { providerKey: string; toolName: string; unitPrice: number }[]): Promise<void> {
    const now = new Date().toISOString();
    const stmt = this.db.prepare(
      `INSERT INTO tool_prices (provider_key, tool_name, unit_price, updated_at) VALUES (?, ?, ?, ?)
       ON CONFLICT(provider_key, tool_name) DO UPDATE SET unit_price = excluded.unit_price, updated_at = excluded.updated_at`
    );
    const transaction = this.db.transaction((items: { providerKey: string; toolName: string; unitPrice: number }[]) => {
      for (const item of items) {
        stmt.run(item.providerKey, item.toolName, item.unitPrice, now);
      }
    });
    transaction(prices);
  }

  // --- User Groups ---

  private toUserGroup(row: Record<string, unknown>): UserGroup {
    const allowedToolsRaw = row.allowed_tools as string | null;
    return {
      id: row.id as string,
      name: row.name as string,
      description: (row.description as string) ?? null,
      allowedTools: allowedToolsRaw ? JSON.parse(allowedToolsRaw) : null,
      status: row.status as "active" | "disabled",
      createdAt: new Date(row.created_at as string),
      updatedAt: new Date(row.updated_at as string),
    };
  }

  async createUserGroup(input: CreateUserGroupInput): Promise<UserGroup> {
    const id = uuidv4();
    const now = new Date().toISOString();
    const allowedTools = input.allowedTools ? JSON.stringify(input.allowedTools) : null;
    this.db.prepare(
      `INSERT INTO user_groups (id, name, description, allowed_tools, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'active', ?, ?)`
    ).run(id, input.name, input.description ?? null, allowedTools, now, now);
    return (await this.getUserGroup(id))!;
  }

  async getUserGroup(id: string): Promise<UserGroup | null> {
    const row = this.db.prepare("SELECT * FROM user_groups WHERE id = ?").get(id) as Record<string, unknown> | undefined;
    return row ? this.toUserGroup(row) : null;
  }

  async listUserGroups(opts?: ListOptions): Promise<UserGroup[]> {
    const limit = opts?.limit ?? 100;
    const offset = opts?.offset ?? 0;
    const rows = this.db.prepare("SELECT * FROM user_groups ORDER BY created_at DESC LIMIT ? OFFSET ?").all(limit, offset) as Record<string, unknown>[];
    return rows.map((r) => this.toUserGroup(r));
  }

  async updateUserGroup(id: string, data: Partial<Pick<UserGroup, "name" | "description" | "allowedTools" | "status">>): Promise<UserGroup> {
    const sets: string[] = [];
    const values: unknown[] = [];
    if (data.name !== undefined) { sets.push("name = ?"); values.push(data.name); }
    if (data.description !== undefined) { sets.push("description = ?"); values.push(data.description); }
    if (data.allowedTools !== undefined) { sets.push("allowed_tools = ?"); values.push(data.allowedTools ? JSON.stringify(data.allowedTools) : null); }
    if (data.status !== undefined) { sets.push("status = ?"); values.push(data.status); }
    sets.push("updated_at = ?");
    values.push(new Date().toISOString());
    values.push(id);
    this.db.prepare(`UPDATE user_groups SET ${sets.join(", ")} WHERE id = ?`).run(...values);
    return (await this.getUserGroup(id))!;
  }

  async deleteUserGroup(id: string): Promise<void> {
    this.db.prepare("DELETE FROM user_group_members WHERE group_id = ?").run(id);
    this.db.prepare("DELETE FROM user_groups WHERE id = ?").run(id);
  }

  async addGroupMembers(groupId: string, userIds: string[]): Promise<void> {
    const now = new Date().toISOString();
    const stmt = this.db.prepare(
      "INSERT OR IGNORE INTO user_group_members (group_id, user_id, created_at) VALUES (?, ?, ?)"
    );
    const transaction = this.db.transaction((ids: string[]) => {
      for (const uid of ids) {
        stmt.run(groupId, uid, now);
      }
    });
    transaction(userIds);
  }

  async removeGroupMember(groupId: string, userId: string): Promise<void> {
    this.db.prepare("DELETE FROM user_group_members WHERE group_id = ? AND user_id = ?").run(groupId, userId);
  }

  async listGroupMembers(groupId: string): Promise<GroupMember[]> {
    const rows = this.db.prepare(
      `SELECT u.id as user_id, u.username, u.email, u.status, m.created_at as joined_at
       FROM user_group_members m JOIN users u ON m.user_id = u.id
       WHERE m.group_id = ? ORDER BY m.created_at DESC`
    ).all(groupId) as Record<string, unknown>[];
    return rows.map((r) => ({
      userId: r.user_id as string,
      username: r.username as string,
      email: (r.email as string) ?? null,
      status: r.status as "active" | "disabled",
      joinedAt: new Date(r.joined_at as string),
    }));
  }

  async listUserGroupsByUser(userId: string): Promise<UserGroup[]> {
    const rows = this.db.prepare(
      `SELECT g.* FROM user_groups g
       JOIN user_group_members m ON g.id = m.group_id
       WHERE m.user_id = ? ORDER BY g.name`
    ).all(userId) as Record<string, unknown>[];
    return rows.map((r) => this.toUserGroup(r));
  }

  async getUserEffectiveAllowedTools(userId: string): Promise<string[] | null> {
    const groups = await this.listUserGroupsByUser(userId);
    const activeGroups = groups.filter((g) => g.status === "active");
    if (activeGroups.length === 0) return null; // no groups -> no group-level restriction
    let hasNullGroup = false;
    const toolSet = new Set<string>();
    for (const g of activeGroups) {
      if (g.allowedTools === null) {
        hasNullGroup = true;
      } else {
        for (const t of g.allowedTools) toolSet.add(t);
      }
    }
    if (hasNullGroup) return null; // at least one group allows all
    return Array.from(toolSet);
  }

  async getGroupMemberCount(groupId: string): Promise<number> {
    const row = this.db.prepare("SELECT COUNT(*) as cnt FROM user_group_members WHERE group_id = ?").get(groupId) as Record<string, unknown>;
    return (row.cnt as number) ?? 0;
  }

  // --- Connection Logs ---

  private toConnectionLog(row: Record<string, unknown>): ConnectionLog {
    return {
      id: row.id as string,
      userId: row.user_id as string,
      apiKeyId: row.api_key_id as string,
      sessionId: row.session_id as string,
      transportType: row.transport_type as "sse" | "http",
      clientName: (row.client_name as string) ?? null,
      clientVersion: (row.client_version as string) ?? null,
      userAgent: (row.user_agent as string) ?? null,
      ipAddress: (row.ip_address as string) ?? null,
      status: row.status as "online" | "offline",
      connectedAt: new Date(row.connected_at as string),
      disconnectedAt: row.disconnected_at ? new Date(row.disconnected_at as string) : null,
    };
  }

  async insertConnectionLog(log: CreateConnectionLogInput): Promise<ConnectionLog> {
    const id = uuidv4();
    const now = new Date().toISOString();
    this.db.prepare(
      `INSERT INTO connection_logs (id, user_id, api_key_id, session_id, transport_type, user_agent, ip_address, status, connected_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'online', ?)`
    ).run(id, log.userId, log.apiKeyId, log.sessionId, log.transportType, log.userAgent ?? null, log.ipAddress ?? null, now);
    return this.toConnectionLog(
      this.db.prepare("SELECT * FROM connection_logs WHERE id = ?").get(id) as Record<string, unknown>
    );
  }

  async updateConnectionLogDisconnect(sessionId: string): Promise<void> {
    const now = new Date().toISOString();
    this.db.prepare(
      "UPDATE connection_logs SET status = 'offline', disconnected_at = ? WHERE session_id = ? AND status = 'online'"
    ).run(now, sessionId);
  }

  async updateConnectionLogClientInfo(sessionId: string, clientName: string, clientVersion: string): Promise<void> {
    this.db.prepare(
      "UPDATE connection_logs SET client_name = ?, client_version = ? WHERE session_id = ?"
    ).run(clientName, clientVersion, sessionId);
  }

  async listConnectionLogs(filter: ConnectionLogFilter): Promise<PaginatedResult<ConnectionLog>> {
    const conditions: string[] = [];
    const values: unknown[] = [];
    if (filter.userId) { conditions.push("c.user_id = ?"); values.push(filter.userId); }
    if (filter.status) { conditions.push("c.status = ?"); values.push(filter.status); }
    const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
    const limit = filter.limit ?? 100;
    const offset = filter.offset ?? 0;
    const totalRow = this.db.prepare(`SELECT COUNT(*) as cnt FROM connection_logs c ${where}`).get(...values) as Record<string, unknown>;
    const total = (totalRow?.cnt as number) ?? 0;
    const rows = this.db.prepare(
      `SELECT c.* FROM connection_logs c ${where} ORDER BY c.connected_at DESC LIMIT ? OFFSET ?`
    ).all(...values, limit, offset) as Record<string, unknown>[];
    return { data: rows.map((r) => this.toConnectionLog(r)), total };
  }

  async cleanStaleConnectionLogs(): Promise<number> {
    const now = new Date().toISOString();
    const result = this.db.prepare(
      "UPDATE connection_logs SET status = 'offline', disconnected_at = ? WHERE status = 'online'"
    ).run(now);
    return result.changes;
  }

  // --- Dashboard Stats ---

  async getDashboardStats(): Promise<DashboardStats> {
    // Overall request stats
    const overallRow = this.db.prepare(
      `SELECT
        COUNT(*) as total,
        SUM(CASE WHEN response_status = 'success' THEN 1 ELSE 0 END) as success_count,
        SUM(CASE WHEN response_status = 'error' THEN 1 ELSE 0 END) as error_count,
        AVG(response_time_ms) as avg_response_time,
        SUM(cost) as total_cost
      FROM request_logs`
    ).get() as Record<string, unknown>;

    const totalRequests = (overallRow.total as number) ?? 0;
    const successCount = (overallRow.success_count as number) ?? 0;
    const errorCount = (overallRow.error_count as number) ?? 0;
    const avgResponseTimeMs = Math.round((overallRow.avg_response_time as number) ?? 0);
    const totalCost = (overallRow.total_cost as number) ?? 0;

    // Top 10 tools by call count
    const toolRows = this.db.prepare(
      `SELECT
        provider_key,
        tool_name,
        COUNT(*) as call_count,
        SUM(cost) as total_cost,
        AVG(response_time_ms) as avg_response_time
      FROM request_logs
      WHERE tool_name IS NOT NULL
      GROUP BY provider_key, tool_name
      ORDER BY call_count DESC
      LIMIT 10`
    ).all() as Record<string, unknown>[];

    const toolStats: DashboardToolStats[] = toolRows.map((r) => ({
      providerKey: (r.provider_key as string) ?? "",
      toolName: r.tool_name as string,
      callCount: r.call_count as number,
      totalCost: (r.total_cost as number) ?? 0,
      avgResponseTimeMs: Math.round((r.avg_response_time as number) ?? 0),
    }));

    // Top 10 users by cost
    const userRows = this.db.prepare(
      `SELECT
        r.user_id,
        u.username,
        COUNT(*) as call_count,
        SUM(r.cost) as total_cost
      FROM request_logs r
      LEFT JOIN users u ON r.user_id = u.id
      GROUP BY r.user_id
      ORDER BY total_cost DESC
      LIMIT 10`
    ).all() as Record<string, unknown>[];

    const userStats: DashboardUserStats[] = userRows.map((r) => ({
      userId: r.user_id as string,
      username: (r.username as string) ?? null,
      callCount: r.call_count as number,
      totalCost: (r.total_cost as number) ?? 0,
    }));

    // Recent 5 errors
    const errorRows = this.db.prepare(
      `SELECT r.provider_key, r.tool_name, r.error_message, u.username, r.created_at
      FROM request_logs r
      LEFT JOIN users u ON r.user_id = u.id
      WHERE r.response_status = 'error'
      ORDER BY r.created_at DESC
      LIMIT 5`
    ).all() as Record<string, unknown>[];

    const recentErrors: DashboardRecentError[] = errorRows.map((r) => ({
      providerKey: (r.provider_key as string) ?? null,
      toolName: (r.tool_name as string) ?? null,
      errorMessage: (r.error_message as string) ?? null,
      username: (r.username as string) ?? null,
      createdAt: new Date(r.created_at as string),
    }));

    return {
      totalRequests,
      successCount,
      errorCount,
      avgResponseTimeMs,
      totalCost,
      toolStats,
      userStats,
      recentErrors,
    };
  }

  // --- Lifecycle ---

  async close(): Promise<void> {
    this.db.close();
  }
}
