// --- Data Models ---

export interface User {
  id: string;
  username: string;
  email: string | null;
  note: string | null;
  status: "active" | "disabled";
  createdAt: Date;
  updatedAt: Date;
}

export interface ApiKey {
  id: string;
  userId: string;
  name: string;
  keyHash: string;
  keyPrefix: string;
  quota: number; // 0 = unlimited
  allowedTools: string[] | null; // null = all tools allowed
  balance: number; // -1 = unlimited
  status: "active" | "disabled";
  expiresAt: Date | null;
  createdAt: Date;
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
  createdAt: Date;
}

export interface UsageRecord {
  id: string;
  userId: string;
  apiKeyId: string;
  toolName: string;
  unitPrice: number;
  billingMonth: string; // "YYYY-MM"
  createdAt: Date;
}

export interface ToolPrice {
  toolName: string;
  unitPrice: number;
  updatedAt: Date;
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
  connectedAt: Date;
  disconnectedAt: Date | null;
}

export interface UserGroup {
  id: string;
  name: string;
  description: string | null;
  allowedTools: string[] | null; // null = all tools allowed
  status: "active" | "disabled";
  createdAt: Date;
  updatedAt: Date;
}

export interface GroupMember {
  userId: string;
  username: string;
  email: string | null;
  status: "active" | "disabled";
  joinedAt: Date;
}

// --- Input Types ---

export interface CreateUserInput {
  username: string;
  email?: string | null;
  note?: string | null;
}

export interface CreateApiKeyInput {
  userId: string;
  name: string;
  keyHash: string;
  keyPrefix: string;
  quota?: number;
  allowedTools?: string[] | null;
  balance?: number;
  status?: "active" | "disabled";
  expiresAt?: Date | null;
}

export interface CreateConnectionLogInput {
  userId: string;
  apiKeyId: string;
  sessionId: string;
  transportType: "sse" | "http";
  userAgent?: string | null;
  ipAddress?: string | null;
}

export interface CreateUserGroupInput {
  name: string;
  description?: string | null;
  allowedTools?: string[] | null;
}

export interface ConnectionLogFilter {
  userId?: string;
  status?: "online" | "offline";
  limit?: number;
  offset?: number;
}

// --- Filter Types ---

export interface ListOptions {
  limit?: number;
  offset?: number;
}

export interface LogFilter {
  userId?: string;
  apiKeyId?: string;
  method?: string;
  startDate?: Date;
  endDate?: Date;
  limit?: number;
  offset?: number;
}

export interface UsageFilter {
  userId?: string;
  toolName?: string;
  toolNamePrefix?: string;
  startDate?: Date;
  endDate?: Date;
  billingMonth?: string;
  limit?: number;
  offset?: number;
}

export interface PaginatedResult<T> {
  data: T[];
  total: number;
}

export interface UserToolFilter {
  userId: string;
  startDate?: Date;
  endDate?: Date;
  billingMonth?: string;
}

export interface RequestLogWithUser extends RequestLog {
  username: string | null;
}

// --- Stats Types ---

export interface UsageStats {
  userId: string;
  username: string | null;
  toolName: string;
  count: number;
  totalCost: number;
}

export interface UserToolStats {
  toolName: string;
  count: number;
  totalCost: number;
}

// --- Dashboard Stats ---

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
  createdAt: Date;
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

// --- Storage Interface ---

export interface IStorage {
  // User management
  createUser(user: CreateUserInput): Promise<User>;
  getUser(id: string): Promise<User | null>;
  getUserByUsername(username: string): Promise<User | null>;
  listUsers(opts?: ListOptions): Promise<User[]>;
  updateUser(id: string, data: Partial<Pick<User, "username" | "email" | "note" | "status">>): Promise<User>;

  // API Key management
  createApiKey(apiKey: CreateApiKeyInput): Promise<ApiKey>;
  getApiKey(id: string): Promise<ApiKey | null>;
  getApiKeyByHash(keyHash: string): Promise<ApiKey | null>;
  listApiKeysByUser(userId: string): Promise<ApiKey[]>;
  updateApiKey(id: string, data: Partial<Pick<ApiKey, "name" | "quota" | "status" | "expiresAt" | "allowedTools" | "balance">>): Promise<ApiKey>;
  deleteApiKey(id: string): Promise<void>;
  regenerateApiKey(id: string, newKeyHash: string, newKeyPrefix: string): Promise<void>;
  deductBalance(apiKeyId: string, amount: number): Promise<void>;

  // Request logs
  insertRequestLog(log: Omit<RequestLog, "id" | "createdAt"> & { createdAt?: Date }): Promise<void>;
  queryRequestLogs(filter: LogFilter): Promise<PaginatedResult<RequestLogWithUser>>;
  cleanExpiredLogs(beforeDate: Date): Promise<number>;

  // Usage records
  insertUsageRecord(record: Omit<UsageRecord, "id" | "createdAt">): Promise<void>;
  getUsageStats(filter: UsageFilter): Promise<PaginatedResult<UsageStats>>;
  getUsageByUserAndTool(filter: UserToolFilter): Promise<UserToolStats[]>;
  getMonthlyUsageCount(userId: string, month: string): Promise<number>;

  // Profile stats
  getProfileStats(providerKey: string, billingMonth: string): Promise<{ profileKey: string; count: number; totalCost: number }[]>;

  // Tool pricing
  setToolPrice(toolName: string, unitPrice: number): Promise<void>;
  getToolPrice(toolName: string): Promise<number>;
  listToolPrices(): Promise<ToolPrice[]>;
  batchUpdateToolPrices(prices: { toolName: string; unitPrice: number }[]): Promise<void>;

  // User groups
  createUserGroup(input: CreateUserGroupInput): Promise<UserGroup>;
  getUserGroup(id: string): Promise<UserGroup | null>;
  listUserGroups(opts?: ListOptions): Promise<UserGroup[]>;
  updateUserGroup(id: string, data: Partial<Pick<UserGroup, "name" | "description" | "allowedTools" | "status">>): Promise<UserGroup>;
  deleteUserGroup(id: string): Promise<void>;
  addGroupMembers(groupId: string, userIds: string[]): Promise<void>;
  removeGroupMember(groupId: string, userId: string): Promise<void>;
  listGroupMembers(groupId: string): Promise<GroupMember[]>;
  listUserGroupsByUser(userId: string): Promise<UserGroup[]>;
  getUserEffectiveAllowedTools(userId: string): Promise<string[] | null>;
  getGroupMemberCount(groupId: string): Promise<number>;

  // Dashboard
  getDashboardStats(): Promise<DashboardStats>;

  // Connection logs
  insertConnectionLog(log: CreateConnectionLogInput): Promise<ConnectionLog>;
  updateConnectionLogDisconnect(sessionId: string): Promise<void>;
  updateConnectionLogClientInfo(sessionId: string, clientName: string, clientVersion: string): Promise<void>;
  listConnectionLogs(filter: ConnectionLogFilter): Promise<PaginatedResult<ConnectionLog>>;
  cleanStaleConnectionLogs(): Promise<number>;

  // Lifecycle
  initialize(): Promise<void>;
  close(): Promise<void>;
}
