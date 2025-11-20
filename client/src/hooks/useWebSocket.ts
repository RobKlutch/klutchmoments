import { useState, useEffect, useRef, useCallback } from 'react';

export interface WebSocketMessage {
  type: 'status_update' | 'progress_update' | 'preview_frame' | 'job_error' | 'job_completed';
  data: any;
}

export interface JobStatus {
  id: string;
  status: string;
  progress: number;
  currentPhase: string;
  processingStartedAt?: string;
  processingCompletedAt?: string;
  errorMessage?: string;
  updatedAt: string;
}

export interface PreviewFrame {
  timestamp: number;
  jobId: string;
  detections: Array<{
    id: string;
    x: number;
    y: number;
    width: number;
    height: number;
    confidence: number;
    centerX: number;
    centerY: number;
  }>;
  frameIndex: number;
}

interface UseWebSocketProps {
  jobId: string | null;
  type?: 'status' | 'preview';
  onStatusUpdate?: (status: JobStatus) => void;
  onProgressUpdate?: (progress: number, phase?: string) => void;
  onPreviewFrame?: (frame: PreviewFrame) => void;
  onError?: (error: string) => void;
  onCompleted?: (downloadUrl?: string) => void;
}

export const useWebSocket = ({
  jobId,
  type = 'status',
  onStatusUpdate,
  onProgressUpdate,
  onPreviewFrame,
  onError,
  onCompleted
}: UseWebSocketProps) => {
  const [isConnected, setIsConnected] = useState(false);
  const [connectionError, setConnectionError] = useState<string | null>(null);
  const [lastMessage, setLastMessage] = useState<WebSocketMessage | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const reconnectAttemptsRef = useRef(0);
  const maxReconnectAttempts = 5;

  const connect = useCallback(() => {
    if (!jobId) return;

    try {
      // Clear any existing connection
      if (wsRef.current) {
        wsRef.current.close();
      }

      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const wsUrl = `${protocol}//${window.location.host}/ws?jobId=${jobId}&type=${type}`;
      
      console.log(`🔌 Connecting to WebSocket: ${wsUrl}`);
      
      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onopen = () => {
        console.log(`✅ WebSocket connected for job ${jobId} (${type})`);
        setIsConnected(true);
        setConnectionError(null);
        reconnectAttemptsRef.current = 0;
      };

      ws.onmessage = (event) => {
        try {
          const message: WebSocketMessage = JSON.parse(event.data);
          setLastMessage(message);

          switch (message.type) {
            case 'status_update':
              onStatusUpdate?.(message.data);
              break;
            case 'progress_update':
              onProgressUpdate?.(message.data.progress, message.data.phase);
              break;
            case 'preview_frame':
              onPreviewFrame?.(message.data);
              break;
            case 'job_error':
              onError?.(message.data.error);
              break;
            case 'job_completed':
              onCompleted?.(message.data.downloadUrl);
              break;
            default:
              console.log('📨 Unknown WebSocket message type:', message.type);
          }
        } catch (error) {
          console.error('❌ Error parsing WebSocket message:', error);
        }
      };

      ws.onclose = (event) => {
        console.log(`🔌 WebSocket disconnected for job ${jobId}:`, event.code, event.reason);
        setIsConnected(false);
        
        // Attempt to reconnect unless it was a clean close
        if (event.code !== 1000 && reconnectAttemptsRef.current < maxReconnectAttempts) {
          const delay = Math.min(1000 * Math.pow(2, reconnectAttemptsRef.current), 10000);
          console.log(`🔄 Attempting to reconnect in ${delay}ms (attempt ${reconnectAttemptsRef.current + 1}/${maxReconnectAttempts})`);
          
          reconnectTimeoutRef.current = setTimeout(() => {
            reconnectAttemptsRef.current++;
            connect();
          }, delay);
        } else if (reconnectAttemptsRef.current >= maxReconnectAttempts) {
          setConnectionError('Connection lost. Please refresh the page.');
        }
      };

      ws.onerror = (error) => {
        console.error(`❌ WebSocket error for job ${jobId}:`, error);
        setConnectionError('WebSocket connection error');
      };

    } catch (error) {
      console.error('❌ Failed to create WebSocket connection:', error);
      setConnectionError('Failed to establish connection');
    }
  }, [jobId, type, onStatusUpdate, onProgressUpdate, onPreviewFrame, onError, onCompleted]);

  const disconnect = useCallback(() => {
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }
    
    if (wsRef.current) {
      wsRef.current.close(1000, 'Disconnecting');
      wsRef.current = null;
    }
    
    setIsConnected(false);
    setConnectionError(null);
    reconnectAttemptsRef.current = 0;
  }, []);

  const sendMessage = useCallback((message: any) => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(message));
    } else {
      console.warn('⚠️  WebSocket not connected, cannot send message');
    }
  }, []);

  // Connect when jobId changes
  useEffect(() => {
    if (jobId) {
      connect();
    } else {
      disconnect();
    }

    return () => {
      disconnect();
    };
  }, [jobId, connect, disconnect]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      disconnect();
    };
  }, [disconnect]);

  return {
    isConnected,
    connectionError,
    lastMessage,
    connect,
    disconnect,
    sendMessage
  };
};