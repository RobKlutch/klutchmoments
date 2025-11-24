import { WebSocketServer, WebSocket } from 'ws';
import { Server } from 'http';
import { parse } from 'url';
import { storage } from './storage';

export interface WebSocketConnection {
  ws: WebSocket;
  jobId: string;
  userId: string;
  type: 'status' | 'preview';
}

export class JobWebSocketServer {
  private wss: WebSocketServer;
  private connections: Map<string, WebSocketConnection[]> = new Map();
  private previewIntervals: Map<string, NodeJS.Timeout> = new Map();

  constructor(server: Server) {
    this.wss = new WebSocketServer({ 
      server,
      path: '/ws',
      verifyClient: (info) => {
        // Basic verification - in production, verify authentication
        const url = parse(info.req.url || '', true);
        return url.pathname === '/ws' && !!url.query.jobId;
      }
    });

    this.setupWebSocketServer();
  }

  private setupWebSocketServer(): void {
    this.wss.on('connection', async (ws, request) => {
      const url = parse(request.url || '', true);
      const jobId = url.query.jobId as string;
      const type = (url.query.type as string) || 'status';
      
      if (!jobId) {
        ws.close(1008, 'Job ID required');
        return;
      }

      try {
        // Verify job exists
        const job = await storage.getJob(jobId);
        if (!job) {
          ws.close(1008, 'Job not found');
          return;
        }

        // TODO: Verify user has access to this job
        // For now, we'll assume they do

        const connection: WebSocketConnection = {
          ws,
          jobId,
          userId: job.userId,
          type: type as 'status' | 'preview'
        };

        // Add to connections
        if (!this.connections.has(jobId)) {
          this.connections.set(jobId, []);
        }
        this.connections.get(jobId)!.push(connection);

        console.log(`🔌 WebSocket connected for job ${jobId} (${type})`);

        // Send initial status
        await this.sendJobStatus(jobId);

        // If this is a preview connection, start sending preview frames
        if (type === 'preview') {
          this.startPreviewStream(jobId);
        }

        // Handle connection close
        ws.on('close', () => {
          this.removeConnection(jobId, ws);
          console.log(`🔌 WebSocket disconnected for job ${jobId} (${type})`);
        });

        // Handle ping/pong for keep-alive
        ws.on('ping', () => {
          ws.pong();
        });

        // Send heartbeat
        const heartbeat = setInterval(() => {
          if (ws.readyState === WebSocket.OPEN) {
            ws.ping();
          } else {
            clearInterval(heartbeat);
          }
        }, 30000); // 30 second heartbeat

      } catch (error) {
        console.error('❌ WebSocket connection error:', error);
        ws.close(1011, 'Internal server error');
      }
    });

    console.log('🔌 WebSocket server initialized');
  }

  private removeConnection(jobId: string, ws: WebSocket): void {
    const connections = this.connections.get(jobId);
    if (connections) {
      const index = connections.findIndex(conn => conn.ws === ws);
      if (index !== -1) {
        connections.splice(index, 1);
        
        // If no more connections for this job, clean up
        if (connections.length === 0) {
          this.connections.delete(jobId);
          this.stopPreviewStream(jobId);
        }
      }
    }
  }

  private startPreviewStream(jobId: string): void {
    // Don't start if already running
    if (this.previewIntervals.has(jobId)) {
      return;
    }

    // Send preview frames at 1-2Hz as specified
    const interval = setInterval(async () => {
      try {
        await this.sendPreviewFrame(jobId);
      } catch (error) {
        console.error(`❌ Preview stream error for job ${jobId}:`, error);
      }
    }, 1000); // 1Hz (1 frame per second)

    this.previewIntervals.set(jobId, interval);
    console.log(`📺 Started preview stream for job ${jobId}`);
  }

  private stopPreviewStream(jobId: string): void {
    const interval = this.previewIntervals.get(jobId);
    if (interval) {
      clearInterval(interval);
      this.previewIntervals.delete(jobId);
      console.log(`📺 Stopped preview stream for job ${jobId}`);
    }
  }

  private async sendPreviewFrame(jobId: string): Promise<void> {
    // Get preview frame data from Redis or generate it
    try {
      // In a real implementation, this would come from the GPU service
      // or be stored in Redis by the preview worker
      const previewData = {
        timestamp: Date.now(),
        jobId,
        detections: [
          {
            id: 'player_1',
            x: 0.3 + Math.random() * 0.4, // Simulate moving player
            y: 0.4 + Math.random() * 0.2,
            width: 0.08,
            height: 0.15,
            confidence: 0.8 + Math.random() * 0.2,
            centerX: 0.3 + Math.random() * 0.4,
            centerY: 0.4 + Math.random() * 0.2,
          }
        ],
        frameIndex: Math.floor(Date.now() / 1000) % 100,
      };

      this.broadcastToJob(jobId, 'preview', {
        type: 'preview_frame',
        data: previewData
      });

    } catch (error) {
      console.error(`❌ Error sending preview frame for job ${jobId}:`, error);
    }
  }

  // Public methods for sending updates
  public async sendJobStatus(jobId: string): Promise<void> {
    try {
      const job = await storage.getJob(jobId);
      if (!job) {
        return;
      }

      const statusData = {
        id: job.id,
        status: job.status,
        progress: job.progress,
        currentPhase: job.currentPhase,
        processingStartedAt: job.processingStartedAt,
        processingCompletedAt: job.processingCompletedAt,
        errorMessage: job.errorMessage,
        updatedAt: job.updatedAt,
      };

      this.broadcastToJob(jobId, 'status', {
        type: 'status_update',
        data: statusData
      });

    } catch (error) {
      console.error(`❌ Error sending job status for ${jobId}:`, error);
    }
  }

  public sendJobProgress(jobId: string, progress: number, phase?: string): void {
    this.broadcastToJob(jobId, 'status', {
      type: 'progress_update',
      data: {
        jobId,
        progress,
        phase,
        timestamp: new Date().toISOString(),
      }
    });
  }

  public sendJobError(jobId: string, error: string): void {
    this.broadcastToJob(jobId, 'status', {
      type: 'job_error',
      data: {
        jobId,
        error,
        timestamp: new Date().toISOString(),
      }
    });
  }

  public sendJobCompleted(jobId: string, downloadUrl?: string): void {
    this.broadcastToJob(jobId, 'status', {
      type: 'job_completed',
      data: {
        jobId,
        downloadUrl,
        timestamp: new Date().toISOString(),
      }
    });

    // Stop preview stream when job is done
    this.stopPreviewStream(jobId);
  }

  private broadcastToJob(jobId: string, connectionType: 'status' | 'preview' | 'all', message: any): void {
    const connections = this.connections.get(jobId);
    if (!connections) {
      return;
    }

    const targetConnections = connections.filter(conn => 
      connectionType === 'all' || conn.type === connectionType
    );

    targetConnections.forEach(conn => {
      if (conn.ws.readyState === WebSocket.OPEN) {
        try {
          conn.ws.send(JSON.stringify(message));
        } catch (error) {
          console.error(`❌ Error sending WebSocket message:`, error);
          // Remove broken connection
          this.removeConnection(jobId, conn.ws);
        }
      }
    });
  }

  public getConnectionCount(jobId?: string): number {
    if (jobId) {
      return this.connections.get(jobId)?.length || 0;
    }
    
    return Array.from(this.connections.values())
      .reduce((total, conns) => total + conns.length, 0);
  }

  public async broadcastJobUpdate(jobId: string, update: any): Promise<void> {
    const connections = this.connections.get(jobId) || [];
    
    const message = JSON.stringify({
      type: 'job_update',
      jobId,
      ...update
    });

    for (const connection of connections) {
      if (connection.ws.readyState === WebSocket.OPEN) {
        try {
          connection.ws.send(message);
        } catch (error) {
          console.warn(`⚠️  Failed to send job update to connection: ${error.message}`);
        }
      }
    }
  }

  public async cleanup(): Promise<void> {
    console.log('🛑 Cleaning up WebSocket server...');
    
    // Stop all preview streams
    for (const [jobId] of this.previewIntervals) {
      this.stopPreviewStream(jobId);
    }

    // Close all connections
    this.wss.clients.forEach(ws => {
      ws.close(1001, 'Server shutting down');
    });

    this.wss.close();
    console.log('✅ WebSocket server cleaned up');
  }
}

// Global WebSocket server instance
let wsServer: JobWebSocketServer | null = null;

export function initializeWebSocketServer(server: Server): JobWebSocketServer {
  if (wsServer) {
    return wsServer;
  }
  
  wsServer = new JobWebSocketServer(server);
  return wsServer;
}

export function getWebSocketServer(): JobWebSocketServer | null {
  return wsServer;
}