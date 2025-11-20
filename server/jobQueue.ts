import { Worker, Job as BullJob } from "bullmq";
import { videoProcessingQueue, previewQueue, redisConnection, JOB_STATUS, getRedisAvailability, REDIS_ENABLED } from "./redis";
import { storage } from "./storage";
import type { Job, CreateJobRequest } from "@shared/schema";
import path from "path";
import fs from "fs/promises";
import { randomUUID } from "crypto";
import { getWebSocketServer } from "./websocketServer";

// Job data interface for video processing
export interface VideoProcessingJobData {
  jobId: string;
  userId: string;
  videoPath: string;
  config: {
    startTime?: number;
    endTime?: number;
    playerSelection?: any;
    effectConfig?: any;
    templateId?: string;
  };
}

// Job data interface for preview generation
export interface PreviewJobData {
  jobId: string;
  videoPath: string;
  timestamp: number;
}

// GPU service client configuration
const GPU_SERVICE_URL = process.env.GPU_SERVICE_URL || "http://localhost:8000";

class JobQueueService {
  private videoWorker: Worker | null = null;
  private previewWorker: Worker | null = null;
  private processingJobs: Set<string> = new Set(); // Track in-process jobs
  private fallbackWorkerEnabled: boolean = false;

  async initialize(): Promise<void> {
    console.log("🚀 Initializing job queue workers...");
    
    // Check Redis availability before creating workers
    if (!getRedisAvailability()) {
      console.warn("⚠️  Redis unavailable - Job queue workers will not be initialized");
      console.warn("⚠️  Video processing will use fallback mode");
      this.fallbackWorkerEnabled = true;
      console.log("✅ In-process fallback worker enabled");
      return;
    }

    try {
      // Initialize video processing worker
      this.videoWorker = new Worker(
        "video-processing",
        this.processVideoJob.bind(this),
        {
          connection: redisConnection,
          concurrency: parseInt(process.env.VIDEO_WORKER_CONCURRENCY || "2"),
        }
      );

      // Initialize preview worker
      this.previewWorker = new Worker(
        "preview-generation", 
        this.processPreviewJob.bind(this),
        {
          connection: redisConnection,
          concurrency: parseInt(process.env.PREVIEW_WORKER_CONCURRENCY || "5"),
        }
      );

      // Set up event listeners
      this.setupEventListeners();
      
      console.log("✅ Job queue workers initialized");
    } catch (error) {
      console.error("❌ Failed to initialize job queue workers:", error);
      console.warn("⚠️  Continuing without job queue workers");
    }
  }

  private setupEventListeners(): void {
    if (this.videoWorker) {
      this.videoWorker.on("completed", async (job) => {
        console.log(`✅ Video job ${job.id} completed`);
        await this.updateJobStatus(job.data.jobId, JOB_STATUS.DONE, 100);
      });

      this.videoWorker.on("failed", async (job, err) => {
        console.error(`❌ Video job ${job?.id} failed:`, err);
        if (job) {
          await this.updateJobStatus(
            job.data.jobId, 
            JOB_STATUS.ERROR, 
            0, 
            err.message
          );
        }
      });

      this.videoWorker.on("progress", async (job, progress: number) => {
        console.log(`📊 Video job ${job.id} progress: ${progress}%`);
        await this.updateJobProgress(job.data.jobId, progress);
      });
    }

    if (this.previewWorker) {
      this.previewWorker.on("completed", (job) => {
        console.log(`✅ Preview job ${job.id} completed`);
      });

      this.previewWorker.on("failed", (job, err) => {
        console.error(`❌ Preview job ${job?.id} failed:`, err);
      });
    }
  }

  // Main video processing job handler
  private async processVideoJob(job: BullJob<VideoProcessingJobData>): Promise<any> {
    const { jobId, userId, videoPath, config } = job.data;
    
    console.log(`🎬 Processing video job ${jobId} for user ${userId}`);
    
    try {
      // Update status to preprocessing
      await this.updateJobStatus(jobId, JOB_STATUS.PREPROCESSING, 5);
      job.updateProgress(5);

      // Step 1: Validate video file
      await this.validateVideoFile(videoPath);
      await this.updateJobStatus(jobId, JOB_STATUS.PREPROCESSING, 10);
      job.updateProgress(10);

      // Step 2: Send to GPU service for processing
      await this.updateJobStatus(jobId, JOB_STATUS.DETECTING, 15);
      job.updateProgress(15);

      const gpuResult = await this.callGpuService(jobId, videoPath, config);
      
      // Step 3: Monitor GPU processing
      await this.updateJobStatus(jobId, JOB_STATUS.RENDERING, 50);
      job.updateProgress(50);

      // Poll GPU service for completion
      const finalResult = await this.pollGpuServiceCompletion(gpuResult.job_id, job);

      // Step 4: Finalize job
      await this.updateJobStatus(jobId, JOB_STATUS.FINALIZING, 90);
      job.updateProgress(90);

      // Update job with results
      await storage.updateJob(jobId, {
        processedVideoPath: finalResult.output_path,
        gpuServiceJobId: gpuResult.job_id,
        processingCompletedAt: new Date(),
        downloadUrl: await this.generateDownloadUrl(finalResult.output_path),
        downloadUrlExpiry: new Date(Date.now() + 24 * 60 * 60 * 1000), // 24 hours
      });

      console.log(`✅ Video job ${jobId} completed successfully`);
      return finalResult;

    } catch (error) {
      console.error(`❌ Video job ${jobId} failed:`, error);
      throw error;
    }
  }

  // Preview generation job handler  
  private async processPreviewJob(job: BullJob<PreviewJobData>): Promise<any> {
    const { jobId, videoPath, timestamp } = job.data;
    
    try {
      // Generate preview frame at timestamp
      const previewData = await this.generatePreviewFrame(videoPath, timestamp);
      
      // Store preview data (could be sent via WebSocket)
      await this.storePreviewFrame(jobId, timestamp, previewData);
      
      return previewData;
    } catch (error) {
      console.error(`❌ Preview job failed:`, error);
      throw error;
    }
  }

  // Fallback job processing for when Redis is unavailable
  private async processFallbackJob(data: VideoProcessingJobData): Promise<void> {
    const { jobId, userId, videoPath, config } = data;
    
    // Prevent duplicate processing
    if (this.processingJobs.has(jobId)) {
      console.warn(`⚠️  Job ${jobId} is already being processed`);
      return;
    }
    
    this.processingJobs.add(jobId);
    
    try {
      console.log(`🎬 Processing fallback job ${jobId} for user ${userId}`);
      
      // Use the same logic as processVideoJob but without BullMQ dependency
      await this.updateJobStatus(jobId, JOB_STATUS.PREPROCESSING, 5);
      await this.notifyJobProgress(jobId, 5);
      
      // Step 1: Validate video file
      await this.validateVideoFile(videoPath);
      await this.updateJobStatus(jobId, JOB_STATUS.PREPROCESSING, 10);
      await this.notifyJobProgress(jobId, 10);
      
      // Step 2: Send to GPU service for processing
      await this.updateJobStatus(jobId, JOB_STATUS.DETECTING, 15);
      await this.notifyJobProgress(jobId, 15);
      
      const gpuResult = await this.callGpuService(jobId, videoPath, config);
      
      // Step 3: Monitor GPU processing
      await this.updateJobStatus(jobId, JOB_STATUS.RENDERING, 50);
      await this.notifyJobProgress(jobId, 50);
      
      // Poll GPU service for completion (without BullJob dependency)
      const finalResult = await this.pollGpuServiceCompletionFallback(gpuResult.job_id, jobId);
      
      // Step 4: Finalize job
      await this.updateJobStatus(jobId, JOB_STATUS.FINALIZING, 90);
      await this.notifyJobProgress(jobId, 90);
      
      // Update job with results
      await storage.updateJob(jobId, {
        processedVideoPath: finalResult.output_path,
        gpuServiceJobId: gpuResult.job_id,
        processingCompletedAt: new Date(),
        downloadUrl: await this.generateDownloadUrl(finalResult.output_path),
        downloadUrlExpiry: new Date(Date.now() + 24 * 60 * 60 * 1000), // 24 hours
      });
      
      await this.updateJobStatus(jobId, JOB_STATUS.DONE, 100);
      await this.notifyJobProgress(jobId, 100);
      
      console.log(`✅ Fallback job ${jobId} completed successfully`);
      
    } catch (error) {
      console.error(`❌ Fallback job ${jobId} failed:`, error);
      await this.updateJobStatus(jobId, JOB_STATUS.ERROR, 0, error.message);
      await this.notifyJobProgress(jobId, 0);
    } finally {
      this.processingJobs.delete(jobId);
    }
  }
  
  // Notify WebSocket clients of job progress (fallback version)
  private async notifyJobProgress(jobId: string, progress: number): Promise<void> {
    try {
      const wsServer = getWebSocketServer();
      if (wsServer) {
        await wsServer.broadcastJobUpdate(jobId, { progress });
      }
    } catch (error) {
      console.warn(`⚠️  Failed to send WebSocket update for job ${jobId}:`, error.message);
    }
  }
  
  // Poll GPU service completion (fallback version without BullJob)
  private async pollGpuServiceCompletionFallback(gpuJobId: string, jobId: string): Promise<any> {
    const maxPollTime = 300000; // 5 minutes max
    const pollInterval = 2000;   // 2 seconds
    const startTime = Date.now();
    
    while (Date.now() - startTime < maxPollTime) {
      try {
        const response = await fetch(`${GPU_SERVICE_URL}/status/${gpuJobId}`);
        
        if (!response.ok) {
          throw new Error(`GPU service status check failed: ${response.statusText}`);
        }
        
        const status = await response.json();
        
        // Update progress based on GPU service progress
        if (status.progress !== undefined) {
          const adjustedProgress = Math.min(50 + (status.progress * 0.4), 90);
          await this.updateJobProgress(jobId, adjustedProgress);
          await this.notifyJobProgress(jobId, adjustedProgress);
        }
        
        if (status.status === "completed") {
          return status;
        } else if (status.status === "failed") {
          throw new Error(`GPU processing failed: ${status.error || "Unknown error"}`);
        }
        
        // Wait before next poll
        await new Promise(resolve => setTimeout(resolve, pollInterval));
        
      } catch (error) {
        if (Date.now() - startTime > maxPollTime - pollInterval) {
          throw new Error(`GPU service polling timeout: ${error.message}`);
        }
        // Continue polling on non-critical errors
        await new Promise(resolve => setTimeout(resolve, pollInterval));
      }
    }
    
    throw new Error("GPU service polling timeout");
  }

  // Public methods for job management
  async createVideoJob(
    userId: string, 
    videoPath: string, 
    config: CreateJobRequest,
    priority: number = 5
  ): Promise<string> {
    const jobId = randomUUID();
    
    // Create job record in database
    await storage.createJob({
      id: jobId,
      userId,
      status: JOB_STATUS.QUEUED,
      priority,
      originalVideoPath: videoPath,
      startTime: config.startTime?.toString() || "0",
      endTime: config.endTime?.toString(),
      playerSelection: config.playerSelection ? JSON.stringify(config.playerSelection) : null,
      effectConfig: config.effectConfig ? JSON.stringify(config.effectConfig) : null,
      templateId: config.templateId,
      processingStartedAt: new Date(),
    });

    // Check Redis availability and queue existence before queuing
    if (!getRedisAvailability() || !videoProcessingQueue) {
      console.warn(`⚠️  Redis/Queue unavailable - Using in-process fallback for job ${jobId}`);
      
      // Process job immediately using in-process fallback
      if (this.fallbackWorkerEnabled) {
        setImmediate(async () => {
          await this.processFallbackJob({
            jobId,
            userId,
            videoPath,
            config
          });
        });
        console.log(`🔄 Job ${jobId} queued for in-process fallback processing`);
      } else {
        console.warn(`⚠️  Job ${jobId} created but will remain in QUEUED status - no fallback worker`);
      }
      
      return jobId;
    }

    try {
      // Add job to queue
      await videoProcessingQueue.add(
        "process-video",
        {
          jobId,
          userId,
          videoPath,
          config,
        },
        {
          priority,
          delay: 0,
        }
      );

      console.log(`📝 Created and queued video job ${jobId} with priority ${priority}`);
    } catch (error) {
      console.error(`❌ Failed to queue job ${jobId}:`, error);
      console.warn(`⚠️  Job ${jobId} created but not queued due to Redis error`);
    }

    return jobId;
  }

  async createPreviewJob(jobId: string, videoPath: string, timestamp: number): Promise<void> {
    if (!getRedisAvailability() || !previewQueue) {
      console.warn(`⚠️  Redis/Queue unavailable - Preview job for ${jobId} not queued`);
      return;
    }

    try {
      await previewQueue.add(
        "generate-preview",
        {
          jobId,
          videoPath,
          timestamp,
        },
        {
          priority: 10, // High priority for previews
        }
      );
    } catch (error) {
      console.error(`❌ Failed to queue preview job for ${jobId}:`, error);
    }
  }

  // Helper methods
  private async validateVideoFile(videoPath: string): Promise<void> {
    try {
      const stats = await fs.stat(videoPath);
      if (!stats.isFile()) {
        throw new Error("Video file not found");
      }
      
      // Additional validation could include:
      // - File format check
      // - Duration limits
      // - Size limits
      // - Codec validation
      
    } catch (error) {
      throw new Error(`Video file validation failed: ${error.message}`);
    }
  }

  private async callGpuService(jobId: string, videoPath: string, config: any): Promise<any> {
    try {
      const response = await fetch(`${GPU_SERVICE_URL}/process`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          video_path: videoPath,
          start_time: config.startTime || 0,
          end_time: config.endTime,
          player_selection: config.playerSelection || { auto_select: true },
          effect_config: config.effectConfig || { type: "circle" },
        }),
      });

      if (!response.ok) {
        throw new Error(`GPU service error: ${response.statusText}`);
      }

      return await response.json();
    } catch (error) {
      throw new Error(`Failed to call GPU service: ${error.message}`);
    }
  }

  private async pollGpuServiceCompletion(gpuJobId: string, job: BullJob): Promise<any> {
    const maxPollTime = 300000; // 5 minutes max
    const pollInterval = 2000;   // 2 seconds
    const startTime = Date.now();

    while (Date.now() - startTime < maxPollTime) {
      try {
        const response = await fetch(`${GPU_SERVICE_URL}/status/${gpuJobId}`);
        
        if (!response.ok) {
          throw new Error(`GPU service status check failed: ${response.statusText}`);
        }

        const status = await response.json();
        
        // Update progress based on GPU service progress
        if (status.progress !== undefined) {
          const adjustedProgress = Math.min(50 + (status.progress * 0.4), 90);
          job.updateProgress(adjustedProgress);
        }

        if (status.stage === "completed") {
          return status;
        }

        if (status.stage === "failed") {
          throw new Error(status.error || "GPU processing failed");
        }

        // Wait before next poll
        await new Promise(resolve => setTimeout(resolve, pollInterval));
        
      } catch (error) {
        console.error(`❌ Error polling GPU service:`, error);
        throw error;
      }
    }

    throw new Error("GPU processing timeout");
  }

  private async generatePreviewFrame(videoPath: string, timestamp: number): Promise<any> {
    // This would call GPU service for single frame detection
    // For now, return mock data
    return {
      timestamp,
      detections: [],
      imageDataUrl: "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQ...", // Mock
    };
  }

  private async storePreviewFrame(jobId: string, timestamp: number, previewData: any): Promise<void> {
    // Store preview frame data for WebSocket transmission
    // Could use Redis or database
    const key = `preview:${jobId}:${timestamp}`;
    // await redis.setex(key, 300, JSON.stringify(previewData)); // 5 min expiry
  }

  private async generateDownloadUrl(filePath: string): Promise<string> {
    // Generate signed URL for file download
    // For now, return simple path-based URL
    const filename = path.basename(filePath);
    return `/api/jobs/download/${filename}`;
  }

  private async updateJobStatus(
    jobId: string, 
    status: string, 
    progress: number, 
    errorMessage?: string
  ): Promise<void> {
    await storage.updateJob(jobId, {
      status,
      progress,
      currentPhase: status,
      errorMessage,
      updatedAt: new Date(),
    });
  }

  private async updateJobProgress(jobId: string, progress: number): Promise<void> {
    await storage.updateJob(jobId, {
      progress,
      updatedAt: new Date(),
    });
  }

  async shutdown(): Promise<void> {
    console.log("🛑 Shutting down job queue workers...");
    
    if (this.videoWorker) {
      await this.videoWorker.close();
    }
    
    if (this.previewWorker) {
      await this.previewWorker.close();
    }
    
    console.log("✅ Job queue workers shut down");
  }
}

export const jobQueueService = new JobQueueService();

// Note: Initialization happens in routes.ts to avoid circular imports