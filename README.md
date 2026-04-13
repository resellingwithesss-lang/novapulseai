# NovaPulseAI Local Development

## Quick Start

1. Copy env templates:
   - `server/.env.example` -> `server/.env`
   - `client/.env.example` -> `client/.env.local`
2. Install dependencies:
   - `npm run install:all`
3. Run both apps:
   - `npm run dev`

## Useful Scripts (repo root)

- `npm run dev` - run server and client together
- `npm run dev:server` - run API only
- `npm run dev:client` - run web app only
- `npm run dev:clean` - Windows-only: stop listeners on ports `3000` and `5000`
- `npm run build` - build server and client
- `npm run lint` - lint frontend
- `npm run typecheck` - typecheck server and client
- `npm run ci:check` - lint + typecheck

## Ports and API Base URL

- Server listens on `PORT` (or legacy `port`) and defaults to `5000`.
- Client runs on `3000` via `next dev`.
- Client rewrites `/api/:path*` to:
  - `NEXT_PUBLIC_API_URL` if set
  - otherwise `http://localhost:5000`

## Required Environment Variables

### Server required for startup

- `JWT_SECRET`
- `GOOGLE_CLIENT_ID`
- `GOOGLE_CLIENT_SECRET`

### Server required for generation/billing features

- `OPENAI_API_KEY`
- `STRIPE_SECRET_KEY`
- `STRIPE_WEBHOOK_SECRET`
- Stripe price IDs (`STRIPE_PRICE_*`)

### Client commonly used

- `NEXT_PUBLIC_API_URL`
- `NEXT_PUBLIC_APP_URL`
- `NEXT_PUBLIC_GOOGLE_CLIENT_ID`

## Docker (Optional)

Use this when you want local Postgres/Redis quickly:

1. Start services:
   - `docker compose up -d`
2. Update `server/.env` `DATABASE_URL` to:
   - `postgresql://novapulseai:novapulseai@localhost:5432/novapulseai`
3. Stop services when done:
   - `docker compose down`

## Prisma Quick Commands

From repository root:

- Generate client:
  - `npm --prefix server exec prisma generate`
- Apply local schema changes (dev):
  - `npm --prefix server exec prisma migrate dev`
