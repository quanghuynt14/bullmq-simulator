import { Queue } from 'bullmq';
import { connection } from './util.ts';

async function produce({delay, priority}: {delay: number; priority: number}) {
  const queue = new Queue('my-queue', {
    connection: connection,
  });

  try {
    await queue.add(
      'my-job',
      { foo: 'bar' },
      {
        delay: delay,
        priority: priority,
        // removeOnComplete: {
        //   age: 10, // Lazily remove jobs after 10 seconds
        //   count: 5, // Keep at most 5 completed jobs
        // }
      }
    );
    console.log(`Added job with delay ${delay} ms and priority ${priority} to the queue.`);
  } finally {
    await queue.close();
    await connection.quit();
  }
}


import commandLineArgs from 'command-line-args';

const optionDefinitions = [
  { name: 'delay', type: Number, defaultValue: 0 },
  { name: 'priority', type: Number, defaultValue: 0 },
];

const options = commandLineArgs(optionDefinitions);

try {
  await produce({ delay: options.delay, priority: options.priority });
  console.log('Producer completed.')
} catch (err) {
  console.error('Error producing job:', err);
}

// Run: node 01-producer.ts --delay 5000 --priority 1