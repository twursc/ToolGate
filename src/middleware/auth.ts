import type { Request, Response, NextFunction } from "express";
import { createHash } from "crypto";
import type { IStorage, ApiKey, User } from "../storage/interface.js";
import { logger } from "../logger.js";

export interface AuthContext {
  userId: string;
  apiKeyId: string;
  apiKey: string;
  user: User;
  apiKeyRecord: ApiKey;
}

declare global {
  namespace Express {
    interface Request {
      authContext?: AuthContext;
    }
  }
}

const ANONYMOUS_AUTH_CONTEXT: AuthContext = {
  userId: "anonymous",
  apiKeyId: "anonymous",
  apiKey: "",
  user: {
    id: "anonymous",
    username: "anonymous",
    email: null,
    note: "Auth-free ghost user",
    status: "active",
    createdAt: new Date(),
    updatedAt: new Date(),
  },
  apiKeyRecord: {
    id: "anonymous",
    userId: "anonymous",
    name: "anonymous",
    keyHash: "",
    keyPrefix: "",
    quota: 0,
    allowedTools: null,
    balance: -1,
    status: "active",
    expiresAt: null,
    createdAt: new Date(),
  },
};

export function createAuthMiddleware(storage: IStorage) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    // Auth-free mode: skip authentication, use anonymous context
    if (process.env.MCP_GW_AUTH_FREE) {
      req.authContext = ANONYMOUS_AUTH_CONTEXT;
      next();
      return;
    }

    const authHeader = req.headers["authorization"];
    const apiKeyHeader = req.headers["x-api-key"] as string | undefined;

    let rawApiKey: string | undefined;

    if (authHeader && authHeader.startsWith("Bearer ")) {
      rawApiKey = authHeader.substring(7);
    } else if (apiKeyHeader) {
      rawApiKey = apiKeyHeader;
    }

    if (!rawApiKey) {
      res.status(401).json({ error: "Missing API key. Provide 'Authorization: Bearer <key>' or 'X-Api-Key: <key>' header." });
      return;
    }

    const keyHash = createHash("sha256").update(rawApiKey).digest("hex");
    const apiKeyRecord = await storage.getApiKeyByHash(keyHash);

    if (!apiKeyRecord) {
      logger.warn(`Invalid API key attempt: ${keyHash.substring(0, 8)}...`);
      res.status(401).json({ error: "Invalid API key" });
      return;
    }

    // Check if API key is disabled
    if (apiKeyRecord.status === "disabled") {
      logger.warn(`Disabled API key used: ${apiKeyRecord.id}`);
      res.status(401).json({ error: "API key is disabled" });
      return;
    }

    // Check if API key is expired
    if (apiKeyRecord.expiresAt && new Date() > apiKeyRecord.expiresAt) {
      logger.warn(`Expired API key used: ${apiKeyRecord.id}`);
      res.status(401).json({ error: "API key has expired" });
      return;
    }

    // Get user and check status
    const user = await storage.getUser(apiKeyRecord.userId);
    if (!user) {
      logger.error(`User not found for API key: ${apiKeyRecord.id}`);
      res.status(401).json({ error: "User not found" });
      return;
    }

    if (user.status === "disabled") {
      logger.warn(`Disabled user attempted access: ${user.id}`);
      res.status(401).json({ error: "User account is disabled" });
      return;
    }

    // Attach auth context to request
    req.authContext = {
      userId: user.id,
      apiKeyId: apiKeyRecord.id,
      apiKey: rawApiKey,
      user,
      apiKeyRecord,
    };

    logger.debug(`Authenticated user: ${user.username} with API key: ${apiKeyRecord.name}`);
    next();
  };
}
