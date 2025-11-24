import { useRef, useCallback, useMemo } from 'react';

interface LogOptions {
  level?: 'log' | 'warn' | 'error' | 'info';
  throttle?: number; // ms between logs for same key
  sample?: number; // only log every Nth call
}

const isDevelopment = import.meta.env.DEV;

/**
 * Development-only logger with throttling and sampling
 * Prevents log flooding in production and high-frequency scenarios
 */
export function useDevLogger(componentName: string) {
  const throttleTimers = useRef<Map<string, number>>(new Map());
  const sampleCounters = useRef<Map<string, number>>(new Map());

  const log = useCallback((message: string, data?: any, options: LogOptions = {}) => {
    if (!isDevelopment) return;

    const { level = 'log', throttle, sample } = options;
    const key = `${componentName}:${message}`;

    // Sample check: only log every Nth call
    if (sample) {
      const count = (sampleCounters.current.get(key) || 0) + 1;
      sampleCounters.current.set(key, count);
      if (count % sample !== 0) return;
    }

    // Throttle check: prevent logging more than once per throttle period
    if (throttle) {
      const now = Date.now();
      const lastLog = throttleTimers.current.get(key);
      if (lastLog && now - lastLog < throttle) return;
      throttleTimers.current.set(key, now);
    }

    const prefix = `[${componentName}]`;
    if (data !== undefined) {
      console[level](prefix, message, data);
    } else {
      console[level](prefix, message);
    }
  }, [componentName]);

  // **CRITICAL FIX**: Memoize the returned object to prevent infinite remounting
  // Without this, every component using useDevLogger gets a new logger object on every render,
  // causing useMemo/useCallback deps to change and triggering remounts
  return useMemo(() => ({
    log: (msg: string, data?: any) => log(msg, data, { level: 'log' }),
    warn: (msg: string, data?: any) => log(msg, data, { level: 'warn' }),
    error: (msg: string, data?: any) => log(msg, data, { level: 'error' }),
    info: (msg: string, data?: any) => log(msg, data, { level: 'info' }),
    throttled: (msg: string, data?: any, throttleMs: number = 1000) => 
      log(msg, data, { level: 'log', throttle: throttleMs }),
    sampled: (msg: string, data?: any, sampleRate: number = 10) => 
      log(msg, data, { level: 'log', sample: sampleRate }),
  }), [log]);
}
