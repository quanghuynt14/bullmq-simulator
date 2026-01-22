import { Job, MetricsTime, Worker } from 'bullmq';
import { connection, JOB_TYPES } from './util.ts';

// Fibonacci calculation (iterative approach for better performance)
function fibonacci(n: number): bigint {
  if (n <= 1) return BigInt(n);
  
  let prev = BigInt(0);
  let curr = BigInt(1);
  
  for (let i = 2; i <= n; i++) {
    const next = prev + curr;
    prev = curr;
    curr = next;
  }
  
  return curr;
}

// Worker statistics
interface WorkerStats {
  processed: number;
  failed: number;
  totalProcessingTime: number;
  startTime: number;
  lastReportTime: number;
  processingTimes: number[];
}

const stats: WorkerStats = {
  processed: 0,
  failed: 0,
  totalProcessingTime: 0,
  startTime: Date.now(),
  lastReportTime: Date.now(),
  processingTimes: [],
};

// Job processor function
async function processJob(job: Job) {
  const startTime = Date.now();
  
  try {
    const { jobType, fibonacciN, jobNumber } = job.data;
    
    // Calculate Fibonacci
    const result = fibonacci(fibonacciN);
    
    const processingTime = Date.now() - startTime;
    stats.processed++;
    stats.totalProcessingTime += processingTime;
    stats.processingTimes.push(processingTime);
    
    // Keep only last 1000 processing times for stats
    if (stats.processingTimes.length > 1000) {
      stats.processingTimes.shift();
    }
    
    // Periodic stats reporting (every 5 seconds)
    const now = Date.now();
    if (now - stats.lastReportTime >= 5000) {
      const elapsed = (now - stats.startTime) / 1000;
      const rate = stats.processed / elapsed;
      const avgTime = stats.totalProcessingTime / stats.processed;
      
      // Calculate percentiles
      const sorted = [...stats.processingTimes].sort((a, b) => a - b);
      const p50 = sorted[Math.floor(sorted.length * 0.5)];
      const p95 = sorted[Math.floor(sorted.length * 0.95)];
      const p99 = sorted[Math.floor(sorted.length * 0.99)];
      
      console.log(`📊 Worker Stats:`);
      console.log(`   Processed: ${stats.processed.toLocaleString()} jobs`);
      console.log(`   Failed: ${stats.failed} jobs`);
      console.log(`   Rate: ${rate.toFixed(2)} jobs/s`);
      console.log(`   Avg time: ${avgTime.toFixed(2)}ms`);
      console.log(`   p50: ${p50}ms | p95: ${p95}ms | p99: ${p99}ms`);
      console.log('');
      
      stats.lastReportTime = now;
    }
    
    return {
      fibonacciN,
      fibonacciResult: result.toString(),
      processingTime,
      jobType,
      jobNumber,
    };
  } catch (error) {
    stats.failed++;
    throw error;
  }
}

// Parse command line arguments
import commandLineArgs from 'command-line-args';

const optionDefinitions = [
  { name: 'concurrency', type: Number, defaultValue: 10 },
  { name: 'queue', type: String, multiple: true }, // Specific queues to process
  { name: 'total', type: Number, defaultValue: 2_500_000 }, // Total jobs to match producer
  { name: 'per-queue', type: Number, defaultValue: 10_000 }, // Jobs per queue to match producer
];

const options = commandLineArgs(optionDefinitions);

// Determine which queues to process
let queuesToProcess: string[];
if (options.queue && options.queue.length > 0) {
  // User specified specific queues
  queuesToProcess = options.queue;
} else {
  // Calculate number of queues based on total jobs and jobs per queue (matching producer logic)
  const numberOfQueues = Math.ceil(options.total / options['per-queue']);
  queuesToProcess = JOB_TYPES.slice(0, numberOfQueues);
}

console.log(`🔧 Starting production workers:`);
console.log(`   Concurrency: ${options.concurrency} per queue`);
console.log(`   Processing ${queuesToProcess.length} queue(s)`);
console.log(`   Queues: ${queuesToProcess.slice(0, 5).join(', ')}${queuesToProcess.length > 5 ? '...' : ''}`);
console.log('');

// Create workers for each queue
const workers = queuesToProcess.map(queueName => {
  const worker = new Worker(queueName, processJob, {
    connection,
    concurrency: options.concurrency,
    metrics: {
      maxDataPoints: MetricsTime.ONE_WEEK * 2  // Keep 2 weeks of data
    }
  });

  worker.on('completed', (job: Job) => {
    // Silent success - stats are printed periodically
  });

  worker.on('failed', (job: Job | undefined, err: Error) => {
    console.error(`❌ Job ${job?.id} failed in queue ${job?.queueName}:`, err.message);
  });

  return worker;
});

// Graceful shutdown
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

async function shutdown() {
  console.log('\n🛑 Shutting down workers...');
  
  const elapsed = (Date.now() - stats.startTime) / 1000;
  const rate = stats.processed / elapsed;
  const avgTime = stats.processed > 0 ? stats.totalProcessingTime / stats.processed : 0;
  
  console.log('\n📊 Final Statistics:');
  console.log(`   Total processed: ${stats.processed.toLocaleString()} jobs`);
  console.log(`   Total failed: ${stats.failed} jobs`);
  console.log(`   Total time: ${elapsed.toFixed(2)}s`);
  console.log(`   Average rate: ${rate.toFixed(2)} jobs/s`);
  console.log(`   Average processing time: ${avgTime.toFixed(2)}ms`);
  
  await Promise.all(workers.map(w => w.close()));
  await connection.quit();
  
  console.log('✅ Workers shut down successfully.');
  process.exit(0);
}

console.log('✅ Workers are ready and waiting for jobs...\n');

// Usage examples:
// node production-worker.ts
// node production-worker.ts --concurrency 20
// node production-worker.ts --total 1000000 --per-queue 10000  // Process 100 queues
// node production-worker.ts --queue image-processing --queue video-encoding --concurrency 5
