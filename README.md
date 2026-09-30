# Assignment 2 Hono API for a Real AI Pipeline

Project documentation for the **Day 6 Final Assignment** of _AI Product Engineering with TypeScript Batch II (Devscale)_: a Hono API that runs a real AI pipeline with Prisma 8, BullMQ 6, and the Anvia SDK (anvia.dev).

A client submits a blog post title and content; the API persists the job and returns `202` immediately; a separate worker performs a **real model call** and stores the generated SEO meta tags in PostgreSQL, where results survive API restarts.

## Endpoints

| Endpoint        | Responsibility                                                               | Response                                                                      |
| --------------- | ---------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| `POST /jobs`    | Validate input (`title`, `content`, both required) and enqueue a BullMQ job. | `202` · `{ jobId, status }` or `500` if enqueuing fails (never a false `202`) |
| `GET /jobs`     | List all jobs with their statuses and saved results.                         | `200` · bare array of jobs                                                    |
| `GET /jobs/:id` | Read one job's status and result by ID (BullMQ `jobId` or numeric id).       | `200` · job, or `404` if missing                                              |

**Job status lifecycle:** `waiting` → `active` → `completed` | `failed` (after 3 attempts with exponential backoff).

**Job object shape:**

```json
{
  "id": 1,
  "jobId": "c66246fb-8c45-42be-a73b-2867fd571cc0",
  "status": "completed",
  "input": { "title": "...", "content": "..." },
  "result": {
    "metaTitle": "...",
    "metaDescription": "...",
    "keywords": ["...", "..."],
    "ogTitle": "...",
    "ogDescription": "..."
  },
  "error": null,
  "createdAt": "2026-09-29 23:52:44.83952+00",
  "updatedAt": "2026-09-29 23:53:01.482+00"
}
```

`result` is `null` while the job is pending; `error` is `null` unless the job failed.

## Architecture

```text
Client                         API (Hono)                    Worker (Node.js)
  |                             |                             |
  |-- POST /jobs --------------->|                             |
  |                             |-- INSERT pipelineJob (waiting, PostgreSQL)
  |                             |-- queue.add(...) (Redis) --->|
  |<-- 202 + jobId + status -----|                             |
  |                             |                    UPDATE status = active
  |                             |                    Real model call (Anvia SDK)
  |                             |                    UPDATE status = completed, result = ...
  |                             |                    (on failure: retry, then failed + error)
  |-- GET /jobs / /:id --------->|                             |
  |<-- status + result ----------|                             |
```

- **Queue:** `seo-meta-generator` (Redis at `localhost:6380`), shared by API and worker via `src/worker/config.ts`.
- **Job payload:** `{ id }` the `pipelineJob.id` of the row created by the API.
- **`jobId`:** one UUID serves as both the PostgreSQL unique `jobId` and the BullMQ `jobId`, which prevents duplicate enqueueing while that ID exists.

## Project structure

| File                         | Purpose                                                            |
| ---------------------------- | ------------------------------------------------------------------ |
| `src/index.ts`               | Server startup; mounts the job router at `/jobs` (port `3000`)     |
| `src/modules/job/router.ts`  | Validation, enqueue (retries + custom jobId), status queries       |
| `src/modules/job/schema.ts`  | Zod schema for `POST /jobs` (`title`, `content`)                   |
| `src/modules/job/service.ts` | SEO-meta prompt + structured output schema, `generateCompletion()` |
| `src/worker/config.ts`       | Queue name and Redis connection                                    |
| `src/worker/queue.ts`        | BullMQ queue (producer)                                            |
| `src/worker/worker.ts`       | Processor, status transitions, failure persistence, shutdown       |
| `src/llm/models.ts`          | Anvia `OpenAIClient` (key, base URL, model id)                     |
| `src/utils/db.ts`            | Prisma runtime client (contract + `DATABASE_URL`)                  |
| `prisma/schema.prisma`       | `PipelineJob` model                                                |
| `prisma.config.ts`           | Prisma CLI config (schema path, contract output, DB connection)    |
| `docker-compose.yml`         | PostgreSQL 16 (`55432`) + Redis 7 (`6380`)                         |

## Setup

Prerequisites: Node.js 22.18+, pnpm, Docker with Compose.

```bash
# 1. Dependencies
pnpm install --frozen-lockfile

# 2. Environment .env (git-excluded)
#    DATABASE_URL="postgresql://hono:hono@localhost:55432/hono"
#    OPENAI_API_KEY="..."
#    OPENAI_BASE_URL="https://<openai-compatible-provider>/v1"

# 3. Services
docker compose up -d

# 4. Database + contract
pnpm contract:emit
pnpm exec prisma db init        # fresh DB; use `db update` after schema edits
pnpm exec prisma db verify

# 5. Run (two terminals)
pnpm dev                        # API  -> http://localhost:3000
pnpm worker:dev                 # worker
```

| Service    | Host address      |
| ---------- | ----------------- |
| API        | `localhost:3000`  |
| PostgreSQL | `localhost:55432` |
| Redis      | `localhost:6380`  |

The model defaults to `deepseek-v4.1-flash` (`src/llm/models.ts`) and is called through the OpenAI-compatible endpoint configured in `.env`.

### Commands

| Command                                        | Purpose                                      |
| ---------------------------------------------- | -------------------------------------------- |
| `pnpm dev` / `pnpm worker:dev`                 | Run API / worker with file watching          |
| `pnpm contract:emit`                           | Regenerate the Prisma contract               |
| `pnpm exec prisma db init \| update \| verify` | Initialize / migrate / check the database    |
| `pnpm exec tsc --noEmit`                       | Type check (passes with 0 errors)            |
| `docker compose up -d \| stop`                 | Start / stop services (volumes persist data) |

## Demonstration

The full flow was executed against this project:

**1. Start a job**

```bash
curl -i -X POST http://localhost:3000/jobs \
  -H 'Content-Type: application/json' \
  -d '{"title":"Why TypeScript Beats JavaScript for Large Teams","content":"TypeScript adds static types ..."}'
```

```text
HTTP 202
{"jobId":"c66246fb-8c45-42be-a73b-2867fd571cc0","status":"waiting"}
```

**2. Fetch while pending result is `null`**

```json
{ "jobId": "c66246fb-...", "status": "active", "result": null, "error": null }
```

**3. Fetch after completion real model output persisted**

```json
{
  "jobId": "c66246fb-...",
  "status": "completed",
  "result": {
    "metaTitle": "TypeScript for Large Teams: Why It Beats JavaScript",
    "metaDescription": "Discover why TypeScript is the better choice for large teams...",
    "keywords": ["TypeScript for large teams", "TypeScript vs JavaScript", "static typing", "...", "..."],
    "ogTitle": "Why TypeScript Beats JavaScript for Large Development Teams",
    "ogDescription": "TypeScript adds static types that catch bugs at compile time..."
  }
}
```

**4. List jobs**

```text
GET /jobs => HTTP 200, array=true, count=2
  jobId=c66246fb-... status=completed error=null result=ready
  jobId=cf8e8944-... status=failed  error=Forced failure (demo trigger title) result=null
```

**5. Handle a failed job**

Submit a job titled `__force_fail__` (a reserved demo trigger that throws before the model call). The worker retries 3 times with exponential backoff worker log:

```text
Job cf8e8944-... failed (attempt 1/3) Error: Forced failure (demo trigger title)
Job cf8e8944-... failed (attempt 2/3) Error: Forced failure (demo trigger title)
Job cf8e8944-... failed (attempt 3/3) Error: Forced failure (demo trigger title)
```

then the API shows:

```json
{ "jobId": "cf8e8944-...", "status": "failed", "error": "Forced failure (demo trigger title)", "result": null }
```

**6. Survive an API restart**

The API process was killed and started again; `GET /jobs/c66246fb-...` still returned `status: completed` with the saved result state lives in PostgreSQL, not in Redis.

**7. Missing job**

```text
GET /jobs/does-not-exist => 404 {"error":"Job not found"}
```
