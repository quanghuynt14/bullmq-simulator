import { Queue, JobsOptions } from 'bullmq';
import commandLineArgs from 'command-line-args';
import { connection, JOB_TYPES, QUEUE_PRIORITIES } from './util.ts';

// ============================================================================
// Types & Interfaces
// ============================================================================

interface ProducerOptions {
  queues: number;
  burstMin: number;
  burstMax: number;
  burstQueuesMin: number;
  burstQueuesMax: number;
  intervalMin: number;
  intervalMax: number;
  priorityHigh: number;
  priorityMedium: number;
  priorityLow: number;
  fibMin: number;
  fibMax: number;
  scheduler: boolean;
  schedulerCount: number;
  cron: string | null;
  every: number | null;
  delay: number | null;
  repeatLimit: number | null;
}

interface QueueWithPriority {
  name: string;
  queue: Queue;
  priority: 'high' | 'medium' | 'low';
  weight: number;
}

interface ProducerStats {
  totalJobs: number;
  totalBursts: number;
  jobsPerQueue: Map<string, number>;
  jobsByPriority: { high: number; medium: number; low: number };
  startTime: number;
  lastReportTime: number;
  recentBursts: { size: number; queues: string[]; timestamp: number }[];
}

interface ScheduleConfig {
  name: string;
  cron?: string;
  every?: number;
  delay?: number;
  limit?: number;
}

// ============================================================================
// Default Schedules for Scheduler Jobs
// ============================================================================

const DEFAULT_SCHEDULES: ScheduleConfig[] = [
  { name: 'every-6h', every: 6 * 60 * 60 * 1000 },
  { name: 'every-12h', every: 12 * 60 * 60 * 1000 },
  { name: 'every-24h', every: 24 * 60 * 60 * 1000 },
  { name: 'daily-midnight', cron: '0 0 * * *' },
  { name: 'daily-noon', cron: '0 12 * * *' },
  { name: 'twice-daily', cron: '0 0,12 * * *' },
  { name: 'delayed-1m', delay: 60 * 1000 },
  { name: 'delayed-5m', delay: 5 * 60 * 1000 },
  { name: 'delayed-30m', delay: 30 * 60 * 1000 },
];

// ============================================================================
// Utility Functions
// ============================================================================

function randomBetween(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function getQueuePriority(queueName: string): 'high' | 'medium' | 'low' {
  if (QUEUE_PRIORITIES.high.includes(queueName as any)) return 'high';
  if (QUEUE_PRIORITIES.medium.includes(queueName as any)) return 'medium';
  return 'low';
}

/**
 * Select queues using weighted random selection based on priority
 */
function selectWeightedQueues(
  queues: QueueWithPriority[],
  count: number
): QueueWithPriority[] {
  const totalWeight = queues.reduce((sum, q) => sum + q.weight, 0);
  const selected: QueueWithPriority[] = [];
  const availableQueues = [...queues];

  while (selected.length < count && availableQueues.length > 0) {
    let random = Math.random() * totalWeight;
    let currentWeight = 0;

    for (let i = 0; i < availableQueues.length; i++) {
      currentWeight += availableQueues[i].weight;
      if (random <= currentWeight) {
        selected.push(availableQueues[i]);
        availableQueues.splice(i, 1);
        break;
      }
    }
  }

  return selected;
}

/**
 * Distribute jobs across queues with some randomness
 */
function distributeJobs(totalJobs: number, queueCount: number): number[] {
  const distribution: number[] = [];
  let remaining = totalJobs;

  for (let i = 0; i < queueCount - 1; i++) {
    // Give each queue a random portion of the remaining jobs
    const maxForThis = Math.ceil(remaining / (queueCount - i));
    const minForThis = Math.max(1, Math.floor(remaining / (queueCount - i) * 0.5));
    const jobsForThis = randomBetween(minForThis, maxForThis);
    distribution.push(jobsForThis);
    remaining -= jobsForThis;
  }
  
  // Last queue gets the remainder
  distribution.push(Math.max(1, remaining));
  
  return distribution;
}

// ============================================================================
// Queue Setup
// ============================================================================

function setupQueues(options: ProducerOptions): QueueWithPriority[] {
  const numberOfQueues = Math.min(options.queues, JOB_TYPES.length);
  const selectedJobTypes = JOB_TYPES.slice(0, numberOfQueues);

  return selectedJobTypes.map(jobType => {
    const priority = getQueuePriority(jobType);
    const weight = priority === 'high' ? options.priorityHigh
      : priority === 'medium' ? options.priorityMedium
      : options.priorityLow;

    return {
      name: jobType,
      queue: new Queue(jobType, { connection }),
      priority,
      weight,
    };
  });
}

// ============================================================================
// Statistics & Reporting
// ============================================================================

function initStats(): ProducerStats {
  return {
    totalJobs: 0,
    totalBursts: 0,
    jobsPerQueue: new Map(),
    jobsByPriority: { high: 0, medium: 0, low: 0 },
    startTime: Date.now(),
    lastReportTime: Date.now(),
    recentBursts: [],
  };
}

function printBurst(
  burstNumber: number,
  burstJobs: { queue: QueueWithPriority; count: number }[]
): void {
  const totalJobs = burstJobs.reduce((sum, b) => sum + b.count, 0);
  const queueInfo = burstJobs
    .map(b => `${b.queue.name}(${b.count})`)
    .join(', ');
  console.log(`Burst #${burstNumber}: ${totalJobs} jobs -> ${queueInfo}`);
}

function printStats(stats: ProducerStats, queues: QueueWithPriority[]): void {
  const elapsed = (Date.now() - stats.startTime) / 1000;
  const rate = stats.totalJobs / elapsed;

  const highPct = stats.totalJobs > 0 
    ? ((stats.jobsByPriority.high / stats.totalJobs) * 100).toFixed(1) 
    : '0.0';
  const mediumPct = stats.totalJobs > 0 
    ? ((stats.jobsByPriority.medium / stats.totalJobs) * 100).toFixed(1) 
    : '0.0';
  const lowPct = stats.totalJobs > 0 
    ? ((stats.jobsByPriority.low / stats.totalJobs) * 100).toFixed(1) 
    : '0.0';

  console.log('');
  console.log(`Stats (${elapsed.toFixed(0)}s): ${stats.totalJobs.toLocaleString()} jobs | ${rate.toFixed(1)}/s | ${stats.totalBursts} bursts`);
  console.log(`   High: ${stats.jobsByPriority.high.toLocaleString()} (${highPct}%) | Medium: ${stats.jobsByPriority.medium.toLocaleString()} (${mediumPct}%) | Low: ${stats.jobsByPriority.low.toLocaleString()} (${lowPct}%)`);

  // Top queues by job count
  const topQueues = [...stats.jobsPerQueue.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([name, count]) => `${name}(${count})`)
    .join(', ');
  console.log(`   Top queues: ${topQueues}`);
  console.log('');
}

function printFinalStats(stats: ProducerStats): void {
  const elapsed = (Date.now() - stats.startTime) / 1000;
  const rate = stats.totalJobs / elapsed;

  console.log('\nFinal Statistics:');
  console.log(`   Total jobs produced: ${stats.totalJobs.toLocaleString()}`);
  console.log(`   Total bursts: ${stats.totalBursts}`);
  console.log(`   Runtime: ${elapsed.toFixed(2)}s`);
  console.log(`   Average rate: ${rate.toFixed(2)} jobs/s`);
  console.log(`   Jobs by priority:`);
  console.log(`     High: ${stats.jobsByPriority.high.toLocaleString()}`);
  console.log(`     Medium: ${stats.jobsByPriority.medium.toLocaleString()}`);
  console.log(`     Low: ${stats.jobsByPriority.low.toLocaleString()}`);

  console.log('\nTop 10 queues by job count:');
  const topQueues = [...stats.jobsPerQueue.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10);
  topQueues.forEach(([name, count], i) => {
    console.log(`   ${i + 1}. ${name}: ${count.toLocaleString()} jobs`);
  });
}

// ============================================================================
// Job Production
// ============================================================================

async function produceBurst(
  queues: QueueWithPriority[],
  options: ProducerOptions,
  stats: ProducerStats
): Promise<void> {
  // Determine burst parameters
  const burstSize = randomBetween(options.burstMin, options.burstMax);
  const numQueues = randomBetween(options.burstQueuesMin, options.burstQueuesMax);

  // Select queues for this burst (weighted by priority)
  const selectedQueues = selectWeightedQueues(queues, numQueues);

  // Distribute jobs across selected queues
  const jobDistribution = distributeJobs(burstSize, selectedQueues.length);

  // Track burst info for logging
  const burstJobs: { queue: QueueWithPriority; count: number }[] = [];

  // Add jobs to each selected queue in parallel
  const addPromises = selectedQueues.map(async (queue, index) => {
    const jobCount = jobDistribution[index];
    burstJobs.push({ queue, count: jobCount });

    const batch: Promise<any>[] = [];
    for (let i = 0; i < jobCount; i++) {
      const fibN = randomBetween(options.fibMin, options.fibMax);
      const currentCount = (stats.jobsPerQueue.get(queue.name) || 0) + i + 1;

      batch.push(
        queue.queue.add(
          `${queue.name}-job`,
          {
            jobType: queue.name,
            fibonacciN: fibN,
            jobNumber: currentCount,
            priority: queue.priority,
            timestamp: Date.now(),
          }
        )
      );
    }

    await Promise.all(batch);

    // Update stats
    const prevCount = stats.jobsPerQueue.get(queue.name) || 0;
    stats.jobsPerQueue.set(queue.name, prevCount + jobCount);
    stats.jobsByPriority[queue.priority] += jobCount;
  });

  await Promise.all(addPromises);

  // Update total stats
  stats.totalJobs += burstSize;
  stats.totalBursts++;

  // Print burst info
  printBurst(stats.totalBursts, burstJobs);

  // Store recent burst for analysis
  stats.recentBursts.push({
    size: burstSize,
    queues: selectedQueues.map(q => q.name),
    timestamp: Date.now(),
  });
  if (stats.recentBursts.length > 100) {
    stats.recentBursts.shift();
  }
}

// ============================================================================
// Scheduler Jobs Production
// ============================================================================

async function produceSchedulerJobs(
  queues: QueueWithPriority[],
  options: ProducerOptions
): Promise<void> {
  console.log('\nStarting scheduler job production:');
  console.log(`   Scheduler jobs to create: ${options.schedulerCount}`);

  if (options.cron) {
    console.log(`   Custom cron: ${options.cron}`);
  } else if (options.every) {
    console.log(`   Custom interval: ${options.every}ms`);
  } else if (options.delay) {
    console.log(`   Custom delay: ${options.delay}ms`);
  } else {
    console.log(`   Using random schedules from defaults`);
  }
  console.log('');

  const schedulerStats = { repeatable: 0, delayed: 0, bySchedule: {} as Record<string, number> };

  for (let i = 0; i < options.schedulerCount; i++) {
    const queue = queues[i % queues.length];
    const fibN = randomBetween(options.fibMin, options.fibMax);

    let schedule: ScheduleConfig;
    if (options.cron || options.every || options.delay) {
      schedule = {
        name: 'custom',
        cron: options.cron ?? undefined,
        every: options.every ?? undefined,
        delay: options.delay ?? undefined,
        limit: options.repeatLimit ?? undefined,
      };
    } else {
      schedule = DEFAULT_SCHEDULES[Math.floor(Math.random() * DEFAULT_SCHEDULES.length)];
    }

    const jobOptions: JobsOptions = {};

    if (schedule.cron || schedule.every) {
      jobOptions.repeat = {};
      if (schedule.cron) jobOptions.repeat.pattern = schedule.cron;
      if (schedule.every) jobOptions.repeat.every = schedule.every;
      if (schedule.limit) jobOptions.repeat.limit = schedule.limit;
      schedulerStats.repeatable++;
    } else if (schedule.delay) {
      jobOptions.delay = schedule.delay;
      schedulerStats.delayed++;
    }

    schedulerStats.bySchedule[schedule.name] = (schedulerStats.bySchedule[schedule.name] || 0) + 1;

    await queue.queue.add(
      `${queue.name}-job`,
      {
        jobType: queue.name,
        fibonacciN: fibN,
        schedulerJob: true,
        scheduleType: schedule.name,
        timestamp: Date.now(),
      },
      jobOptions
    );
  }

  console.log(`Scheduler jobs created:`);
  console.log(`   Repeatable: ${schedulerStats.repeatable}`);
  console.log(`   Delayed: ${schedulerStats.delayed}`);
  console.log(`\nJobs by schedule type:`);
  Object.entries(schedulerStats.bySchedule)
    .sort((a, b) => b[1] - a[1])
    .forEach(([scheduleName, count]) => {
      console.log(`   ${scheduleName}: ${count}`);
    });
}

// ============================================================================
// Main Continuous Producer Loop
// ============================================================================

async function runContinuousProducer(
  queues: QueueWithPriority[],
  options: ProducerOptions
): Promise<void> {
  // Count queues by priority
  const queueCounts = {
    high: queues.filter(q => q.priority === 'high').length,
    medium: queues.filter(q => q.priority === 'medium').length,
    low: queues.filter(q => q.priority === 'low').length,
  };

  console.log('Starting continuous production simulation:');
  console.log(`   Queues: ${queues.length} (${queueCounts.high} high, ${queueCounts.medium} medium, ${queueCounts.low} low priority)`);
  console.log(`   Burst size: ${options.burstMin}-${options.burstMax} jobs across ${options.burstQueuesMin}-${options.burstQueuesMax} queues`);
  console.log(`   Interval: ${options.intervalMin}-${options.intervalMax}ms between bursts`);
  console.log(`   Priority weights: high=${options.priorityHigh}, medium=${options.priorityMedium}, low=${options.priorityLow}`);
  console.log(`   Fibonacci range: n=${options.fibMin}-${options.fibMax}`);
  console.log('\nPress Ctrl+C to stop...\n');

  const stats = initStats();
  let running = true;

  // Graceful shutdown handler
  const shutdown = async () => {
    console.log('\n\nShutting down producer...');
    running = false;
    printFinalStats(stats);

    console.log('\nClosing queue connections...');
    await Promise.all(queues.map(q => q.queue.close()));
    await connection.quit();
    console.log('Producer shut down successfully.');
    process.exit(0);
  };

  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);

  // Main production loop
  while (running) {
    try {
      // Produce a burst
      await produceBurst(queues, options, stats);

      // Periodic stats reporting (every 10 seconds)
      const now = Date.now();
      if (now - stats.lastReportTime >= 10000) {
        printStats(stats, queues);
        stats.lastReportTime = now;
      }

      // Random delay before next burst
      const delay = randomBetween(options.intervalMin, options.intervalMax);
      await sleep(delay);
    } catch (error) {
      console.error('Error in burst production:', error);
      // Continue running despite errors
      await sleep(1000);
    }
  }
}

// ============================================================================
// CLI & Entry Point
// ============================================================================

const optionDefinitions = [
  // Queue configuration
  { name: 'queues', type: Number, defaultValue: 150 },

  // Burst configuration
  { name: 'burst-min', type: Number, defaultValue: 10 },
  { name: 'burst-max', type: Number, defaultValue: 100 },
  { name: 'burst-queues-min', type: Number, defaultValue: 2 },
  { name: 'burst-queues-max', type: Number, defaultValue: 5 },

  // Interval configuration
  { name: 'interval-min', type: Number, defaultValue: 100 },
  { name: 'interval-max', type: Number, defaultValue: 2000 },

  // Priority weights
  { name: 'priority-high', type: Number, defaultValue: 10 },
  { name: 'priority-medium', type: Number, defaultValue: 5 },
  { name: 'priority-low', type: Number, defaultValue: 1 },

  // Fibonacci configuration
  { name: 'fib-min', type: Number, defaultValue: 10 },
  { name: 'fib-max', type: Number, defaultValue: 10000 },

  // Scheduler job options
  { name: 'scheduler', type: Boolean, defaultValue: false },
  { name: 'scheduler-count', type: Number, defaultValue: 10 },
  { name: 'cron', type: String, defaultValue: null },
  { name: 'every', type: Number, defaultValue: null },
  { name: 'delay', type: Number, defaultValue: null },
  { name: 'repeat-limit', type: Number, defaultValue: null },
];

const cliOptions = commandLineArgs(optionDefinitions);

const options: ProducerOptions = {
  queues: cliOptions['queues'],
  burstMin: cliOptions['burst-min'],
  burstMax: cliOptions['burst-max'],
  burstQueuesMin: cliOptions['burst-queues-min'],
  burstQueuesMax: cliOptions['burst-queues-max'],
  intervalMin: cliOptions['interval-min'],
  intervalMax: cliOptions['interval-max'],
  priorityHigh: cliOptions['priority-high'],
  priorityMedium: cliOptions['priority-medium'],
  priorityLow: cliOptions['priority-low'],
  fibMin: cliOptions['fib-min'],
  fibMax: cliOptions['fib-max'],
  scheduler: cliOptions['scheduler'],
  schedulerCount: cliOptions['scheduler-count'],
  cron: cliOptions['cron'],
  every: cliOptions['every'],
  delay: cliOptions['delay'],
  repeatLimit: cliOptions['repeat-limit'],
};

// Validate options
if (options.burstMin > options.burstMax) {
  console.error('Error: --burst-min cannot be greater than --burst-max');
  process.exit(1);
}
if (options.burstQueuesMin > options.burstQueuesMax) {
  console.error('Error: --burst-queues-min cannot be greater than --burst-queues-max');
  process.exit(1);
}
if (options.intervalMin > options.intervalMax) {
  console.error('Error: --interval-min cannot be greater than --interval-max');
  process.exit(1);
}

console.log('Parsed options:', options);
console.log('');

try {
  // Setup queues
  const queues = setupQueues(options);

  // Produce scheduler jobs first if enabled
  if (options.scheduler) {
    await produceSchedulerJobs(queues, options);
    console.log('');
  }

  // Run continuous producer
  await runContinuousProducer(queues, options);
} catch (err) {
  console.error('Error starting producer:', err);
  process.exit(1);
}

// ============================================================================
// Usage Examples
// ============================================================================
//
// Default continuous mode (150 queues, realistic bursts):
//   npx tsx 02-production-producer.ts
//
// High-traffic simulation (larger, more frequent bursts):
//   npx tsx 02-production-producer.ts --burst-max 500 --interval-max 500
//
// Heavy focus on high-priority queues:
//   npx tsx 02-production-producer.ts --priority-high 20 --priority-medium 3 --priority-low 1
//
// Fewer queues for easier monitoring:
//   npx tsx 02-production-producer.ts --queues 20
//
// More queues per burst:
//   npx tsx 02-production-producer.ts --burst-queues-min 3 --burst-queues-max 8
//
// With scheduler jobs:
//   npx tsx 02-production-producer.ts --scheduler --scheduler-count 50
//
// Custom cron scheduler:
//   npx tsx 02-production-producer.ts --scheduler --cron "* * * * *"
//
// Full example with all options:
//   npx tsx 02-production-producer.ts \
//     --queues 200 \
//     --burst-min 20 --burst-max 200 \
//     --burst-queues-min 3 --burst-queues-max 7 \
//     --interval-min 50 --interval-max 1000 \
//     --priority-high 15 --priority-medium 5 --priority-low 1 \
//     --fib-min 20 --fib-max 5000 \
//     --scheduler --scheduler-count 100
