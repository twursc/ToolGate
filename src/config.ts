import { readFileSync, existsSync } from "fs";
import { resolve } from "path";
import { parse as parseYaml } from "yaml";
import { z } from "zod";

// --- Zod Schemas ---

const SqliteConfigSchema = z.object({
  path: z.string().default("./data/gateway.db"),
});

const PostgresConfigSchema = z.object({
  host: z.string().default("localhost"),
  port: z.number().default(5432),
  database: z.string().default("mcp_gateway"),
  username: z.string().default("postgres"),
  password: z.string().default(""),
});

const StorageConfigSchema = z.object({
  type: z.enum(["sqlite", "postgres"]).default("sqlite"),
  sqlite: SqliteConfigSchema.default({}),
  postgres: PostgresConfigSchema.default({}),
});

const ServerConfigSchema = z.object({
  port: z.number().default(3000),
  host: z.string().default("0.0.0.0"),
  mcpPort: z.number().default(3001),
});

const AdminConfigSchema = z.object({
  username: z.string().default("admin"),
  password: z.string().default("changeme"),
  sessionSecret: z.string().default("mcai-mcp-gateway-secret-change-me"),
});

const LoggingConfigSchema = z.object({
  level: z.enum(["error", "warn", "info", "debug"]).default("info"),
  retentionDays: z.number().default(90),
});

const ProxyConfigSchema = z.object({
  serverToolnameSeparator: z.string().default("__"),
  retrySseToolCall: z.boolean().default(true),
  sseToolCallMaxRetries: z.number().default(2),
  sseToolCallRetryDelayBaseMs: z.number().default(300),
  retryHttpToolCall: z.boolean().default(true),
  httpToolCallMaxRetries: z.number().default(2),
  httpToolCallRetryDelayBaseMs: z.number().default(300),
  retryStdioToolCall: z.boolean().default(true),
  stdioToolCallMaxRetries: z.number().default(2),
  stdioToolCallRetryDelayBaseMs: z.number().default(300),
});

const GatewayConfigSchema = z.object({
  server: ServerConfigSchema.default({}),
  admin: AdminConfigSchema.default({}),
  storage: StorageConfigSchema.default({}),
  logging: LoggingConfigSchema.default({}),
  proxy: ProxyConfigSchema.default({}),
});

export type GatewayConfig = z.infer<typeof GatewayConfigSchema>;
export type StorageConfig = z.infer<typeof StorageConfigSchema>;
export type ProxyConfig = z.infer<typeof ProxyConfigSchema>;

// --- Legacy MCP Server Config Types (kept for createTransport compatibility) ---

export interface StdioServerConfig {
  type: "stdio";
  name?: string;
  active?: boolean;
  command: string;
  args?: string[];
  env?: Record<string, string>;
}

export interface SseServerConfig {
  type: "sse";
  name?: string;
  active?: boolean;
  url: string;
  apiKey?: string;
  bearerToken?: string;
  headers?: Record<string, string>;
}

export interface HttpServerConfig {
  type: "http";
  name?: string;
  active?: boolean;
  url: string;
  apiKey?: string;
  bearerToken?: string;
  headers?: Record<string, string>;
}

export type McpServerConfig = StdioServerConfig | SseServerConfig | HttpServerConfig;

// --- Provider / Profile Config Types ---

export interface ProfileConfig {
  active?: boolean;
  // SSE/HTTP profile overrides
  url?: string;
  apiKey?: string;
  bearerToken?: string;
  headers?: Record<string, string>;
  // Stdio profile overrides
  env?: Record<string, string>;
}

export interface ProviderConfig {
  type: "stdio" | "sse" | "http";
  name?: string;
  active?: boolean;
  // SSE/HTTP base
  url?: string;
  // Stdio base
  command?: string;
  args?: string[];
  // Profiles
  profiles: Record<string, ProfileConfig>;
}

export interface McpServersFileConfig {
  mcpProviders?: Record<string, ProviderConfig>;
  mcpServers?: Record<string, McpServerConfig>; // legacy
  proxy?: Partial<z.infer<typeof ProxyConfigSchema>>;
  serverToolnameSeparator?: string;
}

// --- Provider/Profile Merge ---

export function mergeProviderProfile(provider: ProviderConfig, profile: ProfileConfig): McpServerConfig {
  if (provider.type === "stdio") {
    return {
      type: "stdio",
      name: provider.name,
      active: profile.active ?? provider.active,
      command: provider.command!,
      args: provider.args,
      env: profile.env,
    };
  }

  const url = profile.url || provider.url!;
  if (provider.type === "sse") {
    return {
      type: "sse",
      name: provider.name,
      active: profile.active ?? provider.active,
      url,
      apiKey: profile.apiKey,
      bearerToken: profile.bearerToken,
      headers: profile.headers,
    };
  }

  // http
  return {
    type: "http",
    name: provider.name,
    active: profile.active ?? provider.active,
    url,
    apiKey: profile.apiKey,
    bearerToken: profile.bearerToken,
    headers: profile.headers,
  };
}

// --- Legacy Config Migration ---

function migrateLegacyConfig(config: McpServersFileConfig): McpServersFileConfig {
  if (config.mcpProviders) return config;
  if (!config.mcpServers || Object.keys(config.mcpServers).length === 0) {
    return { ...config, mcpProviders: {} };
  }

  const providers: Record<string, ProviderConfig> = {};
  for (const [key, server] of Object.entries(config.mcpServers)) {
    const profile: ProfileConfig = { active: true };

    if (server.type === "stdio") {
      if (server.env) profile.env = server.env;
      providers[key] = {
        type: "stdio",
        name: server.name,
        active: server.active ?? true,
        command: server.command,
        args: server.args,
        profiles: { default: profile },
      };
    } else {
      if ((server as SseServerConfig).apiKey) profile.apiKey = (server as SseServerConfig).apiKey;
      if ((server as SseServerConfig).bearerToken) profile.bearerToken = (server as SseServerConfig).bearerToken;
      if ((server as SseServerConfig).headers) profile.headers = (server as SseServerConfig).headers;
      providers[key] = {
        type: server.type,
        name: server.name,
        active: server.active ?? true,
        url: (server as SseServerConfig).url,
        profiles: { default: profile },
      };
    }
  }

  return { ...config, mcpProviders: providers };
}

// --- Config Loading ---

let cachedConfig: GatewayConfig | null = null;
let cachedMcpServers: McpServersFileConfig | null = null;

export function loadGatewayConfig(configPath?: string): GatewayConfig {
  const filePath = configPath ?? resolve(process.cwd(), "gateway.config.yaml");

  let rawConfig: Record<string, unknown> = {};
  if (existsSync(filePath)) {
    const content = readFileSync(filePath, "utf-8");
    rawConfig = parseYaml(content) ?? {};
  }

  // Environment variable overrides
  if (process.env.PORT) {
    rawConfig.server = { ...(rawConfig.server as object ?? {}), port: parseInt(process.env.PORT, 10) };
  }
  if (process.env.MCP_PORT) {
    rawConfig.server = { ...(rawConfig.server as object ?? {}), mcpPort: parseInt(process.env.MCP_PORT, 10) };
  }
  if (process.env.ADMIN_USERNAME) {
    rawConfig.admin = { ...(rawConfig.admin as object ?? {}), username: process.env.ADMIN_USERNAME };
  }
  if (process.env.ADMIN_PASSWORD) {
    rawConfig.admin = { ...(rawConfig.admin as object ?? {}), password: process.env.ADMIN_PASSWORD };
  }
  if (process.env.SESSION_SECRET) {
    rawConfig.admin = { ...(rawConfig.admin as object ?? {}), sessionSecret: process.env.SESSION_SECRET };
  }
  if (process.env.STORAGE_TYPE) {
    rawConfig.storage = { ...(rawConfig.storage as object ?? {}), type: process.env.STORAGE_TYPE };
  }
  if (process.env.LOGGING) {
    rawConfig.logging = { ...(rawConfig.logging as object ?? {}), level: process.env.LOGGING };
  }

  cachedConfig = GatewayConfigSchema.parse(rawConfig);
  return cachedConfig;
}

export function loadMcpServersConfig(configPath?: string): McpServersFileConfig {
  const filePath = configPath ?? resolve(process.cwd(), "data/mcp_server.json");

  if (!existsSync(filePath)) {
    cachedMcpServers = { mcpProviders: {} };
    return cachedMcpServers;
  }

  const content = readFileSync(filePath, "utf-8");
  const raw = JSON.parse(content) as McpServersFileConfig;
  cachedMcpServers = migrateLegacyConfig(raw);
  return cachedMcpServers;
}

export function getGatewayConfig(): GatewayConfig {
  if (!cachedConfig) {
    return loadGatewayConfig();
  }
  return cachedConfig;
}

export function getMcpServersConfig(): McpServersFileConfig {
  if (!cachedMcpServers) {
    return loadMcpServersConfig();
  }
  return cachedMcpServers;
}

export function reloadMcpServersConfig(configPath?: string): McpServersFileConfig {
  cachedMcpServers = null;
  return loadMcpServersConfig(configPath);
}
