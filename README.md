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
- Database and access-control tests run in GitHub Actions against a fresh Supabase stack. `pnpm test:db` runs the SQL-level tests and `pnpm test:auth` runs real email-code sign-ins against that stack.

## Sign-in setup

Sign-in offers Google and an emailed 6-digit code (the same email also carries a link).

- **Google.** Create an OAuth client (type Web application) in Google Cloud. Add the Supabase callback URL, `https://<project-ref>.supabase.co/auth/v1/callback`, as an authorized redirect URI. In the Supabase dashboard, enable the Google provider under Authentication, Sign In / Providers and paste the client ID and secret. For a local stack, set `SUPABASE_AUTH_EXTERNAL_GOOGLE_CLIENT_ID` and `SUPABASE_AUTH_EXTERNAL_GOOGLE_SECRET` and change `enabled` to `true` under `[auth.external.google]` in `supabase/config.toml`. Google stays disabled by default, so a stack without credentials still starts.
- **Redirect URLs.** In the dashboard under Authentication, URL Configuration, set the Site URL to the deployed origin and add `<origin>/**` (and `http://localhost:3000/**` for development) to the redirect allow list.
- **Email template.** The Magic Link template must contain both `{{ .ConfirmationURL }}` and `{{ .Token }}`, or the code step has nothing to show. `supabase/templates/magic_link.html` is the template for a local stack. A hosted project keeps its own copy: paste the same HTML into Authentication, Emails, Magic Link.
- **Rate limits.** The local `email_sent` limit is raised so test runs can send several codes. Hosted limits are set in the dashboard.

## Docs

- [docs/PRODUCT.md](docs/PRODUCT.md): problem, core loop, product rules
- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md): stack, module layout, data model, engine design
- [docs/DECISIONS.md](docs/DECISIONS.md): key engineering decisions and trade-offs

## Attribution

City search uses data from [GeoNames](https://www.geonames.org/), licensed under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). Regenerate `src/data/cities.json` with `pnpm build-cities`.
