import type { Request, Response } from "express";
import type { IStorage, User, CreateUserInput } from "../storage/interface.js";
import { logger } from "../logger.js";

export function createUsersRouter(storage: IStorage) {
  return {
    // POST /admin/users - Create user
    create: async (req: Request, res: Response): Promise<void> => {
      try {
        const input: CreateUserInput = req.body;
        if (!input.username) {
          res.status(400).json({ error: "Username is required" });
          return;
        }

        // Check if username already exists
        const existing = await storage.getUserByUsername(input.username);
        if (existing) {
          res.status(409).json({ error: "Username already exists" });
          return;
        }

        const user = await storage.createUser(input);
        logger.info(`User created: ${user.id} (${user.username})`);
        res.status(201).json(user);
      } catch (e: any) {
        logger.error(`Failed to create user: ${e.message}`);
        res.status(500).json({ error: e.message });
      }
    },

    // GET /admin/users - List users
    list: async (req: Request, res: Response): Promise<void> => {
      try {
        const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : undefined;
        const offset = req.query.offset ? parseInt(req.query.offset as string, 10) : undefined;
        const users = await storage.listUsers({ limit, offset });
        res.json(users);
      } catch (e: any) {
        logger.error(`Failed to list users: ${e.message}`);
        res.status(500).json({ error: e.message });
      }
    },

    // GET /admin/users/:id - Get user by ID
    getById: async (req: Request, res: Response): Promise<void> => {
      try {
        const user = await storage.getUser(req.params.id);
        if (!user) {
          res.status(404).json({ error: "User not found" });
          return;
        }
        const groups = await storage.listUserGroupsByUser(user.id);
        res.json({ ...user, groups });
      } catch (e: any) {
        logger.error(`Failed to get user: ${e.message}`);
        res.status(500).json({ error: e.message });
      }
    },

    // PUT /admin/users/:id - Update user
    update: async (req: Request, res: Response): Promise<void> => {
      try {
        const { id } = req.params;
        const data = req.body;

        // Validate status if provided
        if (data.status && !["active", "disabled"].includes(data.status)) {
          res.status(400).json({ error: "Invalid status value" });
          return;
        }

        const user = await storage.updateUser(id, data);
        logger.info(`User updated: ${user.id}`);
        res.json(user);
      } catch (e: any) {
        logger.error(`Failed to update user: ${e.message}`);
        res.status(500).json({ error: e.message });
      }
    },
  };
}
