import type { Request, Response } from "express";
import type { IStorage } from "../storage/interface.js";

export function createGroupsRouter(storage: IStorage) {
  return {
    create: async (req: Request, res: Response): Promise<void> => {
      const { name, description, allowedTools } = req.body;
      if (!name) {
        res.status(400).json({ error: "name is required" });
        return;
      }
      try {
        const group = await storage.createUserGroup({ name, description, allowedTools });
        res.status(201).json(group);
      } catch (e: any) {
        if (e.message?.includes("UNIQUE") || e.code === "23505") {
          res.status(409).json({ error: "Group name already exists" });
          return;
        }
        throw e;
      }
    },

    list: async (req: Request, res: Response): Promise<void> => {
      const limit = Math.min(Number(req.query.limit) || 100, 500);
      const offset = Number(req.query.offset) || 0;
      const groups = await storage.listUserGroups({ limit, offset });
      // Enrich with member count
      const enriched = await Promise.all(
        groups.map(async (g) => ({
          ...g,
          memberCount: await storage.getGroupMemberCount(g.id),
        }))
      );
      res.json(enriched);
    },

    getById: async (req: Request, res: Response): Promise<void> => {
      const group = await storage.getUserGroup(req.params.id);
      if (!group) {
        res.status(404).json({ error: "Group not found" });
        return;
      }
      const members = await storage.listGroupMembers(group.id);
      const memberCount = members.length;
      res.json({ ...group, memberCount, members });
    },

    update: async (req: Request, res: Response): Promise<void> => {
      const { name, description, allowedTools, status } = req.body;
      if (status && !["active", "disabled"].includes(status)) {
        res.status(400).json({ error: "Invalid status" });
        return;
      }
      try {
        const group = await storage.updateUserGroup(req.params.id, { name, description, allowedTools, status });
        res.json(group);
      } catch (e: any) {
        if (e.message?.includes("UNIQUE") || e.code === "23505") {
          res.status(409).json({ error: "Group name already exists" });
          return;
        }
        throw e;
      }
    },

    delete: async (req: Request, res: Response): Promise<void> => {
      const group = await storage.getUserGroup(req.params.id);
      if (!group) {
        res.status(404).json({ error: "Group not found" });
        return;
      }
      await storage.deleteUserGroup(req.params.id);
      res.json({ success: true });
    },

    addMembers: async (req: Request, res: Response): Promise<void> => {
      const { userIds } = req.body;
      if (!Array.isArray(userIds) || userIds.length === 0) {
        res.status(400).json({ error: "userIds array is required" });
        return;
      }
      await storage.addGroupMembers(req.params.id, userIds);
      res.json({ success: true });
    },

    removeMember: async (req: Request, res: Response): Promise<void> => {
      await storage.removeGroupMember(req.params.id, req.params.userId);
      res.json({ success: true });
    },
  };
}
