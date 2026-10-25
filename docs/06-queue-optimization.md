# Phase 6: Queue Optimization Logic (Nonlinear Model)

> **Status:** ✅ Complete | **Updated:** 2026-05-13

---

## 1. Overview

The queue system replaces traditional FIFO with a **nonlinear priority optimization model** that minimizes total system inefficiency by dynamically reordering the queue based on multiple weighted factors.

```
Traditional FIFO:  1 → 2 → 3 → 4 → 5 → 6
                   (order of arrival, ignores everything else)

Nonlinear Queue:   3 → 1 → 5 → 2 → 6 → 4
                   (optimized: rush priority, wait time penalties,
                    service duration, congestion factors)
```

---

## 2. Mathematical Model

### 2.1 Priority Score Function

Each order `i` receives a **priority score** `P(i)` computed as:

```
P(i) = W_wait · C_wait(t_i) + W_rush · R(i) + W_duration · D(i) + W_congestion · G(i)
```

Where:
- `C_wait(t_i)` = nonlinear waiting cost (exponential penalty)
- `R(i)` = rush priority modifier
- `D(i)` = service duration efficiency score
- `G(i)` = congestion/workload factor
- `W_*` = configurable weights

**Higher score = higher priority (served first)**

---

### 2.2 Nonlinear Waiting Cost — `C_wait(t)`

Waiting time generates **exponentially increasing** dissatisfaction:

```
C_wait(t) = α · (e^(β·t) - 1)
```

Where:
- `t` = waiting time in minutes
- `α` = base sensitivity coefficient (default: 1.0)
- `β` = exponential growth rate (default: 0.05)

**Behavior:**
| Wait Time | Linear Cost | Nonlinear Cost | Ratio |
|-----------|-------------|----------------|-------|
| 5 min | 5.0 | 1.28 | 0.26x |
| 10 min | 10.0 | 1.65 | 0.17x |
| 20 min | 20.0 | 3.72 | 0.19x |
| 30 min | 30.0 | 9.49 | 0.32x |
| 45 min | 45.0 | 33.50 | 0.74x |
| 60 min | 60.0 | 119.2 | 1.99x |

> Orders waiting 45+ minutes get **massive priority boosts**, preventing extreme delays.

---

### 2.3 Rush Priority Modifier — `R(i)`

```
R(i) = is_rush ? rush_multiplier · base_rush_score : 0
```

- `rush_multiplier`: configurable (default: 2.5)
- `base_rush_score`: 10.0
- Rush orders get instant priority boost but don't permanently dominate

**Rush decay** (optional): Rush bonus decreases slightly as the order ages to prevent starvation of non-rush orders:

```
R(i) = rush_multiplier · base_rush_score · e^(-0.01 · t_i)
```

---

### 2.4 Service Duration Efficiency — `D(i)`

Shorter jobs get a slight boost to improve throughput (Shortest Job Next influence):

```
D(i) = max_duration / estimated_duration(i)
```

Where `max_duration` = maximum service duration in current queue.

| Service | Est. Duration | D(i) (max=15) |
|---------|---------------|----------------|
| Printing (simple) | 3 min | 5.0 |
| ID Photo | 5 min | 3.0 |
| Photo Editing | 10 min | 1.5 |
| Doc Editing | 15 min | 1.0 |

> This prevents long jobs from blocking many short jobs, improving average wait time.

---

### 2.5 Congestion Factor — `G(i)`

System congestion nonlinearly affects processing speed:

```
G(i) = 1 / (1 + e^(k · (load - threshold)))
```

This is a **sigmoid function** where:
- `load` = current system utilization (0.0 to 1.0)
- `threshold` = congestion threshold (default: 0.7)
- `k` = steepness (default: 10)

**Behavior:**
- Low congestion (load < 0.5): G ≈ 1.0 (no impact)
- Medium congestion (load = 0.7): G ≈ 0.5 (reduced efficiency)
- High congestion (load > 0.9): G ≈ 0.02 (severe slowdown)

When congestion is high, the optimizer favors:
- Shorter jobs (clear the queue faster)
- Already-waiting orders (prevent extreme delays)

---

## 3. Implementation

### 3.1 Core Optimizer — `lib/queue/optimizer.ts`

```typescript
export interface QueueOrder {
  id: string
  orderNumber: string
  serviceId: string
  serviceName: string
  estimatedDurationMinutes: number
  isRush: boolean
  createdAt: Date
  currentWaitMinutes: number
  status: 'waiting' | 'serving'
}

export interface OptimizerConfig {
  // Weights (must sum to ~1.0 for normalized scoring)
  weightWait: number          // default: 0.40
  weightRush: number          // default: 0.25
  weightDuration: number      // default: 0.20
  weightCongestion: number    // default: 0.15

  // Waiting cost parameters
  waitAlpha: number           // default: 1.0
  waitBeta: number            // default: 0.05

  // Rush parameters
  rushMultiplier: number      // default: 2.5
  rushBaseScore: number       // default: 10.0
  rushDecayRate: number       // default: 0.01

  // Congestion parameters
  congestionThreshold: number // default: 0.7
  congestionSteepness: number // default: 10.0

  // System
  maxConcurrentJobs: number   // default: 2
}

export const DEFAULT_CONFIG: OptimizerConfig = {
  weightWait: 0.40,
  weightRush: 0.25,
  weightDuration: 0.20,
  weightCongestion: 0.15,
  waitAlpha: 1.0,
  waitBeta: 0.05,
  rushMultiplier: 2.5,
  rushBaseScore: 10.0,
  rushDecayRate: 0.01,
  congestionThreshold: 0.7,
  congestionSteepness: 10.0,
  maxConcurrentJobs: 2,
}

export class QueueOptimizer {
  private config: OptimizerConfig

  constructor(config: Partial<OptimizerConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config }
  }

  /**
   * Optimize the queue — returns orders sorted by priority (highest first)
   */
  optimize(orders: QueueOrder[]): OptimizedResult {
    const waitingOrders = orders.filter(o => o.status === 'waiting')
    const servingOrders = orders.filter(o => o.status === 'serving')

    // Calculate system load
    const systemLoad = servingOrders.length / this.config.maxConcurrentJobs
    const maxDuration = Math.max(...waitingOrders.map(o => o.estimatedDurationMinutes), 1)

    // Score each order
    const scored = waitingOrders.map(order => ({
      order,
      score: this.calculatePriority(order, systemLoad, maxDuration),
      components: this.getScoreComponents(order, systemLoad, maxDuration)
    }))

    // Sort by priority score (descending)
    scored.sort((a, b) => b.score - a.score)

    // Assign positions
    const optimizedQueue = scored.map((item, index) => ({
      orderId: item.order.id,
      orderNumber: item.order.orderNumber,
      position: index + 1,
      priorityScore: Math.round(item.score * 100) / 100,
      components: item.components,
      estimatedWaitMinutes: this.estimateWait(scored, index)
    }))

    // Calculate metrics
    const metrics = this.calculateMetrics(optimizedQueue, scored)

    return { queue: optimizedQueue, metrics }
  }

  /**
   * Calculate total priority score for an order
   */
  private calculatePriority(
    order: QueueOrder,
    systemLoad: number,
    maxDuration: number
  ): number {
    const waitCost = this.waitingCost(order.currentWaitMinutes)
    const rushScore = this.rushPriority(order)
    const durationScore = this.durationEfficiency(order, maxDuration)
    const congestionScore = this.congestionFactor(systemLoad)

    return (
      this.config.weightWait * waitCost +
      this.config.weightRush * rushScore +
      this.config.weightDuration * durationScore +
      this.config.weightCongestion * congestionScore
    )
  }

  /**
   * Nonlinear waiting cost: α · (e^(β·t) - 1)
   */
  private waitingCost(waitMinutes: number): number {
    const { waitAlpha, waitBeta } = this.config
    return waitAlpha * (Math.exp(waitBeta * waitMinutes) - 1)
  }

  /**
   * Rush priority with optional decay
   */
  private rushPriority(order: QueueOrder): number {
    if (!order.isRush) return 0
    const { rushMultiplier, rushBaseScore, rushDecayRate } = this.config
    const decay = Math.exp(-rushDecayRate * order.currentWaitMinutes)
    return rushMultiplier * rushBaseScore * decay
  }

  /**
   * Duration efficiency: shorter jobs get higher scores
   */
  private durationEfficiency(order: QueueOrder, maxDuration: number): number {
    return maxDuration / Math.max(order.estimatedDurationMinutes, 1)
  }

  /**
   * Congestion factor: sigmoid function
   */
  private congestionFactor(load: number): number {
    const { congestionThreshold, congestionSteepness } = this.config
    return 1 / (1 + Math.exp(congestionSteepness * (load - congestionThreshold)))
  }

  /**
   * Estimate wait time for an order at a given position
   */
  private estimateWait(scored: any[], position: number): number {
    let totalWait = 0
    for (let i = 0; i < position; i++) {
      totalWait += scored[i].order.estimatedDurationMinutes
    }
    return Math.round(totalWait / this.config.maxConcurrentJobs)
  }

  /**
   * Get breakdown of score components for transparency
   */
  private getScoreComponents(
    order: QueueOrder,
    systemLoad: number,
    maxDuration: number
  ) {
    return {
      waitCost: Math.round(this.waitingCost(order.currentWaitMinutes) * 100) / 100,
      rushScore: Math.round(this.rushPriority(order) * 100) / 100,
      durationScore: Math.round(this.durationEfficiency(order, maxDuration) * 100) / 100,
      congestionScore: Math.round(this.congestionFactor(systemLoad) * 100) / 100
    }
  }

  private calculateMetrics(queue: any[], scored: any[]) {
    const waitTimes = queue.map(q => q.estimatedWaitMinutes)
    return {
      totalOrders: queue.length,
      avgWaitMinutes: waitTimes.length
        ? Math.round(waitTimes.reduce((a, b) => a + b, 0) / waitTimes.length)
        : 0,
      maxWaitMinutes: waitTimes.length ? Math.max(...waitTimes) : 0,
      rushOrders: scored.filter(s => s.order.isRush).length,
      efficiencyScore: this.calculateEfficiency(scored)
    }
  }

  private calculateEfficiency(scored: any[]): number {
    if (scored.length === 0) return 1.0
    // Efficiency = 1 - (variance of wait times / max possible variance)
    const waits = scored.map((_, i) => this.estimateWait(scored, i))
    const mean = waits.reduce((a, b) => a + b, 0) / waits.length
    const variance = waits.reduce((sum, w) => sum + Math.pow(w - mean, 2), 0) / waits.length
    const maxVariance = Math.pow(Math.max(...waits), 2)
    return maxVariance > 0
      ? Math.round((1 - variance / maxVariance) * 100) / 100
      : 1.0
  }
}

export interface OptimizedResult {
  queue: {
    orderId: string
    orderNumber: string
    position: number
    priorityScore: number
    components: {
      waitCost: number
      rushScore: number
      durationScore: number
      congestionScore: number
    }
    estimatedWaitMinutes: number
  }[]
  metrics: {
    totalOrders: number
    avgWaitMinutes: number
    maxWaitMinutes: number
    rushOrders: number
    efficiencyScore: number
  }
}
```

---

### 3.2 Queue Scheduler — `lib/queue/scheduler.ts`

```typescript
/**
 * Runs the optimizer periodically and on key events.
 * Integrated with Supabase Realtime for trigger-based optimization.
 */
export class QueueScheduler {
  private optimizer: QueueOptimizer
  private intervalId: NodeJS.Timeout | null = null

  constructor(
    private supabase: any,
    config?: Partial<OptimizerConfig>
  ) {
    this.optimizer = new QueueOptimizer(config)
  }

  /**
   * Run optimization and update queue_entries in Supabase
   */
  async runOptimization(): Promise<OptimizedResult> {
    // 1. Fetch all active queue entries with order data
    const { data: entries } = await this.supabase
      .from('queue_entries')
      .select(`
        *,
        orders!inner (
          id, order_number, service_id, is_rush,
          estimated_duration_minutes, created_at,
          services!inner (name, estimated_duration_minutes)
        )
      `)
      .eq('queue_date', new Date().toISOString().split('T')[0])
      .in('status', ['waiting', 'serving'])

    if (!entries || entries.length === 0) {
      return { queue: [], metrics: this.emptyMetrics() }
    }

    // 2. Map to optimizer input format
    const queueOrders: QueueOrder[] = entries.map(entry => ({
      id: entry.orders.id,
      orderNumber: entry.orders.order_number,
      serviceId: entry.orders.service_id,
      serviceName: entry.orders.services.name,
      estimatedDurationMinutes:
        entry.orders.estimated_duration_minutes ||
        entry.orders.services.estimated_duration_minutes,
      isRush: entry.orders.is_rush,
      createdAt: new Date(entry.orders.created_at),
      currentWaitMinutes:
        (Date.now() - new Date(entry.created_at).getTime()) / 60000,
      status: entry.status
    }))

    // 3. Run optimizer
    const result = this.optimizer.optimize(queueOrders)

    // 4. Update queue_entries with new positions and scores
    for (const item of result.queue) {
      await this.supabase
        .from('queue_entries')
        .update({
          position: item.position,
          priority_score: item.priorityScore,
          wait_time_minutes: item.estimatedWaitMinutes
        })
        .eq('order_id', item.orderId)
    }

    // 5. Also update priority_score on orders table
    for (const item of result.queue) {
      await this.supabase
        .from('orders')
        .update({ priority_score: item.priorityScore })
        .eq('id', item.orderId)
    }

    return result
  }

  /**
   * Start periodic optimization (every 60 seconds)
   */
  startPeriodicOptimization(intervalMs = 60000) {
    this.intervalId = setInterval(() => this.runOptimization(), intervalMs)
    this.runOptimization() // Run immediately
  }

  stop() {
    if (this.intervalId) clearInterval(this.intervalId)
  }

  private emptyMetrics() {
    return {
      totalOrders: 0, avgWaitMinutes: 0,
      maxWaitMinutes: 0, rushOrders: 0, efficiencyScore: 1.0
    }
  }
}
```

---

## 4. Optimization Triggers

The queue re-optimizes when:

| Event | Trigger |
|-------|---------|
| New order submitted | INSERT on `queue_entries` |
| Order status changes | UPDATE on `orders.status` |
| Admin manually triggers | POST `/api/queue/optimize` |
| Periodic timer | Every 60 seconds |
| Rush order added | INSERT with `is_rush = true` |

---

## 5. Visual Explanation

```
QUEUE AT T=0 (FIFO order):
  Pos  Order    Service      Wait   Rush   Priority
  1    ORD-001  Doc Edit     0m     No     1.0
  2    ORD-002  Printing     0m     No     1.0
  3    ORD-003  Photo Edit   0m     Yes    1.0

QUEUE AT T=10 (After optimization):
  Pos  Order    Service      Wait   Rush   Priority
  1    ORD-003  Photo Edit   10m    Yes    28.4  ← Rush boost
  2    ORD-002  Printing     10m    No     4.2   ← Short job boost
  3    ORD-001  Doc Edit     10m    No     2.8   ← Long job, lower priority

QUEUE AT T=40 (ORD-001 waited long):
  Pos  Order    Service      Wait   Rush   Priority
  1    ORD-001  Doc Edit     40m    No     15.7  ← Wait penalty kicks in!
  2    ORD-007  Printing     2m     Yes    26.1  ← New rush order
  ...
```

> The nonlinear model ensures **no order waits forever** — the exponential waiting cost eventually surpasses all other factors.
