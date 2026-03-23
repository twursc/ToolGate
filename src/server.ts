import express from "express";
import cors from "cors";
import path from "path";
import { fileURLToPath } from "url";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import { createServer } from "http";
import { randomUUID } from "crypto";
import { loadGatewayConfig, loadMcpServersConfig } from "./config.js";
import { logger, setLogLevel } from "./logger.js";
import { createStorage } from "./storage/factory.js";
import { setupMcpProxy, updateBackendConnections, setSessionAuth, clearSessionAuth } from "./proxy/mcp-proxy.js";
import { createAuthMiddleware } from "./middleware/auth.js";
import { createAdminRouter } from "./admin/router.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Map to store transports by session ID for SSE
const sseTransports: Map<string, SSEServerTransport> = new Map();
// Map to store transports by session ID for Streamable HTTP
const httpTransports: Map<string, StreamableHTTPServerTransport> = new Map();

async function main() {
  // Load configuration
  const config = loadGatewayConfig();
  const mcpConfig = loadMcpServersConfig();

  // Set log level
  setLogLevel(config.logging.level);
  logger.info(`Starting MCP Gateway Server...`);

  // Initialize storage
  const storage = await createStorage(config);
  await storage.initialize();
  logger.info(`Storage initialized: ${config.storage.type}`);

  // Create MCP Server with proxy handlers
  const server = await setupMcpProxy({
    serverToolnameSeparator: config.proxy.serverToolnameSeparator,
    proxy: config.proxy,
    storage,
  });

  // Connect to backend MCP providers
  const providers = mcpConfig.mcpProviders ?? {};
  await updateBackendConnections(
    providers,
    config.proxy.serverToolnameSeparator,
    config.proxy
  );
  logger.info(`Connected to ${Object.keys(providers).length} backend providers`);

  // --- Admin App (port: config.server.port) ---

  const adminApp = express();
  adminApp.use(cors());
  adminApp.use(express.json());

  // Mount Admin API
  adminApp.use("/admin/api", createAdminRouter(storage));
  logger.info(`Admin API mounted at /admin/api`);

  // Serve Admin UI static files
  const adminUiPath = path.join(process.cwd(), "build", "admin-ui");
  adminApp.use("/admin", express.static(adminUiPath));
  adminApp.get("/admin/*", (_req, res) => {
    res.sendFile(path.join(adminUiPath, "index.html"));
  });

  const adminServer = createServer(adminApp);

  // --- MCP App (port: config.server.mcpPort) ---

  const mcpApp = express();
  mcpApp.use(cors());
  mcpApp.use(express.json());

  // Auth middleware
  const authMiddleware = createAuthMiddleware(storage);

  // SSE transport endpoint
  mcpApp.get("/sse", authMiddleware, async (req, res) => {
    const transport = new SSEServerTransport("/message", res);
    sseTransports.set(transport.sessionId, transport);

    // Store auth context for this session so CallTool handler can access it
    if (req.authContext) {
      setSessionAuth(transport.sessionId, req.authContext);
    }

    res.on("close", () => {
      clearSessionAuth(transport.sessionId);
      sseTransports.delete(transport.sessionId);
    });

    await server.connect(transport);
    logger.debug(`SSE connection established: ${transport.sessionId}`);
  });

  // SSE message endpoint
  mcpApp.post("/message", authMiddleware, async (req, res) => {
    const sessionId = req.query.sessionId as string;
    const transport = sseTransports.get(sessionId);
    if (!transport) {
      res.status(400).json({ error: "Session not found" });
      return;
    }
    await transport.handlePostMessage(req, res);
  });

  // Streamable HTTP transport endpoint
  mcpApp.post("/mcp", authMiddleware, async (req, res) => {
    const sessionId = req.headers["mcp-session-id"] as string | undefined;

    // Reuse existing session
    if (sessionId && httpTransports.has(sessionId)) {
      const transport = httpTransports.get(sessionId)!;
      await transport.handleRequest(req, res, req.body);
      return;
    }

    // New session: only allow initialize requests
    if (sessionId || !isInitializeRequest(req.body)) {
      res.status(400).json({
        jsonrpc: "2.0",
        error: { code: -32000, message: "Invalid session" },
        id: null,
      });
      return;
    }

    const authContext = req.authContext;

    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => randomUUID(),
      onsessioninitialized: (sid: string) => {
        httpTransports.set(sid, transport);
        // Store auth context for this session
        if (authContext) {
          setSessionAuth(sid, authContext);
        }
        logger.debug(`HTTP session initialized: ${sid}`);
      },
    });

    transport.onclose = () => {
      if (transport.sessionId) {
        clearSessionAuth(transport.sessionId);
        httpTransports.delete(transport.sessionId);
      }
    };

    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  });

  // Handle GET requests to /mcp for SSE streaming (existing sessions)
  mcpApp.get("/mcp", authMiddleware, async (req, res) => {
    const sessionId = req.headers["mcp-session-id"] as string;
    if (sessionId && httpTransports.has(sessionId)) {
      await httpTransports.get(sessionId)!.handleRequest(req, res);
      return;
    }
    res.status(400).json({
      jsonrpc: "2.0",
      error: { code: -32000, message: "Invalid session" },
      id: null,
    });
  });

  // Handle DELETE requests to /mcp for session termination
  mcpApp.delete("/mcp", authMiddleware, async (req, res) => {
    const sessionId = req.headers["mcp-session-id"] as string;
    if (sessionId && httpTransports.has(sessionId)) {
      await httpTransports.get(sessionId)!.handleRequest(req, res);
      return;
    }
    res.status(400).json({
      jsonrpc: "2.0",
      error: { code: -32000, message: "Invalid session" },
      id: null,
    });
  });

  // Catch-all: return JSON 404 for any unmatched routes
  mcpApp.use((_req, res) => {
    res.status(404).json({ error: "Not found" });
  });

  const mcpServer = createServer(mcpApp);

  // --- Start both servers ---

  await new Promise<void>((resolve, reject) => {
    adminServer.listen(config.server.port, config.server.host, () => {
      logger.info(`Admin server listening on ${config.server.host}:${config.server.port}`);
      resolve();
    });
    adminServer.on("error", reject);
  });

  await new Promise<void>((resolve, reject) => {
    mcpServer.listen(config.server.mcpPort, config.server.host, () => {
      logger.info(`MCP server listening on ${config.server.host}:${config.server.mcpPort}`);
      resolve();
    });
    mcpServer.on("error", reject);
  });

  // Graceful shutdown
  const shutdown = async () => {
    logger.info("Shutting down servers...");

    // Close all SSE transports
    for (const transport of sseTransports.values()) {
      await transport.close();
    }
    sseTransports.clear();

    // Close all HTTP transports
    for (const transport of httpTransports.values()) {
      await transport.close();
    }
    httpTransports.clear();

    // Close storage
    await storage.close();

    // Close both HTTP servers
    await Promise.all([
      new Promise<void>((resolve) => adminServer.close(() => resolve())),
      new Promise<void>((resolve) => mcpServer.close(() => resolve())),
    ]);

    logger.info("Server shut down complete");
    process.exit(0);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  // Clean expired logs on startup and daily
  await cleanExpiredLogs(storage, config.logging.retentionDays);
  const dailyInterval = setInterval(() => {
    cleanExpiredLogs(storage, config.logging.retentionDays).catch((e) => {
      logger.error(`Failed to clean expired logs: ${e.message}`);
    });
  }, 24 * 60 * 60 * 1000); // 24 hours

  process.on("exit", () => {
    clearInterval(dailyInterval);
  });
}

async function cleanExpiredLogs(storage: any, retentionDays: number) {
  const beforeDate = new Date();
  beforeDate.setDate(beforeDate.getDate() - retentionDays);
  const deleted = await storage.cleanExpiredLogs(beforeDate);
  if (deleted > 0) {
    logger.info(`Cleaned ${deleted} expired request logs`);
  }
}

main().catch((e) => {
  logger.error(`Failed to start server: ${e.message}`);
  process.exit(1);
});
