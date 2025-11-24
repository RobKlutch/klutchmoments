/**
 * Aggressive Log Throttling System
 * 
 * Prevents console log flooding that causes app freezes and white screens.
 * 
 * Features:
 * - Rate limiting: Max 1 log/second per channel
 * - Sampling: Only logs 1 in N messages
 * - Rolling buffer: Keeps last 100 entries in memory
 * - Remote sink: Mirrors critical events to server
 */

interface LogEntry {
  timestamp: number;
  channel: string;
  level: 'debug' | 'info' | 'warn' | 'error';
  message: string;
  data?: any;
}

interface ThrottleConfig {
  enabled: boolean;
  rateLimit: number; // Max logs per second
  sampleRate: number; // 1 in N messages (e.g., 10 = 1 in 10)
  bufferSize: number;
  remoteSink: boolean;
  mutedChannels: string[]; // Channels to completely silence
}

class LogThrottler {
  private config: ThrottleConfig = {
    enabled: true,
    rateLimit: 1, // 1 log/second max
    sampleRate: 10, // Log 1 in 10 messages
    bufferSize: 100,
    remoteSink: false, // Disabled by default to avoid network spam
    mutedChannels: []
  };

  private buffer: LogEntry[] = [];
  private lastLogTime: Map<string, number> = new Map();
  private sampleCounters: Map<string, number> = new Map();
  private droppedCounts: Map<string, number> = new Map();

  configure(newConfig: Partial<ThrottleConfig>) {
    this.config = { ...this.config, ...newConfig };
  }

  /**
   * Log a message with throttling applied
   */
  log(channel: string, level: 'debug' | 'info' | 'warn' | 'error', message: string, data?: any) {
    if (!this.config.enabled) {
      this.logDirect(level, message, data);
      return;
    }

    // Muted channels are completely silenced
    if (this.config.mutedChannels.includes(channel)) {
      this.incrementDropped(channel);
      return;
    }

    // Sample check: only log 1 in N messages
    if (!this.shouldSample(channel)) {
      this.incrementDropped(channel);
      return;
    }

    // Rate limit check: max 1 log/second per channel
    if (!this.shouldLog(channel)) {
      this.incrementDropped(channel);
      return;
    }

    // Passed all gates - log it
    const entry: LogEntry = {
      timestamp: Date.now(),
      channel,
      level,
      message,
      data
    };

    this.addToBuffer(entry);
    this.logDirect(level, `[${channel}] ${message}`, data);

    // Remote sink for critical events
    if (this.config.remoteSink && (level === 'error' || level === 'warn')) {
      this.sendToRemote(entry).catch(() => {}); // Silent fail
    }
  }

  /**
   * Check if we should sample this log (1 in N)
   */
  private shouldSample(channel: string): boolean {
    const counter = (this.sampleCounters.get(channel) || 0) + 1;
    this.sampleCounters.set(channel, counter);

    // Log every Nth message
    if (counter >= this.config.sampleRate) {
      this.sampleCounters.set(channel, 0);
      return true;
    }

    return false;
  }

  /**
   * Check if we should log based on rate limit
   */
  private shouldLog(channel: string): boolean {
    const now = Date.now();
    const lastTime = this.lastLogTime.get(channel) || 0;
    const elapsed = (now - lastTime) / 1000; // Convert to seconds

    // Check if enough time has passed (inverse of rate limit)
    if (elapsed >= (1 / this.config.rateLimit)) {
      this.lastLogTime.set(channel, now);
      return true;
    }

    return false;
  }

  /**
   * Add log to rolling buffer
   */
  private addToBuffer(entry: LogEntry) {
    this.buffer.push(entry);

    // Keep buffer size limited
    if (this.buffer.length > this.config.bufferSize) {
      this.buffer.shift(); // Remove oldest entry
    }
  }

  /**
   * Increment dropped log counter
   */
  private incrementDropped(channel: string) {
    const count = this.droppedCounts.get(channel) || 0;
    this.droppedCounts.set(channel, count + 1);
  }

  /**
   * Get dropped log statistics
   */
  getDroppedStats(): Record<string, number> {
    const stats: Record<string, number> = {};
    this.droppedCounts.forEach((count, channel) => {
      stats[channel] = count;
    });
    return stats;
  }

  /**
   * Get buffer contents (for debugging or crash dumps)
   */
  getBuffer(): LogEntry[] {
    return [...this.buffer];
  }

  /**
   * Clear buffer and reset counters
   */
  reset() {
    this.buffer = [];
    this.lastLogTime.clear();
    this.sampleCounters.clear();
    this.droppedCounts.clear();
  }

  /**
   * Direct console logging (bypasses throttling)
   */
  private logDirect(level: 'debug' | 'info' | 'warn' | 'error', message: string, data?: any) {
    if (data !== undefined) {
      console[level](message, data);
    } else {
      console[level](message);
    }
  }

  /**
   * Send critical event to remote logging endpoint
   */
  private async sendToRemote(entry: LogEntry): Promise<void> {
    try {
      await fetch('/api/logs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ logs: [entry] })
      });
    } catch (error) {
      // Silent fail - don't log errors about logging
    }
  }

  /**
   * Mute specific channels to completely silence them
   */
  mute(channels: string[]) {
    this.config.mutedChannels = [...this.config.mutedChannels, ...channels];
  }

  /**
   * Unmute channels
   */
  unmute(channels: string[]) {
    this.config.mutedChannels = this.config.mutedChannels.filter(c => !channels.includes(c));
  }

  /**
   * Enable/disable throttling globally
   */
  setEnabled(enabled: boolean) {
    this.config.enabled = enabled;
  }
}

// Global singleton instance
export const logThrottler = new LogThrottler();

// Configure for Video Preview to prevent freezing
logThrottler.configure({
  enabled: true,
  rateLimit: 1, // Max 1 log/second per channel
  sampleRate: 30, // Log 1 in 30 messages (RAF runs at 30fps, so 1 log/second)
  bufferSize: 100,
  remoteSink: false, // Don't spam server
  mutedChannels: [
    'bbox-calculation', // Mute bounding box calculations (too verbose)
    'coordinate-transform', // Mute coordinate transforms
    'session-persistence' // Mute session storage persistence
  ]
});

// Convenience functions
export function throttledLog(channel: string, message: string, data?: any) {
  logThrottler.log(channel, 'info', message, data);
}

export function throttledDebug(channel: string, message: string, data?: any) {
  logThrottler.log(channel, 'debug', message, data);
}

export function throttledWarn(channel: string, message: string, data?: any) {
  logThrottler.log(channel, 'warn', message, data);
}

export function throttledError(channel: string, message: string, data?: any) {
  logThrottler.log(channel, 'error', message, data);
}
