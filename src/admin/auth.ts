import type { Request, Response, NextFunction } from "express";
import session from "express-session";
import { loadGatewayConfig } from "../config.js";
import { logger } from "../logger.js";

declare module "express-session" {
  interface SessionData {
    adminAuthenticated?: boolean;
    adminUsername?: string;
  }
}

export function createAdminSessionMiddleware(): ReturnType<typeof session> {
  const config = loadGatewayConfig();
  return session({
    secret: config.admin.sessionSecret,
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      secure: false,
      maxAge: 24 * 60 * 60 * 1000,
    },
  });
}

export function createAdminAuthMiddleware() {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const config = loadGatewayConfig();

    // Check if already authenticated via session
    if (req.session?.adminAuthenticated) {
      logger.debug(`Admin authenticated: ${req.session.adminUsername}`);
      next();
      return;
    }

    // Check Authorization header for basic auth
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith("Basic ")) {
      logger.warn("Admin request without authorization header");
      res.status(401).json({ error: "Authorization header required" });
      return;
    }

    try {
      const credentials = Buffer.from(authHeader.substring(6), "base64").toString("utf-8");
      const [username, password] = credentials.split(":");

      if (username === config.admin.username && password === config.admin.password) {
        // Authenticate and set session
        if (req.session) {
          req.session.adminAuthenticated = true;
          req.session.adminUsername = username;
        }
        logger.info(`Admin login successful: ${username}`);
        next();
        return;
      }

      logger.warn(`Admin login failed: ${username}`);
      res.status(401).json({ error: "Invalid credentials" });
    } catch (e: any) {
      logger.error(`Admin auth error: ${e.message}`);
      res.status(401).json({ error: "Authorization failed" });
    }
  };
}

export function createAdminLoginHandler() {
  return async (req: Request, res: Response): Promise<void> => {
    const config = loadGatewayConfig();
    const { username, password } = req.body;

    if (!username || !password) {
      res.status(400).json({ error: "Username and password required" });
      return;
    }

    if (username === config.admin.username && password === config.admin.password) {
      if (req.session) {
        req.session.adminAuthenticated = true;
        req.session.adminUsername = username;
      }
      logger.info(`Admin login successful: ${username}`);
      res.json({ success: true, username });
    } else {
      logger.warn(`Admin login failed: ${username}`);
      res.status(401).json({ error: "Invalid credentials" });
    }
  };
}

export function createAdminLogoutHandler() {
  return async (req: Request, res: Response): Promise<void> => {
    const username = req.session?.adminUsername;
    if (req.session) {
      req.session.adminAuthenticated = false;
      req.session.adminUsername = undefined;
    }
    logger.info(`Admin logout: ${username}`);
    res.json({ success: true });
  };
}
