import type { IStorage } from "./interface.js";
import type { GatewayConfig } from "../config.js";
import { SqliteStorage } from "./sqlite.js";
import { PostgresStorage } from "./postgres.js";

export function createStorage(config: GatewayConfig): IStorage {
  switch (config.storage.type) {
    case "sqlite":
      return new SqliteStorage(config.storage.sqlite.path);
    case "postgres":
      return new PostgresStorage(config.storage.postgres);
    default:
      throw new Error(`Unsupported storage type: ${config.storage.type}`);
  }
}
