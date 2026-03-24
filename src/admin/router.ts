import { Router } from "express";
import type { IStorage } from "../storage/interface.js";
import {
  createAdminSessionMiddleware,
  createAdminAuthMiddleware,
  createAdminLoginHandler,
  createAdminLogoutHandler,
} from "./auth.js";
import { createUsersRouter } from "./users.js";
import { createApiKeysRouter } from "./api-keys.js";
import { createProvidersRouter } from "./providers.js";
import { createStatsRouter } from "./stats.js";
import { createPlaygroundRouter } from "./playground.js";
import { createConnectionLogsRouter } from "./connection-logs.js";
import { createGroupsRouter } from "./groups.js";

export function createAdminRouter(storage: IStorage): Router {
  const router = Router();

  // Session middleware - must be applied before auth
  const sessionMiddleware = createAdminSessionMiddleware();
  router.use(sessionMiddleware);

  // Public routes (no auth required)
  router.post("/login", createAdminLoginHandler());
  router.post("/logout", createAdminLogoutHandler());

  // Protected routes (auth required)
  const authMiddleware = createAdminAuthMiddleware();

  // Users routes
  const usersRouter = createUsersRouter(storage);
  router.post("/users", authMiddleware, usersRouter.create);
  router.get("/users", authMiddleware, usersRouter.list);
  router.get("/users/:id", authMiddleware, usersRouter.getById);
  router.put("/users/:id", authMiddleware, usersRouter.update);

  // API Keys routes
  const apiKeysRouter = createApiKeysRouter(storage);
  router.post("/users/:userId/api-keys", authMiddleware, apiKeysRouter.create);
  router.get("/users/:userId/api-keys", authMiddleware, apiKeysRouter.listByUser);
  router.get("/api-keys/:id", authMiddleware, apiKeysRouter.getById);
  router.put("/api-keys/:id", authMiddleware, apiKeysRouter.update);
  router.post("/api-keys/:id/regenerate", authMiddleware, apiKeysRouter.regenerate);
  router.delete("/api-keys/:id", authMiddleware, apiKeysRouter.delete);

  // Providers routes
  const providersRouter = createProvidersRouter();
  router.get("/providers", authMiddleware, providersRouter.list);
  router.post("/providers", authMiddleware, providersRouter.create);
  router.post("/providers/reload", authMiddleware, providersRouter.reload);
  router.get("/providers/:key/tools", authMiddleware, providersRouter.getTools);
  router.put("/providers/:key", authMiddleware, providersRouter.update);
  router.delete("/providers/:key", authMiddleware, providersRouter.delete);
  router.post("/providers/:key/profiles", authMiddleware, providersRouter.createProfile);
  router.put("/providers/:key/profiles/:profileKey", authMiddleware, providersRouter.updateProfile);
  router.delete("/providers/:key/profiles/:profileKey", authMiddleware, providersRouter.deleteProfile);

  // Stats routes
  const statsRouter = createStatsRouter(storage);
  router.get("/stats/usage", authMiddleware, statsRouter.getUsage);
  router.get("/stats/users/:id/usage", authMiddleware, statsRouter.getUserUsage);
  router.get("/stats/provider/:key/tool-usage", authMiddleware, statsRouter.getProviderToolUsage);
  router.get("/stats/provider/:key/profile-stats", authMiddleware, statsRouter.getProfileStats);
  router.get("/logs", authMiddleware, statsRouter.getLogs);
  router.get("/tool-prices", authMiddleware, statsRouter.listToolPrices);
  router.put("/tool-prices/:toolName", authMiddleware, statsRouter.setToolPrice);
  router.put("/tool-prices", authMiddleware, statsRouter.batchUpdateToolPrices);

  // Connection logs routes
  const connectionLogsRouter = createConnectionLogsRouter(storage);
  router.get("/users/:id/connection-logs", authMiddleware, connectionLogsRouter.listByUser);

  // Groups routes
  const groupsRouter = createGroupsRouter(storage);
  router.post("/groups", authMiddleware, groupsRouter.create);
  router.get("/groups", authMiddleware, groupsRouter.list);
  router.get("/groups/:id", authMiddleware, groupsRouter.getById);
  router.put("/groups/:id", authMiddleware, groupsRouter.update);
  router.delete("/groups/:id", authMiddleware, groupsRouter.delete);
  router.post("/groups/:id/members", authMiddleware, groupsRouter.addMembers);
  router.delete("/groups/:id/members/:userId", authMiddleware, groupsRouter.removeMember);

  // Playground routes
  const playgroundRouter = createPlaygroundRouter(storage);
  router.get("/playground/tools", authMiddleware, playgroundRouter.listTools);
  router.post("/playground/call", authMiddleware, playgroundRouter.call);

  return router;
}
