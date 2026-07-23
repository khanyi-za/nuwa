## Promote dev → staging

Merging this PR **deploys to the staging environment** (Railway, `staging` branch).

- **Base:** `staging`  ·  **Head:** `main`
- Open with: `.../compare/staging...main?template=promote-to-staging.md`

### Checklist
- [ ] Changes have been validated locally against a dev database
- [ ] Any new env vars are set in the **staging** Railway environment
- [ ] New Prisma migrations are committed and are forward-compatible (expand → migrate → contract)
- [ ] No secrets committed

### What's shipping
<!-- brief summary of the commits being promoted -->
