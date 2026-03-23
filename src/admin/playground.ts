import type { Request, Response } from "express";
import type { IStorage } from "../storage/interface.js";
import { logger } from "../logger.js";
import { getProviderPools, getToolToClientMap } from "../proxy/mcp-proxy.js";

const PLAYGROUND_USERNAME = "playground";

async function ensurePlaygroundUser(storage: IStorage): Promise<string> {
  const existing = await storage.getUserByUsername(PLAYGROUND_USERNAME);
  if (existing) return existing.id;
  const user = await storage.createUser({
    username: PLAYGROUND_USERNAME,
    note: "Playground ghost user for admin tool testing",
  });
  logger.info(`Created playground ghost user: ${user.id}`);
  return user.id;
}

export function createPlaygroundRouter(storage: IStorage) {
  return {
    // POST /admin/playground/call - Call a tool and return result
    call: async (req: Request, res: Response): Promise<void> => {
      try {
        const { toolName, arguments: args } = req.body;
        if (!toolName) {
          res.status(400).json({ error: "toolName is required" });
          return;
        }

        const toolMap = getToolToClientMap();
        const mapping = toolMap.get(toolName);
        if (!mapping) {
          res.status(404).json({ error: `Tool not found: ${toolName}` });
          return;
        }

        const pools = getProviderPools();
        const pool = pools.get(mapping.providerKey);
        if (!pool || pool.clients.length === 0) {
          res.status(503).json({ error: `No available profiles for provider: ${mapping.providerKey}` });
          return;
        }

        // Select client via round-robin
        const clientIndex = pool.roundRobinIndex % pool.clients.length;
        pool.roundRobinIndex++;
        const selectedClient = pool.clients[clientIndex];

        const startTime = Date.now();
        const originalToolName = mapping.toolInfo.name;
        const result = await selectedClient.client.callTool({ name: originalToolName, arguments: args ?? {} });
        const responseTimeMs = Date.now() - startTime;

        // Record billing under playground user
        const playgroundUserId = await ensurePlaygroundUser(storage);
        const currentMonth = new Date().toISOString().slice(0, 7);
        const profileKey = selectedClient.profileKey ?? null;

        storage.getToolPrice(toolName).then((unitPrice) => {
          storage.insertRequestLog({
            userId: playgroundUserId,
            apiKeyId: "playground",
            method: "tools/call",
            toolName,
            requestSummary: JSON.stringify(args ?? {}).substring(0, 500),
            responseStatus: "success",
            responseTimeMs,
            errorMessage: null,
            cost: unitPrice,
            profileKey,
          }).catch((e: any) => logger.error(`Playground log error: ${e.message}`));

          storage.insertUsageRecord({
            userId: playgroundUserId,
            apiKeyId: "playground",
            toolName,
            unitPrice,
            billingMonth: currentMonth,
          }).catch((e: any) => logger.error(`Playground usage error: ${e.message}`));
        }).catch((e: any) => logger.error(`Failed to get tool price: ${e.message}`));

        res.json({ result, responseTimeMs, profileKey });
      } catch (e: any) {
        logger.error(`Playground call failed: ${e.message}`);
        res.status(500).json({ error: e.message });
      }
    },

    // GET /admin/playground/tools - List all available tools with schemas
    listTools: async (_req: Request, res: Response): Promise<void> => {
      try {
        const pools = getProviderPools();
        const toolMap = getToolToClientMap();
        const tools: { name: string; providerKey: string; description?: string; inputSchema: Record<string, unknown> }[] = [];

        for (const [qualifiedName, mapping] of toolMap) {
          const pool = pools.get(mapping.providerKey);
          if (!pool || pool.clients.length === 0) continue;
          tools.push({
            name: qualifiedName,
            providerKey: mapping.providerKey,
            description: mapping.toolInfo.description,
            inputSchema: mapping.toolInfo.inputSchema as Record<string, unknown>,
          });
        }

        tools.sort((a, b) => a.name.localeCompare(b.name));
        res.json({ tools });
      } catch (e: any) {
        logger.error(`Playground list tools failed: ${e.message}`);
        res.status(500).json({ error: e.message });
      }
    },
  };
}
