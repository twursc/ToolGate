import type { Request, Response, NextFunction } from "express";
import type { IStorage } from "../storage/interface.js";
import { logger } from "../logger.js";
import { getCurrentSeparator } from "../proxy/mcp-proxy.js";

export function createBillingMiddleware(storage: IStorage) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const authContext = req.authContext;
    if (!authContext) {
      next();
      return;
    }

    const method = req.body?.method;

    // Only apply billing to tools/call requests
    if (method !== "tools/call") {
      next();
      return;
    }

    const qualifiedName = req.body?.params?.name;
    if (!qualifiedName) {
      logger.warn(`tools/call without tool name`);
      next();
      return;
    }

    // Split qualified name into providerKey and toolName
    const separator = getCurrentSeparator();
    const sepIndex = qualifiedName.indexOf(separator);
    let providerKey = "";
    let toolName = qualifiedName;
    if (sepIndex >= 0) {
      providerKey = qualifiedName.substring(0, sepIndex);
      toolName = qualifiedName.substring(sepIndex + separator.length);
    }

    // Check quota before allowing the call
    const currentMonth = new Date().toISOString().slice(0, 7); // "YYYY-MM"
    const quota = authContext.apiKeyRecord.quota;

    if (quota > 0) {
      const usageCount = await storage.getMonthlyUsageCount(authContext.userId, currentMonth);
      if (usageCount >= quota) {
        logger.warn(`Quota exceeded for user ${authContext.userId}: ${usageCount}/${quota}`);
        res.status(429).json({ error: "Monthly quota exceeded", quota, usage: usageCount });
        return;
      }
    }

    // Get tool price
    const unitPrice = await storage.getToolPrice(providerKey, toolName);

    // Capture original methods to record usage after successful response
    let recorded = false;
    const originalJson = res.json ? res.json.bind(res) : null;

    if (originalJson) {
      res.json = function(body: any) {
        if (!recorded && res.statusCode < 400) {
          // Record usage after successful response
          storage.insertUsageRecord({
            userId: authContext.userId,
            apiKeyId: authContext.apiKeyId,
            providerKey,
            toolName,
            unitPrice,
            billingMonth: currentMonth,
          }).catch((e: any) => {
            logger.error(`Failed to record usage: ${e.message}`);
          });
          recorded = true;
        }
        return originalJson(body);
      };
    }

    next();
  };
}
