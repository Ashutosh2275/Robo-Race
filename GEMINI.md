# Robo-Race Repository & Development Rules

## Mandatory Version Control Rule
- **Strict GitHub Push Requirement**: Every single time changes, features, or fixes are made in this codebase, all work MUST be committed and pushed to GitHub.
- **Repository Remote**: `origin` -> `https://github.com/Ashutosh2275/Robo-Race.git`
- **Branch**: `main`
- **Pre-Push Quality Gates**: Always run `npm test` and `npm run build` prior to pushing to ensure zero regressions and clean compilation.
- **Delivery Confirmation**: Always execute `git push origin main` and verify the remote push succeeds before concluding any task.
