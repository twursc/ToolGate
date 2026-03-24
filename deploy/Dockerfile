# -- Build stage --
FROM node:20-alpine AS builder

RUN apk add --no-cache python3 make g++

WORKDIR /app

# Install backend dependencies
COPY package.json yarn.lock ./
RUN yarn install --frozen-lockfile || yarn install --frozen-lockfile

# Install frontend dependencies
COPY src/admin-ui/package.json src/admin-ui/yarn.lock ./src/admin-ui/
RUN cd src/admin-ui && yarn install --frozen-lockfile

# Build frontend
COPY src/admin-ui ./src/admin-ui
RUN cd src/admin-ui && yarn build

# Build backend
COPY tsconfig.json ./
COPY src ./src
RUN yarn tsc

# -- Production stage --
FROM node:20-alpine

WORKDIR /app

# Copy compiled build output and node_modules from builder
COPY --from=builder /app/build ./build
COPY --from=builder /app/node_modules ./node_modules
COPY gateway.config.yaml ./

RUN mkdir -p /app/data /app/config

ENV NODE_ENV=production

EXPOSE 3000 3001

CMD ["node", "build/server.js"]
