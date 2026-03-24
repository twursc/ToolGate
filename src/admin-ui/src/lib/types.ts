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
  allowedTools: string[] | null;
  balance: number;
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
  cost: number;
  profileKey: string | null;
  username: string | null;
  createdAt: string;
}

export interface UsageStats {
  userId: string;
  username: string | null;
  toolName: string;
  count: number;
  totalCost: number;
}

export interface ToolPrice {
  toolName: string;
  unitPrice: number;
  updatedAt: string;
}

export interface PaginatedResponse<T> {
  data: T[];
  total: number;
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

export interface ConnectionLog {
  id: string;
  userId: string;
  apiKeyId: string;
  sessionId: string;
  transportType: "sse" | "http";
  clientName: string | null;
  clientVersion: string | null;
  userAgent: string | null;
  ipAddress: string | null;
  status: "online" | "offline";
  connectedAt: string;
  disconnectedAt: string | null;
  apiKeyName: string | null;
  apiKeyPrefix: string | null;
}

export interface UserGroup {
  id: string;
  name: string;
  description: string | null;
  allowedTools: string[] | null;
  status: "active" | "disabled";
  memberCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface GroupMember {
  userId: string;
  username: string;
  email: string | null;
  status: "active" | "disabled";
  joinedAt: string;
}

export interface GroupDetail extends UserGroup {
  members: GroupMember[];
}

export interface DashboardToolStats {
  toolName: string;
  callCount: number;
  totalCost: number;
  avgResponseTimeMs: number;
}

export interface DashboardUserStats {
  userId: string;
  username: string | null;
  callCount: number;
  totalCost: number;
}

export interface DashboardRecentError {
  toolName: string | null;
  errorMessage: string | null;
  username: string | null;
  createdAt: string;
}

export interface DashboardStats {
  totalRequests: number;
  successCount: number;
  errorCount: number;
  avgResponseTimeMs: number;
  totalCost: number;
  toolStats: DashboardToolStats[];
  userStats: DashboardUserStats[];
  recentErrors: DashboardRecentError[];
}

export interface ToolSchema {
  name: string;
  description?: string;
  inputSchema: Record<string, unknown>;
  hasMismatch: boolean;
}
