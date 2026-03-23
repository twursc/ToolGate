import type { Request, Response, NextFunction } from "express";
import type { IStorage } from "../storage/interface.js";
import { logger } from "../logger.js";

export function createLoggingMiddleware(storage: IStorage) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const startTime = Date.now();
    const authContext = req.authContext;

    // Capture original json method to intercept response
    const originalJson = res.json.bind(res);
    const originalSend = res.send.bind(res);

    let responseStatus: "success" | "error" = "success";
    let errorMessage: string | null = null;

    // Wrap json method to capture response status
    res.json = function(body: any) {
      if (res.statusCode >= 400) {
        responseStatus = "error";
        errorMessage = body?.error ?? String(body);
      }
      return originalJson(body);
    };

    res.send = function(body: any) {
      if (res.statusCode >= 400) {
        responseStatus = "error";
        errorMessage = String(body);
      }
      return originalSend(body);
    };

    // Log on finish
    res.on("finish", async () => {
      const responseTimeMs = Date.now() - startTime;
      const method = req.body?.method ?? `${req.method} ${req.path}`;
      const toolName = req.body?.params?.name ?? null;
      const requestSummary = JSON.stringify(req.body?.params ?? {}).substring(0, 500);

      if (authContext) {
        try {
          await storage.insertRequestLog({
            userId: authContext.userId,
            apiKeyId: authContext.apiKeyId,
            method,
            toolName,
            requestSummary,
            responseStatus,
            responseTimeMs,
            errorMessage,
          });
          logger.debug(`Request logged: ${method} in ${responseTimeMs}ms`);
        } catch (e: any) {
          logger.error(`Failed to write request log: ${e.message}`);
        }
      } else {
        logger.debug(`Unauthenticated request logged: ${method} in ${responseTimeMs}ms`);
      }
    });

    next();
  };
}
