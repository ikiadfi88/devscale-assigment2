import { Queue } from "bullmq";
import { QUEUE_NAME, workerConnection } from "./config";

export const queue = new Queue(QUEUE_NAME, { connection: workerConnection });
