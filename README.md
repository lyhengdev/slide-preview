# Secure Digital Pitching & Judging Platform

A secure, paperless pitching and judging platform for confidential startup presentations. Judges join via QR code, navigate slides independently, and are tracked with device binding and personalized watermarking. Optional on-device camera detection (face presence / secondary devices).

Full technical plan: `KE_Secure_Pitching_Judging_Plan.md`

## Stack

| Layer | Tech |
|---|---|
| Frontend | React + Vite + Tailwind CSS + TypeScript |
| Backend | Node.js + Fastify + Socket.IO + Prisma |
| Database | PostgreSQL |
| Queue | Redis (Valkey) + BullMQ |
| Files | Internal storage service + disk |
| AI (client) | MediaPipe (lazy-loaded, local) |

## Monorepo

```
apps/
  web/       React admin console + judge viewer
  api/       Fastify API + Socket.IO + auth + slide delivery
  worker/    BullMQ deck processing (PPTX/PDF → WebP)
  storage/   private file service
packages/
  database/  Prisma schema + client
  types/     shared domain types
  validation/  Zod schemas
  auth/      password/JWT/device helpers
  config/    env validation
```

## Quick start (local)

Requires: Node 20+, pnpm, and a PostgreSQL database. Postgres can run locally via Docker, or you can point `DATABASE_URL` at a managed provider such as **Neon** (recommended — no local Postgres needed):

```bash
# example: manage your Neon database
DATABASE_URL="postgresql://<user>:<password>@<host>/<database>?sslmode=require"
```

```bash
# 1. infra (Redis only if you use local Docker; skip if using a hosted Redis)
docker compose up -d

# 2. copy env files
cp apps/api/.env apps/api/.env
cp apps/storage/.env apps/storage/.env
cp apps/worker/.env apps/worker/.env
# 3. set DATABASE_URL in apps/api/.env and apps/worker/.env to your Postgres (local or Neon)
#    optional: set the AWS_* + S3_BUCKET vars in apps/storage/.env to use Neon Storage
#    instead of the local DATA_DIR disk (see "Storage backend" below)

# 4. install + db
pnpm install
pnpm db:generate
pnpm db:migrate      # creates a new migration (dev)
pnpm db:deploy       # apply all migrations to the connected database
pnpm db:seed         # create admin + demo event

# 5. run (four terminals or use turbo dev)
pnpm dev:worker       # deck processing (needs LibreOffice + poppler for PPTX/PDF)
pnpm dev:api
pnpm dev:web
```

Run services:

```bash
# storage + api + web (worker optional for deck uploads)
pnpm --filter @ke/storage dev
pnpm dev:api
pnpm dev:web
```

### macOS deck tooling

```bash
brew install --cask libreoffice   # PPTX → PDF
brew install poppler              # PDF → images
```

## Demo accounts

- Admin: `admin@ke.local` / `admin123` (created by `pnpm db:seed`)
- Judges: `J001`/`J002` are created with generated PINs (see seed logs)

## Flow (event day)

1. Admins upload decks in **Startups & Decks** (PPTX/PDF → background worker → private WebP slides rendered at three sizes).
2. In **Live Control**, admin clicks **Start** → a QR code is generated.
3. Judges scan → enter code + PIN → secure session bound to their device.
4. The deck is preloaded at the preview tier for the whole session, then at the tier that matches the judge's connection (resolution ladder). Slides snap into view with a blur-up transition; judges browse independently with Previous / Next.
5. **End** locks every judge screen immediately.

Security settings (watermark, device binding, tab-switch hide, fullscreen, camera detection, detection action) are per-event in the **Security** tab. The **Live Control → Override** control temporarily relaxes camera enforcement for one pitch; it is stored separately from the event default so clearing it restores the event's own setting.

### Visible secondary device

Enable **Security → Camera Security → Visible secondary device** to check for possible phones in camera view. It works independently of face presence detection. Models run locally; camera frames are never recorded or uploaded. Confirmed sightings create `POSSIBLE_PHONE_DETECTED` alerts with confidence and model metadata.

- **LOG** records an alert.
- **WARN** also shows the judge a message.
- **BLUR** blurs slides while a confirmed concern remains.
- **LOCK** hides the presentation and its controls until the camera view clears.

Repeated detections are required, and brief missed detections do not immediately clear an alert. This detects possible visible phones, not whether they are recording. Off-camera devices cannot be detected. See [model details](apps/web/public/mediapipe/README.md).

Run `pnpm --filter @ke/web test:camera` for the detection policy regression tests.

## Environment variables

| App | Env file |
|---|---|
| API | `apps/api/.env` (see `.env.example`) |
| Storage | `apps/storage/.env` |
| Worker | `apps/worker/.env` |

Key API vars: `DATABASE_URL`, `REDIS_URL`, `STORAGE_URL`, `STORAGE_TOKEN` (must match storage), `JWT_SECRET`, `COOKIE_SECRET`, `WEB_URL`, `COOKIE_SECURE=true` in production.

The same `DATABASE_URL` (and matching `STORAGE_TOKEN`) is shared by the API and the worker — keep them in sync when switching databases.

> `STORAGE_TOKEN` is a shared secret between API/worker and the storage service. Set the same value in all services, or in Render set it once (`sync: false`) and reuse.

### Storage backend (local disk vs Neon Storage)

`apps/storage` exposes a private file service (multipart upload, streamed download, delete) that the API and worker call over HTTP. Its backing store is pluggable:

- **Local disk** (default): files live under `DATA_DIR` (`apps/storage/var/data`). No extra config.
- **Neon Storage** (S3-compatible): set all four `AWS_*` vars plus the bucket in `apps/storage/.env` (see `.env.example`). The service then persists blobs to object storage instead of disk:

```dotenv
# apps/storage/.env
AWS_ENDPOINT_URL_S3=https://<branch>.storage.<region>.aws.neon.tech
AWS_ACCESS_KEY_ID=<neon-storage-key>
AWS_SECRET_ACCESS_KEY=<neon-storage-secret>
AWS_REGION=us-east-2
S3_BUCKET=<your-bucket>   # e.g. created via the Neon console
```

Path-style addressing (`forcePathStyle: true`) is used, as required by Neon Storage/MinIO. When the `AWS_*` vars are not all set, the service falls back to `DATA_DIR` on disk. The HTTP contract — and therefore the API and worker — is identical either way; verify with `pnpm --filter @ke/storage test` (disk backend) and the `/internal/health` response, which reports `backend: s3|disk`.

Worker slide rendering (`apps/worker`): each slide is rasterised at three sizes so the viewer can pick the cheapest one that still reads well on the judge's connection:

| Tier | Width | Quality |
|---|---|---|
| preview (blur-up placeholder) | `SLIDE_WIDTH_PREVIEW` = 384 | `SLIDE_QUALITY_PREVIEW` = 55 |
| standard (default mid-tier) | `SLIDE_WIDTH_STANDARD` = 1280 | `SLIDE_QUALITY_STANDARD` = 72 |
| full (fast connections / zoom) | `SLIDE_WIDTH` = 1920 | `SLIDE_QUALITY` = 80 |

## Deployment (Render)

`render.yaml` provisions:

- `ke-pitch-web` — static site
- `ke-pitch-api` — web service (health: `/api/health`)
- `ke-pitch-worker` — background worker
- `ke-pitch-storage` — private service + 20GB disk
- `ke-pitch-db` — Postgres
- `ke-pitch-cache` — Key Value (Redis)

Before first deploy, set the shared `STORAGE_TOKEN` on api, worker and storage services, and set `VITE_API_URL` (usually the api public URL). Then create the first admin by hitting `POST /api/v1/auth/register-admin` once (bootstraps only when no admin exists).

## Safety notes

- The original PPTX/PDF is never stored on a public URL and never sent to judges.
- Slides are watermarked per judge server-side and served with a weak `ETag` and `Cache-Control: private, max-age=3600`; matching `If-None-Match` replies `304` so revisits transfer zero bytes. The watermark's placement is derived from the judge + slide + config so its bytes (and ETag) stay deterministic for the cache's lifetime.
- The **preview** tier (~sharply downscaled, ~5 KB) is served unwatermarked: it is only useful as a placeholder and is never sharp enough to leak content.
- Swiss-cheese single-viewer protection: judges' devices are bound by session, the viewer hides on tab-switch, blurs on window blur, requires fullscreen when configured, and a new tab with the same session automatically hides the other one (BroadcastChannel + Web Locks) so the deck stays single-device.
- Camera frames never leave the device; runs at low resolution and low fps, lazy-loaded only when enabled.
- Detection starts in **LOG ONLY**; escalate per event after live testing.

## Scripts

```bash
pnpm dev          # run every app via turbo
pnpm build        # production build
pnpm typecheck    # typecheck all workspaces
pnpm db:migrate   # create a migration
pnpm db:push      # apply schema without migration
```