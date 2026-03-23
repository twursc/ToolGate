import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { loadGatewayConfig, loadMcpServersConfig } from "./config.js";
import { logger, setLogLevel } from "./logger.js";
import { createStorage } from "./storage/factory.js";
import { setupMcpProxy, updateBackendConnections } from "./proxy/mcp-proxy.js";

async function main() {
  // Load configuration
  const config = loadGatewayConfig();
  const mcpConfig = loadMcpServersConfig();

  // Set log level to error for stdio mode (to avoid polluting stdout)
  setLogLevel("error");

  // Initialize storage
  const storage = await createStorage(config);
  await storage.initialize();

  // Create MCP Server with proxy handlers
  const server = await setupMcpProxy({
    serverToolnameSeparator: config.proxy.serverToolnameSeparator,
    proxy: config.proxy,
  });

  // Connect to backend MCP providers
  const providers = mcpConfig.mcpProviders ?? {};
  await updateBackendConnections(
    providers,
    config.proxy.serverToolnameSeparator,
    config.proxy
  );

  // Start stdio transport
  const transport = new StdioServerTransport();
  await server.connect(transport);

  logger.info("MCP Gateway (stdio mode) started");
}

main().catch((e) => {
  console.error(`Failed to start stdio server: ${e.message}`);
  process.exit(1);
});
