import { Hono } from "hono";
import { randomUUID } from "node:crypto";
import { db } from "../../utils/db";
import { zValidator } from "@hono/zod-validator";
import { CreateJobSchema } from "./schema";
import { queue } from "../../worker/queue";

function parseResult(result: string | null | undefined) {
  if (!result) return null;
  try {
    return JSON.parse(result);
  } catch {
    return result;
  }
}

function serializeJob(job: {
  id: number;
  jobId: string;
  status: string;
  input: string;
  result: string | null;
  error: string | null;
  createdAt: unknown;
  updatedAt: unknown;
}) {
  return {
    id: job.id,
    jobId: job.jobId,
    status: job.status,
    input: JSON.parse(job.input),
    result: parseResult(job.result),
    error: job.error,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
  };
}

export const jobRouter = new Hono()
  .get("/", async (c) => {
    const jobs = await db.orm.public.PipelineJob.all();
    return c.json(jobs.map(serializeJob));
  })
  .get("/:id", async (c) => {
    const id = c.req.param("id");

    let job = await db.orm.public.PipelineJob.where((pj) =>
      pj.jobId.eq(id)
    ).first();

    if (!job && /^\d+$/.test(id)) {
      job = await db.orm.public.PipelineJob.where((pj) =>
        pj.id.eq(Number(id))
      ).first();
    }

    if (!job) {
      return c.json({ error: "Job not found" }, 404);
    }

    return c.json(serializeJob(job));
  })
  .post("/", zValidator("json", CreateJobSchema), async (c) => {
    const body = c.req.valid("json");

    const jobId = randomUUID();

    const newJob = await db.orm.public.PipelineJob.create({
      jobId,
      status: "waiting",
      input: JSON.stringify({ title: body.title, content: body.content }),
    });

    try {
      await queue.add(
        "generate-seo-meta",
        { id: newJob.id },
        {
          jobId,
          attempts: 3,
          backoff: {
            type: "exponential",
            delay: 1000,
          },
        },
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await db.orm.public.PipelineJob.where((pj) =>
        pj.id.eq(newJob.id)
      ).update({
        status: "failed",
        error: `Enqueue failed: ${message}`,
      });
      return c.json({ error: "Failed to enqueue job" }, 500);
    }

    return c.json({ jobId: newJob.jobId, status: newJob.status }, 202);
  });
