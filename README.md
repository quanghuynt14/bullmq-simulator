# BullMQ Production Simulation

This project simulates a real-life production environment with BullMQ job processing.

## Simulation Specifications

- **2.5 Million jobs** (default)
- **250 different queue types** (each representing a different job type)
- **~10,000 jobs per queue**
- **Processing rate**: 1,000 jobs/second
- **Job computation**: Random n-th Fibonacci number (n=10-10,000)

## Setup

### Prerequisites

- Node.js (v18+)
- Redis server running on localhost:6379

### Install Dependencies

```bash
npm install
```

### Start Redis

```bash
# macOS with Homebrew
brew services start redis

# Or run directly
redis-server
```

## Usage

### Quick Start (Basic Example)

For a simple introduction, use the basic producer/worker:

```bash
# Terminal 1: Start the worker
node 01-worker.ts

# Terminal 2: Produce jobs
node 01-producer.ts
```

### Production Simulation

#### 1. Start Workers

Start one or more worker processes to handle jobs:

```bash
# Start workers for all queues with default concurrency (10)
node 02-production-worker.ts

# Start workers with custom concurrency
node 02-production-worker.ts --concurrency 20

# Start workers for specific queues only
node 02-production-worker.ts --queue image-processing --queue video-encoding --concurrency 5
```

**Recommended setup for 1000 jobs/s target:**
- Run 5-10 worker processes
- Each with concurrency of 10-20
- Total concurrent job processing: 50-200 workers

#### 2. Produce Jobs

In a separate terminal, start producing jobs:

```bash
# Default: 2.5M jobs, 10k per queue, 1000 jobs/s, fib(10-10000)
node 02-production-producer.ts

# Custom configuration
node 02-production-producer.ts --total 1000000 --per-queue 10000 --rate 1000 --fib-min 20 --fib-max 40

# Smaller test run
node 02-production-producer.ts --total 100000 --per-queue 1000 --rate 500
```

### Producer Options

- `--total`: Total number of jobs to produce (default: 2,500,000)
- `--per-queue`: Jobs per queue (default: 10,000)
- `--rate`: Jobs per second production rate (default: 1,000)
- `--fib-min`: Minimum Fibonacci n value (default: 10)
- `--fib-max`: Maximum Fibonacci n value (default: 10,000)

### Worker Options

- `--concurrency`: Number of concurrent jobs per queue (default: 10)
- `--queue`: Specific queue names to process (can be repeated, default: all queues)

## Job Types

The simulation includes 250 realistic job types:

- `image-processing`, `video-encoding`, `email-sender`
- `payment-processor`, `invoice-generator`, `order-fulfillment`
- `data-analytics`, `report-generator`, `fraud-detection`
- `notification-sender`, `webhook-processor`, `search-indexer`
- And many more...

## Monitoring

Both producer and worker scripts provide real-time statistics:

### Producer Stats
- Progress percentage
- Jobs created
- Production rate (jobs/s)
- Jobs per queue

### Worker Stats
- Total jobs processed
- Failed jobs
- Processing rate (jobs/s)
- Average processing time
- Latency percentiles (p50, p95, p99)

## Scaling Strategy

For production-like performance:

1. **Horizontal scaling**: Run multiple worker processes
2. **Vertical scaling**: Increase concurrency per worker
3. **Redis optimization**: Configure Redis for high throughput
4. **Job cleanup**: Configure `removeOnComplete` and `removeOnFail`

### Example Multi-Worker Setup

```bash
# Terminal 1: Worker for first 50 queues
node 02-production-worker.ts --concurrency 15

# Terminal 2: Worker for next 50 queues  
node 02-production-worker.ts --concurrency 15

# Terminal 3: Producer
node 02-production-producer.ts --rate 1000
```

## Performance Tips

1. **Redis Configuration**: Ensure Redis has enough memory
2. **Concurrency**: Balance between CPU cores and job complexity
3. **Rate Limiting**: Adjust `--rate` to match worker capacity
4. **Job Data**: Keep job payloads small for better throughput
5. **Cleanup**: Enable `removeOnComplete` to prevent memory bloat

## Expected Results

With optimal configuration:
- **Producer**: Creates 2.5M jobs in ~42 minutes (1000 jobs/s)
- **Worker**: Processes jobs at similar rate
- **Total throughput**: 800-1200 jobs/s sustained

## Troubleshooting

**Issue**: Workers are slow
- Solution: Increase `--concurrency` or run more worker processes

**Issue**: Redis memory full
- Solution: Enable job cleanup with smaller retention values

**Issue**: Production too fast
- Solution: Decrease `--rate` parameter

**Issue**: Connection errors
- Solution: Check Redis is running and accessible
