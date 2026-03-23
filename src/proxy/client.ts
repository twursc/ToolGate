import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { SSEClientTransport, SSEClientTransportOptions } from "@modelcontextprotocol/sdk/client/sse.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport, StreamableHTTPClientTransportOptions } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import { logger } from "../logger.js";
import type { McpServerConfig } from "../config.js";

export interface ConnectedClient {
  client: Client;
  cleanup: () => Promise<void>;
  name: string;              // "providerKey/profileKey"
  providerKey: string;
  profileKey: string;
  config: McpServerConfig;
  transportType: "sse" | "stdio" | "http";
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

function createTransport(name: string, config: McpServerConfig): { transport: Transport | null; transportType: "sse" | "stdio" | "http" | null } {
  let transport: Transport | null = null;
  let transportType: "sse" | "stdio" | "http" | null = null;

  try {
    if (config.type === "sse") {
      transportType = "sse";
      const transportOptions: SSEClientTransportOptions = {};
      const customHeaders: Record<string, string> = {};
      if (config.bearerToken) customHeaders["Authorization"] = `Bearer ${config.bearerToken}`;
      if (config.apiKey) customHeaders["X-Api-Key"] = config.apiKey;
      if (config.headers) Object.assign(customHeaders, config.headers);
      if (Object.keys(customHeaders).length > 0) {
        transportOptions.requestInit = { headers: customHeaders };
        transportOptions.eventSourceInit = {
          fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
            const originalHeaders = new Headers(init?.headers || {});
            for (const key in customHeaders) originalHeaders.set(key, customHeaders[key]);
            return fetch(input, { ...init, headers: originalHeaders });
          },
        } as any;
      }
      transport = new SSEClientTransport(new URL(config.url), transportOptions);
    } else if (config.type === "stdio") {
      transportType = "stdio";
      const mergedEnv = { ...process.env, ...config.env };
      const filteredEnv: Record<string, string> = {};
      for (const key in mergedEnv) {
        if (Object.prototype.hasOwnProperty.call(mergedEnv, key) && mergedEnv[key] !== undefined) {
          filteredEnv[key] = mergedEnv[key] as string;
        }
      }
      transport = new StdioClientTransport({ command: config.command, args: config.args, env: filteredEnv });
    } else if (config.type === "http") {
      transportType = "http";
      const transportOptions: StreamableHTTPClientTransportOptions = {};
      const customHeaders: Record<string, string> = {};
      if (config.bearerToken) customHeaders["Authorization"] = `Bearer ${config.bearerToken}`;
      if (config.apiKey) customHeaders["X-Api-Key"] = config.apiKey;
      if (config.headers) Object.assign(customHeaders, config.headers);
      if (Object.keys(customHeaders).length > 0) {
        transportOptions.requestInit = { headers: customHeaders };
      }
      transport = new StreamableHTTPClientTransport(new URL(config.url), transportOptions);
    } else {
      logger.error(`Invalid transport type for server: ${name}`);
    }
  } catch (error: any) {
    logger.error(`Failed to create transport for ${name}: ${error.message}`);
  }

  if (!transport || !transportType) {
    logger.warn(`Transport creation failed for ${name}`);
    return { transport: null, transportType: null };
  }

  return { transport, transportType };
}

export async function createConnectedClient(
  name: string,
  config: McpServerConfig,
  providerKey: string,
  profileKey: string,
): Promise<ConnectedClient | null> {
  const { transport, transportType } = createTransport(name, config);
  if (!transport || !transportType) return null;

  const client = new Client(
    { name: "mcp-gateway-client", version: "1.0.0" },
    { capabilities: { prompts: {}, resources: { subscribe: true }, tools: {} } }
  );

  try {
    await client.connect(transport);
    logger.log(`Connected to server: ${name}`);
    return {
      client,
      name,
      providerKey,
      profileKey,
      config,
      transportType,
      cleanup: async () => {
        await transport.close();
      },
    };
  } catch (error: any) {
    logger.error(`Failed to connect to ${name}: ${error.message}`);
    await transport.close();
    return null;
  }
}

export async function reconnectSingleClient(
  name: string,
  config: McpServerConfig,
  existingCleanup?: () => Promise<void>
): Promise<Omit<ConnectedClient, "name" | "providerKey" | "profileKey"> | null> {
  logger.log(`Attempting to reconnect client: ${name}`);

  if (existingCleanup) {
    try {
      await existingCleanup();
      logger.log(`Existing client ${name} cleaned up before reconnecting`);
    } catch (e: any) {
      logger.warn(`Error during cleanup of existing client ${name}: ${e.message}`);
    }
  }

  const { transport, transportType } = createTransport(name, config);
  if (!transport || !transportType) return null;

  const client = new Client(
    { name: "mcp-gateway-client-reconnect", version: "1.0.0" },
    { capabilities: { prompts: {}, resources: { subscribe: true }, tools: {} } }
  );

  try {
    await client.connect(transport);
    logger.log(`Successfully reconnected to server: ${name}`);
    const finalTransport = transport;
    return {
      client,
      config,
      transportType,
      cleanup: async () => {
        await finalTransport.close();
      },
    };
  } catch (error: any) {
    logger.error(`Failed to reconnect to ${name}: ${error.message}`);
    await transport.close();
    return null;
  }
}
