import { useState, useCallback, useRef, useEffect } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { apiRequest, queryClient } from '@/lib/queryClient';
import { useWebSocket, JobStatus, PreviewFrame } from './useWebSocket';

export interface JobConfig {
  startTime?: number;
  endTime?: number;
  playerSelection?: any;
  effectConfig?: any;
  templateId?: string;
  priority?: number;
}

export interface ProcessingPhase {
  id: string;
  name: string;
  description: string;
  icon: string;
  status: 'pending' | 'processing' | 'completed' | 'error';
  progress?: number;
}

export const PROCESSING_PHASES: ProcessingPhase[] = [
  {
    id: 'upload',
    name: 'Upload',
    description: 'Uploading and validating video file',
    icon: 'upload',
    status: 'pending'
  },
  {
    id: 'detection',
    name: 'Detection',
    description: 'AI detecting players and objects in video',
    icon: 'search',
    status: 'pending'
  },
  {
    id: 'tracking',
    name: 'Tracking',
    description: 'Tracking selected player throughout the clip',
    icon: 'target',
    status: 'pending'
  },
  {
    id: 'rendering',
    name: 'Rendering',
    description: 'Applying highlight effects and rendering video',
    icon: 'sparkles',
    status: 'pending'
  },
  {
    id: 'finalizing',
    name: 'Finalizing',
    description: 'Optimizing video for download and sharing',
    icon: 'check-circle',
    status: 'pending'
  },
  {
    id: 'complete',
    name: 'Complete',
    description: 'Video processing complete and ready for download',
    icon: 'download',
    status: 'pending'
  }
];

interface UseJobProcessingProps {
  onComplete?: (jobId: string, downloadUrl?: string) => void;
  onError?: (error: string) => void;
}

const JOB_STORAGE_KEY = 'klutch-processing-job';

export const useJobProcessing = ({ onComplete, onError }: UseJobProcessingProps = {}) => {
  const [currentJobId, setCurrentJobId] = useState<string | null>(() => {
    // Try to restore job ID from localStorage on initialization
    try {
      const savedJobData = localStorage.getItem(JOB_STORAGE_KEY);
      if (savedJobData) {
        const { jobId, timestamp } = JSON.parse(savedJobData);
        // Only restore if less than 24 hours old
        if (Date.now() - timestamp < 24 * 60 * 60 * 1000) {
          console.log('🔄 Restoring job from localStorage:', jobId);
          return jobId;
        } else {
          localStorage.removeItem(JOB_STORAGE_KEY);
        }
      }
    } catch (error) {
      console.error('❌ Failed to restore job from localStorage:', error);
      localStorage.removeItem(JOB_STORAGE_KEY);
    }
    return null;
  });
  
  const [phases, setPhases] = useState<ProcessingPhase[]>(PROCESSING_PHASES);
  const [currentPhaseIndex, setCurrentPhaseIndex] = useState(0);
  const [overallProgress, setOverallProgress] = useState(0);
  const [previewFrames, setPreviewFrames] = useState<PreviewFrame[]>([]);
  const [latestPreviewFrame, setLatestPreviewFrame] = useState<PreviewFrame | null>(null);
  const [downloadUrl, setDownloadUrl] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [retryCount, setRetryCount] = useState(0);
  const [isAutoRetrying, setIsAutoRetrying] = useState(false);
  const retryTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // WebSocket connection for real-time updates
  const { isConnected: isWebSocketConnected, connectionError } = useWebSocket({
    jobId: currentJobId,
    type: 'status',
    onStatusUpdate: handleStatusUpdate,
    onProgressUpdate: handleProgressUpdate,
    onPreviewFrame: handlePreviewFrame,
    onError: handleJobError,
    onCompleted: handleJobCompleted
  });

  // WebSocket connection for preview frames
  const { } = useWebSocket({
    jobId: currentJobId,
    type: 'preview',
    onPreviewFrame: handlePreviewFrame
  });

  // Query for job status (fallback when WebSocket is unavailable)
  const { data: jobStatus, isError: isJobError } = useQuery({
    queryKey: ['job', currentJobId],
    queryFn: async () => {
      if (!currentJobId) return null;
      const response = await fetch(`/api/jobs/${currentJobId}`, {
        credentials: 'include'
      });
      if (!response.ok) throw new Error('Failed to fetch job status');
      return response.json();
    },
    enabled: !!currentJobId && !isWebSocketConnected,
    refetchInterval: 2000, // Poll every 2 seconds when WebSocket is not connected
  });

  // Mutation for creating a new job
  const createJobMutation = useMutation({
    mutationFn: async ({ videoFile, config }: { videoFile: File; config: JobConfig }) => {
      const formData = new FormData();
      formData.append('video', videoFile);
      
      // Add config as JSON string
      formData.append('config', JSON.stringify(config));
      
      // Add idempotency key to prevent duplicate jobs
      const idempotencyKey = `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
      
      const response = await fetch('/api/jobs', {
        method: 'POST',
        headers: {
          'Idempotency-Key': idempotencyKey
        },
        body: formData,
        credentials: 'include'
      });
      
      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to create job');
      }
      
      return response.json();
    },
    onSuccess: (data) => {
      setCurrentJobId(data.id);
      setErrorMessage(null);
      setRetryCount(0);
      resetPhases();
      
      // Persist job ID to localStorage
      try {
        localStorage.setItem(JOB_STORAGE_KEY, JSON.stringify({
          jobId: data.id,
          timestamp: Date.now()
        }));
      } catch (error) {
        console.warn('⚠️ Failed to save job to localStorage:', error);
      }
      
      console.log('✅ Job created successfully:', data.id);
    },
    onError: (error: Error) => {
      const errorMsg = error.message || 'Failed to create processing job';
      setErrorMessage(errorMsg);
      onError?.(errorMsg);
      console.error('❌ Job creation failed:', error);
    }
  });

  // Mutation for retrying a failed job
  const retryJobMutation = useMutation({
    mutationFn: async (jobId: string) => {
      const response = await apiRequest('POST', `/api/jobs/${jobId}/retry`);
      return response.json();
    },
    onSuccess: () => {
      setRetryCount(prev => prev + 1);
      setErrorMessage(null);
      resetPhases();
      console.log('🔄 Job retry initiated');
    },
    onError: (error: Error) => {
      const errorMsg = error.message || 'Failed to retry job';
      setErrorMessage(errorMsg);
      onError?.(errorMsg);
    }
  });

  function handleStatusUpdate(status: JobStatus) {
    console.log('📊 Job status update:', status);
    setOverallProgress(status.progress);
    updatePhasesFromStatus(status.status, status.currentPhase, status.progress);
    
    if (status.errorMessage) {
      setErrorMessage(status.errorMessage);
    }
  }

  function handleProgressUpdate(progress: number, phase?: string) {
    console.log('📈 Progress update:', progress, phase);
    setOverallProgress(progress);
    if (phase) {
      updatePhasesFromStatus('processing', phase, progress);
    }
  }

  function handlePreviewFrame(frame: PreviewFrame) {
    console.log('🖼️ Preview frame received:', frame);
    setLatestPreviewFrame(frame);
    setPreviewFrames(prev => {
      const newFrames = [...prev, frame];
      // Keep only the last 10 frames to prevent memory issues
      return newFrames.slice(-10);
    });
  }

  function handleJobError(error: string) {
    console.error('❌ Job error:', error);
    setErrorMessage(error);
    setPhases(prev => prev.map(phase => 
      phase.status === 'processing' ? { ...phase, status: 'error' } : phase
    ));
    onError?.(error);
    
    // Trigger automatic retry with exponential backoff if we haven't exceeded max attempts
    if (retryCount < 3 && currentJobId) {
      triggerAutoRetry();
    }
  }

  function handleJobCompleted(downloadUrl?: string) {
    console.log('✅ Job completed:', downloadUrl);
    setOverallProgress(100);
    setDownloadUrl(downloadUrl || null);
    setPhases(prev => prev.map(phase => ({ ...phase, status: 'completed' })));
    
    // Clear job from localStorage when completed
    try {
      localStorage.removeItem(JOB_STORAGE_KEY);
    } catch (error) {
      console.warn('⚠️ Failed to clear job from localStorage:', error);
    }
    
    onComplete?.(currentJobId!, downloadUrl);
  }

  function updatePhasesFromStatus(status: string, currentPhase?: string, progress?: number) {
    const phaseMap: Record<string, number> = {
      'queued': 0,
      'preprocessing': 0,
      'detecting': 1,
      'tracking': 2,
      'rendering': 3,
      'finalizing': 4,
      'done': 5,
      'completed': 5
    };

    const activePhaseIndex = currentPhase ? phaseMap[currentPhase] ?? 0 : phaseMap[status] ?? 0;
    setCurrentPhaseIndex(activePhaseIndex);

    setPhases(prev => prev.map((phase, index) => {
      if (index < activePhaseIndex) {
        return { ...phase, status: 'completed' };
      } else if (index === activePhaseIndex) {
        return { 
          ...phase, 
          status: status === 'error' ? 'error' : 'processing',
          progress: progress ? Math.round((progress - (index * 16.67)) / 16.67 * 100) : undefined
        };
      } else {
        return { ...phase, status: 'pending' };
      }
    }));
  }

  function resetPhases() {
    setPhases(PROCESSING_PHASES.map(phase => ({ ...phase, status: 'pending' })));
    setCurrentPhaseIndex(0);
    setOverallProgress(0);
    setPreviewFrames([]);
    setLatestPreviewFrame(null);
    setDownloadUrl(null);
  }

  // Automatic retry with exponential backoff
  const triggerAutoRetry = useCallback(() => {
    if (retryCount >= 3 || !currentJobId) return;
    
    // Calculate exponential backoff delay: 2^attempt * 1000ms (1s, 2s, 4s)
    const backoffDelay = Math.pow(2, retryCount) * 1000;
    
    console.log(`🔄 Auto-retry scheduled in ${backoffDelay}ms (attempt ${retryCount + 1}/3)`);
    setIsAutoRetrying(true);
    
    // Clear any existing timeout
    if (retryTimeoutRef.current) {
      clearTimeout(retryTimeoutRef.current);
    }
    
    retryTimeoutRef.current = setTimeout(() => {
      console.log(`🔄 Auto-retrying job (attempt ${retryCount + 1}/3)...`);
      setIsAutoRetrying(false);
      if (currentJobId) {
        retryJobMutation.mutate(currentJobId);
      }
    }, backoffDelay);
  }, [retryCount, currentJobId, retryJobMutation]);

  // Cleanup timeout on unmount or job change
  useEffect(() => {
    return () => {
      if (retryTimeoutRef.current) {
        clearTimeout(retryTimeoutRef.current);
      }
    };
  }, []);

  // Clear retry timeout when job changes
  useEffect(() => {
    if (retryTimeoutRef.current) {
      clearTimeout(retryTimeoutRef.current);
      setIsAutoRetrying(false);
    }
  }, [currentJobId]);

  const startProcessing = useCallback((videoFile: File, config: JobConfig) => {
    createJobMutation.mutate({ videoFile, config });
  }, [createJobMutation]);

  const retryJob = useCallback(() => {
    if (currentJobId) {
      retryJobMutation.mutate(currentJobId);
    }
  }, [currentJobId, retryJobMutation]);

  const cancelJob = useCallback(async () => {
    if (!currentJobId) return;
    
    try {
      await apiRequest('DELETE', `/api/jobs/${currentJobId}`);
      setCurrentJobId(null);
      resetPhases();
      
      // Clear job from localStorage when cancelled
      try {
        localStorage.removeItem(JOB_STORAGE_KEY);
      } catch (error) {
        console.warn('⚠️ Failed to clear job from localStorage:', error);
      }
      
      console.log('❌ Job cancelled');
    } catch (error) {
      console.error('❌ Failed to cancel job:', error);
      setErrorMessage('Failed to cancel job. Please try again.');
    }
  }, [currentJobId]);

  const downloadVideo = useCallback(async () => {
    if (!currentJobId) return;
    
    try {
      // First, get the download URL from the API
      const response = await fetch(`/api/jobs/${currentJobId}/download`, {
        credentials: 'include'
      });
      
      if (!response.ok) throw new Error('Download failed');
      
      const { downloadUrl, filename } = await response.json();
      
      // Then fetch the actual video file using the download URL
      const videoResponse = await fetch(downloadUrl, {
        credentials: 'include'
      });
      
      if (!videoResponse.ok) throw new Error('Video fetch failed');
      
      const blob = await videoResponse.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename || `klutch-highlight-${currentJobId}.mp4`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      
      console.log('📥 Video downloaded successfully');
    } catch (error) {
      console.error('❌ Download failed:', error);
      setErrorMessage('Failed to download video');
    }
  }, [currentJobId]);

  return {
    // State
    currentJobId,
    phases,
    currentPhaseIndex,
    overallProgress,
    previewFrames,
    latestPreviewFrame,
    downloadUrl,
    errorMessage,
    retryCount,
    isAutoRetrying,
    isWebSocketConnected,
    connectionError,
    
    // Status
    isProcessing: createJobMutation.isPending || currentJobId !== null,
    isCompleted: phases.every(phase => phase.status === 'completed'),
    hasError: !!errorMessage || isJobError,
    canRetry: !!errorMessage && retryCount < 3,
    
    // Actions
    startProcessing,
    retryJob,
    cancelJob,
    downloadVideo,
    
    // Utils
    resetPhases,
    setCurrentJobId
  };
};