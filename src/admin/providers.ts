import type { Request, Response } from "express";
import {
  loadMcpServersConfig,
  reloadMcpServersConfig,
  getMcpServersConfig,
} from "../config.js";
import type { ProviderConfig, ProfileConfig } from "../config.js";
import { writeFileSync, existsSync, mkdirSync } from "fs";
import { join, dirname } from "path";
import { logger } from "../logger.js";
import {
  getProviderPools,
  getCurrentConnectedClients,
  updateBackendConnections,
} from "../proxy/mcp-proxy.js";
import { getGatewayConfig } from "../config.js";

const MCP_SERVER_CONFIG_PATH = join(process.cwd(), "data", "mcp_server.json");

function persistConfig(config: ReturnType<typeof loadMcpServersConfig>): void {
  const dir = dirname(MCP_SERVER_CONFIG_PATH);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  writeFileSync(MCP_SERVER_CONFIG_PATH, JSON.stringify(config, null, 2));
}

function validateProviderConfig(provider: Partial<ProviderConfig>): string | null {
  if (!provider.type || !["stdio", "sse", "http"].includes(provider.type)) {
    return "Invalid type, must be 'stdio', 'sse', or 'http'";
  }
  if (provider.type === "stdio" && !provider.command) {
    return "Command is required for stdio transport";
  }
  if ((provider.type === "sse" || provider.type === "http") && !provider.url) {
    return "URL is required for SSE/HTTP transport";
  }
  return null;
}

export function createProvidersRouter() {
  return {
    // GET /providers - List all providers with runtime status
    list: async (_req: Request, res: Response): Promise<void> => {
      try {
        const config = loadMcpServersConfig();
        const pools = getProviderPools();
        const connectedClients = getCurrentConnectedClients();
        const providers = config.mcpProviders ?? {};

        const result = Object.entries(providers).map(([key, provider]) => {
          const pool = pools.get(key);
          const tools = pool?.tools.map((t) => t.name) ?? [];
          const schemaErrors = pool?.schemaErrors ?? [];
          const mismatchedTools = pool?.mismatchedTools ?? [];

          const profiles = Object.entries(provider.profiles).map(
            ([profileKey, profile]) => {
              const clientName = `${key}/${profileKey}`;
              const client = connectedClients.find((c) => c.name === clientName);
              return {
                key: profileKey,
                active: profile.active ?? true,
                status: client ? ("connected" as const) : ("disconnected" as const),
                url: profile.url,
                headers: profile.headers,
                env: profile.env,
                monthlyBudget: profile.monthlyBudget ?? 0,
              };
            }
          );

          return {
            key,
            type: provider.type,
            active: provider.active ?? true,
            name: provider.name,
            url: provider.url,
            command: provider.command,
            args: provider.args,
            circuitBreaker: provider.circuitBreaker,
            tools,
            schemaErrors,
            mismatchedTools,
            profiles,
          };
        });

        res.json(result);
      } catch (e: any) {
        logger.error(`Failed to list providers: ${e.message}`);
        res.status(500).json({ error: e.message });
      }
    },

    // POST /providers - Create a new provider
    create: async (req: Request, res: Response): Promise<void> => {
      try {
        const config = loadMcpServersConfig();
        const { key, profiles: rawProfiles, ...providerData } = req.body;

        if (!key) {
          res.status(400).json({ error: "Provider key is required" });
          return;
        }

        const error = validateProviderConfig(providerData);
        if (error) {
          res.status(400).json({ error });
          return;
        }

        if (!config.mcpProviders) config.mcpProviders = {};
        if (config.mcpProviders[key]) {
          res.status(409).json({ error: "Provider already exists" });
          return;
        }

        const profiles: Record<string, ProfileConfig> = rawProfiles ?? {};

        config.mcpProviders[key] = { ...providerData, profiles } as ProviderConfig;
        persistConfig(config);
        logger.info(`Provider created: ${key}`);

        res.status(201).json({ success: true, key });
      } catch (e: any) {
        logger.error(`Failed to create provider: ${e.message}`);
        res.status(500).json({ error: e.message });
      }
    },

    // PUT /providers/:key - Update a provider
    update: async (req: Request, res: Response): Promise<void> => {
      try {
        const { key } = req.params;
        const config = loadMcpServersConfig();

        if (!config.mcpProviders?.[key]) {
          res.status(404).json({ error: "Provider not found" });
          return;
        }

        const existing = config.mcpProviders[key];
        const { profiles, ...updates } = req.body;

        // Merge updates but preserve profiles unless explicitly provided
        config.mcpProviders[key] = {
          ...existing,
          ...updates,
          profiles: profiles ?? existing.profiles,
        };

        persistConfig(config);
        logger.info(`Provider updated: ${key}`);

        res.json({ success: true });
      } catch (e: any) {
        logger.error(`Failed to update provider: ${e.message}`);
        res.status(500).json({ error: e.message });
      }
    },

    // DELETE /providers/:key - Delete a provider
    delete: async (req: Request, res: Response): Promise<void> => {
      try {
        const { key } = req.params;
        const config = loadMcpServersConfig();

        if (!config.mcpProviders?.[key]) {
          res.status(404).json({ error: "Provider not found" });
          return;
        }

        delete config.mcpProviders[key];
        persistConfig(config);
        logger.info(`Provider deleted: ${key}`);

        res.json({ success: true });
      } catch (e: any) {
        logger.error(`Failed to delete provider: ${e.message}`);
        res.status(500).json({ error: e.message });
      }
    },

    // POST /providers/:key/profiles - Add a profile to a provider
    createProfile: async (req: Request, res: Response): Promise<void> => {
      try {
        const { key } = req.params;
        const config = loadMcpServersConfig();

        if (!config.mcpProviders?.[key]) {
          res.status(404).json({ error: "Provider not found" });
          return;
        }

        const { key: profileKey, ...profileData } = req.body;
        if (!profileKey) {
          res.status(400).json({ error: "Profile key is required" });
          return;
        }

        if (config.mcpProviders[key].profiles[profileKey]) {
          res.status(409).json({ error: "Profile already exists" });
          return;
        }

        config.mcpProviders[key].profiles[profileKey] = profileData as ProfileConfig;
        persistConfig(config);
        logger.info(`Profile created: ${key}/${profileKey}`);

        res.status(201).json({ success: true, profileKey });
      } catch (e: any) {
        logger.error(`Failed to create profile: ${e.message}`);
        res.status(500).json({ error: e.message });
      }
    },

    // PUT /providers/:key/profiles/:profileKey - Update a profile
    updateProfile: async (req: Request, res: Response): Promise<void> => {
      try {
        const { key, profileKey } = req.params;
        const config = loadMcpServersConfig();

        if (!config.mcpProviders?.[key]) {
          res.status(404).json({ error: "Provider not found" });
          return;
        }
        if (!config.mcpProviders[key].profiles[profileKey]) {
          res.status(404).json({ error: "Profile not found" });
          return;
        }

        config.mcpProviders[key].profiles[profileKey] = {
          ...config.mcpProviders[key].profiles[profileKey],
          ...req.body,
        };

        persistConfig(config);
        logger.info(`Profile updated: ${key}/${profileKey}`);

        res.json({ success: true });
      } catch (e: any) {
        logger.error(`Failed to update profile: ${e.message}`);
        res.status(500).json({ error: e.message });
      }
    },

    // DELETE /providers/:key/profiles/:profileKey - Delete a profile
    deleteProfile: async (req: Request, res: Response): Promise<void> => {
      try {
        const { key, profileKey } = req.params;
        const config = loadMcpServersConfig();

        if (!config.mcpProviders?.[key]) {
          res.status(404).json({ error: "Provider not found" });
          return;
        }
        if (!config.mcpProviders[key].profiles[profileKey]) {
          res.status(404).json({ error: "Profile not found" });
          return;
        }

        delete config.mcpProviders[key].profiles[profileKey];
        persistConfig(config);
        logger.info(`Profile deleted: ${key}/${profileKey}`);

        res.json({ success: true });
      } catch (e: any) {
        logger.error(`Failed to delete profile: ${e.message}`);
        res.status(500).json({ error: e.message });
      }
    },

    // POST /providers/reload - Reload config and reconnect
    reload: async (_req: Request, res: Response): Promise<void> => {
      try {
        const mcpConfig = reloadMcpServersConfig();
        const gatewayConfig = getGatewayConfig();
        const providers = mcpConfig.mcpProviders ?? {};

        await updateBackendConnections(
          providers,
          gatewayConfig.proxy.serverToolnameSeparator,
          gatewayConfig.proxy
        );

        logger.info("Providers reloaded and reconnected");
        res.json({ success: true });
      } catch (e: any) {
        logger.error(`Failed to reload providers: ${e.message}`);
        res.status(500).json({ error: e.message });
      }
    },

    // GET /providers/:key/tools - Get tool list with full schema
    getTools: async (req: Request, res: Response): Promise<void> => {
      try {
        const { key } = req.params;
        const pools = getProviderPools();
        const pool = pools.get(key);

        if (!pool) {
          res.status(404).json({ error: "Provider not found or not connected" });
          return;
        }

        const tools = pool.tools.map((tool) => ({
          name: tool.name,
          description: tool.description,
          inputSchema: tool.inputSchema,
          hasMismatch: pool.mismatchedTools.includes(tool.name),
        }));

        res.json({ tools });
      } catch (e: any) {
        logger.error(`Failed to get tools for provider: ${e.message}`);
        res.status(500).json({ error: e.message });
      }
    },
  };
}
