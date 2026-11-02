# Layover

Layover is a collaborative group trip planner. Group members compare routes, understand costs, and decide together.

## Prerequisites

- Node.js 22 or later
- pnpm 10

## Setup

```sh
pnpm install
cp .env.example .env.local
# then fill in the values in .env.local
```

## Commands

| Command          | What it does                                  |
| ---------------- | --------------------------------------------- |
| `pnpm dev`       | Start the Next.js dev server                  |
| `pnpm build`     | Production build                              |
| `pnpm typecheck` | Generate Next.js types and run `tsc --noEmit` |
| `pnpm lint`      | Run ESLint                                    |
| `pnpm test`      | Run the Vitest suite once                     |

`pnpm test:watch` runs Vitest in watch mode.

## Database

- There is no local Docker setup. Development uses a hosted Supabase project.
- Schema changes are hand-written migrations in `supabase/migrations`, pushed with the Supabase CLI.
- Database and access-control tests run in GitHub Actions against a fresh Supabase stack.

## Docs

- [docs/PRODUCT.md](docs/PRODUCT.md): problem, core loop, product rules
- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md): stack, module layout, data model, engine design
- [docs/DECISIONS.md](docs/DECISIONS.md): key engineering decisions and trade-offs
