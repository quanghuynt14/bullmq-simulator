# BullMQ Production Simulation with Docker & Monitoring

Complete Docker setup with monitoring stack for BullMQ production simulation.

## Stack Components

### Core Services
- **Redis**: Message broker (7.4-alpine) with optimized configuration
- **BullMQ**: Job queue system (producer & worker)

### Monitoring Stack
- **Prometheus**: Metrics collection and storage
- **Grafana**: Visualization dashboards (port 3000)
- **Redis Exporter**: Redis metrics for Prometheus
- **cAdvisor**: Container metrics
- **Node Exporter**: Host system metrics
- **BullMQ Board**: Web UI for queue inspection (port 3001)

## Quick Start

### 1. Start the entire stack

```bash
# Start all services
docker compose up -d

# View logs
docker compose logs -f
```

### 2. Run workers (multiple instances)

```bash
# Terminal 1: Worker instance 1
node production-worker.ts --concurrency 20

# Terminal 2: Worker instance 2
node production-worker.ts --concurrency 20

# Terminal 3: Worker instance 3
node production-worker.ts --concurrency 20
```

### 3. Start production

```bash
# Produce 1M jobs
node production-producer.ts

# Or custom configuration
node production-producer.ts --total 1000000 --per-queue 4000 --rate 1000
```

## Access Points

| Service | URL | Credentials |
|---------|-----|-------------|
| **Grafana** | http://localhost:3000 | admin/admin |
| **BullMQ Board** | http://localhost:3001 | - |
| **Prometheus** | http://localhost:9090 | - |
| **cAdvisor** | http://localhost:8080 | - |
| **Redis** | localhost:6379 | - |

## Monitoring Features

### Grafana Dashboard
Pre-configured dashboard showing:
- Redis connected clients
- Total keys in database
- Commands per second
- Memory usage
- CPU usage per container
- Memory usage per container
- Network traffic
- Redis status

### BullMQ Board
Visual interface for:
- Queue inspection
- Job details
- Retry management
- Job statistics
- Real-time updates

### Prometheus Metrics
Available metrics:
- `redis_connected_clients`: Number of client connections
- `redis_db_keys`: Total keys in Redis
- `redis_commands_processed_total`: Total commands processed
- `redis_memory_used_bytes`: Memory usage
- `container_cpu_usage_seconds_total`: Container CPU
- `container_memory_usage_bytes`: Container memory

## Docker Commands

```bash
# Start services
docker compose up -d

# Stop services
docker compose down

# View logs
docker compose logs -f [service-name]

# Restart a service
docker compose restart [service-name]

# View service status
docker compose ps

# Remove volumes (clean slate)
docker compose down -v

# Scale workers (if using Docker workers)
docker compose up -d --scale worker=5
```

## Configuration Files

### docker-compose.yml
Main orchestration file with all services

### redis.conf
- 2GB memory limit
- AOF persistence enabled
- Optimized for production workload
- Slow query logging

### prometheus.yml
- 15s scrape interval
- Monitors: Redis, cAdvisor, Node Exporter, Prometheus
- Labels for environment tracking

### grafana/
- `provisioning/datasources/`: Prometheus datasource
- `provisioning/dashboards/`: Auto-load dashboards
- `dashboards/`: BullMQ production dashboard

## Performance Monitoring

### Key Metrics to Watch

1. **Redis Commands/sec**: Should match job processing rate (~1000/s)
2. **Redis Memory**: Should stay under 2GB limit
3. **Container CPU**: Worker containers should show consistent CPU usage
4. **Network Traffic**: Indicates data flow to/from Redis

### Alert Thresholds

- Redis memory > 1.8GB (90% of limit)
- Commands/sec < 500 (underperforming)
- Redis down (connectivity issues)
- Container memory > 500MB (per worker)

## Troubleshooting

### Redis Connection Issues
```bash
# Check Redis is running
docker compose ps redis

# View Redis logs
docker compose logs redis

# Test Redis connection
docker compose exec redis redis-cli ping
```

### High Memory Usage
```bash
# Check Redis memory
docker compose exec redis redis-cli INFO memory

# Clear specific queues
docker compose exec redis redis-cli KEYS "bull:*"
```

### Grafana Not Showing Data
```bash
# Check Prometheus targets
# Visit: http://localhost:9090/targets

# Restart Grafana
docker compose restart grafana
```

### BullMQ Board Empty
The board will only show queues that exist. Start producing jobs first, or modify `Dockerfile.board` to add your specific queue names.

## Production Tips

1. **Multiple Workers**: Run 5-10 worker processes for best throughput
2. **Resource Limits**: Set Docker memory/CPU limits in production
3. **Persistence**: Use named volumes for Redis data
4. **Backups**: Regular snapshots of Redis data volume
5. **Scaling**: Use Docker Swarm or Kubernetes for horizontal scaling
6. **Monitoring**: Set up Grafana alerts for critical metrics
7. **Network**: Use bridge network for service isolation

## Architecture

```
┌─────────────┐
│  Producer   │───┐
└─────────────┘   │
                  │    ┌──────────┐      ┌────────────┐
┌─────────────┐   ├───▶│  Redis   │◀────▶│ Prometheus │
│  Worker 1   │───┤    └──────────┘      └────────────┘
└─────────────┘   │         │                    │
                  │         │                    │
┌─────────────┐   │         ▼                    ▼
│  Worker 2   │───┤    ┌──────────┐      ┌────────────┐
└─────────────┘   │    │  Board   │      │  Grafana   │
                  │    └──────────┘      └────────────┘
┌─────────────┐   │
│  Worker N   │───┘
└─────────────┘
```

## Cleanup

```bash
# Stop and remove all containers
docker compose down

# Remove all data (including Redis data)
docker compose down -v

# Remove images
docker compose down --rmi all
```

## Next Steps

1. ✅ Start monitoring stack
2. ✅ Access Grafana dashboard
3. ✅ Start worker processes
4. ✅ Run producer
5. ✅ Monitor in real-time
6. ✅ Analyze performance metrics
7. ✅ Optimize based on data
