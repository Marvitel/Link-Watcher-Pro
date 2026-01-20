import os from "os";

interface MetricCounter {
  total: number;
  success: number;
  errors: number;
  lastExecutionMs: number;
  avgExecutionMs: number;
  executionCount: number;
}

interface SystemMetrics {
  startTime: Date;
  counters: {
    snmpQueries: MetricCounter;
    icmpPings: MetricCounter;
    dbQueries: MetricCounter;
    apiRequests: MetricCounter;
    blacklistChecks: MetricCounter;
    opticalSignalQueries: MetricCounter;
    wanguardQueries: MetricCounter;
    monitoringCycles: MetricCounter;
  };
  currentLoad: {
    activeMonitoringTasks: number;
    pendingDbWrites: number;
    queuedAlerts: number;
  };
  errors: {
    recent: Array<{ timestamp: Date; type: string; message: string; count: number }>;
    totalCount: number;
  };
}

const metrics: SystemMetrics = {
  startTime: new Date(),
  counters: {
    snmpQueries: createEmptyCounter(),
    icmpPings: createEmptyCounter(),
    dbQueries: createEmptyCounter(),
    apiRequests: createEmptyCounter(),
    blacklistChecks: createEmptyCounter(),
    opticalSignalQueries: createEmptyCounter(),
    wanguardQueries: createEmptyCounter(),
    monitoringCycles: createEmptyCounter(),
  },
  currentLoad: {
    activeMonitoringTasks: 0,
    pendingDbWrites: 0,
    queuedAlerts: 0,
  },
  errors: {
    recent: [],
    totalCount: 0,
  },
};

function createEmptyCounter(): MetricCounter {
  return {
    total: 0,
    success: 0,
    errors: 0,
    lastExecutionMs: 0,
    avgExecutionMs: 0,
    executionCount: 0,
  };
}

export function incrementCounter(
  counterName: keyof typeof metrics.counters,
  success: boolean,
  executionTimeMs?: number
): void {
  const counter = metrics.counters[counterName];
  counter.total++;
  if (success) {
    counter.success++;
  } else {
    counter.errors++;
  }
  if (executionTimeMs !== undefined) {
    counter.lastExecutionMs = executionTimeMs;
    counter.executionCount++;
    counter.avgExecutionMs =
      (counter.avgExecutionMs * (counter.executionCount - 1) + executionTimeMs) /
      counter.executionCount;
  }
}

export function setCurrentLoad(
  key: keyof typeof metrics.currentLoad,
  value: number
): void {
  metrics.currentLoad[key] = value;
}

export function recordError(type: string, message: string): void {
  metrics.errors.totalCount++;
  const existing = metrics.errors.recent.find(
    (e) => e.type === type && e.message === message
  );
  if (existing) {
    existing.count++;
    existing.timestamp = new Date();
  } else {
    metrics.errors.recent.unshift({
      timestamp: new Date(),
      type,
      message,
      count: 1,
    });
    if (metrics.errors.recent.length > 50) {
      metrics.errors.recent.pop();
    }
  }
}

export function getServerStatus(): {
  uptime: number;
  uptimeFormatted: string;
  memory: {
    total: number;
    used: number;
    free: number;
    usagePercent: number;
    heapUsed: number;
    heapTotal: number;
    external: number;
    rss: number;
  };
  cpu: {
    cores: number;
    model: string;
    loadAvg: number[];
    usagePercent: number;
  };
  process: {
    pid: number;
    nodeVersion: string;
    platform: string;
    arch: string;
  };
} {
  const uptimeSeconds = Math.floor((Date.now() - metrics.startTime.getTime()) / 1000);
  const memUsage = process.memoryUsage();
  const totalMem = os.totalmem();
  const freeMem = os.freemem();
  const usedMem = totalMem - freeMem;
  const cpus = os.cpus();
  const loadAvg = os.loadavg();

  const days = Math.floor(uptimeSeconds / 86400);
  const hours = Math.floor((uptimeSeconds % 86400) / 3600);
  const minutes = Math.floor((uptimeSeconds % 3600) / 60);
  const seconds = uptimeSeconds % 60;
  const uptimeFormatted = `${days}d ${hours}h ${minutes}m ${seconds}s`;

  return {
    uptime: uptimeSeconds,
    uptimeFormatted,
    memory: {
      total: totalMem,
      used: usedMem,
      free: freeMem,
      usagePercent: Math.round((usedMem / totalMem) * 100),
      heapUsed: memUsage.heapUsed,
      heapTotal: memUsage.heapTotal,
      external: memUsage.external,
      rss: memUsage.rss,
    },
    cpu: {
      cores: cpus.length,
      model: cpus[0]?.model || "Unknown",
      loadAvg,
      usagePercent: Math.round(loadAvg[0] * 100 / cpus.length),
    },
    process: {
      pid: process.pid,
      nodeVersion: process.version,
      platform: process.platform,
      arch: process.arch,
    },
  };
}

export function getMetrics(): SystemMetrics {
  return { ...metrics };
}

export function getMetricsSummary(): {
  startTime: Date;
  uptimeSeconds: number;
  counters: typeof metrics.counters;
  currentLoad: typeof metrics.currentLoad;
  errorCount: number;
  recentErrors: typeof metrics.errors.recent;
} {
  return {
    startTime: metrics.startTime,
    uptimeSeconds: Math.floor((Date.now() - metrics.startTime.getTime()) / 1000),
    counters: { ...metrics.counters },
    currentLoad: { ...metrics.currentLoad },
    errorCount: metrics.errors.totalCount,
    recentErrors: metrics.errors.recent.slice(0, 10),
  };
}

export function resetMetrics(): void {
  metrics.startTime = new Date();
  Object.keys(metrics.counters).forEach((key) => {
    metrics.counters[key as keyof typeof metrics.counters] = createEmptyCounter();
  });
  metrics.currentLoad = {
    activeMonitoringTasks: 0,
    pendingDbWrites: 0,
    queuedAlerts: 0,
  };
  metrics.errors = {
    recent: [],
    totalCount: 0,
  };
}

export async function measureExecution<T>(
  counterName: keyof typeof metrics.counters,
  fn: () => Promise<T>
): Promise<T> {
  const start = Date.now();
  try {
    const result = await fn();
    incrementCounter(counterName, true, Date.now() - start);
    return result;
  } catch (error) {
    incrementCounter(counterName, false, Date.now() - start);
    throw error;
  }
}
