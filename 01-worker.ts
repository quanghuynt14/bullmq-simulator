import { Job, Worker } from 'bullmq';
import { connection } from './util.ts';

const worker = new Worker(
  'my-queue',
  async (job: Job) => {
    console.log(`Processing job ${job.id} with data:`, job.data);
    // throw Error("Intentional failure for testing purposes");
    return "ok";
  },
  {
    connection: connection,
  }
);

worker.on('completed', (job: Job) => {
  console.log(`Job ${job.id} has completed.`);
});

worker.on('failed', (job?: Job) => {
  console.log(`Job ${job?.id} has failed.`);
});

// Graceful shutdown
process.on('SIGTERM', async () => {
  console.log('Shutting down worker...');
  await worker.close();
  await connection.quit();
});