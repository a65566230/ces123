export interface ToolRateLimiterOptions {
  maxCalls?: number;
  windowMs?: number;
}

export class ToolRateLimiter {
  private readonly maxCalls: number;
  private readonly windowMs: number;
  private readonly events = new Map<string, number[]>();

  public constructor(options: ToolRateLimiterOptions = {}) {
    this.maxCalls = options.maxCalls ?? 10;
    this.windowMs = options.windowMs ?? 1000;
  }

  public check(key: string): { allowed: boolean; remaining: number; resetInMs: number } {
    const now = Date.now();
    const cutoff = now - this.windowMs;
    const timestamps = (this.events.get(key) || []).filter((timestamp) => timestamp > cutoff);

    if (timestamps.length >= this.maxCalls) {
      this.events.set(key, timestamps);
      const oldest = timestamps[0] ?? now;
      return {
        allowed: false,
        remaining: 0,
        resetInMs: Math.max(0, this.windowMs - (now - oldest)),
      };
    }

    timestamps.push(now);
    this.events.set(key, timestamps);

    return {
      allowed: true,
      remaining: Math.max(0, this.maxCalls - timestamps.length),
      resetInMs: this.windowMs,
    };
  }

  public getStats(): { maxCalls: number; windowMs: number; trackedKeys: number } {
    return {
      maxCalls: this.maxCalls,
      windowMs: this.windowMs,
      trackedKeys: this.events.size,
    };
  }
}
