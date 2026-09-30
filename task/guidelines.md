# Guidelines

- Stack: Node 20, TypeScript, Express, Mongoose (MongoDB). Dependencies are already installed in `/repo` (`npm ci`).
- Build: `npm run build` (runs `tsc`, output in `dist/`).
- Type-check / lint: `npx tsc --noEmit` must pass. There is no ESLint config; follow the style of the surrounding code.
- Tests: the repo has no automated test suite. No MongoDB server is running, but `mongodb-memory-server` is installed in `/opt/blockers/node_modules` with a cached `mongod` 7.0.14, so you can start an in-memory database from a script (set `NODE_PATH=/opt/blockers/node_modules`). There is no network access.
- Don't start the full server (`npm run dev`): it needs a `.env` and external services.
- Relevant code: `src/models/investorReportShare.model.ts`, `src/services/investorReportShareService.ts`, `src/controllers/investorReportShareController.ts`, `src/routes/report.route.ts`, `src/routes/investorReportShare.route.ts`.
