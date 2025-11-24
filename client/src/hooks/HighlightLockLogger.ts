/**
 * HighlightLock Production Logger
 * 
 * Comprehensive logging and monitoring system for production debugging,
 * performance analysis, and system health monitoring.
 */

export interface LogMetrics {
  timestamp: number;
  component: string;
  event: string;
  data: Record<string, any>;
  level: 'debug' | 'info' | 'warn' | 'error' | 'critical';
}

export interface PerformanceMetrics {
  detectionLatency: number;
  updateFrequency: number;
  memoryUsage: number;
  trackingAccuracy: number;
  stateTransitions: number;
}

export interface SystemHealth {
  lockState: string;
  confidence: number;
  detectionGaps: number;
  lastUpdateAge: number;
  errorCount: number;
  recoveryCount: number;
}

class HighlightLockLogger {
  private logs: LogMetrics[] = [];
  private maxLogs = 1000; // Keep last 1000 log entries
  private performanceBuffer: PerformanceMetrics[] = [];
  private errorBuffer: Array<{ error: Error; context: any; timestamp: number }> = [];
  
  // Performance tracking
  private lastDetectionTime = 0;
  private updateCount = 0;
  private stateTransitionCount = 0;
  private lastMemoryCheck = 0;
  
  // System health tracking
  private consecutiveErrors = 0;
  private lastKnownGoodState: any = null;
  private recoveryAttempts = 0;
  
  log(level: LogMetrics['level'], component: string, event: string, data: Record<string, any> = {}): void {
    const entry: LogMetrics = {
      timestamp: Date.now(),
      component,
      event,
      data: { ...data },
      level
    };
    
    this.logs.push(entry);
    
    // Maintain log size limit
    if (this.logs.length > this.maxLogs) {
      this.logs = this.logs.slice(-this.maxLogs);
    }
    
    // **PRODUCTION OPTIMIZATION**: Environment-based log level gating
    const isProduction = import.meta.env.NODE_ENV === 'production';
    const isDevelopment = import.meta.env.NODE_ENV === 'development';
    
    // Only log to console based on environment and level
    const shouldLogToConsole = 
      level === 'error' || level === 'critical' || // Always log errors
      (level === 'warn' && !isProduction) || // Warnings in dev/staging
      (level === 'info' && isDevelopment) || // Info only in development
      (level === 'debug' && isDevelopment && Math.random() < 0.1); // Sampled debug in dev only
    
    if (shouldLogToConsole) {
      const prefix = this.getLogPrefix(level, component);
      const formattedData = this.formatLogData(data);
      
      switch (level) {
        case 'debug':
          console.debug(prefix, event, formattedData);
          break;
        case 'info':
          console.log(prefix, event, formattedData);
          break;
        case 'warn':
          console.warn(prefix, event, formattedData);
          break;
        case 'error':
        case 'critical':
          console.error(prefix, event, formattedData);
          this.handleError(event, data);
          break;
      }
    }
  }
  
  /**
   * Log state transitions with detailed context
   */
  logStateTransition(masterId: string, oldState: string, newState: string, context: any): void {
    this.stateTransitionCount++;
    
    this.log('info', 'HighlightLock', 'STATE_TRANSITION', {
      masterId,
      oldState,
      newState,
      transitionCount: this.stateTransitionCount,
      context: {
        confidence: context.confidence?.toFixed(3),
        timeSinceLastDetection: context.timeSinceLastDetection,
        detectionCount: context.detectionCount,
        byteTrackId: context.byteTrackId
      }
    });
    
    // Track critical state transitions
    if (newState === 'lost' || newState === 'reacquiring') {
      this.log('warn', 'HighlightLock', 'CRITICAL_STATE_CHANGE', {
        masterId,
        newState,
        consecutiveTransitions: this.stateTransitionCount,
        possibleCause: this.diagnosePossibleCause(context)
      });
    }
  }
  
  /**
   * Log detection processing performance
   */
  logDetectionProcessing(detectionCount: number, processingTime: number, matchResults: any): void {
    const now = Date.now();
    this.updateCount++;
    
    // Calculate detection frequency
    const detectionLatency = this.lastDetectionTime > 0 ? now - this.lastDetectionTime : 0;
    this.lastDetectionTime = now;
    
    this.log('debug', 'HighlightLock', 'DETECTION_PROCESSING', {
      detectionCount,
      processingTime: `${processingTime.toFixed(2)}ms`,
      detectionLatency: `${detectionLatency}ms`,
      updateCount: this.updateCount,
      matchResults: {
        bestScore: matchResults.bestScore?.toFixed(3),
        hasMatch: matchResults.hasMatch,
        candidateSwitch: matchResults.candidateSwitch,
        hysteresisActive: matchResults.hysteresisActive
      }
    });
    
    // Track performance metrics
    const metrics: PerformanceMetrics = {
      detectionLatency,
      updateFrequency: this.calculateUpdateFrequency(),
      memoryUsage: this.estimateMemoryUsage(),
      trackingAccuracy: matchResults.bestScore || 0,
      stateTransitions: this.stateTransitionCount
    };
    
    this.performanceBuffer.push(metrics);
    if (this.performanceBuffer.length > 100) {
      this.performanceBuffer = this.performanceBuffer.slice(-100);
    }
    
    // Performance alerts
    if (detectionLatency > 500) { // > 500ms gap
      this.log('warn', 'HighlightLock', 'HIGH_DETECTION_LATENCY', {
        latency: detectionLatency,
        threshold: 500,
        possibleCauses: ['Network issues', 'CPU overload', 'Detection service lag']
      });
    }
    
    if (processingTime > 50) { // > 50ms processing
      this.log('warn', 'HighlightLock', 'HIGH_PROCESSING_TIME', {
        processingTime,
        threshold: 50,
        detectionCount,
        recommendation: 'Consider reducing detection frequency or optimizing algorithms'
      });
    }
  }
  
  /**
   * Log system health and recovery events
   */
  logSystemHealth(healthData: SystemHealth): void {
    const isHealthy = this.assessSystemHealth(healthData);
    
    this.log(isHealthy ? 'info' : 'warn', 'HighlightLock', 'SYSTEM_HEALTH', {
      health: isHealthy ? 'HEALTHY' : 'DEGRADED',
      metrics: {
        lockState: healthData.lockState,
        confidence: healthData.confidence.toFixed(3),
        detectionGaps: healthData.detectionGaps,
        lastUpdateAge: `${healthData.lastUpdateAge}ms`,
        errorRate: `${healthData.errorCount}/${this.updateCount}`,
        recoveryAttempts: healthData.recoveryCount
      },
      recommendations: this.generateHealthRecommendations(healthData)
    });
    
    // Store last known good state for recovery
    if (isHealthy && healthData.confidence > 0.7) {
      this.lastKnownGoodState = { ...healthData, timestamp: Date.now() };
    }
  }
  
  /**
   * Log error and initiate recovery procedures
   */
  logError(error: Error, context: any): void {
    this.consecutiveErrors++;
    this.errorBuffer.push({ error, context, timestamp: Date.now() });
    
    this.log('error', 'HighlightLock', 'ERROR_OCCURRED', {
      errorMessage: error.message,
      errorStack: error.stack?.substring(0, 500), // Truncate stack trace
      consecutiveErrors: this.consecutiveErrors,
      context: this.sanitizeContext(context),
      recoveryAction: this.determineRecoveryAction()
    });
    
    // Cleanup old errors
    if (this.errorBuffer.length > 50) {
      this.errorBuffer = this.errorBuffer.slice(-50);
    }
    
    // Trigger recovery if too many consecutive errors
    if (this.consecutiveErrors >= 5) {
      this.initiateRecovery(context);
    }
  }
  
  /**
   * Log successful recovery
   */
  logRecovery(recoveryType: string, context: any): void {
    this.recoveryAttempts++;
    this.consecutiveErrors = 0; // Reset error count
    
    this.log('info', 'HighlightLock', 'RECOVERY_SUCCESSFUL', {
      recoveryType,
      recoveryAttempt: this.recoveryAttempts,
      context: this.sanitizeContext(context),
      previousErrors: this.errorBuffer.slice(-5).map(e => e.error.message)
    });
  }
  
  /**
   * Generate performance report
   */
  generatePerformanceReport(): any {
    if (this.performanceBuffer.length === 0) return null;
    
    const recent = this.performanceBuffer.slice(-20); // Last 20 measurements
    const avg = (arr: number[]) => arr.reduce((a, b) => a + b, 0) / arr.length;
    
    return {
      averageLatency: avg(recent.map(m => m.detectionLatency)).toFixed(2),
      averageUpdateFreq: avg(recent.map(m => m.updateFrequency)).toFixed(2),
      averageAccuracy: avg(recent.map(m => m.trackingAccuracy)).toFixed(3),
      totalUpdates: this.updateCount,
      totalTransitions: this.stateTransitionCount,
      errorRate: (this.errorBuffer.length / this.updateCount * 100).toFixed(2),
      systemUptime: Date.now() - (this.logs[0]?.timestamp || Date.now())
    };
  }
  
  /**
   * Export logs for debugging
   */
  exportLogs(filterLevel?: LogMetrics['level']): LogMetrics[] {
    if (!filterLevel) return [...this.logs];
    return this.logs.filter(log => log.level === filterLevel);
  }
  
  // Private helper methods
  
  private getLogPrefix(level: string, component: string): string {
    const icons = {
      debug: '🔍',
      info: '📋',
      warn: '⚠️',
      error: '❌',
      critical: '🚨'
    };
    
    return `${icons[level] || '📋'} ${component}:`;
  }
  
  private formatLogData(data: Record<string, any>): string {
    try {
      return Object.keys(data).length > 0 ? JSON.stringify(data, null, 2) : '';
    } catch {
      return '[Complex Object]';
    }
  }
  
  private handleError(event: string, data: any): void {
    // Custom error handling logic
    if (event.includes('CRITICAL') || event.includes('FAILURE')) {
      // Could send to external monitoring service
      console.error('🚨 CRITICAL ERROR in HighlightLock:', { event, data });
    }
  }
  
  private diagnosePossibleCause(context: any): string[] {
    const causes = [];
    
    if (context.timeSinceLastDetection > 2000) causes.push('Long detection gap');
    if (context.confidence < 0.3) causes.push('Low tracking confidence');
    if (context.detectionCount === 0) causes.push('No detections available');
    if (context.byteTrackId !== context.previousByteTrackId) causes.push('ByteTrack ID change');
    
    return causes.length > 0 ? causes : ['Unknown cause'];
  }
  
  private calculateUpdateFrequency(): number {
    if (this.updateCount < 2) return 0;
    const timeSpan = Date.now() - (this.logs[0]?.timestamp || Date.now());
    return (this.updateCount / timeSpan) * 1000; // Updates per second
  }
  
  private estimateMemoryUsage(): number {
    // Rough estimation based on tracked objects
    return this.logs.length * 200 + this.performanceBuffer.length * 100; // bytes
  }
  
  private assessSystemHealth(health: SystemHealth): boolean {
    return health.confidence > 0.5 && 
           health.lastUpdateAge < 1000 && 
           health.detectionGaps < 5 &&
           this.consecutiveErrors < 3;
  }
  
  private generateHealthRecommendations(health: SystemHealth): string[] {
    const recs = [];
    
    if (health.confidence < 0.5) recs.push('Improve detection quality or reduce noise');
    if (health.lastUpdateAge > 1000) recs.push('Check detection pipeline for delays');
    if (health.detectionGaps > 5) recs.push('Investigate frequent detection failures');
    if (this.consecutiveErrors > 0) recs.push('Review error patterns and fix root causes');
    
    return recs;
  }
  
  private determineRecoveryAction(): string {
    if (this.lastKnownGoodState) return 'Restore to last known good state';
    if (this.consecutiveErrors > 3) return 'Reset tracking system';
    return 'Monitor and retry';
  }
  
  private initiateRecovery(context: any): void {
    this.log('warn', 'HighlightLock', 'INITIATING_RECOVERY', {
      trigger: 'Consecutive errors exceeded threshold',
      errorCount: this.consecutiveErrors,
      lastGoodState: this.lastKnownGoodState ? 'Available' : 'None',
      context: this.sanitizeContext(context)
    });
  }
  
  private sanitizeContext(context: any): any {
    // Remove sensitive or large objects from context for logging
    if (!context) return {};
    
    const sanitized = { ...context };
    
    // Remove large objects that could bloat logs
    delete sanitized.detections;
    delete sanitized.fullVideoElement;
    delete sanitized.rawFrameData;
    
    return sanitized;
  }
}

// Singleton logger instance
export const highlightLockLogger = new HighlightLockLogger();

// Export convenience methods
export const logStateTransition = highlightLockLogger.logStateTransition.bind(highlightLockLogger);
export const logDetectionProcessing = highlightLockLogger.logDetectionProcessing.bind(highlightLockLogger);
export const logSystemHealth = highlightLockLogger.logSystemHealth.bind(highlightLockLogger);
export const logError = highlightLockLogger.logError.bind(highlightLockLogger);
export const logRecovery = highlightLockLogger.logRecovery.bind(highlightLockLogger);
export const generatePerformanceReport = highlightLockLogger.generatePerformanceReport.bind(highlightLockLogger);
export const exportLogs = highlightLockLogger.exportLogs.bind(highlightLockLogger);