## Promote staging → production

Merging this PR **deploys to production** (Railway, `production` branch).

- **Base:** `production`  ·  **Head:** `staging`
- Open with: `.../compare/production...staging?template=promote-to-production.md`

### Checklist
- [ ] Verified on **staging** (smoke-tested the affected flows)
- [ ] Staging Railway deploy is green
- [ ] Any new env vars are set in the **production** Railway environment
- [ ] Prisma migrations already applied cleanly on staging
- [ ] Rollback plan understood (revert PR → prod redeploys previous commit)

### What's shipping
<!-- summary of what staging has that prod doesn't yet -->
