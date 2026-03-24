# ToolGate

MCP Gateway proxy service with authentication, logging, billing and load balancing. ToolGate aggregates multiple MCP (Model Context Protocol) backend providers behind a single endpoint, adding API key authentication, usage logging and an admin dashboard.

## Features

- **Multi-transport MCP proxy** -- aggregate multiple MCP providers via Stdio, SSE and Streamable HTTP behind a single endpoint
- **Provider profiles & load balancing** -- each provider supports multiple profiles with independent credentials/URLs; requests are distributed round-robin across active profiles
- **API key authentication** -- SHA-256 hashed keys with expiration, per-key allowed-tool lists and enable/disable control
- **User & group management** -- users, user groups with group-level tool permission restrictions
- **Usage billing** -- per-tool pricing, monthly quota enforcement (HTTP 429 on exceed), balance deduction and usage statistics
- **Request logging** -- full request/response logging with method, tool name, latency, error details and configurable retention policies
- **Connection tracking** -- real-time session monitoring with client info, online/offline timestamps and auto-cleanup of stale sessions
- **Tool call retry** -- configurable retry with exponential back-off, independently tunable for SSE, HTTP and Stdio transports
- **Docker ready** -- multi-stage Dockerfile and docker-compose for one-command deployment

## Quick Start

### Prerequisites

- Node.js >= 20
- Yarn

### Install & Run

```bash
# Install dependencies
yarn install
cd src/admin-ui && yarn install && cd ../..

### Build and start for Production
yarn build
yarn start
```

The admin dashboard is served on port **3000** and the MCP endpoint on port **3001** by default.

## Configuration

Edit `gateway.config.yaml` in the project root, generally the default configuration can work without modification:

```yaml
server:
  port: 3000
  mcpPort: 3001

admin:
  username: "admin"
  password: "changeme"

storage:
  type: "sqlite"          # "sqlite" or "postgres"
  sqlite:
    path: "./data/gateway.db"

logging:
  level: "info"
  retentionDays: 90
```

MCP providers are configured via the admin dashboard.

## Docker

```bash
cd deploy
docker compose up -d
```

This exposes ports 3000 (admin) and 3001 (MCP). Data is persisted via the `./data` volume mount.

## Project Structure

```
src/
  server.ts        # HTTP server entry (admin + MCP endpoints)
  index.ts         # Stdio transport entry
  config.ts        # Configuration loading & validation (Zod)
  proxy/           # MCP proxy logic
  middleware/       # API key auth middleware
  admin/           # Admin API router & handlers
  admin-ui/        # React frontend (Vite + Tailwind + shadcn/ui)
  storage/         # Storage interface + SQLite / PostgreSQL implementations
deploy/
  Dockerfile
  docker-compose.yml
gateway.config.yaml
```

## License

[MIT](LICENSE)
