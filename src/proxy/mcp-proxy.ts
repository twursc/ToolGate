import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  GetPromptRequestSchema,
  ListPromptsRequestSchema,
  ListResourcesRequestSchema,
  ListToolsRequestSchema,
  ReadResourceRequestSchema,
  Tool,
} from "@modelcontextprotocol/sdk/types.js";
import { logger } from "../logger.js";
import type { ConnectedClient } from "./client.js";
import type { ProviderConfig, ProxyConfig, CircuitBreakerConfig } from "../config.js";
import { mergeProviderProfile, getMcpServersConfig } from "../config.js";
import type { IStorage } from "../storage/interface.js";
import type { AuthContext } from "../middleware/auth.js";

// Tool call hook context for middleware
export interface ToolCallContext {
  userId: string;
  apiKeyId: string;
  toolName: string;
  args?: Record<string, unknown>;
}

export interface ToolCallResult {
  success: boolean;
  result?: unknown;
  error?: string;
}

export interface McpProxyOptions {
  serverToolnameSeparator?: string;
  proxy?: ProxyConfig;
  storage?: IStorage;
  onToolCall?: (ctx: ToolCallContext) => Promise<ToolCallResult | void>;
}

// --- Provider Pool ---

export interface ProviderPool {
  providerKey: string;
  type: "stdio" | "sse" | "http";
  clients: ConnectedClient[];
  roundRobinIndex: number;
  tools: Tool[];
  toolSchemas: Map<string, Tool>;
  schemaErrors: string[];
  mismatchedTools: string[];
}

interface ToolMapping {
  qualifiedName: string;
  exposedName: string;
  providerKey: string;
  toolInfo: Tool;
}

// --- Global State ---

let currentConnectedClients: ConnectedClient[] = [];
const toolToClientMap = new Map<string, ToolMapping>();
const resourceToClientMap = new Map<string, ConnectedClient>();
const promptToClientMap = new Map<string, ConnectedClient>();
const providerPools = new Map<string, ProviderPool>();

// --- Circuit Breaker State ---

interface CircuitBreakerState {
  status: "closed" | "open";
  failureCount: number;
  openedAt: number | null;
}

const circuitBreakerStates = new Map<string, CircuitBreakerState>();

function getCircuitBreakerState(clientName: string): CircuitBreakerState {
  let state = circuitBreakerStates.get(clientName);
  if (!state) {
    state = { status: "closed", failureCount: 0, openedAt: null };
    circuitBreakerStates.set(clientName, state);
  }
  return state;
}

function isCircuitOpen(clientName: string, config: CircuitBreakerConfig): boolean {
  if (!config.enabled) return false;
  const state = getCircuitBreakerState(clientName);
  if (state.status !== "open") return false;
  // Auto-recover after cooldown
  if (state.openedAt && Date.now() - state.openedAt > config.cooldownSeconds * 1000) {
    state.status = "closed";
    state.failureCount = 0;
    state.openedAt = null;
    logger.log(`Circuit breaker auto-recovered for ${clientName}`);
    return false;
  }
  return true;
}

function tripCircuitBreaker(clientName: string): void {
  const state = getCircuitBreakerState(clientName);
  state.status = "open";
  state.openedAt = Date.now();
  logger.warn(`Circuit breaker tripped for ${clientName}`);
}

function recordCircuitBreakerFailure(clientName: string, config: CircuitBreakerConfig): void {
  const state = getCircuitBreakerState(clientName);
  state.failureCount++;
  if (config.failureThreshold > 0 && state.failureCount >= config.failureThreshold) {
    tripCircuitBreaker(clientName);
  }
}

function resetCircuitBreakerFailures(clientName: string): void {
  const state = circuitBreakerStates.get(clientName);
  if (state) {
    state.failureCount = 0;
  }
}

function checkCircuitBreakerError(errorMsg: string, config: CircuitBreakerConfig): "trip" | "failure" | null {
  if (!config.enabled) return null;
  const msgLower = errorMsg.toLowerCase();
  // Immediate trip on content match
  if (config.tripOnContent.length > 0) {
    for (const pattern of config.tripOnContent) {
      if (msgLower.includes(pattern.toLowerCase())) {
        return "trip";
      }
    }
  }
  // Count-based failure on status code match
  if (config.failureStatusCodes.length > 0) {
    for (const code of config.failureStatusCodes) {
      if (msgLower.includes(String(code))) {
        return "failure";
      }
    }
  }
  return null;
}

let currentProxyConfig: Omit<ProxyConfig, "serverToolnameSeparator"> = {
  retrySseToolCall: true,
  sseToolCallMaxRetries: 2,
  sseToolCallRetryDelayBaseMs: 300,
  retryHttpToolCall: true,
  httpToolCallMaxRetries: 2,
  httpToolCallRetryDelayBaseMs: 300,
  retryStdioToolCall: true,
  stdioToolCallMaxRetries: 2,
  stdioToolCallRetryDelayBaseMs: 300,
};

let currentSeparator = "__";
export function getCurrentSeparator() { return currentSeparator; }
let gOnToolCall: ((ctx: ToolCallContext) => Promise<ToolCallResult | void>) | undefined;
let gStorage: IStorage | undefined;

// Session ID -> AuthContext mapping for logging/billing inside CallTool handler
const sessionAuthMap = new Map<string, AuthContext>();

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

// --- Session Auth Management (called from server.ts) ---

export function setSessionAuth(sessionId: string, auth: AuthContext): void {
  sessionAuthMap.set(sessionId, auth);
}

export function clearSessionAuth(sessionId: string): void {
  sessionAuthMap.delete(sessionId);
}

function isConnectionError(error: any): boolean {
  const msg = String(error?.message ?? error ?? "").toLowerCase();
  return (
    msg.includes("disconnected") ||
    msg.includes("not connected") ||
    msg.includes("connection closed") ||
    msg.includes("transport is closed") ||
    msg.includes("failed to fetch") ||
    msg.includes("404") ||
    msg.includes("eof") ||
    msg.includes("tls") ||
    msg.includes("timeout") ||
    msg.includes("enetunreach") ||
    msg.includes("econnrefused")
  );
}

// --- Schema Validation ---

function sortKeys(obj: unknown): unknown {
  if (obj === null || typeof obj !== "object") return obj;
  if (Array.isArray(obj)) return obj.map(sortKeys);
  return Object.fromEntries(
    Object.entries(obj as Record<string, unknown>)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => [k, sortKeys(v)])
  );
}

function deepEqual(a: unknown, b: unknown): boolean {
  return JSON.stringify(sortKeys(a)) === JSON.stringify(sortKeys(b));
}

async function validateProviderSchemas(pool: ProviderPool): Promise<void> {
  if (pool.clients.length <= 1) return;

  const baseClient = pool.clients[0];
  let baseTools: Tool[];
  try {
    const result = await baseClient.client.listTools();
    baseTools = result.tools ?? [];
  } catch {
    return; // can't validate if base fails
  }

  const baseToolMap = new Map(baseTools.map(t => [t.name, t]));

  for (let i = 1; i < pool.clients.length; i++) {
    const otherClient = pool.clients[i];
    let otherTools: Tool[];
    try {
      const result = await otherClient.client.listTools();
      otherTools = result.tools ?? [];
    } catch {
      pool.schemaErrors.push(
        `Profile "${otherClient.profileKey}": failed to list tools`
      );
      continue;
    }

    const otherToolMap = new Map(otherTools.map(t => [t.name, t]));

    if (baseToolMap.size !== otherToolMap.size) {
      pool.schemaErrors.push(
        `Profile "${otherClient.profileKey}" has ${otherToolMap.size} tools, expected ${baseToolMap.size} (same as "${baseClient.profileKey}")`
      );
    }

    for (const [toolName, baseTool] of baseToolMap) {
      const otherTool = otherToolMap.get(toolName);
      if (!otherTool) {
        pool.schemaErrors.push(
          `Profile "${otherClient.profileKey}" missing tool "${toolName}"`
        );
        if (!pool.mismatchedTools.includes(toolName)) {
          pool.mismatchedTools.push(toolName);
        }
        continue;
      }
      if (!deepEqual(baseTool.inputSchema, otherTool.inputSchema)) {
        pool.schemaErrors.push(
          `Tool "${toolName}" schema mismatch between "${baseClient.profileKey}" and "${otherClient.profileKey}"`
        );
        if (!pool.mismatchedTools.includes(toolName)) {
          pool.mismatchedTools.push(toolName);
        }
      }
    }

    for (const toolName of otherToolMap.keys()) {
      if (!baseToolMap.has(toolName)) {
        pool.schemaErrors.push(
          `Profile "${otherClient.profileKey}" has extra tool "${toolName}" not in "${baseClient.profileKey}"`
        );
        if (!pool.mismatchedTools.includes(toolName)) {
          pool.mismatchedTools.push(toolName);
        }
      }
    }
  }
}

// --- Backend Connections ---

export async function updateBackendConnections(
  providers: Record<string, ProviderConfig>,
  separator?: string,
  proxyConfig?: ProxyConfig
): Promise<void> {
  if (separator) currentSeparator = separator;
  if (proxyConfig) currentProxyConfig = { ...currentProxyConfig, ...proxyConfig };

  const newClients: ConnectedClient[] = [];
  toolToClientMap.clear();
  resourceToClientMap.clear();
  promptToClientMap.clear();
  providerPools.clear();

  // Cleanup old clients
  for (const client of currentConnectedClients) {
    try {
      await client.cleanup();
      logger.log(`Disconnected from server: ${client.name}`);
    } catch (e: any) {
      logger.warn(`Error cleaning up client ${client.name}: ${e.message}`);
    }
  }

  // Connect to providers
  for (const [providerKey, provider] of Object.entries(providers)) {
    if (provider.active === false) {
      logger.log(`Skipping inactive provider: ${providerKey}`);
      continue;
    }

    const pool: ProviderPool = {
      providerKey,
      type: provider.type,
      clients: [],
      roundRobinIndex: 0,
      tools: [],
      toolSchemas: new Map(),
      schemaErrors: [],
      mismatchedTools: [],
    };

    for (const [profileKey, profile] of Object.entries(provider.profiles)) {
      if (profile.active === false) {
        logger.log(`Skipping inactive profile: ${providerKey}/${profileKey}`);
        continue;
      }

      const mergedConfig = mergeProviderProfile(provider, profile);
      const clientName = `${providerKey}/${profileKey}`;

      let connected: ConnectedClient | null = null;
      let attempts = 0;
      const maxAttempts = 3;

      while (!connected && attempts < maxAttempts) {
        try {
          const { createConnectedClient } = await import("./client.js");
          connected = await createConnectedClient(clientName, mergedConfig, providerKey, profileKey);
          if (!connected) {
            attempts++;
            if (attempts < maxAttempts) await sleep(2500);
          }
        } catch (e: any) {
          logger.error(`Connection error for ${clientName}: ${e.message}`);
          attempts++;
          if (attempts < maxAttempts) await sleep(2500);
        }
      }

      if (connected) {
        newClients.push(connected);
        pool.clients.push(connected);
      }
    }

    if (pool.clients.length > 0) {
      // Get tools from first connected profile
      const firstClient = pool.clients[0];
      try {
        const toolsResult = await firstClient.client.listTools();
        pool.tools = toolsResult.tools ?? [];
        for (const tool of pool.tools) {
          pool.toolSchemas.set(tool.name, tool);
          const qualifiedName = `${providerKey}${currentSeparator}${tool.name}`;
          toolToClientMap.set(qualifiedName, {
            qualifiedName,
            exposedName: qualifiedName,
            providerKey,
            toolInfo: tool,
          });
        }
      } catch (e: any) {
        logger.warn(`Failed to list tools for ${providerKey}: ${e.message}`);
      }

      // Get resources from first profile
      try {
        const resourcesResult = await firstClient.client.listResources();
        for (const resource of resourcesResult.resources ?? []) {
          resourceToClientMap.set(resource.uri, firstClient);
        }
      } catch {
        // Server does not support resources
      }

      // Get prompts from first profile
      try {
        const promptsResult = await firstClient.client.listPrompts();
        for (const prompt of promptsResult.prompts ?? []) {
          promptToClientMap.set(prompt.name, firstClient);
        }
      } catch {
        // Server does not support prompts
      }

      // Validate schemas across profiles
      await validateProviderSchemas(pool);
      if (pool.schemaErrors.length > 0) {
        logger.warn(`Schema validation errors for provider ${providerKey}: ${pool.schemaErrors.join("; ")}`);
      }

      logger.log(`Provider ${providerKey}: ${pool.clients.length} profiles connected, ${pool.tools.length} tools`);
    }

    providerPools.set(providerKey, pool);
  }

  currentConnectedClients = newClients;
}

// --- MCP Proxy Server ---

export async function setupMcpProxy(options?: McpProxyOptions): Promise<Server> {
  if (options?.serverToolnameSeparator) currentSeparator = options.serverToolnameSeparator;
  if (options?.proxy) currentProxyConfig = { ...currentProxyConfig, ...options.proxy };
  if (options?.storage) gStorage = options.storage;
  gOnToolCall = options?.onToolCall;

  const server = new Server(
    { name: "ToolGate", version: "1.0" },
    { capabilities: { prompts: {}, resources: {}, tools: {} } }
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => {
    const tools: Tool[] = [];
    for (const [, mapping] of toolToClientMap) {
      tools.push({
        name: mapping.exposedName,
        description: mapping.toolInfo.description,
        inputSchema: mapping.toolInfo.inputSchema,
      });
    }
    return { tools };
  });

  server.setRequestHandler(ListResourcesRequestSchema, async () => {
    const resources = [];
    for (const [uri, client] of resourceToClientMap) {
      try {
        const result = await client.client.listResources();
        const res = result.resources?.find((r) => r.uri === uri);
        if (res) resources.push(res);
      } catch (e: any) {
        logger.warn(`Failed to list resource ${uri}: ${e.message}`);
      }
    }
    return { resources };
  });

  server.setRequestHandler(ListPromptsRequestSchema, async () => {
    const prompts = [];
    for (const [name, client] of promptToClientMap) {
      try {
        const result = await client.client.listPrompts();
        const prompt = result.prompts?.find((p) => p.name === name);
        if (prompt) prompts.push(prompt);
      } catch (e: any) {
        logger.warn(`Failed to list prompt ${name}: ${e.message}`);
      }
    }
    return { prompts };
  });

  server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
    const { uri } = request.params;
    const client = resourceToClientMap.get(uri);
    if (!client) {
      throw new Error(`Resource not found: ${uri}`);
    }
    const result = await client.client.readResource({ uri });
    return result;
  });

  server.setRequestHandler(GetPromptRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    const client = promptToClientMap.get(name);
    if (!client) {
      throw new Error(`Prompt not found: ${name}`);
    }
    const result = await client.client.getPrompt({ name, arguments: args });
    return result;
  });

  server.setRequestHandler(CallToolRequestSchema, async (request, extra) => {
    const startTime = Date.now();
    const { name, arguments: args } = request.params;
    const mapping = toolToClientMap.get(name);

    if (!mapping) {
      throw new Error(`Tool not found: ${name}`);
    }

    const pool = providerPools.get(mapping.providerKey);
    if (!pool || pool.clients.length === 0) {
      throw new Error(`No available profiles for provider: ${mapping.providerKey}`);
    }

    const originalToolName = mapping.toolInfo.name;

    // Resolve auth context from session -> auth mapping
    const sessionId = (extra as any)?.sessionId as string | undefined;
    const authContext = sessionId ? sessionAuthMap.get(sessionId) : undefined;

    const userId = authContext?.userId ?? "unknown";
    const apiKeyId = authContext?.apiKeyId ?? "unknown";

    // Billing: check quota before allowing the call
    if (gStorage && authContext) {
      const quota = authContext.apiKeyRecord.quota;
      if (quota > 0) {
        const currentMonth = new Date().toISOString().slice(0, 7);
        const usageCount = await gStorage.getMonthlyUsageCount(userId, currentMonth);
        if (usageCount >= quota) {
          logger.warn(`Quota exceeded for user ${userId}: ${usageCount}/${quota}`);
          throw new Error(`Monthly quota exceeded (${usageCount}/${quota})`);
        }
      }

      // Check allowedTools: group-level + API key-level
      const groupTools = authContext.groupAllowedTools;
      const keyTools = authContext.apiKeyRecord.allowedTools;
      let effectiveAllowed: string[] | null = null;
      if (groupTools !== null && keyTools !== null && keyTools.length > 0) {
        // Both set: intersection
        const groupSet = new Set(groupTools);
        effectiveAllowed = keyTools.filter((t) => groupSet.has(t));
      } else if (groupTools !== null) {
        effectiveAllowed = groupTools;
      } else if (keyTools !== null && keyTools.length > 0) {
        effectiveAllowed = keyTools;
      }
      if (effectiveAllowed !== null && !effectiveAllowed.includes(name)) {
        logger.warn(`Tool ${name} not allowed for user ${userId} / API key ${apiKeyId}`);
        throw new Error(`Tool not allowed: ${name}`);
      }

      // Check balance
      const balance = authContext.apiKeyRecord.balance;
      if (balance >= 0 && balance <= 0) {
        logger.warn(`Insufficient balance for API key ${apiKeyId}: ${balance}`);
        throw new Error(`Insufficient balance (${balance})`);
      }
    }

    // Call hook before tool execution
    if (gOnToolCall) {
      const hookResult = await gOnToolCall({ userId, apiKeyId, toolName: name, args });
      if (hookResult && !hookResult.success) {
        throw new Error(hookResult.error ?? "Tool call blocked by middleware");
      }
    }

    // Filter out clients: monthly budget exceeded or circuit breaker open
    let availableClients = pool.clients;
    const mcpConfig = getMcpServersConfig();
    const providerConfig = mcpConfig.mcpProviders?.[mapping.providerKey];
    const cbConfig = providerConfig?.circuitBreaker;

    // Circuit breaker filter (in-memory, no async needed)
    if (cbConfig?.enabled) {
      availableClients = availableClients.filter(
        (client) => !isCircuitOpen(client.name, cbConfig)
      );
    }

    // Monthly budget filter
    if (gStorage && availableClients.length > 0) {
      const currentMonth = new Date().toISOString().slice(0, 7);
      const budgetChecks = await Promise.all(
        availableClients.map(async (client) => {
          const profileConfig = providerConfig?.profiles?.[client.profileKey];
          const budget = profileConfig?.monthlyBudget;
          if (budget && budget > 0) {
            const cost = await gStorage!.getProfileMonthlyCost(client.providerKey, client.profileKey, currentMonth);
            return cost < budget;
          }
          return true;
        })
      );
      availableClients = availableClients.filter((_, i) => budgetChecks[i]);
    }

    if (availableClients.length === 0) {
      throw new Error("No available profiles (all are over budget or circuit-broken)");
    }

    // Select client via round-robin
    const clientIndex = pool.roundRobinIndex % availableClients.length;
    pool.roundRobinIndex++;
    let selectedClient = availableClients[clientIndex];

    // Retry config based on transport type
    const retryEnabled =
      selectedClient.transportType === "sse"
        ? currentProxyConfig.retrySseToolCall
        : selectedClient.transportType === "http"
          ? currentProxyConfig.retryHttpToolCall
          : currentProxyConfig.retryStdioToolCall;

    const maxRetries =
      selectedClient.transportType === "sse"
        ? currentProxyConfig.sseToolCallMaxRetries
        : selectedClient.transportType === "http"
          ? currentProxyConfig.httpToolCallMaxRetries
          : currentProxyConfig.stdioToolCallMaxRetries;

    const baseDelay =
      selectedClient.transportType === "sse"
        ? currentProxyConfig.sseToolCallRetryDelayBaseMs
        : selectedClient.transportType === "http"
          ? currentProxyConfig.httpToolCallRetryDelayBaseMs
          : currentProxyConfig.stdioToolCallRetryDelayBaseMs;

    // SSE: force reconnect on first attempt
    if (selectedClient.transportType === "sse") {
      try {
        const { reconnectSingleClient } = await import("./client.js");
        const reconnected = await reconnectSingleClient(selectedClient.name, selectedClient.config, selectedClient.cleanup);
        if (reconnected) {
          Object.assign(selectedClient, reconnected);
          logger.log(`Forced reconnection for SSE client: ${selectedClient.name}`);
        }
      } catch (e: any) {
        logger.warn(`Reconnection failed for ${selectedClient.name}: ${e.message}`);
      }
    }

    let lastError: any = null;
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        const result = await selectedClient.client.callTool({ name: originalToolName, arguments: args });
        const responseTimeMs = Date.now() - startTime;
        logger.debug(`Tool call success: ${name} via ${selectedClient.name} in ${responseTimeMs}ms`);

        // Record logging and billing on success
        if (gStorage && authContext) {
          const currentMonth = new Date().toISOString().slice(0, 7);
          const requestSummary = JSON.stringify(args ?? {}).substring(0, 500);
          const profileKey = selectedClient.profileKey ?? null;

          // Insert usage record for billing + request log
          const billingProviderKey = mapping.providerKey;
          gStorage.getToolPrice(billingProviderKey, originalToolName).then((unitPrice) => {
            // Insert request log with cost
            gStorage!.insertRequestLog({
              userId,
              apiKeyId,
              method: "tools/call",
              providerKey: billingProviderKey,
              toolName: originalToolName,
              requestSummary,
              responseStatus: "success",
              responseTimeMs,
              errorMessage: null,
              cost: unitPrice,
              profileKey,
            }).catch((e: any) => logger.error(`Failed to write request log: ${e.message}`));

            gStorage!.insertUsageRecord({
              userId,
              apiKeyId,
              providerKey: billingProviderKey,
              toolName: originalToolName,
              unitPrice,
              billingMonth: currentMonth,
            }).catch((e: any) => logger.error(`Failed to record usage: ${e.message}`));

            // Deduct balance if applicable
            if (unitPrice > 0 && authContext!.apiKeyRecord.balance > 0) {
              gStorage!.deductBalance(apiKeyId, unitPrice)
                .catch((e: any) => logger.error(`Failed to deduct balance: ${e.message}`));
            }
          }).catch((e: any) => logger.error(`Failed to get tool price: ${e.message}`));
        }

        // Check MCP-level isError responses for circuit breaker content matching
        if (cbConfig?.enabled && result && (result as any).isError) {
          const texts = ((result as any).content ?? [])
            .filter((c: any) => c.type === "text")
            .map((c: any) => c.text)
            .join(" ");
          if (texts) {
            const cbResult = checkCircuitBreakerError(texts, cbConfig);
            if (cbResult === "trip") {
              tripCircuitBreaker(selectedClient.name);
            } else if (cbResult === "failure") {
              recordCircuitBreakerFailure(selectedClient.name, cbConfig);
            }
          }
        } else {
          // Successful non-error response: reset failure count
          resetCircuitBreakerFailures(selectedClient.name);
        }

        return result;
      } catch (error: any) {
        lastError = error;
        logger.warn(`Tool call attempt ${attempt + 1} failed for ${name} via ${selectedClient.name}: ${error.message}`);

        // Update circuit breaker state on error
        if (cbConfig?.enabled) {
          const cbResult = checkCircuitBreakerError(error.message ?? "", cbConfig);
          if (cbResult === "trip") {
            tripCircuitBreaker(selectedClient.name);
          } else if (cbResult === "failure") {
            recordCircuitBreakerFailure(selectedClient.name, cbConfig);
          }
        }

        if (!retryEnabled || !isConnectionError(error)) {
          logger.error(`Non-retryable error for ${name}: ${error.message}`);

          // Record failed tool call in request log
          if (gStorage && authContext) {
            const responseTimeMs = Date.now() - startTime;
            gStorage.insertRequestLog({
              userId,
              apiKeyId,
              method: "tools/call",
              providerKey: mapping.providerKey,
              toolName: originalToolName,
              requestSummary: JSON.stringify(args ?? {}).substring(0, 500),
              responseStatus: "error",
              responseTimeMs,
              errorMessage: error.message,
              cost: 0,
              profileKey: selectedClient.profileKey ?? null,
            }).catch((e: any) => logger.error(`Failed to write request log: ${e.message}`));
          }

          throw error;
        }

        if (attempt < maxRetries) {
          // Failover: try next client in pool
          if (pool.clients.length > 1) {
            const nextIndex = (clientIndex + attempt + 1) % pool.clients.length;
            selectedClient = pool.clients[nextIndex];
            logger.log(`Failover to ${selectedClient.name} for ${name}`);
          }

          const delay = baseDelay * Math.pow(2, attempt) + Math.random() * baseDelay * 0.5;
          logger.log(`Retrying ${name} in ${delay.toFixed(0)}ms (attempt ${attempt + 1}/${maxRetries})`);
          await sleep(delay);

          // Try reconnect before retry
          try {
            const { reconnectSingleClient } = await import("./client.js");
            const reconnected = await reconnectSingleClient(
              selectedClient.name,
              selectedClient.config,
              selectedClient.cleanup
            );
            if (reconnected) {
              Object.assign(selectedClient, reconnected);
            }
          } catch (e: any) {
            logger.warn(`Reconnection failed for ${selectedClient.name}: ${e.message}`);
          }
        }
      }
    }

    logger.error(`Tool call failed after ${maxRetries} retries: ${name}`);

    // Record failed tool call in request log
    if (gStorage && authContext) {
      const responseTimeMs = Date.now() - startTime;
      gStorage.insertRequestLog({
        userId,
        apiKeyId,
        method: "tools/call",
        providerKey: mapping.providerKey,
        toolName: originalToolName,
        requestSummary: JSON.stringify(args ?? {}).substring(0, 500),
        responseStatus: "error",
        responseTimeMs,
        errorMessage: lastError?.message ?? "Unknown error",
        cost: 0,
        profileKey: selectedClient.profileKey ?? null,
      }).catch((e: any) => logger.error(`Failed to write request log: ${e.message}`));
    }

    throw lastError;
  });

  return server;
}

export async function startMcpProxyStdio(server: Server): Promise<void> {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  logger.log("MCP Proxy server running on stdio");
}

export function getToolToClientMap(): Map<string, ToolMapping> {
  return toolToClientMap;
}

export function getCurrentConnectedClients(): ConnectedClient[] {
  return currentConnectedClients;
}

export function getProviderPools(): Map<string, ProviderPool> {
  return providerPools;
}
