/**
 * RESILIENT STAGE LOGGER
 * 
 * Production-grade logging system that survives UI crashes and React errors.
 * Guarantees log visibility through memory buffer, console output, and remote sink.
 */

interface LogEntry {
  timestamp: number;
  level: 'info' | 'warn' | 'error' | 'debug';
  stage: string;
  message: string;
  data?: any;
  stack?: string;
}

class StageLogger {
  private buffer: LogEntry[] = [];
  private readonly MAX_BUFFER_SIZE = 200;
  private readonly REMOTE_ENDPOINT = '/api/logs';
  private readonly FLUSH_INTERVAL_MS = 5000;
  private flushTimer: number | null = null;
  private stageName: string;

  constructor(stageName: string) {
    this.stageName = stageName;
    this.info('StageLogger initialized', { stageName });
    
    // Start periodic flush
    this.startPeriodicFlush();
    
    // Flush on page unload
    if (typeof window !== 'undefined') {
      window.addEventListener('beforeunload', () => this.flush());
    }
  }

  private addToBuffer(entry: LogEntry) {
    this.buffer.push(entry);
    
    // Trim buffer if too large
    if (this.buffer.length > this.MAX_BUFFER_SIZE) {
      this.buffer = this.buffer.slice(-this.MAX_BUFFER_SIZE);
    }
  }

  private formatMessage(level: string, message: string, data?: any): string {
    const timestamp = new Date().toISOString();
    const dataStr = data ? ` | ${JSON.stringify(data)}` : '';
    return `[${timestamp}] [${this.stageName}] [${level.toUpperCase()}] ${message}${dataStr}`;
  }

  private async sendToRemote(entries: LogEntry[]) {
    try {
      await fetch(this.REMOTE_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ entries }),
        keepalive: true // Ensures request completes even if page unloads
      });
    } catch (error) {
      // Silent fail for remote logging - don't break the app
      console.warn('[StageLogger] Remote logging failed:', error);
    }
  }

  private startPeriodicFlush() {
    if (typeof window === 'undefined') return;
    
    this.flushTimer = window.setInterval(() => {
      if (this.buffer.length > 0) {
        this.flush();
      }
    }, this.FLUSH_INTERVAL_MS);
  }

  public info(message: string, data?: any) {
    const entry: LogEntry = {
      timestamp: Date.now(),
      level: 'info',
      stage: this.stageName,
      message,
      data
    };
    
    this.addToBuffer(entry);
    console.log(this.formatMessage('info', message, data));
  }

  public warn(message: string, data?: any) {
    const entry: LogEntry = {
      timestamp: Date.now(),
      level: 'warn',
      stage: this.stageName,
      message,
      data
    };
    
    this.addToBuffer(entry);
    console.warn(this.formatMessage('warn', message, data));
  }

  public error(message: string, error?: Error | any, data?: any) {
    const entry: LogEntry = {
      timestamp: Date.now(),
      level: 'error',
      stage: this.stageName,
      message,
      data,
      stack: error?.stack || new Error().stack
    };
    
    this.addToBuffer(entry);
    console.error(this.formatMessage('error', message, data), error);
  }

  public debug(message: string, data?: any) {
    const entry: LogEntry = {
      timestamp: Date.now(),
      level: 'debug',
      stage: this.stageName,
      message,
      data
    };
    
    this.addToBuffer(entry);
    
    // Only log debug in development
    if (import.meta.env.DEV) {
      console.debug(this.formatMessage('debug', message, data));
    }
  }

  public flush() {
    if (this.buffer.length === 0) return;
    
    const entriesToFlush = [...this.buffer];
    
    // Send to remote endpoint (non-blocking)
    this.sendToRemote(entriesToFlush).catch(console.warn);
    
    // Clear buffer after flush
    this.buffer = [];
  }

  public getBuffer(): LogEntry[] {
    return [...this.buffer];
  }

  public destroy() {
    this.flush();
    
    if (this.flushTimer !== null) {
      clearInterval(this.flushTimer);
      this.flushTimer = null;
    }
  }
}

// Global logger registry
const loggers = new Map<string, StageLogger>();

export function getLogger(stageName: string): StageLogger {
  if (!loggers.has(stageName)) {
    loggers.set(stageName, new StageLogger(stageName));
  }
  return loggers.get(stageName)!;
}

export function destroyLogger(stageName: string) {
  const logger = loggers.get(stageName);
  if (logger) {
    logger.destroy();
    loggers.delete(stageName);
  }
}

export function flushAllLoggers() {
  loggers.forEach(logger => logger.flush());
}

export type { LogEntry, StageLogger };
