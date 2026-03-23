import type { Request, Response } from "express";
import type { IStorage, CreateApiKeyInput } from "../storage/interface.js";
import { v4 as uuidv4 } from "uuid";
import { createHash } from "crypto";
import { logger } from "../logger.js";

function generateApiKey(): { key: string; hash: string; prefix: string } {
  const rawKey = uuidv4() + uuidv4().replace(/-/g, "");
  const key = `sk_${rawKey.substring(0, 32)}`;
  const hash = createHash("sha256").update(key).digest("hex");
  const prefix = key.substring(0, 8);
  return { key, hash, prefix };
}

export function createApiKeysRouter(storage: IStorage) {
  return {
    // POST /admin/users/:userId/api-keys - Create API key for user
    create: async (req: Request, res: Response): Promise<void> => {
      try {
        const { userId } = req.params;
        const { name, quota, expiresAt, status, allowedTools, balance } = req.body;

        if (!name) {
          res.status(400).json({ error: "Name is required" });
          return;
        }

        // Verify user exists
        const user = await storage.getUser(userId);
        if (!user) {
          res.status(404).json({ error: "User not found" });
          return;
        }

        // Generate API key
        const { key, hash, prefix } = generateApiKey();

        const apiKeyInput: CreateApiKeyInput = {
          userId,
          name,
          keyHash: hash,
          keyPrefix: prefix,
          quota: quota ?? 0,
          allowedTools: allowedTools ?? null,
          balance: balance ?? -1,
          status,
          expiresAt: expiresAt ? new Date(expiresAt) : null,
        };

        const apiKey = await storage.createApiKey(apiKeyInput);
        logger.info(`API Key created: ${apiKey.id} for user ${userId}`);

        // Return API key with plain text key (only time it's returned)
        res.status(201).json({
          ...apiKey,
          key, // Plain text key - only returned on creation
        });
      } catch (e: any) {
        logger.error(`Failed to create API key: ${e.message}`);
        res.status(500).json({ error: e.message });
      }
    },

    // GET /admin/users/:userId/api-keys - List API keys for user
    listByUser: async (req: Request, res: Response): Promise<void> => {
      try {
        const { userId } = req.params;
        const apiKeys = await storage.listApiKeysByUser(userId);
        // Don't return key hashes in list response
        const safeKeys = apiKeys.map((k) => ({
          ...k,
          keyHash: undefined, // Hide hash in list
        }));
        res.json(safeKeys);
      } catch (e: any) {
        logger.error(`Failed to list API keys: ${e.message}`);
        res.status(500).json({ error: e.message });
      }
    },

    // GET /admin/api-keys/:id - Get API key by ID
    getById: async (req: Request, res: Response): Promise<void> => {
      try {
        const apiKey = await storage.getApiKey(req.params.id);
        if (!apiKey) {
          res.status(404).json({ error: "API key not found" });
          return;
        }
        // Don't return key hash
        const { keyHash, ...safeKey } = apiKey;
        res.json(safeKey);
      } catch (e: any) {
        logger.error(`Failed to get API key: ${e.message}`);
        res.status(500).json({ error: e.message });
      }
    },

    // PUT /admin/api-keys/:id - Update API key
    update: async (req: Request, res: Response): Promise<void> => {
      try {
        const { id } = req.params;
        const { name, quota, status, expiresAt, allowedTools, balance } = req.body;

        const existing = await storage.getApiKey(id);
        if (!existing) {
          res.status(404).json({ error: "API key not found" });
          return;
        }

        // Validate status if provided
        if (status && !["active", "disabled"].includes(status)) {
          res.status(400).json({ error: "Invalid status value" });
          return;
        }

        const data: Partial<Pick<ApiKey, "name" | "quota" | "status" | "expiresAt" | "allowedTools" | "balance">> = {};
        if (name !== undefined) data.name = name;
        if (quota !== undefined) data.quota = quota;
        if (status !== undefined) data.status = status;
        if (expiresAt !== undefined) data.expiresAt = expiresAt ? new Date(expiresAt) : null;
        if (allowedTools !== undefined) data.allowedTools = allowedTools;
        if (balance !== undefined) data.balance = balance;

        const apiKey = await storage.updateApiKey(id, data);
        logger.info(`API Key updated: ${apiKey.id}`);

        const { keyHash, ...safeKey } = apiKey;
        res.json(safeKey);
      } catch (e: any) {
        logger.error(`Failed to update API key: ${e.message}`);
        res.status(500).json({ error: e.message });
      }
    },

    // POST /admin/api-keys/:id/regenerate - Regenerate API key
    regenerate: async (req: Request, res: Response): Promise<void> => {
      try {
        const { id } = req.params;
        const existing = await storage.getApiKey(id);
        if (!existing) {
          res.status(404).json({ error: "API key not found" });
          return;
        }

        const { key, hash, prefix } = generateApiKey();
        await storage.regenerateApiKey(id, hash, prefix);
        logger.info(`API Key regenerated: ${id}`);

        res.json({ key });
      } catch (e: any) {
        logger.error(`Failed to regenerate API key: ${e.message}`);
        res.status(500).json({ error: e.message });
      }
    },

    // DELETE /admin/api-keys/:id - Delete API key
    delete: async (req: Request, res: Response): Promise<void> => {
      try {
        const { id } = req.params;
        const existing = await storage.getApiKey(id);
        if (!existing) {
          res.status(404).json({ error: "API key not found" });
          return;
        }

        await storage.deleteApiKey(id);
        logger.info(`API Key deleted: ${id}`);
        res.json({ success: true });
      } catch (e: any) {
        logger.error(`Failed to delete API key: ${e.message}`);
        res.status(500).json({ error: e.message });
      }
    },
  };
}

// Need to import ApiKey type
import type { ApiKey } from "../storage/interface.js";
