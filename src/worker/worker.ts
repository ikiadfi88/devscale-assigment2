import { Worker } from "bullmq";
import { QUEUE_NAME, workerConnection } from "./config";
import { db } from "../utils/db";
import { generateSeoMeta } from "../modules/job/service";

const FORCE_FAIL_TITLE = "__force_fail__";

export const worker = new Worker(
  QUEUE_NAME,
  async (job) => {
    console.log(`Processing job: ${job.data.id}`);

    const pipelineJobId = job.data.id;
    if (!pipelineJobId) {
      throw new Error("PipelineJob ID is missing");
    }

    try {
      await db.orm.public.PipelineJob.where((pj) =>
        pj.id.eq(pipelineJobId)
      ).update({ status: "active" });

      const pipelineJob = await db.orm.public.PipelineJob.where((pj) =>
        pj.id.eq(pipelineJobId)
      ).first();

      if (!pipelineJob?.input) {
        throw new Error(`PipelineJob with ID ${pipelineJobId} not found`);
      }

      const inputData = JSON.parse(pipelineJob.input);

      if (inputData.title === FORCE_FAIL_TITLE) {
        throw new Error("Forced failure (demo trigger title)");
      }

      const seoMeta = await generateSeoMeta(inputData.title, inputData.content);

      console.log("SEO meta generated successfully");
      console.log(seoMeta);

      await db.orm.public.PipelineJob.where((pj) =>
        pj.id.eq(pipelineJobId)
      ).update({
        status: "completed",
        result: JSON.stringify(seoMeta),
      });
    } catch (error) {
      console.error(`Job failed: ${job.id}`, error);
      throw error;
    }
  },
  {
    connection: workerConnection,
  },
);

worker.on("completed", (job) => {
  console.log(`Job ${job.id} completed`);
});

worker.on("failed", async (job, error) => {
  if (!job) return;

  const pipelineJobId = job.data?.id;
  if (!pipelineJobId) return;

  const attemptsMade = job.attemptsMade;
  const maxAttempts = Number(job.opts?.attempts ?? 1);
  const isFinalAttempt = attemptsMade >= maxAttempts;

  console.error(
    `Job ${job.id} failed (attempt ${attemptsMade}/${maxAttempts})`,
    error,
  );

  try {
    await db.orm.public.PipelineJob.where((pj) =>
      pj.id.eq(pipelineJobId)
    ).update({
      status: isFinalAttempt ? "failed" : "waiting",
      error: error?.message ?? "Job failed",
    });
  } catch (persistError) {
    console.error("Failed to persist job failure", persistError);
  }
});

worker.on("error", (error) => console.error(error));

// Graceful shutdown: finish active jobs, then close the database client.
let closing = false;
async function shutdown() {
  if (closing) return;
  closing = true;
  console.log("Shutting down worker...");
  await worker.close();
  await db.close();
  process.exit(0);
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
