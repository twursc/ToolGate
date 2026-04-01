import pg from "pg";
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

const { Pool } = pg;

export class PostgresStorage implements IStorage {
  private pool: pg.Pool;

  constructor(config: { host: string; port: number; database: string; username: string; password: string }) {
    this.pool = new Pool({
      host: config.host,
      port: config.port,
      database: config.database,
      user: config.username,
      password: config.password,
    });
  }

  async initialize(): Promise<void> {
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS users (
        id UUID PRIMARY KEY,
        username VARCHAR(255) NOT NULL UNIQUE,
        email VARCHAR(255),
        note TEXT,
        status VARCHAR(20) NOT NULL DEFAULT 'active',
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS api_keys (
        id UUID PRIMARY KEY,
        user_id UUID NOT NULL REFERENCES users(id),
        name VARCHAR(255) NOT NULL,
        key_hash VARCHAR(255) NOT NULL UNIQUE,
        key_prefix VARCHAR(8) NOT NULL,
        quota INTEGER NOT NULL DEFAULT 0,
        status VARCHAR(20) NOT NULL DEFAULT 'active',
        expires_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS request_logs (
        id UUID PRIMARY KEY,
        user_id UUID NOT NULL,
        api_key_id UUID NOT NULL,
        method VARCHAR(50) NOT NULL,
        tool_name VARCHAR(255),
        request_summary TEXT NOT NULL DEFAULT '',
        response_status VARCHAR(20) NOT NULL,
        response_time_ms INTEGER NOT NULL DEFAULT 0,
        error_message TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_request_logs_user_created
        ON request_logs(user_id, created_at);
    `);
    // PLACEHOLDER_PG_INIT_2
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS usage_records (
        id UUID PRIMARY KEY,
        user_id UUID NOT NULL,
        api_key_id UUID NOT NULL,
        tool_name VARCHAR(255) NOT NULL,
        unit_price DECIMAL(10,4) NOT NULL DEFAULT 0,
        billing_month VARCHAR(7) NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_usage_user_month
        ON usage_records(user_id, billing_month);
      CREATE INDEX IF NOT EXISTS idx_usage_tool_month
        ON usage_records(tool_name, billing_month);

      CREATE TABLE IF NOT EXISTS tool_prices (
        provider_key VARCHAR(255) NOT NULL DEFAULT '',
        tool_name VARCHAR(255) NOT NULL,
        unit_price DECIMAL(10,4) NOT NULL DEFAULT 0,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        PRIMARY KEY (provider_key, tool_name)
      );
    `);

    // Migrations: add new columns if they don't exist
    await this.pool.query(`
      DO $$ BEGIN
        ALTER TABLE api_keys ADD COLUMN IF NOT EXISTS allowed_tools TEXT DEFAULT NULL;
        ALTER TABLE api_keys ADD COLUMN IF NOT EXISTS balance DECIMAL(10,4) DEFAULT -1;
        ALTER TABLE request_logs ADD COLUMN IF NOT EXISTS cost DECIMAL(10,4) DEFAULT 0;
        ALTER TABLE request_logs ADD COLUMN IF NOT EXISTS profile_key VARCHAR(255) DEFAULT NULL;
        ALTER TABLE request_logs ADD COLUMN IF NOT EXISTS provider_key VARCHAR(255) DEFAULT NULL;
        ALTER TABLE usage_records ADD COLUMN IF NOT EXISTS provider_key VARCHAR(255) NOT NULL DEFAULT '';
      END $$;
    `);

    // Migrate tool_prices to composite primary key if needed
    await this.pool.query(`
      DO $$ BEGIN
        IF EXISTS (
          SELECT 1 FROM information_schema.table_constraints
          WHERE table_name = 'tool_prices' AND constraint_type = 'PRIMARY KEY'
          AND constraint_name IN (
            SELECT constraint_name FROM information_schema.key_column_usage
            WHERE table_name = 'tool_prices'
            GROUP BY constraint_name
            HAVING COUNT(*) = 1
          )
        ) THEN
          ALTER TABLE tool_prices ADD COLUMN IF NOT EXISTS provider_key VARCHAR(255) NOT NULL DEFAULT '';
          ALTER TABLE tool_prices DROP CONSTRAINT tool_prices_pkey;
          ALTER TABLE tool_prices ADD PRIMARY KEY (provider_key, tool_name);
        END IF;
      END $$;
    `);

    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS user_groups (
        id UUID PRIMARY KEY,
        name VARCHAR(255) NOT NULL UNIQUE,
        description TEXT,
        allowed_tools TEXT,
        status VARCHAR(20) NOT NULL DEFAULT 'active',
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS user_group_members (
        group_id UUID NOT NULL REFERENCES user_groups(id),
        user_id UUID NOT NULL REFERENCES users(id),
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        PRIMARY KEY (group_id, user_id)
      );
      CREATE INDEX IF NOT EXISTS idx_ugm_user ON user_group_members(user_id);
    `);

    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS connection_logs (
        id UUID PRIMARY KEY,
        user_id UUID NOT NULL,
        api_key_id UUID NOT NULL,
        session_id VARCHAR(255) NOT NULL,
        transport_type VARCHAR(10) NOT NULL,
        client_name VARCHAR(255),
        client_version VARCHAR(255),
        user_agent TEXT,
        ip_address VARCHAR(45),
        status VARCHAR(10) NOT NULL DEFAULT 'online',
        connected_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        disconnected_at TIMESTAMPTZ
      );
      CREATE INDEX IF NOT EXISTS idx_conn_logs_user ON connection_logs(user_id, status);
      CREATE INDEX IF NOT EXISTS idx_conn_logs_session ON connection_logs(session_id);
    `);
  }

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
      quota: Number(row.quota),
      allowedTools: allowedToolsRaw ? JSON.parse(allowedToolsRaw) : null,
      balance: Number(row.balance ?? -1),
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
      responseTimeMs: Number(row.response_time_ms),
      errorMessage: (row.error_message as string) ?? null,
      cost: Number(row.cost ?? 0),
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

  // --- User Management ---

  async createUser(input: CreateUserInput): Promise<User> {
    const id = uuidv4();
    const { rows } = await this.pool.query(
      `INSERT INTO users (id, username, email, note) VALUES ($1, $2, $3, $4) RETURNING *`,
      [id, input.username, input.email ?? null, input.note ?? null]
    );
    return this.toUser(rows[0]);
  }

  async getUser(id: string): Promise<User | null> {
    const { rows } = await this.pool.query("SELECT * FROM users WHERE id = $1", [id]);
    return rows[0] ? this.toUser(rows[0]) : null;
  }

  async getUserByUsername(username: string): Promise<User | null> {
    const { rows } = await this.pool.query("SELECT * FROM users WHERE username = $1", [username]);
    return rows[0] ? this.toUser(rows[0]) : null;
  }

  async listUsers(opts?: ListOptions): Promise<User[]> {
    const limit = opts?.limit ?? 100;
    const offset = opts?.offset ?? 0;
    const { rows } = await this.pool.query("SELECT * FROM users ORDER BY created_at DESC LIMIT $1 OFFSET $2", [limit, offset]);
    return rows.map((r: Record<string, unknown>) => this.toUser(r));
  }

  async updateUser(id: string, data: Partial<Pick<User, "username" | "email" | "note" | "status">>): Promise<User> {
    const sets: string[] = [];
    const values: unknown[] = [];
    let idx = 1;
    if (data.username !== undefined) { sets.push(`username = $${idx++}`); values.push(data.username); }
    if (data.email !== undefined) { sets.push(`email = $${idx++}`); values.push(data.email); }
    if (data.note !== undefined) { sets.push(`note = $${idx++}`); values.push(data.note); }
    if (data.status !== undefined) { sets.push(`status = $${idx++}`); values.push(data.status); }
    sets.push(`updated_at = NOW()`);
    values.push(id);
    const { rows } = await this.pool.query(`UPDATE users SET ${sets.join(", ")} WHERE id = $${idx} RETURNING *`, values);
    return this.toUser(rows[0]);
  }

  // --- API Key Management ---

  async createApiKey(input: CreateApiKeyInput): Promise<ApiKey> {
    const id = uuidv4();
    const status = input.status ?? "active";
    const allowedTools = input.allowedTools ? JSON.stringify(input.allowedTools) : null;
    const balance = input.balance ?? -1;
    const { rows } = await this.pool.query(
      `INSERT INTO api_keys (id, user_id, name, key_hash, key_prefix, quota, allowed_tools, balance, status, expires_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING *`,
      [id, input.userId, input.name, input.keyHash, input.keyPrefix, input.quota ?? 0, allowedTools, balance, status, input.expiresAt ?? null]
    );
    return this.toApiKey(rows[0]);
  }

  async getApiKey(id: string): Promise<ApiKey | null> {
    const { rows } = await this.pool.query("SELECT * FROM api_keys WHERE id = $1", [id]);
    return rows[0] ? this.toApiKey(rows[0]) : null;
  }

  async getApiKeyByHash(keyHash: string): Promise<ApiKey | null> {
    const { rows } = await this.pool.query("SELECT * FROM api_keys WHERE key_hash = $1", [keyHash]);
    return rows[0] ? this.toApiKey(rows[0]) : null;
  }

  async listApiKeysByUser(userId: string): Promise<ApiKey[]> {
    const { rows } = await this.pool.query("SELECT * FROM api_keys WHERE user_id = $1 ORDER BY created_at DESC", [userId]);
    return rows.map((r: Record<string, unknown>) => this.toApiKey(r));
  }

  async updateApiKey(id: string, data: Partial<Pick<ApiKey, "name" | "quota" | "status" | "expiresAt" | "allowedTools" | "balance">>): Promise<ApiKey> {
    const sets: string[] = [];
    const values: unknown[] = [];
    let idx = 1;
    if (data.name !== undefined) { sets.push(`name = $${idx++}`); values.push(data.name); }
    if (data.quota !== undefined) { sets.push(`quota = $${idx++}`); values.push(data.quota); }
    if (data.status !== undefined) { sets.push(`status = $${idx++}`); values.push(data.status); }
    if (data.expiresAt !== undefined) { sets.push(`expires_at = $${idx++}`); values.push(data.expiresAt); }
    if (data.allowedTools !== undefined) { sets.push(`allowed_tools = $${idx++}`); values.push(data.allowedTools ? JSON.stringify(data.allowedTools) : null); }
    if (data.balance !== undefined) { sets.push(`balance = $${idx++}`); values.push(data.balance); }
    values.push(id);
    const { rows } = await this.pool.query(`UPDATE api_keys SET ${sets.join(", ")} WHERE id = $${idx} RETURNING *`, values);
    return this.toApiKey(rows[0]);
  }

  async regenerateApiKey(id: string, newKeyHash: string, newKeyPrefix: string): Promise<void> {
    await this.pool.query("UPDATE api_keys SET key_hash = $1, key_prefix = $2 WHERE id = $3", [newKeyHash, newKeyPrefix, id]);
  }

  async deductBalance(apiKeyId: string, amount: number): Promise<void> {
    await this.pool.query("UPDATE api_keys SET balance = balance - $1 WHERE id = $2 AND balance > 0", [amount, apiKeyId]);
  }

  async deleteApiKey(id: string): Promise<void> {
    await this.pool.query("DELETE FROM api_keys WHERE id = $1", [id]);
  }

  // --- Request Logs ---

  async insertRequestLog(log: Omit<RequestLog, "id" | "createdAt"> & { createdAt?: Date }): Promise<void> {
    const id = uuidv4();
    await this.pool.query(
      `INSERT INTO request_logs (id, user_id, api_key_id, method, provider_key, tool_name, request_summary, response_status, response_time_ms, error_message, cost, profile_key)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
      [id, log.userId, log.apiKeyId, log.method, log.providerKey ?? null, log.toolName, log.requestSummary, log.responseStatus, log.responseTimeMs, log.errorMessage, log.cost ?? 0, log.profileKey ?? null]
    );
  }

  async queryRequestLogs(filter: LogFilter): Promise<PaginatedResult<RequestLogWithUser>> {
    const conditions: string[] = [];
    const values: unknown[] = [];
    let idx = 1;
    if (filter.userId) { conditions.push(`r.user_id = $${idx++}`); values.push(filter.userId); }
    if (filter.apiKeyId) { conditions.push(`r.api_key_id = $${idx++}`); values.push(filter.apiKeyId); }
    if (filter.method) { conditions.push(`r.method = $${idx++}`); values.push(filter.method); }
    if (filter.startDate) { conditions.push(`r.created_at >= $${idx++}`); values.push(filter.startDate); }
    if (filter.endDate) { conditions.push(`r.created_at <= $${idx++}`); values.push(filter.endDate); }
    const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
    const countResult = await this.pool.query(`SELECT COUNT(*)::int as cnt FROM request_logs r ${where}`, values);
    const total = countResult.rows[0]?.cnt ?? 0;
    const limit = filter.limit ?? 100;
    const offset = filter.offset ?? 0;
    const dataValues = [...values, limit, offset];
    const { rows } = await this.pool.query(
      `SELECT r.*, u.username FROM request_logs r LEFT JOIN users u ON r.user_id = u.id ${where} ORDER BY r.created_at DESC LIMIT $${idx++} OFFSET $${idx}`,
      dataValues
    );
    return { data: rows.map((r: Record<string, unknown>) => this.toRequestLogWithUser(r)), total };
  }

  async cleanExpiredLogs(beforeDate: Date): Promise<number> {
    const result = await this.pool.query("DELETE FROM request_logs WHERE created_at < $1", [beforeDate]);
    return result.rowCount ?? 0;
  }

  // --- Usage Records ---

  async insertUsageRecord(record: Omit<UsageRecord, "id" | "createdAt">): Promise<void> {
    const id = uuidv4();
    await this.pool.query(
      `INSERT INTO usage_records (id, user_id, api_key_id, provider_key, tool_name, unit_price, billing_month)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [id, record.userId, record.apiKeyId, record.providerKey, record.toolName, record.unitPrice, record.billingMonth]
    );
  }

  async getUsageStats(filter: UsageFilter): Promise<PaginatedResult<UsageStats>> {
    const conditions: string[] = [];
    const values: unknown[] = [];
    let idx = 1;
    if (filter.userId) { conditions.push(`r.user_id = $${idx++}`); values.push(filter.userId); }
    if (filter.providerKey) { conditions.push(`r.provider_key = $${idx++}`); values.push(filter.providerKey); }
    if (filter.toolName) { conditions.push(`r.tool_name = $${idx++}`); values.push(filter.toolName); }
    if (filter.billingMonth) { conditions.push(`r.billing_month = $${idx++}`); values.push(filter.billingMonth); }
    if (filter.startDate) { conditions.push(`r.created_at >= $${idx++}`); values.push(filter.startDate); }
    if (filter.endDate) { conditions.push(`r.created_at <= $${idx++}`); values.push(filter.endDate); }
    const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
    const countResult = await this.pool.query(
      `SELECT COUNT(*)::int as cnt FROM (SELECT 1 FROM usage_records r ${where} GROUP BY r.user_id, r.provider_key, r.tool_name) sub`,
      values
    );
    const total = countResult.rows[0]?.cnt ?? 0;
    const limit = filter.limit ?? 100;
    const offset = filter.offset ?? 0;
    const dataValues = [...values, limit, offset];
    const { rows } = await this.pool.query(
      `SELECT r.user_id, r.provider_key, r.tool_name, COUNT(*)::int as count, COALESCE(SUM(r.unit_price), 0)::float as total_cost, u.username
       FROM usage_records r LEFT JOIN users u ON r.user_id = u.id ${where} GROUP BY r.user_id, r.provider_key, r.tool_name, u.username ORDER BY count DESC LIMIT $${idx++} OFFSET $${idx}`,
      dataValues
    );
    return {
      data: rows.map((r: Record<string, unknown>) => ({
        userId: r.user_id as string,
        username: (r.username as string) ?? null,
        providerKey: (r.provider_key as string) ?? "",
        toolName: r.tool_name as string,
        count: r.count as number,
        totalCost: r.total_cost as number,
      })),
      total,
    };
  }

  async getUsageByUserAndTool(filter: UserToolFilter): Promise<UserToolStats[]> {
    const conditions: string[] = ["user_id = $1"];
    const values: unknown[] = [filter.userId];
    let idx = 2;
    if (filter.billingMonth) { conditions.push(`billing_month = $${idx++}`); values.push(filter.billingMonth); }
    if (filter.startDate) { conditions.push(`created_at >= $${idx++}`); values.push(filter.startDate); }
    if (filter.endDate) { conditions.push(`created_at <= $${idx++}`); values.push(filter.endDate); }
    const where = `WHERE ${conditions.join(" AND ")}`;
    const { rows } = await this.pool.query(
      `SELECT provider_key, tool_name, COUNT(*)::int as count, COALESCE(SUM(unit_price), 0)::float as total_cost
       FROM usage_records ${where} GROUP BY provider_key, tool_name ORDER BY count DESC`,
      values
    );
    return rows.map((r: Record<string, unknown>) => ({
      providerKey: (r.provider_key as string) ?? "",
      toolName: r.tool_name as string,
      count: r.count as number,
      totalCost: r.total_cost as number,
    }));
  }

  async getMonthlyUsageCount(userId: string, month: string): Promise<number> {
    const { rows } = await this.pool.query(
      "SELECT COUNT(*)::int as count FROM usage_records WHERE user_id = $1 AND billing_month = $2",
      [userId, month]
    );
    return rows[0]?.count ?? 0;
  }

  // --- Profile Stats ---

  async getProfileStats(providerKey: string, billingMonth: string): Promise<{ profileKey: string; count: number; totalCost: number }[]> {
    const { rows } = await this.pool.query(
      `SELECT profile_key, COUNT(*)::int as count, COALESCE(SUM(cost), 0)::float as total_cost
       FROM request_logs
       WHERE provider_key = $1 AND created_at >= ($2 || '-01')::date AND created_at < (($2 || '-01')::date + interval '1 month') AND profile_key IS NOT NULL
       GROUP BY profile_key`,
      [providerKey, billingMonth]
    );
    return rows.map((r: Record<string, unknown>) => ({
      profileKey: r.profile_key as string,
      count: r.count as number,
      totalCost: r.total_cost as number,
    }));
  }

  async getProfileMonthlyCost(providerKey: string, profileKey: string, billingMonth: string): Promise<number> {
    const { rows } = await this.pool.query(
      `SELECT COALESCE(SUM(cost), 0)::float as total_cost
       FROM request_logs
       WHERE provider_key = $1 AND profile_key = $2 AND created_at >= ($3 || '-01')::date AND created_at < (($3 || '-01')::date + interval '1 month')`,
      [providerKey, profileKey, billingMonth]
    );
    return (rows[0]?.total_cost as number) ?? 0;
  }

  // --- Tool Pricing ---

  async setToolPrice(providerKey: string, toolName: string, unitPrice: number): Promise<void> {
    await this.pool.query(
      `INSERT INTO tool_prices (provider_key, tool_name, unit_price, updated_at) VALUES ($1, $2, $3, NOW())
       ON CONFLICT(provider_key, tool_name) DO UPDATE SET unit_price = EXCLUDED.unit_price, updated_at = NOW()`,
      [providerKey, toolName, unitPrice]
    );
  }

  async getToolPrice(providerKey: string, toolName: string): Promise<number> {
    const { rows } = await this.pool.query("SELECT unit_price FROM tool_prices WHERE provider_key = $1 AND tool_name = $2", [providerKey, toolName]);
    return rows[0] ? Number(rows[0].unit_price) : 0;
  }

  async listToolPrices(): Promise<ToolPrice[]> {
    const { rows } = await this.pool.query("SELECT * FROM tool_prices ORDER BY provider_key, tool_name");
    return rows.map((r: Record<string, unknown>) => ({
      providerKey: (r.provider_key as string) ?? "",
      toolName: r.tool_name as string,
      unitPrice: Number(r.unit_price),
      updatedAt: new Date(r.updated_at as string),
    }));
  }

  async batchUpdateToolPrices(prices: { providerKey: string; toolName: string; unitPrice: number }[]): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      for (const p of prices) {
        await client.query(
          `INSERT INTO tool_prices (provider_key, tool_name, unit_price, updated_at) VALUES ($1, $2, $3, NOW())
           ON CONFLICT(provider_key, tool_name) DO UPDATE SET unit_price = EXCLUDED.unit_price, updated_at = NOW()`,
          [p.providerKey, p.toolName, p.unitPrice]
        );
      }
      await client.query("COMMIT");
    } catch (e) {
      await client.query("ROLLBACK");
      throw e;
    } finally {
      client.release();
    }
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
    const allowedTools = input.allowedTools ? JSON.stringify(input.allowedTools) : null;
    const { rows } = await this.pool.query(
      `INSERT INTO user_groups (id, name, description, allowed_tools) VALUES ($1, $2, $3, $4) RETURNING *`,
      [id, input.name, input.description ?? null, allowedTools]
    );
    return this.toUserGroup(rows[0]);
  }

  async getUserGroup(id: string): Promise<UserGroup | null> {
    const { rows } = await this.pool.query("SELECT * FROM user_groups WHERE id = $1", [id]);
    return rows[0] ? this.toUserGroup(rows[0]) : null;
  }

  async listUserGroups(opts?: ListOptions): Promise<UserGroup[]> {
    const limit = opts?.limit ?? 100;
    const offset = opts?.offset ?? 0;
    const { rows } = await this.pool.query("SELECT * FROM user_groups ORDER BY created_at DESC LIMIT $1 OFFSET $2", [limit, offset]);
    return rows.map((r: Record<string, unknown>) => this.toUserGroup(r));
  }

  async updateUserGroup(id: string, data: Partial<Pick<UserGroup, "name" | "description" | "allowedTools" | "status">>): Promise<UserGroup> {
    const sets: string[] = [];
    const values: unknown[] = [];
    let idx = 1;
    if (data.name !== undefined) { sets.push(`name = $${idx++}`); values.push(data.name); }
    if (data.description !== undefined) { sets.push(`description = $${idx++}`); values.push(data.description); }
    if (data.allowedTools !== undefined) { sets.push(`allowed_tools = $${idx++}`); values.push(data.allowedTools ? JSON.stringify(data.allowedTools) : null); }
    if (data.status !== undefined) { sets.push(`status = $${idx++}`); values.push(data.status); }
    sets.push(`updated_at = NOW()`);
    values.push(id);
    const { rows } = await this.pool.query(`UPDATE user_groups SET ${sets.join(", ")} WHERE id = $${idx} RETURNING *`, values);
    return this.toUserGroup(rows[0]);
  }

  async deleteUserGroup(id: string): Promise<void> {
    await this.pool.query("DELETE FROM user_group_members WHERE group_id = $1", [id]);
    await this.pool.query("DELETE FROM user_groups WHERE id = $1", [id]);
  }

  async addGroupMembers(groupId: string, userIds: string[]): Promise<void> {
    for (const uid of userIds) {
      await this.pool.query(
        "INSERT INTO user_group_members (group_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING",
        [groupId, uid]
      );
    }
  }

  async removeGroupMember(groupId: string, userId: string): Promise<void> {
    await this.pool.query("DELETE FROM user_group_members WHERE group_id = $1 AND user_id = $2", [groupId, userId]);
  }

  async listGroupMembers(groupId: string): Promise<GroupMember[]> {
    const { rows } = await this.pool.query(
      `SELECT u.id as user_id, u.username, u.email, u.status, m.created_at as joined_at
       FROM user_group_members m JOIN users u ON m.user_id = u.id
       WHERE m.group_id = $1 ORDER BY m.created_at DESC`,
      [groupId]
    );
    return rows.map((r: Record<string, unknown>) => ({
      userId: r.user_id as string,
      username: r.username as string,
      email: (r.email as string) ?? null,
      status: r.status as "active" | "disabled",
      joinedAt: new Date(r.joined_at as string),
    }));
  }

  async listUserGroupsByUser(userId: string): Promise<UserGroup[]> {
    const { rows } = await this.pool.query(
      `SELECT g.* FROM user_groups g
       JOIN user_group_members m ON g.id = m.group_id
       WHERE m.user_id = $1 ORDER BY g.name`,
      [userId]
    );
    return rows.map((r: Record<string, unknown>) => this.toUserGroup(r));
  }

  async getUserEffectiveAllowedTools(userId: string): Promise<string[] | null> {
    const groups = await this.listUserGroupsByUser(userId);
    const activeGroups = groups.filter((g) => g.status === "active");
    if (activeGroups.length === 0) return null;
    let hasNullGroup = false;
    const toolSet = new Set<string>();
    for (const g of activeGroups) {
      if (g.allowedTools === null) {
        hasNullGroup = true;
      } else {
        for (const t of g.allowedTools) toolSet.add(t);
      }
    }
    if (hasNullGroup) return null;
    return Array.from(toolSet);
  }

  async getGroupMemberCount(groupId: string): Promise<number> {
    const { rows } = await this.pool.query("SELECT COUNT(*)::int as cnt FROM user_group_members WHERE group_id = $1", [groupId]);
    return rows[0]?.cnt ?? 0;
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
    const { rows } = await this.pool.query(
      `INSERT INTO connection_logs (id, user_id, api_key_id, session_id, transport_type, user_agent, ip_address, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, 'online') RETURNING *`,
      [id, log.userId, log.apiKeyId, log.sessionId, log.transportType, log.userAgent ?? null, log.ipAddress ?? null]
    );
    return this.toConnectionLog(rows[0]);
  }

  async updateConnectionLogDisconnect(sessionId: string): Promise<void> {
    await this.pool.query(
      "UPDATE connection_logs SET status = 'offline', disconnected_at = NOW() WHERE session_id = $1 AND status = 'online'",
      [sessionId]
    );
  }

  async updateConnectionLogClientInfo(sessionId: string, clientName: string, clientVersion: string): Promise<void> {
    await this.pool.query(
      "UPDATE connection_logs SET client_name = $1, client_version = $2 WHERE session_id = $3",
      [clientName, clientVersion, sessionId]
    );
  }

  async listConnectionLogs(filter: ConnectionLogFilter): Promise<PaginatedResult<ConnectionLog>> {
    const conditions: string[] = [];
    const values: unknown[] = [];
    let idx = 1;
    if (filter.userId) { conditions.push(`c.user_id = $${idx++}`); values.push(filter.userId); }
    if (filter.status) { conditions.push(`c.status = $${idx++}`); values.push(filter.status); }
    const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
    const countResult = await this.pool.query(`SELECT COUNT(*)::int as cnt FROM connection_logs c ${where}`, values);
    const total = countResult.rows[0]?.cnt ?? 0;
    const limit = filter.limit ?? 100;
    const offset = filter.offset ?? 0;
    const dataValues = [...values, limit, offset];
    const { rows } = await this.pool.query(
      `SELECT c.* FROM connection_logs c ${where} ORDER BY c.connected_at DESC LIMIT $${idx++} OFFSET $${idx}`,
      dataValues
    );
    return { data: rows.map((r: Record<string, unknown>) => this.toConnectionLog(r)), total };
  }

  async cleanStaleConnectionLogs(): Promise<number> {
    const result = await this.pool.query(
      "UPDATE connection_logs SET status = 'offline', disconnected_at = NOW() WHERE status = 'online'"
    );
    return result.rowCount ?? 0;
  }

  // --- Dashboard Stats ---

  async getDashboardStats(): Promise<DashboardStats> {
    const overallResult = await this.pool.query(
      `SELECT
        COUNT(*)::int as total,
        SUM(CASE WHEN response_status = 'success' THEN 1 ELSE 0 END)::int as success_count,
        SUM(CASE WHEN response_status = 'error' THEN 1 ELSE 0 END)::int as error_count,
        AVG(response_time_ms)::int as avg_response_time,
        COALESCE(SUM(cost), 0) as total_cost
      FROM request_logs`
    );
    const ov = overallResult.rows[0];

    const toolResult = await this.pool.query(
      `SELECT
        provider_key,
        tool_name,
        COUNT(*)::int as call_count,
        COALESCE(SUM(cost), 0) as total_cost,
        AVG(response_time_ms)::int as avg_response_time
      FROM request_logs
      WHERE tool_name IS NOT NULL
      GROUP BY provider_key, tool_name
      ORDER BY call_count DESC
      LIMIT 10`
    );
    const toolStats: DashboardToolStats[] = toolResult.rows.map((r: Record<string, unknown>) => ({
      providerKey: (r.provider_key as string) ?? "",
      toolName: r.tool_name as string,
      callCount: r.call_count as number,
      totalCost: Number(r.total_cost) ?? 0,
      avgResponseTimeMs: (r.avg_response_time as number) ?? 0,
    }));

    const userResult = await this.pool.query(
      `SELECT
        r.user_id,
        u.username,
        COUNT(*)::int as call_count,
        COALESCE(SUM(r.cost), 0) as total_cost
      FROM request_logs r
      LEFT JOIN users u ON r.user_id = u.id
      GROUP BY r.user_id, u.username
      ORDER BY total_cost DESC
      LIMIT 10`
    );
    const userStats: DashboardUserStats[] = userResult.rows.map((r: Record<string, unknown>) => ({
      userId: r.user_id as string,
      username: (r.username as string) ?? null,
      callCount: r.call_count as number,
      totalCost: Number(r.total_cost) ?? 0,
    }));

    const errorResult = await this.pool.query(
      `SELECT r.provider_key, r.tool_name, r.error_message, u.username, r.created_at
      FROM request_logs r
      LEFT JOIN users u ON r.user_id = u.id
      WHERE r.response_status = 'error'
      ORDER BY r.created_at DESC
      LIMIT 5`
    );
    const recentErrors: DashboardRecentError[] = errorResult.rows.map((r: Record<string, unknown>) => ({
      providerKey: (r.provider_key as string) ?? null,
      toolName: (r.tool_name as string) ?? null,
      errorMessage: (r.error_message as string) ?? null,
      username: (r.username as string) ?? null,
      createdAt: new Date(r.created_at as string),
    }));

    return {
      totalRequests: ov.total ?? 0,
      successCount: ov.success_count ?? 0,
      errorCount: ov.error_count ?? 0,
      avgResponseTimeMs: ov.avg_response_time ?? 0,
      totalCost: Number(ov.total_cost) ?? 0,
      toolStats,
      userStats,
      recentErrors,
    };
  }

  // --- Lifecycle ---

  async close(): Promise<void> {
    await this.pool.end();
  }
}
