import { useEffect, useRef } from 'react';
import { useDevLogger } from './useDevLogger';

interface DetectionSchedulerOptions {
  enabled: boolean;
  intervalMs?: number;
  playerId: string | null;
  videoRef: React.RefObject<HTMLVideoElement>;
  onDetection: (playerId: string, currentTime: number, videoElement: HTMLVideoElement) => Promise<void>;
}

/**
 * Clean 1Hz detection scheduler
 * Only runs when playback is active, prevents concurrent detections
 */
export function useDetectionScheduler(options: DetectionSchedulerOptions) {
  const { enabled, intervalMs = 1000, playerId, videoRef, onDetection } = options;
  const logger = useDevLogger('DetectionScheduler');
  
  const intervalRef = useRef<NodeJS.Timeout | null>(null);
  const inFlightRef = useRef<boolean>(false);

  useEffect(() => {
    // Clear any existing interval
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }

    // Only start if enabled and we have a player
    if (!enabled || !playerId) {
      logger.log('Scheduler disabled', { enabled, hasPlayerId: !!playerId });
      return;
    }

    const video = videoRef.current;
    if (!video) {
      logger.warn('Cannot start scheduler: no video element');
      return;
    }

    logger.log('Starting detection scheduler', { playerId, intervalMs });

    intervalRef.current = setInterval(async () => {
      if (inFlightRef.current) {
        logger.sampled('Skipping detection: request in flight', undefined, 10);
        return;
      }

      const currentVideo = videoRef.current;
      if (!currentVideo || currentVideo.paused) {
        return;
      }

      inFlightRef.current = true;
      try {
        await onDetection(playerId, currentVideo.currentTime, currentVideo);
        logger.throttled('Detection completed', { 
          playerId, 
          time: currentVideo.currentTime.toFixed(2) 
        }, 2000);
      } catch (error) {
        logger.error('Detection failed', error);
      } finally {
        inFlightRef.current = false;
      }
    }, intervalMs);

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
      inFlightRef.current = false;
      logger.log('Scheduler stopped');
    };
  }, [enabled, intervalMs, playerId, videoRef, onDetection, logger]);
}
