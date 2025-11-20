import Redis from "ioredis";
import { Queue, Worker, Job, QueueEvents } from "bullmq";

// Check if Redis is enabled
export const REDIS_ENABLED = process.env.REDIS_ENABLED === "true";

// Redis configuration for BullMQ compatibility
const redisConfig = {
  host: process.env.REDIS_HOST || "localhost",
  port: parseInt(process.env.REDIS_PORT || "6379"),
  password: process.env.REDIS_PASSWORD,
  retryDelayOnFailover: 100,
  maxRetriesPerRequest: null, // Required for BullMQ
  lazyConnect: true,
  // Disable auto-reconnection and offline queue when Redis is not enabled
  retryStrategy: REDIS_ENABLED ? undefined : () => null,
  enableOfflineQueue: REDIS_ENABLED,
};

// Create Redis instances only if Redis is enabled
export let redis: Redis | null = null;
export let redisConnection: Redis | null = null;

if (REDIS_ENABLED) {
  redis = new Redis(redisConfig);
  redisConnection = new Redis(redisConfig);
} else {
  console.log("ℹ️  Redis is disabled (REDIS_ENABLED != true)");
  console.log("ℹ️  Job processing will use in-process fallback mode");
}

// Job queue configuration
const queueConfig = {
  connection: redisConnection,
  defaultJobOptions: {
    removeOnComplete: 50, // Keep last 50 completed jobs
    removeOnFail: 100,    // Keep last 100 failed jobs
    attempts: 3,
    backoff: {
      type: "exponential",
      delay: 2000,
    },
  },
};

// Create job queues conditionally
export let videoProcessingQueue: Queue | null = null;
export let previewQueue: Queue | null = null;
export let videoProcessingEvents: QueueEvents | null = null;
export let previewEvents: QueueEvents | null = null;

// Function to create queues after Redis is confirmed available
export function createQueues(): void {
  if (!isRedisAvailable || !REDIS_ENABLED || !redisConnection) {
    console.warn("⚠️  Cannot create queues - Redis is not available or not enabled");
    return;
  }

  try {
    // Create job queues
    videoProcessingQueue = new Queue("video-processing", {
      connection: redisConnection,
      defaultJobOptions: {
        removeOnComplete: 50, // Keep last 50 completed jobs
        removeOnFail: 100,    // Keep last 100 failed jobs
        attempts: 3,
        backoff: {
          type: "exponential",
          delay: 2000,
        },
      },
    });
    
    previewQueue = new Queue("preview-generation", {
      connection: redisConnection,
      defaultJobOptions: {
        removeOnComplete: 10,
        removeOnFail: 10,
        attempts: 1, // Preview jobs shouldn't retry
        backoff: {
          type: "exponential",
          delay: 2000,
        },
      },
    });

    // Queue events for monitoring
    videoProcessingEvents = new QueueEvents("video-processing", {
      connection: redisConnection,
    });

    previewEvents = new QueueEvents("preview-generation", {
      connection: redisConnection,
    });

    console.log("✅ Job queues created successfully");
  } catch (error) {
    console.error("❌ Failed to create job queues:", error);
    videoProcessingQueue = null;
    previewQueue = null;
    videoProcessingEvents = null;
    previewEvents = null;
  }
}

// Job priorities
export const JOB_PRIORITIES = {
  LOW: 1,
  NORMAL: 5,
  HIGH: 10,
  URGENT: 15,
} as const;

// Job status mapping
export const JOB_STATUS = {
  QUEUED: "queued",
  PREPROCESSING: "preprocessing", 
  DETECTING: "detecting",
  RENDERING: "rendering",
  FINALIZING: "finalizing",
  DONE: "done",
  ERROR: "error",
} as const;

// Global flag to track Redis availability
let isRedisAvailable = false;

// Initialize Redis connection
export async function initializeRedis(): Promise<void> {
  // Skip Redis initialization if not enabled
  if (!REDIS_ENABLED) {
    console.log("ℹ️  Skipping Redis initialization (REDIS_ENABLED != true)");
    console.log("ℹ️  Job processing will use in-process fallback mode");
    isRedisAvailable = false;
    return;
  }

  // Ensure Redis instances exist before trying to connect
  if (!redis || !redisConnection) {
    console.error("❌ Redis instances not created - this should not happen when REDIS_ENABLED=true");
    isRedisAvailable = false;
    return;
  }

  try {
    await redis.connect();
    console.log("✅ Redis connected successfully");
    
    // Test connection
    await redis.ping();
    console.log("✅ Redis ping successful");
    isRedisAvailable = true;
    
    // Create queues now that Redis is available
    createQueues();
    
  } catch (error) {
    console.error("❌ Redis connection failed:", error);
    isRedisAvailable = false;
    
    // Immediately disconnect to stop retry attempts
    try {
      if (redis) {
        await redis.disconnect();
      }
      if (redisConnection) {
        await redisConnection.disconnect();
      }
      console.log("✅ Redis connections closed after failed connect");
    } catch (disconnectError) {
      console.error("❌ Error disconnecting Redis after failed connect:", disconnectError);
    }
    
    // Always continue in fallback mode instead of crashing
    console.warn("⚠️  Running in fallback mode without Redis");
    console.warn("⚠️  Job queue functionality will use in-process worker");
    
    // Don't throw error - allow server to continue
    return;
  }
}

// Export function to check Redis availability
export function getRedisAvailability(): boolean {
  return isRedisAvailable;
}

// Cleanup function
export async function cleanupRedis(): Promise<void> {
  if (!REDIS_ENABLED || (!redis && !redisConnection)) {
    console.log("ℹ️  No Redis connections to cleanup");
    return;
  }

  try {
    if (redis) {
      await redis.disconnect();
    }
    if (redisConnection) {
      await redisConnection.disconnect();
    }
    console.log("✅ Redis connections closed");
  } catch (error) {
    console.error("❌ Error closing Redis connections:", error);
  }
}

// Handle graceful shutdown
process.on("SIGTERM", cleanupRedis);
process.on("SIGINT", cleanupRedis);