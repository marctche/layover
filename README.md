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

| Command                | What it does                                                                                  |
| ---------------------- | --------------------------------------------------------------------------------------------- |
| `pnpm dev`             | Start the Next.js dev server                                                                  |
| `pnpm build`           | Production build                                                                              |
| `pnpm typecheck`       | Generate Next.js types and run `tsc --noEmit`                                                 |
| `pnpm lint`            | Run ESLint                                                                                    |
| `pnpm test`            | Run the Vitest suite once                                                                     |
| `pnpm test:db`         | Run the SQL-level database and access-control tests (needs `LAYOVER_TEST_DB_URL`)             |
| `pnpm test:auth`       | Run real email-code sign-in tests against a local Supabase stack                              |
| `pnpm price-trip`      | Dry-run the flight searches for a sample trip (`--trip europe\|asia`); `--live --max-searches N` runs them |
| `pnpm build-cities`    | Regenerate `src/data/cities.json` from the GeoNames cities15000 dump                          |
| `pnpm build-airports`  | Regenerate `src/data/airports.json` from the OurAirports airport list                         |

`pnpm test:watch` runs Vitest in watch mode.

## Environment variables

Copy `.env.example` to `.env.local` for the application and the pricing script. The test variables are read from the shell or CI environment.

| Variable                               | Required                          | Used for                                                                           |
| -------------------------------------- | --------------------------------- | ---------------------------------------------------------------------------------- |
| `NEXT_PUBLIC_SUPABASE_URL`             | Yes, to run the app               | Supabase project URL. Browser-safe.                                                |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Yes, to run the app               | Supabase publishable (anon) key. Browser-safe.                                     |
| `SUPABASE_SECRET_KEY`                  | No                                | Supabase secret key. Server-only, never exposed to the browser.                    |
| `SERPAPI_API_KEY`                      | Only for `pnpm price-trip --live` | SerpApi key for live flight quotes. Server-only. Also read from `.env.local`.      |
| `LAYOVER_TEST_DB_URL`                  | Only for `pnpm test:db`           | Postgres connection string for a database with the migrations applied.             |
| `LAYOVER_TEST_SUPABASE_URL`            | Only for `pnpm test:auth`         | API URL of the local Supabase stack.                                               |
| `LAYOVER_TEST_SUPABASE_KEY`            | Only for `pnpm test:auth`         | Publishable (or anon) key of the local stack.                                      |
| `LAYOVER_TEST_MAILPIT_URL`             | No                                | Mailpit URL for reading sign-in codes. Defaults to `http://127.0.0.1:54324`.       |

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

Airport search uses data from [OurAirports](https://ourairports.com/data/), released into the public domain. Regenerate `src/data/airports.json` with `pnpm build-airports`.
