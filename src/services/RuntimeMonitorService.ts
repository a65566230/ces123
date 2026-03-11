import { monitorEventLoopDelay } from 'perf_hooks';

export interface RuntimeMonitorStats {
  memory: NodeJS.MemoryUsage;
  eventLoop: {
    min: number;
    max: number;
    mean: number;
    stddev: number;
  };
  sampledAt: string;
}

export class RuntimeMonitorService {
  private readonly histogram = monitorEventLoopDelay({ resolution: 20 });
  private started = false;

  public async start(): Promise<void> {
    if (this.started) {
      return;
    }
    this.histogram.enable();
    this.started = true;
  }

  public getStats(): RuntimeMonitorStats {
    if (!this.started) {
      this.histogram.enable();
      this.started = true;
    }

    return {
      memory: process.memoryUsage(),
      eventLoop: {
        min: Number(this.histogram.min || 0),
        max: Number(this.histogram.max || 0),
        mean: Number(this.histogram.mean || 0),
        stddev: Number(this.histogram.stddev || 0),
      },
      sampledAt: new Date().toISOString(),
    };
  }

  public async close(): Promise<void> {
    if (!this.started) {
      return;
    }
    this.histogram.disable();
    this.started = false;
  }
}
