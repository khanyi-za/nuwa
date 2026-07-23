# Deployment

nuwa runs on **Railway** with two deployed environments. `main` is the local dev
playground and is **not** deployed anywhere.

## Environments & branches

| Branch       | Deployed?         | Advances via                        |
|--------------|-------------------|-------------------------------------|
| `main`       | No (local dev)    | feature-branch PRs                  |
| `staging`    | Railway `staging` | PR **`main → staging`** (deploy #1) |
| `production` | Railway `production` | PR **`staging → production`** (deploy #2) |

`staging` and `production` are long-lived environment branches: created once,
then only ever advanced by the promotion PRs above. Never push to them directly
and never merge backwards — fixes start on `main` and flow forward.

## Promotion flow

1. Feature branch → PR into `main` (reviewed; no deploy).
2. **Deploy to staging:** open a PR `main → staging`
   (`.../compare/staging...main?template=promote-to-staging.md`). Merge = deploy.
3. **Deploy to production:** open a PR `staging → production`
   (`.../compare/production...staging?template=promote-to-production.md`). Merge = deploy.

## How Railway builds each env

Config lives in `railway.json` (Nixpacks):
- **Build:** `npm run build && npx prisma generate`
- **Pre-deploy:** `npx prisma migrate deploy` (applies migrations to that env's DB before the new release goes live)
- **Start:** `npm run start:prod`
- **Health check:** `GET /health`
- Node version pinned via `.nvmrc` (22). Can also set `NIXPACKS_NODE_VERSION=22` in Railway.

Each environment has its **own PostgreSQL** (Railway plugin) — DBs are never shared.
Keep 1 replica per env (in-process cron + Socket.IO are single-instance-safe;
scaling out later needs a Redis socket.io adapter + cron locking).

## Environment variables (set per Railway environment)

Provided automatically by Railway: `DATABASE_URL`, `PORT`.

Set manually (staging and production get their own values):

| Var | Notes |
|---|---|
| `JWT_SECRET` | required; unique per env |
| `JWT_EXPIRES_IN` | e.g. `15m` |
| `REFRESH_TOKEN_EXPIRES_IN_DAYS` | e.g. `30` |
| `TRUST_PROXY` | `1` (behind Railway's edge proxy) |
| `CORS_ORIGINS` | allowed frontend/merchant origins for that env |
| `RESEND_API_KEY` | test key on staging, live key on production |
| `SHIPLOGIC_WEBHOOK_SECRET` | per env |
| `SHIPPING_FLAT_FEE_IN_CENTS` | per env |
| `FEED_SPOTLIGHT_STORE`, `FEED_SPOTLIGHT_WEIGHT` | per env |

## One-time Railway setup

1. New project → deploy `khanyi-za/nuwa`.
2. Create environment **staging** → source branch `staging` → add a PostgreSQL → set staging vars.
3. Create environment **production** → source branch `production` → add a PostgreSQL → set prod vars.
4. Do **not** connect any environment to `main`.
5. Seed the branches once: `staging` off `main`, `production` off `staging`.

## Rollback

Revert the offending promotion PR on the environment branch (or redeploy the
previous deployment in the Railway UI). Prod redeploys the prior commit and
re-runs `migrate deploy` (which is a no-op if no migrations changed).
