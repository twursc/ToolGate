export interface User {
  id: string;
  username: string;
  email: string | null;
  note: string | null;
  status: "active" | "disabled";
  createdAt: string;
  updatedAt: string;
}

export interface ApiKey {
  id: string;
  userId: string;
  name: string;
  keyHash: string;
  keyPrefix: string;
  quota: number;
  status: "active" | "disabled";
  expiresAt: string | null;
  createdAt: string;
}

export interface ApiKeyCreateResponse extends ApiKey {
  rawKey: string;
}

export interface RequestLog {
  id: string;
  userId: string;
  apiKeyId: string;
  method: string;
  toolName: string | null;
  requestSummary: string;
  responseStatus: "success" | "error";
  responseTimeMs: number;
  errorMessage: string | null;
  createdAt: string;
}

export interface UsageStats {
  userId: string;
  toolName: string;
  count: number;
  totalCost: number;
}

export interface ToolPrice {
  toolName: string;
  unitPrice: number;
  updatedAt: string;
}

export interface McpProfile {
  key: string;
  active: boolean;
  status: "connected" | "disconnected";
  url?: string;
  headers?: Record<string, string>;
  env?: Record<string, string>;
}

export interface McpProvider {
  key: string;
  type: "stdio" | "sse" | "http";
  active: boolean;
  name?: string;
  url?: string;
  command?: string;
  args?: string[];
  tools: string[];
  schemaErrors: string[];
  mismatchedTools: string[];
  profiles: McpProfile[];
}

export interface ToolSchema {
  name: string;
  description?: string;
  inputSchema: Record<string, unknown>;
  hasMismatch: boolean;
}
