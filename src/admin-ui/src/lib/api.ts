import axios from "axios";

const api = axios.create({
  baseURL: "/admin/api",
  withCredentials: true,
});

api.interceptors.response.use(
  (res) => res,
  (err) => {
    if (err.response?.status === 401 && !window.location.pathname.endsWith("/login")) {
      window.location.href = "/admin/login";
    }
    return Promise.reject(err);
  }
);

// Auth
export const login = (username: string, password: string) =>
  api.post("/login", { username, password });

export const logout = () => api.post("/logout");

// Users
export const listUsers = (limit = 50, offset = 0) =>
  api.get("/users", { params: { limit, offset } });

export const getUser = (id: string) => api.get(`/users/${id}`);

export const createUser = (data: { username: string; email?: string; note?: string }) =>
  api.post("/users", data);

export const updateUser = (id: string, data: Record<string, unknown>) =>
  api.put(`/users/${id}`, data);

// API Keys
export const listApiKeys = (userId: string) =>
  api.get(`/users/${userId}/api-keys`);

export const createApiKey = (userId: string, data: { name: string; quota?: number; expiresAt?: string }) =>
  api.post(`/users/${userId}/api-keys`, data);

export const updateApiKey = (id: string, data: Record<string, unknown>) =>
  api.put(`/api-keys/${id}`, data);

export const deleteApiKey = (id: string) =>
  api.delete(`/api-keys/${id}`);

export const regenerateApiKey = (id: string) =>
  api.post(`/api-keys/${id}/regenerate`);

// Connection Logs
export const listConnectionLogs = (userId: string, params?: Record<string, string>) =>
  api.get(`/users/${userId}/connection-logs`, { params });

// Providers
export const listProviders = () => api.get("/providers");

export const createProvider = (data: Record<string, unknown>) =>
  api.post("/providers", data);

export const updateProvider = (key: string, data: Record<string, unknown>) =>
  api.put(`/providers/${key}`, data);

export const deleteProvider = (key: string) =>
  api.delete(`/providers/${key}`);

export const createProfile = (providerKey: string, data: Record<string, unknown>) =>
  api.post(`/providers/${providerKey}/profiles`, data);

export const updateProfile = (providerKey: string, profileKey: string, data: Record<string, unknown>) =>
  api.put(`/providers/${providerKey}/profiles/${profileKey}`, data);

export const deleteProfile = (providerKey: string, profileKey: string) =>
  api.delete(`/providers/${providerKey}/profiles/${profileKey}`);

export const reloadProviders = () => api.post("/providers/reload");

export const getProviderTools = (key: string) =>
  api.get(`/providers/${key}/tools`);

export const getProviderToolUsage = (key: string, params?: Record<string, string>) =>
  api.get(`/stats/provider/${key}/tool-usage`, { params });

export const getProfileStats = (key: string, params?: Record<string, string>) =>
  api.get(`/stats/provider/${key}/profile-stats`, { params });

// Dashboard
export const getDashboardStats = () => api.get("/stats/dashboard");

// Stats
export const getUsageStats = (params?: Record<string, string>) =>
  api.get("/stats/usage", { params });

export const getUserUsage = (userId: string, params?: Record<string, string>) =>
  api.get(`/stats/users/${userId}/usage`, { params });

export const getRequestLogs = (params?: Record<string, string>) =>
  api.get("/logs", { params });

// Tool Prices
export const listToolPrices = () => api.get("/tool-prices");

export const setToolPrice = (providerKey: string, toolName: string, unitPrice: number) =>
  api.put("/tool-prices/set", { providerKey, toolName, unitPrice });

export const batchUpdateToolPrices = (prices: { providerKey: string; toolName: string; unitPrice: number }[]) =>
  api.put("/tool-prices", { prices });

// Groups
export const listGroups = (limit = 50, offset = 0) =>
  api.get("/groups", { params: { limit, offset } });

export const getGroup = (id: string) => api.get(`/groups/${id}`);

export const createGroup = (data: { name: string; description?: string; allowedTools?: string[] | null }) =>
  api.post("/groups", data);

export const updateGroup = (id: string, data: Record<string, unknown>) =>
  api.put(`/groups/${id}`, data);

export const deleteGroup = (id: string) =>
  api.delete(`/groups/${id}`);

export const addGroupMembers = (groupId: string, userIds: string[]) =>
  api.post(`/groups/${groupId}/members`, { userIds });

export const removeGroupMember = (groupId: string, userId: string) =>
  api.delete(`/groups/${groupId}/members/${userId}`);

// Playground
export const playgroundListTools = () => api.get("/playground/tools");

export const playgroundCall = (toolName: string, args: Record<string, unknown>) =>
  api.post("/playground/call", { toolName, arguments: args });

export default api;
