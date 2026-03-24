import type { Request, Response } from "express";
import type { IStorage } from "../storage/interface.js";

export function createConnectionLogsRouter(storage: IStorage) {
  return {
    listByUser: async (req: Request, res: Response) => {
      const userId = req.params.id;
      const status = (req.query.status as string) || "online";
      const limit = Math.min(Number(req.query.limit) || 100, 500);
      const offset = Number(req.query.offset) || 0;

      const result = await storage.listConnectionLogs({
        userId,
        status: status === "all" ? undefined : (status as "online" | "offline"),
        limit,
        offset,
      });

      // Enrich with API key info
      const apiKeys = await storage.listApiKeysByUser(userId);
      const keyMap = new Map(apiKeys.map((k) => [k.id, k]));

      const enriched = result.data.map((log) => {
        const key = keyMap.get(log.apiKeyId);
        return {
          ...log,
          apiKeyName: key?.name ?? null,
          apiKeyPrefix: key?.keyPrefix ?? null,
        };
      });

      res.json({ data: enriched, total: result.total });
    },
  };
}
