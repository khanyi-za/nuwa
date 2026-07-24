# syntax=docker/dockerfile:1

# ---- Build stage: full deps, generate client, compile to dist/ ----
FROM node:22-slim AS build
WORKDIR /app
# openssl is required by Prisma's query engine
RUN apt-get update -y && apt-get install -y --no-install-recommends openssl && rm -rf /var/lib/apt/lists/*
COPY package*.json ./
RUN npm ci
COPY . .
RUN npx prisma generate && npm run build

# ---- Runtime stage: production deps only + compiled output ----
FROM node:22-slim AS runtime
WORKDIR /app
RUN apt-get update -y && apt-get install -y --no-install-recommends openssl && rm -rf /var/lib/apt/lists/*
# NODE_ENV is set per Railway environment (staging/production), not baked in.
# Prod deps only (excludes @nestjs/cli, jest, eslint, …). prisma + dotenv + ts-node
# + typescript are production deps so `prisma migrate deploy` and `prisma db seed` work.
COPY package*.json prisma.config.ts tsconfig.json ./
COPY prisma ./prisma
RUN npm ci --omit=dev && npx prisma generate
COPY --from=build /app/dist ./dist
EXPOSE 3000
CMD ["node", "dist/main"]
