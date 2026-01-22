import { Queue } from 'bullmq';
import { connection, JOB_TYPES } from './util.ts';

interface ProducerStats {
  totalJobs: number;
  jobsPerQueue: Record<string, number>;
  startTime: number;
  lastReportTime: number;
}

async function produceJobs(options: {
  totalJobs: number;
  jobsPerQueue: number;
  ratePerSecond: number;
  randomFibRange: [number, number];
}) {
  const { totalJobs, jobsPerQueue, ratePerSecond, randomFibRange } = options;
  
  // Calculate number of queues needed
  const numberOfQueues = Math.ceil(totalJobs / jobsPerQueue);
  const actualJobTypes = JOB_TYPES.slice(0, numberOfQueues);
  
  console.log(`🚀 Starting production simulation:`);
  console.log(`   Total jobs: ${totalJobs.toLocaleString()}`);
  console.log(`   Jobs per queue: ${jobsPerQueue.toLocaleString()}`);
  console.log(`   Number of queues: ${numberOfQueues}`);
  console.log(`   Target rate: ${ratePerSecond} jobs/second`);
  console.log(`   Fibonacci range: n=${randomFibRange[0]}-${randomFibRange[1]}`);
  console.log('');

  // Create queues for each job type
  const queues = actualJobTypes.map(jobType => ({
    name: jobType,
    queue: new Queue(jobType, { connection }),
  }));

  const stats: ProducerStats = {
    totalJobs: 0,
    jobsPerQueue: {},
    startTime: Date.now(),
    lastReportTime: Date.now(),
  };

  // Initialize stats
  actualJobTypes.forEach(jobType => {
    stats.jobsPerQueue[jobType] = 0;
  });

  try {
    // Use batching for high throughput
    const batchSize = Math.min(1000, Math.ceil(ratePerSecond / 10)); // Batch size based on rate
    const delayBetweenBatches = batchSize > 1 ? (batchSize / ratePerSecond) * 1000 : 1000 / ratePerSecond;
    
    console.log(`⚙️  Batch size: ${batchSize} jobs | Delay between batches: ${delayBetweenBatches.toFixed(2)}ms`);
    console.log('');
    
    let currentQueue = 0;
    let jobsRemaining = totalJobs;
    
    while (jobsRemaining > 0) {
      const currentBatchSize = Math.min(batchSize, jobsRemaining);
      const batch: Promise<any>[] = [];
      
      for (let i = 0; i < currentBatchSize; i++) {
        const { name, queue } = queues[currentQueue];
        const fibN = Math.floor(Math.random() * (randomFibRange[1] - randomFibRange[0] + 1)) + randomFibRange[0];
        
        const jobPromise = queue.add(
          `${name}-job`,
          { 
            jobType: name,
            fibonacciN: fibN,
            jobNumber: stats.jobsPerQueue[name] + 1,
            timestamp: Date.now(),
          },
          {
            // removeOnComplete: {
            //   age: 3600, // Keep for 1 hour
            //   count: 1000, // Keep last 1000
            // },
            // removeOnFail: {
            //   age: 86400, // Keep failed for 24 hours
            // },
          }
        );
        
        batch.push(jobPromise);
        stats.jobsPerQueue[name]++;

        // Move to next queue after reaching jobsPerQueue limit
        if (stats.jobsPerQueue[name] >= jobsPerQueue) {
          currentQueue++;
          if (currentQueue >= queues.length) {
            break; // All queues filled
          }
        }
      }
      
      // Wait for batch to complete
      await Promise.all(batch);
      stats.totalJobs += batch.length;
      jobsRemaining -= batch.length;

      // Progress reporting every 5 seconds
      const now = Date.now();
      if (now - stats.lastReportTime >= 5000) {
        const elapsed = (now - stats.startTime) / 1000;
        const rate = stats.totalJobs / elapsed;
        const progress = (stats.totalJobs / totalJobs) * 100;
        console.log(`📊 Progress: ${progress.toFixed(1)}% | Jobs: ${stats.totalJobs.toLocaleString()} | Rate: ${rate.toFixed(0)} jobs/s`);
        stats.lastReportTime = now;
      }

      // Rate limiting between batches
      if (delayBetweenBatches > 0 && jobsRemaining > 0) {
        await new Promise(resolve => setTimeout(resolve, delayBetweenBatches));
      }
      
      // Break if all queues are filled
      if (currentQueue >= queues.length) {
        break;
      }
    }

    // Final report
    const totalTime = (Date.now() - stats.startTime) / 1000;
    const actualRate = stats.totalJobs / totalTime;
    
    console.log('\n✅ Production simulation completed!');
    console.log(`   Total time: ${totalTime.toFixed(2)}s`);
    console.log(`   Total jobs: ${stats.totalJobs.toLocaleString()}`);
    console.log(`   Actual rate: ${actualRate.toFixed(2)} jobs/s`);
    console.log(`   Active queues: ${Object.keys(stats.jobsPerQueue).length}`);
    console.log('\n📦 Jobs per queue:');
    
    Object.entries(stats.jobsPerQueue)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .forEach(([name, count]) => {
        console.log(`   ${name}: ${count.toLocaleString()} jobs`);
      });
    
    if (Object.keys(stats.jobsPerQueue).length > 10) {
      console.log(`   ... and ${Object.keys(stats.jobsPerQueue).length - 10} more queues`);
    }

  } finally {
    // Close all queues
    await Promise.all(queues.map(q => q.queue.close()));
    await connection.quit();
  }
}

// Parse command line arguments
import commandLineArgs from 'command-line-args';

const optionDefinitions = [
  { name: 'total', type: Number, defaultValue: 2_500_000 }, // 2.5M jobs
  { name: 'per-queue', type: Number, defaultValue: 10_000 }, // 10k per queue
  { name: 'rate', type: Number, defaultValue: 1000 }, // 1000 jobs/second (1 job/ms)
  { name: 'fib-min', type: Number, defaultValue: 10 },
  { name: 'fib-max', type: Number, defaultValue: 10000 },
];

const options = commandLineArgs(optionDefinitions);

// Debug: Log parsed options
console.log('📝 Parsed options:', options);
console.log('');

try {
  await produceJobs({
    totalJobs: options.total,
    jobsPerQueue: options['per-queue'],
    ratePerSecond: options.rate,
    randomFibRange: [options['fib-min'], options['fib-max']],
  });
  console.log('\n🎉 Producer completed successfully.');
} catch (err) {
  console.error('❌ Error producing jobs:', err);
  process.exit(1);
}

// Usage examples:
// node production-producer.ts
// node production-producer.ts --total 1000000 --per-queue 10000 --rate 1000 --fib-min 20 --fib-max 40
// node production-producer.ts --total 100000 --per-queue 1000 --rate 500  // Smaller test
