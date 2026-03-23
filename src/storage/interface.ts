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
  status?: "active" | "disabled";
  expiresAt?: Date | null;
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
  startDate?: Date;
  endDate?: Date;
  billingMonth?: string;
}

export interface UserToolFilter {
  userId: string;
  startDate?: Date;
  endDate?: Date;
  billingMonth?: string;
}

// --- Stats Types ---

export interface UsageStats {
  userId: string;
  toolName: string;
  count: number;
  totalCost: number;
}

export interface UserToolStats {
  toolName: string;
  count: number;
  totalCost: number;
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
  updateApiKey(id: string, data: Partial<Pick<ApiKey, "name" | "quota" | "status" | "expiresAt">>): Promise<ApiKey>;
  deleteApiKey(id: string): Promise<void>;

  // Request logs
  insertRequestLog(log: Omit<RequestLog, "id" | "createdAt"> & { createdAt?: Date }): Promise<void>;
  queryRequestLogs(filter: LogFilter): Promise<RequestLog[]>;
  cleanExpiredLogs(beforeDate: Date): Promise<number>;

  // Usage records
  insertUsageRecord(record: Omit<UsageRecord, "id" | "createdAt">): Promise<void>;
  getUsageStats(filter: UsageFilter): Promise<UsageStats[]>;
  getUsageByUserAndTool(filter: UserToolFilter): Promise<UserToolStats[]>;
  getMonthlyUsageCount(userId: string, month: string): Promise<number>;

  // Tool pricing
  setToolPrice(toolName: string, unitPrice: number): Promise<void>;
  getToolPrice(toolName: string): Promise<number>;
  listToolPrices(): Promise<ToolPrice[]>;
  batchUpdateToolPrices(prices: { toolName: string; unitPrice: number }[]): Promise<void>;

  // Lifecycle
  initialize(): Promise<void>;
  close(): Promise<void>;
}
