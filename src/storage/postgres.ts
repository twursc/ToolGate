import pg from "pg";
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
        tool_name VARCHAR(255) PRIMARY KEY,
        unit_price DECIMAL(10,4) NOT NULL DEFAULT 0,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
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
    return {
      id: row.id as string,
      userId: row.user_id as string,
      name: row.name as string,
      keyHash: row.key_hash as string,
      keyPrefix: row.key_prefix as string,
      quota: Number(row.quota),
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
      responseTimeMs: Number(row.response_time_ms),
      errorMessage: (row.error_message as string) ?? null,
      createdAt: new Date(row.created_at as string),
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
    const { rows } = await this.pool.query(
      `INSERT INTO api_keys (id, user_id, name, key_hash, key_prefix, quota, status, expires_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
      [id, input.userId, input.name, input.keyHash, input.keyPrefix, input.quota ?? 0, status, input.expiresAt ?? null]
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

  async updateApiKey(id: string, data: Partial<Pick<ApiKey, "name" | "quota" | "status" | "expiresAt">>): Promise<ApiKey> {
    const sets: string[] = [];
    const values: unknown[] = [];
    let idx = 1;
    if (data.name !== undefined) { sets.push(`name = $${idx++}`); values.push(data.name); }
    if (data.quota !== undefined) { sets.push(`quota = $${idx++}`); values.push(data.quota); }
    if (data.status !== undefined) { sets.push(`status = $${idx++}`); values.push(data.status); }
    if (data.expiresAt !== undefined) { sets.push(`expires_at = $${idx++}`); values.push(data.expiresAt); }
    values.push(id);
    const { rows } = await this.pool.query(`UPDATE api_keys SET ${sets.join(", ")} WHERE id = $${idx} RETURNING *`, values);
    return this.toApiKey(rows[0]);
  }

  async deleteApiKey(id: string): Promise<void> {
    await this.pool.query("DELETE FROM api_keys WHERE id = $1", [id]);
  }

  // --- Request Logs ---

  async insertRequestLog(log: Omit<RequestLog, "id" | "createdAt">): Promise<void> {
    const id = uuidv4();
    await this.pool.query(
      `INSERT INTO request_logs (id, user_id, api_key_id, method, tool_name, request_summary, response_status, response_time_ms, error_message)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [id, log.userId, log.apiKeyId, log.method, log.toolName, log.requestSummary, log.responseStatus, log.responseTimeMs, log.errorMessage]
    );
  }

  async queryRequestLogs(filter: LogFilter): Promise<RequestLog[]> {
    const conditions: string[] = [];
    const values: unknown[] = [];
    let idx = 1;
    if (filter.userId) { conditions.push(`user_id = $${idx++}`); values.push(filter.userId); }
    if (filter.apiKeyId) { conditions.push(`api_key_id = $${idx++}`); values.push(filter.apiKeyId); }
    if (filter.method) { conditions.push(`method = $${idx++}`); values.push(filter.method); }
    if (filter.startDate) { conditions.push(`created_at >= $${idx++}`); values.push(filter.startDate); }
    if (filter.endDate) { conditions.push(`created_at <= $${idx++}`); values.push(filter.endDate); }
    const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
    const limit = filter.limit ?? 100;
    const offset = filter.offset ?? 0;
    values.push(limit, offset);
    const { rows } = await this.pool.query(
      `SELECT * FROM request_logs ${where} ORDER BY created_at DESC LIMIT $${idx++} OFFSET $${idx}`,
      values
    );
    return rows.map((r: Record<string, unknown>) => this.toRequestLog(r));
  }

  async cleanExpiredLogs(beforeDate: Date): Promise<number> {
    const result = await this.pool.query("DELETE FROM request_logs WHERE created_at < $1", [beforeDate]);
    return result.rowCount ?? 0;
  }

  // --- Usage Records ---

  async insertUsageRecord(record: Omit<UsageRecord, "id" | "createdAt">): Promise<void> {
    const id = uuidv4();
    await this.pool.query(
      `INSERT INTO usage_records (id, user_id, api_key_id, tool_name, unit_price, billing_month)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [id, record.userId, record.apiKeyId, record.toolName, record.unitPrice, record.billingMonth]
    );
  }

  async getUsageStats(filter: UsageFilter): Promise<UsageStats[]> {
    const conditions: string[] = [];
    const values: unknown[] = [];
    let idx = 1;
    if (filter.userId) { conditions.push(`user_id = $${idx++}`); values.push(filter.userId); }
    if (filter.toolName) { conditions.push(`tool_name = $${idx++}`); values.push(filter.toolName); }
    if (filter.billingMonth) { conditions.push(`billing_month = $${idx++}`); values.push(filter.billingMonth); }
    if (filter.startDate) { conditions.push(`created_at >= $${idx++}`); values.push(filter.startDate); }
    if (filter.endDate) { conditions.push(`created_at <= $${idx++}`); values.push(filter.endDate); }
    const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
    const { rows } = await this.pool.query(
      `SELECT user_id, tool_name, COUNT(*)::int as count, COALESCE(SUM(unit_price), 0)::float as total_cost
       FROM usage_records ${where} GROUP BY user_id, tool_name ORDER BY count DESC`,
      values
    );
    return rows.map((r: Record<string, unknown>) => ({
      userId: r.user_id as string,
      toolName: r.tool_name as string,
      count: r.count as number,
      totalCost: r.total_cost as number,
    }));
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
      `SELECT tool_name, COUNT(*)::int as count, COALESCE(SUM(unit_price), 0)::float as total_cost
       FROM usage_records ${where} GROUP BY tool_name ORDER BY count DESC`,
      values
    );
    return rows.map((r: Record<string, unknown>) => ({
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

  // --- Tool Pricing ---

  async setToolPrice(toolName: string, unitPrice: number): Promise<void> {
    await this.pool.query(
      `INSERT INTO tool_prices (tool_name, unit_price, updated_at) VALUES ($1, $2, NOW())
       ON CONFLICT(tool_name) DO UPDATE SET unit_price = EXCLUDED.unit_price, updated_at = NOW()`,
      [toolName, unitPrice]
    );
  }

  async getToolPrice(toolName: string): Promise<number> {
    const { rows } = await this.pool.query("SELECT unit_price FROM tool_prices WHERE tool_name = $1", [toolName]);
    return rows[0] ? Number(rows[0].unit_price) : 0;
  }

  async listToolPrices(): Promise<ToolPrice[]> {
    const { rows } = await this.pool.query("SELECT * FROM tool_prices ORDER BY tool_name");
    return rows.map((r: Record<string, unknown>) => ({
      toolName: r.tool_name as string,
      unitPrice: Number(r.unit_price),
      updatedAt: new Date(r.updated_at as string),
    }));
  }

  async batchUpdateToolPrices(prices: { toolName: string; unitPrice: number }[]): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      for (const p of prices) {
        await client.query(
          `INSERT INTO tool_prices (tool_name, unit_price, updated_at) VALUES ($1, $2, NOW())
           ON CONFLICT(tool_name) DO UPDATE SET unit_price = EXCLUDED.unit_price, updated_at = NOW()`,
          [p.toolName, p.unitPrice]
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

  // --- Lifecycle ---

  async close(): Promise<void> {
    await this.pool.end();
  }
}
