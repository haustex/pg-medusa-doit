# Contributing

Thanks for helping! Bug reports, fixes and documentation improvements are welcome.

## Before you start

- For anything bigger than a small fix, open an issue first so we can agree on the approach.
- Never commit API keys, signing secrets or `.env` files. Tests use a mock doit.id; the sandbox suite reads
  `DOIT_TEST_API_KEY` from the environment.

## Setup

```bash
npm ci
npm run lint && npm run typecheck && npm run test:unit && npm run build
```

E2E tests need Postgres on `127.0.0.1:55432` and Redis on `127.0.0.1:56379` (for example in Docker), see
[integration-tests/README.md](integration-tests/README.md):

```bash
DATABASE_URL=postgres://postgres:spike@127.0.0.1:55432/doit_e2e REDIS_URL=redis://127.0.0.1:56379 npm run test:e2e
```

## Conventions

- Follow Medusa's patterns: modules → workflows (all mutations) → API routes; only GET, POST and DELETE; Zod from
  `@medusajs/framework/zod`.
- Amounts are whole rupiah, as Medusa stores them. Never multiply or divide by 100.
- Behaviour should match the official doit.id docs (https://doit.id/docs/); note anything only seen in the sandbox.
- Add or update tests with each change and an entry under `[Unreleased]` in `CHANGELOG.md`.
- Pull requests run CI (lint, typecheck, unit, build, E2E) and need to pass.

Bahasa Indonesia atau Inggris sama-sama boleh untuk issue dan pull request.
