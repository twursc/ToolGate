import type { Request, Response } from "express";
import type { IStorage, UsageFilter, UserToolFilter, LogFilter } from "../storage/interface.js";
import { logger } from "../logger.js";

export function createStatsRouter(storage: IStorage) {
  return {
    // GET /admin/stats/dashboard - Aggregated dashboard stats
    getDashboard: async (req: Request, res: Response): Promise<void> => {
      try {
        const stats = await storage.getDashboardStats();
        res.json(stats);
      } catch (e: any) {
        logger.error(`Failed to get dashboard stats: ${e.message}`);
        res.status(500).json({ error: e.message });
      }
    },

    // GET /admin/stats/usage - Get usage statistics with filters
    getUsage: async (req: Request, res: Response): Promise<void> => {
      try {
        const filter: UsageFilter = {};
        if (req.query.userId) filter.userId = req.query.userId as string;
        if (req.query.toolName) filter.toolName = req.query.toolName as string;
        if (req.query.provider) filter.toolNamePrefix = (req.query.provider as string) + "__";
        if (req.query.billingMonth) filter.billingMonth = req.query.billingMonth as string;
        if (req.query.startDate) filter.startDate = new Date(req.query.startDate as string);
        if (req.query.endDate) filter.endDate = new Date(req.query.endDate as string);
        if (req.query.limit) filter.limit = parseInt(req.query.limit as string, 10);
        if (req.query.offset) filter.offset = parseInt(req.query.offset as string, 10);

        const result = await storage.getUsageStats(filter);
        res.json(result);
      } catch (e: any) {
        logger.error(`Failed to get usage stats: ${e.message}`);
        res.status(500).json({ error: e.message });
      }
    },

    // GET /admin/stats/users/:id/usage - Get usage by user
    getUserUsage: async (req: Request, res: Response): Promise<void> => {
      try {
        const userId = req.params.userId || req.params.id;
        const filter: UserToolFilter = { userId };
        if (req.query.billingMonth) filter.billingMonth = req.query.billingMonth as string;
        if (req.query.startDate) filter.startDate = new Date(req.query.startDate as string);
        if (req.query.endDate) filter.endDate = new Date(req.query.endDate as string);

        const stats = await storage.getUsageByUserAndTool(filter);
        res.json(stats);
      } catch (e: any) {
        logger.error(`Failed to get user usage: ${e.message}`);
        res.status(500).json({ error: e.message });
      }
    },

    // GET /admin/logs - Query request logs
    getLogs: async (req: Request, res: Response): Promise<void> => {
      try {
        const filter: any = {};
        if (req.query.userId) filter.userId = req.query.userId as string;
        if (req.query.apiKeyId) filter.apiKeyId = req.query.apiKeyId as string;
        if (req.query.method) filter.method = req.query.method as string;
        if (req.query.startDate) filter.startDate = new Date(req.query.startDate as string);
        if (req.query.endDate) filter.endDate = new Date(req.query.endDate as string);
        if (req.query.limit) filter.limit = parseInt(req.query.limit as string, 10);
        if (req.query.offset) filter.offset = parseInt(req.query.offset as string, 10);

        const logs = await storage.queryRequestLogs(filter);
        res.json(logs);
      } catch (e: any) {
        logger.error(`Failed to query logs: ${e.message}`);
        res.status(500).json({ error: e.message });
      }
    },

    // GET /admin/stats/provider/:key/tool-usage - Get per-tool usage with profile & user breakdown
    getProviderToolUsage: async (req: Request, res: Response): Promise<void> => {
      try {
        const providerKey = req.params.key;
        const billingMonth = (req.query.billingMonth as string) || new Date().toISOString().slice(0, 7);
        const toolNamePrefix = providerKey + "__";

        const filter: UsageFilter = { toolNamePrefix, billingMonth, limit: 10000, offset: 0 };
        const usageResult = await storage.getUsageStats(filter);

        res.json({
          data: usageResult.data,
          billingMonth,
        });
      } catch (e: any) {
        logger.error(`Failed to get provider tool usage: ${e.message}`);
        res.status(500).json({ error: e.message });
      }
    },

    // GET /admin/stats/provider/:key/profile-stats - Get per-profile call count and cost
    getProfileStats: async (req: Request, res: Response): Promise<void> => {
      try {
        const providerKey = req.params.key;
        const billingMonth = (req.query.billingMonth as string) || new Date().toISOString().slice(0, 7);
        const stats = await storage.getProfileStats(providerKey, billingMonth);
        res.json(stats);
      } catch (e: any) {
        logger.error(`Failed to get profile stats: ${e.message}`);
        res.status(500).json({ error: e.message });
      }
    },

    // GET /admin/tool-prices - List all tool prices
    listToolPrices: async (req: Request, res: Response): Promise<void> => {
      try {
        const prices = await storage.listToolPrices();
        res.json(prices);
      } catch (e: any) {
        logger.error(`Failed to list tool prices: ${e.message}`);
        res.status(500).json({ error: e.message });
      }
    },

    // PUT /admin/tool-prices/:toolName - Set tool price
    setToolPrice: async (req: Request, res: Response): Promise<void> => {
      try {
        const { toolName } = req.params;
        const { unitPrice } = req.body;

        if (unitPrice === undefined || unitPrice === null) {
          res.status(400).json({ error: "unitPrice is required" });
          return;
        }

        if (typeof unitPrice !== "number" || unitPrice < 0) {
          res.status(400).json({ error: "unitPrice must be a non-negative number" });
          return;
        }

        await storage.setToolPrice(toolName, unitPrice);
        logger.info(`Tool price set: ${toolName} = ${unitPrice}`);
        res.json({ success: true, toolName, unitPrice });
      } catch (e: any) {
        logger.error(`Failed to set tool price: ${e.message}`);
        res.status(500).json({ error: e.message });
      }
    },

    // PUT /admin/tool-prices - Batch update tool prices
    batchUpdateToolPrices: async (req: Request, res: Response): Promise<void> => {
      try {
        const { prices } = req.body;

        if (!Array.isArray(prices)) {
          res.status(400).json({ error: "prices must be an array" });
          return;
        }

        // Validate each price entry
        for (const p of prices) {
          if (!p.toolName || typeof p.unitPrice !== "number") {
            res.status(400).json({ error: "Each price must have toolName (string) and unitPrice (number)" });
            return;
          }
        }

        await storage.batchUpdateToolPrices(prices);
        logger.info(`Batch updated ${prices.length} tool prices`);
        res.json({ success: true, count: prices.length });
      } catch (e: any) {
        logger.error(`Failed to batch update tool prices: ${e.message}`);
        res.status(500).json({ error: e.message });
      }
    },
  };
}
