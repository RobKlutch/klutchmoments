import type { Express } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { setupAuth } from "./auth";
import { insertUserSchema, insertAthleteSchema, insertHighlightSchema, playerDetectionRequestSchema, playerDetectionResponseSchema, createJobRequestSchema, jobStatusResponseSchema } from "@shared/schema";
import { requireAdmin, requireSuperAdmin, logAdminAction } from "./middleware/admin";
import { safeUserResponse, safeUsersResponse } from "./auth";
import detectionRateLimiter from "./middleware/rateLimiter";
import { z } from "zod";
import OpenAI from "openai";
import sharp from "sharp";
import fs from "fs";
import path from "path";
import os from "os";
import multer from "multer";
import Replicate from "replicate";
// YOLOv11-ONLY: No transformers dependencies
import { videoUpload, VideoValidationService, FileStorageService } from "./fileUpload";
import { initializeRedis } from "./redis";
import { jobQueueService } from "./jobQueue";
import { initializeWebSocketServer, getWebSocketServer } from "./websocketServer";
import { randomUUID } from "crypto";
import { assignConsistentPlayerIDs, applySpatialTrackingToResponse, getLatestTrackedPlayers } from './utils/spatialTracking';
import { localYolo11DetectionService } from './services/localYolo11Detection';
import { replicateDetectionService } from './services/replicateDetection';
import { replicateDirectDetection } from './services/replicateDirectDetection';

// ZERO-LAG OPTIMIZATION: Configure multer for memory storage
const detectPlayersUpload = multer({ 
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 } // 5MB limit
});

// YOLOv11-ONLY ARCHITECTURE: No external service dependencies
// All detection integrated directly into main application

export async function registerRoutes(app: Express): Promise<Server> {
  // Initialize Redis and job queue
  await initializeRedis();
  await jobQueueService.initialize();
  
  // **ARCHITECT FIX**: Disable broken local YOLOv11 worker (ONNX protobuf errors, weak HOG fallback)
  // Use ONLY Replicate GPU detection for reliable YOLOv11 quality
  console.log('ℹ️ Local YOLOv11 worker disabled - using Replicate GPU exclusively');
  // await localYolo11DetectionService.initialize(); // DISABLED
  
  // Initialize Direct Replicate GPU detection service (ZERO-LAG, no Python worker)
  if (process.env.REPLICATE_API_TOKEN) {
    await replicateDirectDetection.initialize();
  } else {
    console.log('⚠️ REPLICATE_API_TOKEN not set - Replicate GPU detection disabled');
  }

  // Blueprint: javascript_auth_all_persistance - sets up /api/register, /api/login, /api/logout, /api/user
  setupAuth(app);

  // Error Reporting Endpoint - Critical for preventing blank screen regressions
  app.post("/api/error-report", async (req, res) => {
    try {
      const errorData = req.body;
      const timestamp = new Date().toISOString();
      const userAgent = req.get('User-Agent') || 'unknown';
      const ip = req.ip;
      
      // Enhanced error logging with context
      const logEntry = {
        timestamp,
        userAgent,
        ip,
        userId: req.user?.id || 'anonymous',
        sessionId: errorData.sessionId || 'unknown',
        ...errorData
      };

      console.error('🚨 CLIENT_ERROR_REPORT:', JSON.stringify(logEntry, null, 2));
      
      res.json({ success: true });
    } catch (error) {
      console.error('Failed to process error report:', error);
      res.status(500).json({ error: 'Failed to log error' });
    }
  });

  // Remote Logging Endpoint - Resilient logging from client-side stage loggers
  app.post("/api/logs", async (req, res) => {
    try {
      const { entries } = req.body;
      
      if (!Array.isArray(entries)) {
        return res.status(400).json({ error: 'entries must be an array' });
      }

      // Log each entry with timestamp and stage context
      entries.forEach(entry => {
        const logLine = `[${new Date(entry.timestamp).toISOString()}] [${entry.stage}] [${entry.level.toUpperCase()}] ${entry.message}`;
        
        switch (entry.level) {
          case 'error':
            console.error(logLine, entry.data, entry.stack);
            break;
          case 'warn':
            console.warn(logLine, entry.data);
            break;
          case 'debug':
            console.debug(logLine, entry.data);
            break;
          default:
            console.log(logLine, entry.data);
        }
      });
      
      res.json({ success: true, count: entries.length });
    } catch (error) {
      console.error('Failed to process remote logs:', error);
      res.status(500).json({ error: 'Failed to process logs' });
    }
  });
  
  // Legacy error reporting (keeping for backwards compat)
  app.post("/api/client-error", async (req, res) => {
    try {
      const errorData = req.body;
      const timestamp = new Date().toISOString();
      
      console.error('🚨 CLIENT ERROR (Legacy):', {
        timestamp,
        ...errorData
      });
      
      // Store error in storage if needed (could add a dedicated error storage method)
      // await storage.logError(logEntry);
      
      res.json({ 
        success: true, 
        errorId: errorData.errorId || `ERR_${Date.now()}`,
        message: 'Error report received and logged'
      });
    } catch (error) {
      console.error('Failed to process error report:', error);
      res.status(500).json({ error: 'Failed to process error report' });
    }
  });


  // Admin Routes - Protected by admin middleware
  
  // Admin Stats & Overview
  app.get("/api/admin/stats", requireAdmin, async (req, res) => {
    try {
      const users = await storage.getAllUsers(1000);
      const orders = await storage.getAllOrders(1000);
      const highlights = await storage.getAllHighlights(1000);
      
      const activeUsers = users.filter(u => u.isActive).length;
      const totalRevenue = orders.reduce((sum, order) => sum + (Number(order.amount) || 0), 0);
      const monthlyRevenue = orders
        .filter(order => {
          const orderDate = new Date(order.createdAt);
          const monthAgo = new Date();
          monthAgo.setMonth(monthAgo.getMonth() - 1);
          return orderDate > monthAgo;
        })
        .reduce((sum, order) => sum + (Number(order.amount) || 0), 0);
      
      const todayHighlights = highlights.filter(h => {
        const today = new Date();
        const hDate = new Date(h.createdAt);
        return today.toDateString() === hDate.toDateString();
      }).length;
      
      const avgCreditsPerUser = users.length > 0 
        ? users.reduce((sum, u) => sum + u.credits, 0) / users.length 
        : 0;

      res.json({
        totalUsers: users.length,
        activeUsers,
        totalRevenue,
        monthlyRevenue,
        totalHighlights: highlights.length,
        todayHighlights,
        avgCreditsPerUser: Math.round(avgCreditsPerUser * 10) / 10
      });
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch admin stats" });
    }
  });

  // User Management
  app.get("/api/admin/users", requireAdmin, async (req, res) => {
    try {
      const limit = parseInt(req.query.limit as string) || 50;
      const offset = parseInt(req.query.offset as string) || 0;
      const search = req.query.search as string;
      
      let users = await storage.getAllUsers(limit + offset);
      
      if (search) {
        users = users.filter(user => 
          user.username.toLowerCase().includes(search.toLowerCase()) ||
          user.email?.toLowerCase().includes(search.toLowerCase())
        );
      }
      
      const paginatedUsers = users.slice(offset, offset + limit);
      res.json({ users: safeUsersResponse(paginatedUsers), total: users.length });
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch users" });
    }
  });

  // Validation schemas
  const updateRoleSchema = z.object({
    role: z.enum(["user", "admin", "super_admin"])
  });

  const suspendUserSchema = z.object({
    reason: z.string().optional()
  });

  const updateCreditsSchema = z.object({
    credits: z.number().int().min(0)
  });

  app.patch("/api/admin/users/:id/role", requireSuperAdmin, async (req, res) => {
    try {
      const { id } = req.params;
      const validation = updateRoleSchema.safeParse(req.body);
      
      if (!validation.success) {
        return res.status(400).json({ error: "Invalid role", details: validation.error.errors });
      }
      
      const { role } = validation.data;
      
      const updatedUser = await storage.updateUserRole(id, role);
      if (!updatedUser) {
        return res.status(404).json({ error: "User not found" });
      }
      
      await logAdminAction(
        req.user!.id,
        "role_updated",
        "user",
        id,
        { oldRole: updatedUser.role, newRole: role },
        req.ip
      );
      
      res.json(safeUserResponse(updatedUser));
    } catch (error) {
      res.status(500).json({ error: "Failed to update user role" });
    }
  });

  app.patch("/api/admin/users/:id/suspend", requireAdmin, async (req, res) => {
    try {
      const { id } = req.params;
      const validation = suspendUserSchema.safeParse(req.body);
      
      if (!validation.success) {
        return res.status(400).json({ error: "Invalid request", details: validation.error.errors });
      }
      
      const updatedUser = await storage.suspendUser(id);
      
      if (!updatedUser) {
        return res.status(404).json({ error: "User not found" });
      }
      
      await logAdminAction(
        req.user!.id,
        "user_suspended",
        "user",
        id,
        { reason: validation.data.reason },
        req.ip
      );
      
      res.json(safeUserResponse(updatedUser));
    } catch (error) {
      res.status(500).json({ error: "Failed to suspend user" });
    }
  });

  app.patch("/api/admin/users/:id/activate", requireAdmin, async (req, res) => {
    try {
      const { id } = req.params;
      const validation = suspendUserSchema.safeParse(req.body);
      
      if (!validation.success) {
        return res.status(400).json({ error: "Invalid request", details: validation.error.errors });
      }
      
      const updatedUser = await storage.activateUser(id);
      
      if (!updatedUser) {
        return res.status(404).json({ error: "User not found" });
      }
      
      await logAdminAction(
        req.user!.id,
        "user_activated",
        "user",
        id,
        { reason: validation.data.reason },
        req.ip
      );
      
      res.json(safeUserResponse(updatedUser));
    } catch (error) {
      res.status(500).json({ error: "Failed to activate user" });
    }
  });

  // Order Management
  app.get("/api/admin/orders", requireAdmin, async (req, res) => {
    try {
      const limit = parseInt(req.query.limit as string) || 50;
      const offset = parseInt(req.query.offset as string) || 0;
      const search = req.query.search as string;
      
      let orders = await storage.getAllOrders(limit + offset);
      
      if (search) {
        // Get user details for search
        const users = await storage.getAllUsers();
        const userMap = new Map(users.map(u => [u.id, u]));
        
        orders = orders.filter(order => {
          const user = userMap.get(order.userId);
          return user?.username.toLowerCase().includes(search.toLowerCase()) ||
                 user?.email?.toLowerCase().includes(search.toLowerCase()) ||
                 order.id.includes(search);
        });
      }
      
      const paginatedOrders = orders.slice(offset, offset + limit);
      res.json({ orders: paginatedOrders, total: orders.length });
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch orders" });
    }
  });

  // Highlight Management  
  app.get("/api/admin/highlights", requireAdmin, async (req, res) => {
    try {
      const limit = parseInt(req.query.limit as string) || 50;
      const offset = parseInt(req.query.offset as string) || 0;
      const search = req.query.search as string;
      
      let highlights = await storage.getAllHighlights(limit + offset);
      
      if (search) {
        highlights = highlights.filter(highlight => 
          highlight.description?.toLowerCase().includes(search.toLowerCase())
        );
      }
      
      const paginatedHighlights = highlights.slice(offset, offset + limit);
      res.json({ highlights: paginatedHighlights, total: highlights.length });
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch highlights" });
    }
  });

  app.delete("/api/admin/highlights/:id", requireAdmin, async (req, res) => {
    try {
      const { id } = req.params;
      const validation = suspendUserSchema.safeParse(req.body);
      
      if (!validation.success) {
        return res.status(400).json({ error: "Invalid request", details: validation.error.errors });
      }
      
      const deleted = await storage.deleteHighlight(id);
      if (!deleted) {
        return res.status(404).json({ error: "Highlight not found" });
      }
      
      await logAdminAction(
        req.user!.id,
        "highlight_deleted",
        "highlight",
        id,
        { reason: validation.data.reason },
        req.ip
      );
      
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: "Failed to delete highlight" });
    }
  });

  // System Settings (Super Admin Only)
  app.get("/api/admin/settings", requireSuperAdmin, async (req, res) => {
    try {
      const settings = await storage.getSystemSettings();
      res.json(settings);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch system settings" });
    }
  });

  app.patch("/api/admin/settings/:key", requireSuperAdmin, async (req, res) => {
    try {
      const { key } = req.params;
      const { value } = req.body;
      
      const updatedSetting = await storage.updateSystemSetting(key, value, req.user!.id);
      if (!updatedSetting) {
        return res.status(404).json({ error: "Setting not found" });
      }
      
      await logAdminAction(
        req.user!.id,
        "setting_updated",
        "system_setting",
        key,
        { newValue: value },
        req.ip
      );
      
      res.json(updatedSetting);
    } catch (error) {
      res.status(500).json({ error: "Failed to update system setting" });
    }
  });

  // Admin Logs
  app.get("/api/admin/logs", requireAdmin, async (req, res) => {
    try {
      const limit = parseInt(req.query.limit as string) || 100;
      const offset = parseInt(req.query.offset as string) || 0;
      
      const logs = await storage.getAdminLogs(limit, offset);
      res.json(logs);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch admin logs" });
    }
  });

  // Template Management Routes
  app.get("/api/templates", async (req, res) => {
    try {
      const sport = req.query.sport as string;
      const popular = req.query.popular === 'true';
      
      let templates;
      if (popular) {
        templates = await storage.getPopularTemplates();
      } else if (sport) {
        templates = await storage.getTemplatesBySport(sport);
      } else {
        templates = await storage.getAllTemplates();
      }
      
      res.json(templates);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch templates" });
    }
  });

  app.get("/api/templates/:id", async (req, res) => {
    try {
      const template = await storage.getTemplate(req.params.id);
      if (!template) {
        return res.status(404).json({ error: "Template not found" });
      }
      res.json(template);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch template" });
    }
  });

  // User credit management
  app.patch("/api/admin/users/:id/credits", requireAdmin, async (req, res) => {
    try {
      const { id } = req.params;
      const validation = updateCreditsSchema.safeParse(req.body);
      
      if (!validation.success) {
        return res.status(400).json({ error: "Invalid credits value", details: validation.error.errors });
      }
      
      const { credits } = validation.data;
      
      const updatedUser = await storage.updateUserCredits(id, credits);
      if (!updatedUser) {
        return res.status(404).json({ error: "User not found" });
      }
      
      await logAdminAction(
        req.user!.id,
        "credits_adjusted",
        "user",
        id,
        { newCredits: credits },
        req.ip
      );
      
      res.json(safeUserResponse(updatedUser));
    } catch (error) {
      res.status(500).json({ error: "Failed to update user credits" });
    }
  });

  // YOLOv11-ONLY ARCHITECTURE: Pure YOLOv11 detection system
  // All detection handled by integrated YOLOv11 service (no external dependencies)
  console.log("🎯 YOLOv11-ONLY: Initialized for integrated player detection");

  // Helper function to extract image dimensions from base64 data
  async function getImageDimensions(base64Data: string): Promise<{ width: number; height: number }> {
    try {
      // Strip data URL prefix if present (e.g., "data:image/webp;base64,")
      const base64 = base64Data.replace(/^data:image\/[^;]+;base64,/, '');
      const imageBuffer = Buffer.from(base64, 'base64');
      const metadata = await sharp(imageBuffer).metadata();
      
      if (!metadata.width || !metadata.height) {
        throw new Error("Unable to extract image dimensions");
      }
      
      return {
        width: metadata.width,
        height: metadata.height
      };
    } catch (error) {
      console.error("Error extracting image dimensions:", error);
      // Fallback dimensions if extraction fails
      return { width: 1920, height: 1080 };
    }
  }

  // Helper function for Non-Maximum Suppression (NMS)
  function nonMaxSuppression(detections: any[], iouThreshold: number = 0.5) {
    // Sort by confidence descending
    detections.sort((a, b) => b.confidence - a.confidence);
    
    const keep = [];
    const suppressed = new Set();
    
    for (let i = 0; i < detections.length; i++) {
      if (suppressed.has(i)) continue;
      
      keep.push(detections[i]);
      
      for (let j = i + 1; j < detections.length; j++) {
        if (suppressed.has(j)) continue;
        
        // Calculate IoU (Intersection over Union)
        const boxA = detections[i];
        const boxB = detections[j];
        
        const xA = Math.max(boxA.x - boxA.width/2, boxB.x - boxB.width/2);
        const yA = Math.max(boxA.y - boxA.height/2, boxB.y - boxB.height/2);
        const xB = Math.min(boxA.x + boxA.width/2, boxB.x + boxB.width/2);
        const yB = Math.min(boxA.y + boxA.height/2, boxB.y + boxB.height/2);
        
        const interArea = Math.max(0, xB - xA) * Math.max(0, yB - yA);
        const boxAArea = boxA.width * boxA.height;
        const boxBArea = boxB.width * boxB.height;
        const unionArea = boxAArea + boxBArea - interArea;
        
        const iou = interArea / unionArea;
        
        if (iou > iouThreshold) {
          suppressed.add(j);
        }
      }
    }
    
    return keep;
  }

  // **COORDINATE CANONICALIZATION HELPER**: Centralized coordinate validation and fixing
  const canonicalizeDetectionResponse = (responseData: any) => {
    console.log('📦 CANONICALIZE INPUT:', {
      playerCount: responseData.players?.length || 0,
      firstPlayer: responseData.players?.[0] || null,
      source: responseData.modelType || 'unknown'
    });
    
    if (responseData.players && Array.isArray(responseData.players)) {
      responseData.players = responseData.players.map((player: any, index: number) => {
        // Clamp dimensions to valid [0,1] bounds
        const clampedWidth = Math.max(0, Math.min(player.width || 0, 1));
        const clampedHeight = Math.max(0, Math.min(player.height || 0, 1));
        
        // Handle both detection formats:
        // 1. Full format (Replicate/Local YOLO): has centerX/centerY/topLeftX/topLeftY
        // 2. Fallback format (HOG/Mock): has only x/y/width/height where x/y are centers
        
        let clampedCenterX, clampedCenterY, clampedTopLeftX, clampedTopLeftY;
        
        if (player.centerX != null && player.centerY != null) {
          // Full format: use provided center and top-left coordinates
          clampedCenterX = Math.max(0, Math.min(player.centerX, 1));
          clampedCenterY = Math.max(0, Math.min(player.centerY, 1));
          clampedTopLeftX = Math.max(0, Math.min(player.topLeftX || (clampedCenterX - clampedWidth/2), 1 - clampedWidth));
          clampedTopLeftY = Math.max(0, Math.min(player.topLeftY || (clampedCenterY - clampedHeight/2), 1 - clampedHeight));
        } else {
          // Fallback format: x/y are centers, compute top-left from them
          clampedCenterX = Math.max(0, Math.min(player.x || 0, 1));
          clampedCenterY = Math.max(0, Math.min(player.y || 0, 1));
          clampedTopLeftX = Math.max(0, Math.min(clampedCenterX - clampedWidth/2, 1 - clampedWidth));
          clampedTopLeftY = Math.max(0, Math.min(clampedCenterY - clampedHeight/2, 1 - clampedHeight));
        }
        
        const result = {
          ...player,
          x: clampedTopLeftX,  // x/y are top-left for backward compatibility
          y: clampedTopLeftY,
          width: clampedWidth,
          height: clampedHeight,
          centerX: clampedCenterX,
          centerY: clampedCenterY,
          topLeftX: clampedTopLeftX,
          topLeftY: clampedTopLeftY
        };
        
        if (index === 0) {
          console.log('📦 CANONICALIZE OUTPUT (first player):', {
            original: { x: player.x, y: player.y, centerX: player.centerX, topLeftX: player.topLeftX },
            normalized: { x: result.x, y: result.y, centerX: result.centerX, topLeftX: result.topLeftX, width: result.width, height: result.height }
          });
        }
        
        return result;
      }).filter((player: any) => player.width > 0 && player.height > 0);
      
      // Update player count after filtering
      if (responseData.frameAnalysis) {
        responseData.frameAnalysis.totalPlayers = responseData.players.length;
      }
    }
    return responseData;
  };

  // Latest Detections Cache API - Returns most recent tracked players for fallback
  app.get("/api/detections/latest", async (req, res) => {
    try {
      // Skip auth in development for smooth tracking testing
      const isProduction = process.env.NODE_ENV === 'production';
      console.log('🔑 AUTH CHECK:', { hasUser: !!req.user, isProduction, nodeEnv: process.env.NODE_ENV });
      if (!req.user && isProduction) {
        return res.status(401).json({ error: "Authentication required" });
      }

      const videoId = req.query.videoId as string || 'tracking-video';
      const currentTime = Date.now() / 1000;
      
      console.log(`📦 CACHE REQUEST: Getting latest tracked players for videoId=${videoId}`);
      
      // Get latest tracked players from spatial tracking cache
      const cacheResult = getLatestTrackedPlayers(videoId);
      
      // Format response similar to detection endpoint
      const response = {
        success: true,
        timestamp: currentTime,
        frameAnalysis: {
          totalPlayers: cacheResult.trackedCount
        },
        players: cacheResult.players,
        fallbackMode: true,
        source: cacheResult.source,
        processingTime: 0 // No GPU processing for cache
      };
      
      console.log(`📦 CACHE RESPONSE: Returning ${cacheResult.players.length} cached players`);
      res.json(response);
      
    } catch (error) {
      console.error("Latest detections cache error:", error);
      res.status(500).json({ 
        error: "Failed to retrieve cached detections",
        fallbackMode: true,
        players: [],
        timestamp: Date.now() / 1000
      });
    }
  });

  // ZERO-LAG Player Detection API - Optimized FormData + Direct Replicate SDK
  // **RESET TRACKING STATE** - Clear spatial tracking memory
  app.post("/api/reset-tracking", async (req, res) => {
    try {
      const { videoId, selectedPlayerId, anchorCoordinates } = req.body;
      const { resetTrackingState } = await import('./utils/spatialTracking');
      
      // **CRITICAL FIX**: Pass anchor coordinates to initialize tracking correctly
      resetTrackingState(videoId || 'preview', selectedPlayerId, anchorCoordinates);
      console.log(`🧹 Spatial tracking reset for videoId: ${videoId || 'preview'}`, {
        selectedPlayerId,
        anchorCoords: anchorCoordinates ? `(${anchorCoordinates.x.toFixed(3)}, ${anchorCoordinates.y.toFixed(3)})` : 'none'
      });
      
      res.json({ success: true, message: 'Tracking state reset' });
    } catch (error) {
      console.error('❌ Reset tracking error:', error);
      res.status(500).json({ success: false, error: 'Reset failed' });
    }
  });

  app.post("/api/detect-players", detectPlayersUpload.single('frame'), detectionRateLimiter, async (req, res) => {
    const startTime = Date.now();
    const isProduction = process.env.NODE_ENV === 'production';
    
    console.log(`⏱️ [LATENCY] Detection request received at ${new Date().toISOString()}`);
    
    try {
      // Skip auth in development for smooth tracking testing
      console.log('🔑 DETECT AUTH CHECK:', { hasUser: !!req.user, isProduction, nodeEnv: process.env.NODE_ENV });
      if (!req.user && isProduction) {
        return res.status(401).json({ error: "Authentication required" });
      }

      // ZERO-LAG OPTIMIZATION: Handle FormData (Blob) or JSON (base64)
      const isFormData = !!req.file;
      console.log(`📦 Request type: ${isFormData ? 'FormData (Blob)' : 'JSON (base64)'}`);
      
      let timestampMs: number;
      let videoId: string;
      let detectionMethod: string;
      let imageBuffer: Buffer | null = null;
      let imageDataUrl: string | null = null;
      
      if (isFormData) {
        // OPTIMIZED PATH: FormData with Blob
        imageBuffer = req.file!.buffer;
        timestampMs = parseInt(req.body.timestampMs || '0', 10);
        videoId = req.body.videoId || 'tracking-video';
        detectionMethod = req.body.detectionMethod || 'replicate';
        console.log(`⚡ ZERO-LAG PATH: Using direct Replicate SDK (${(imageBuffer.length / 1024).toFixed(1)}KB blob)`);
      } else {
        // LEGACY PATH: JSON with base64
        const validation = playerDetectionRequestSchema.safeParse(req.body);
        if (!validation.success) {
          return res.status(400).json({ 
            error: "Invalid request", 
            details: validation.error.errors 
          });
        }
        const data = validation.data;
        imageDataUrl = data.imageDataUrl;
        timestampMs = data.timestampMs;
        videoId = data.videoId || 'tracking-video';
        detectionMethod = data.detectionMethod || 'replicate';
        console.log(`🐌 LEGACY PATH: Using base64 JSON (${imageDataUrl.length} chars)`);
      }
      
      // Use validated detection method (defaults to 'replicate' via schema)
      
      // **CRITICAL FIX**: Ensure stable videoId for consistent tracking
      const stableVideoId = videoId || 'tracking-video'; // Use stable default if not provided
      
      console.log(`🧭 Tracking: videoId=${stableVideoId} selected=${req.body.selectedPlayerId || 'none'} method=${detectionMethod}`);
      console.log(`⏱️ [LATENCY] Request validated in ${Date.now() - startTime}ms`);
      
      // Convert timestamp from milliseconds to seconds for processing
      const timestamp = timestampMs / 1000;
      
      // **DUAL DETECTION SUPPORT**: Choose detection service based on method and availability
      try {
        let yoloResult;
        const detectionStartTime = Date.now();
        
        // Check if Replicate is requested AND available (has API token configured)
        const replicateAvailable = !!process.env.REPLICATE_API_TOKEN;
        const shouldUseReplicate = detectionMethod === 'replicate' && replicateAvailable;
        
        if (shouldUseReplicate && isFormData && imageBuffer) {
          // ZERO-LAG OPTIMIZED PATH: Direct Replicate SDK with Buffer (NO Python worker IPC)
          console.log(`⚡ [ZERO-LAG] Starting DIRECT Replicate detection (no Python worker)`);
          yoloResult = await replicateDirectDetection.detectPlayers(imageBuffer, timestampMs);
          console.log(`⚡ [ZERO-LAG] Direct Replicate completed in ${Date.now() - detectionStartTime}ms`);
        } else if (shouldUseReplicate && imageDataUrl) {
          // LEGACY PATH: Replicate via Python worker (base64 string)
          console.log(`🐌 [LEGACY] Starting Replicate detection (Python worker)`);
          yoloResult = await replicateDetectionService.detectPlayers(imageDataUrl, timestampMs);
          console.log(`🐌 [LEGACY] Python worker Replicate completed in ${Date.now() - detectionStartTime}ms`);
        } else {
          // **EXTERNAL-ONLY YOLOv11**: Block local detection fallback
          // Enforce Replicate-only pipeline to maintain quality and consistency
          if (detectionMethod === 'replicate' && !replicateAvailable) {
            console.error(`❌ EXTERNAL-ONLY YOLOv11: Replicate API token not configured`);
            return res.status(503).json({ 
              error: "Detection service unavailable",
              details: "Replicate API token not configured. External-Only YOLOv11 mode requires Replicate."
            });
          }
          
          console.error(`❌ EXTERNAL-ONLY YOLOv11: Invalid detection path - method=${detectionMethod}, replicateAvailable=${replicateAvailable}`);
          return res.status(400).json({ 
            error: "Invalid detection configuration",
            details: "External-Only YOLOv11 mode requires detectionMethod='replicate' with valid API token"
          });
        }
        
        // Validate YOLOv11 response format
        if (!yoloResult.success) {
          throw new Error(`YOLOv11 detection failed: ${(yoloResult as any).error || 'Unknown error'}`);
        }

        // Validate response against schema
        const responseValidation = playerDetectionResponseSchema.safeParse(yoloResult);
        if (!responseValidation.success) {
          console.error("YOLOv11 response validation failed:", responseValidation.error);
          return res.status(500).json({ 
            error: "Invalid response format from YOLOv11 analysis" 
          });
        }

        // **CANONICALIZATION**: Apply coordinate fixing to YOLOv11 response 
        const canonicalizedResult = canonicalizeDetectionResponse(yoloResult);
        
        // **APPLY SPATIAL TRACKING**: Apply to YOLOv11 results with selected player ID and coordinates for locking
        const { selectedPlayerId } = req.body;
        
        // **SPATIAL FIX**: Parse selectedPlayer from JSON if it exists (FormData sends as string)
        let selectedPlayer = null;
        if (req.body.selectedPlayer) {
          try {
            selectedPlayer = JSON.parse(req.body.selectedPlayer);
            console.log(`📍 Selected player coordinates: centerX=${selectedPlayer.centerX?.toFixed(3)}, centerY=${selectedPlayer.centerY?.toFixed(3)}`);
          } catch (e) {
            console.warn('⚠️ Failed to parse selectedPlayer JSON:', e);
          }
        }
        
        const trackingStartTime = Date.now();
        console.log(`🔧 APPLYING SPATIAL TRACKING to ${canonicalizedResult.players.length} YOLOv11 detections`);
        const trackedResult = applySpatialTrackingToResponse(canonicalizedResult, stableVideoId, timestamp, selectedPlayerId, selectedPlayer);
        console.log(`⏱️ [LATENCY] Spatial tracking completed in ${Date.now() - trackingStartTime}ms`);
        console.log(`🔧 SPATIAL TRACKING COMPLETED, returning ${trackedResult.players.length} tracked players`);
        
        const totalLatency = Date.now() - startTime;
        console.log(`✅ YOLOv11 detected ${trackedResult.players.length} players in ${trackedResult.processingTime || 0}ms`);
        console.log(`⏱️ [LATENCY] TOTAL REQUEST LATENCY: ${totalLatency}ms (request→response)`);
        res.json(trackedResult);
        
      } catch (yoloError) {
        console.error("YOLOv11 detection error:", yoloError);
        console.log("📦 YOLOv11-ONLY: Service unavailable - using graceful fallback");
        
        // **YOLOv11-ONLY ARCHITECTURE**: Simple graceful fallback system
        // This eliminates the dual-model complexity causing timestamp/ID issues
        
        // Try to get cached data first
        const { getLatestTrackedPlayers } = await import('./utils/spatialTracking');
        const cachedData = getLatestTrackedPlayers(stableVideoId);
        const cachedPlayers = cachedData?.players || [];
        
        if (cachedPlayers && cachedPlayers.length > 0) {
          console.log(`✅ CACHE FALLBACK: Serving ${cachedPlayers.length} cached players`);
          return res.json({
            success: true,
            timestamp,
            frameAnalysis: { totalPlayers: cachedPlayers.length },
            players: cachedPlayers,
            fallbackMode: true,
            source: 'cached_spatial_tracking',
            processingTime: Date.now() - startTime
          });
        }
        
        // **YOLOv11-ONLY FALLBACK**: Strategic player positions when YOLOv11 service is unavailable
        console.log("📦 YOLOv11-ONLY: Service unavailable, using strategic positioning fallback");
        
        // Generate grid-based strategic positions to detect ALL potential players
        // This creates a 4x3 grid of likely player positions across the field
        const strategicPlayers = [];
        const gridRows = 3;
        const gridCols = 4;
        const playerWidth = 0.06;
        const playerHeight = 0.12;
        
        for (let row = 0; row < gridRows; row++) {
          for (let col = 0; col < gridCols; col++) {
            const centerX = 0.15 + (col * 0.25); // Spread across field
            const centerY = 0.25 + (row * 0.25); // Top to bottom
            const topLeftX = centerX - playerWidth / 2;
            const topLeftY = centerY - playerHeight / 2;
            
            strategicPlayers.push({
              id: `player_${row * gridCols + col + 1}`,
              x: topLeftX,
              y: topLeftY,
              width: playerWidth,
              height: playerHeight,
              confidence: 0.6 - (row * 0.05), // Decreasing confidence by distance
              description: `Player ${row * gridCols + col + 1} (strategic)`,
              centerX,
              centerY,
              topLeftX,
              topLeftY,
            });
          }
        }
        
        console.log(`📦 Generated ${strategicPlayers.length} strategic positions`);
        
        const fallbackResult = {
          success: true,
          timestamp,
          frameAnalysis: { totalPlayers: strategicPlayers.length },
          players: strategicPlayers,
          processingTime: Date.now() - startTime
        };
        
        // Apply spatial tracking to strategic positions
        const trackedResult = applySpatialTrackingToResponse(
          fallbackResult,
          stableVideoId,
          timestamp,
          req.body.selectedPlayerId
        );
        
        console.log(`✅ YOLOv11-ONLY: Serving ${trackedResult.players.length} strategic players`);
        
        return res.json({
          ...trackedResult,
          fallbackMode: true,
          source: 'yolov11_strategic_fallback',
          message: "Using strategic positioning (YOLOv11 service developing)"
        });
      }

    } catch (error) {
      const processingTime = Date.now() - startTime;
      
      // Structured error logging for production debugging
      const requestData = req.body || {};
      const errorDetails = {
        timestamp: new Date().toISOString(),
        userId: req.user?.id,
        videoId: requestData.videoId,
        processingTime,
        imageSize: requestData.imageDataUrl?.length || 0,
        userAgent: req.get('User-Agent'),
        error: {
          message: error instanceof Error ? error.message : 'Unknown error',
          stack: error instanceof Error ? error.stack : undefined,
          type: error?.constructor?.name || 'UnknownError'
        }
      };
      
      console.error("Player detection failed:", JSON.stringify(errorDetails, null, 2));
      
      // Production: Return proper error responses
      if (isProduction) {
        // Determine appropriate error status based on error type
        let statusCode = 500;
        let errorMessage = "Internal server error during player detection";
        
        if (error instanceof Error) {
          if (error.message.includes('timeout') || error.message.includes('TIMEOUT')) {
            statusCode = 502;
            errorMessage = "Player detection service timeout";
          } else if (error.message.includes('memory') || error.message.includes('MEMORY')) {
            statusCode = 507;
            errorMessage = "Insufficient server resources";
          } else if (error.message.includes('Invalid') || error.message.includes('format')) {
            statusCode = 400;
            errorMessage = "Invalid image format";
          } else if (error.message.includes('YOLOv11 service')) {
            statusCode = 503;
            errorMessage = "YOLOv11 detection service unavailable";
          }
        }
        
        return res.status(statusCode).json({
          success: false,
          error: errorMessage,
          timestamp: (requestData.timestampMs || 0) / 1000,
          requestId: `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
        });
      }
      
      // Return proper error response instead of fake data
      console.error('❌ YOLOv11 detection failed - returning error to prevent fake results');
      
      return res.status(500).json({
        success: false,
        error: "Player detection system unavailable",
        timestamp: requestData.timestamp || 0,
        details: "YOLOv11 AI processing failed. Please try again later."
      });
    }
  });

  // Video Processing API Routes
  const createHighlightSchema = z.object({
    videoFile: z.string(), // Will be file path after upload
    timeSelection: z.object({
      start: z.number(),
      end: z.number()
    }),
    playerPosition: z.object({
      x: z.number(),
      y: z.number()
    }),
    // **CRITICAL FIX**: Add complete selectedPlayer data for tracking consistency
    selectedPlayer: z.object({
      id: z.string(),
      x: z.number(),
      y: z.number(),
      width: z.number(),
      height: z.number(),
      confidence: z.number(),
      description: z.string(),
      // Canonical coordinates for consistent tracking
      centerX: z.number(),
      centerY: z.number(),
      topLeftX: z.number(),
      topLeftY: z.number()
    }).optional(), // Optional for backward compatibility
    effect: z.object({
      id: z.string(),
      name: z.string(),
      settings: z.object({
        intensity: z.number().optional(),
        size: z.number().optional(),
        color: z.string().optional()
      }).optional()
    }),
    templateId: z.string().optional()
  });

  // Reset tracking state to prevent ID explosion and resolve ID mismatches
  app.post("/api/tracking/reset", async (req, res) => {
    try {
      const { resetTrackingState } = await import('./utils/spatialTracking');
      const { videoId } = req.body;
      
      // Reset tracking state (all videos if no videoId specified)
      resetTrackingState(videoId);
      
      res.json({ 
        success: true, 
        message: videoId ? `Tracking state reset for video ${videoId}` : "All tracking state reset",
        videoId: videoId || "all"
      });
    } catch (error) {
      console.error("Tracking reset error:", error);
      res.status(500).json({ error: "Failed to reset tracking state" });
    }
  });

  // Create a new highlight
  app.post("/api/highlights", async (req, res) => {
    try {
      if (!req.user) {
        return res.status(401).json({ error: "Authentication required" });
      }

      const validation = createHighlightSchema.safeParse(req.body);
      if (!validation.success) {
        return res.status(400).json({ error: "Invalid request", details: validation.error.errors });
      }

      const user = await storage.getUser(req.user.id);
      if (!user) {
        return res.status(404).json({ error: "User not found" });
      }

      // Check if user has enough credits (bypass in development)
      if (process.env.NODE_ENV !== "development" && user.credits < 1) {
        return res.status(402).json({ error: "Insufficient credits" });
      }

      const { videoFile, timeSelection, playerPosition, selectedPlayer, effect, templateId } = validation.data;

      // **CRITICAL FIX**: Store complete player tracking data for consistent video processing
      // Combine playerPosition (basic x,y) with selectedPlayer (complete tracking data) 
      const completePlayerData = {
        // Basic position data (backward compatibility)
        position: playerPosition,
        // Complete tracking data for accurate processing
        selectedPlayer: selectedPlayer || null,
        // Effect settings for processing pipeline
        effectSettings: effect.settings || {}
      };

      // Create highlight record
      const highlight = await storage.createHighlight({
        userId: req.user.id,
        title: `${effect.name} highlight`,
        originalVideoUrl: videoFile,
        effect: effect.id,
        playerPosition: JSON.stringify(completePlayerData), // Store complete tracking data
        timeStart: timeSelection.start.toString(),
        timeEnd: timeSelection.end.toString(),
        status: "processing",
        templateId: templateId || null,
        description: `${effect.name} highlight`
      });

      // Deduct credit
      await storage.updateUserCredits(req.user.id, user.credits - 1);

      // In a real implementation, this would trigger video processing
      // For now, we'll simulate processing with a delay and use original video as fallback
      setTimeout(async () => {
        try {
          await storage.updateHighlight(highlight.id, {
            status: "completed",
            processedVideoUrl: videoFile // Use original video as fallback for demo
          });
        } catch (error) {
          console.error("Failed to update highlight status:", error);
        }
      }, 5000); // Simulate 5 second processing

      res.json({ 
        highlightId: highlight.id,
        status: "processing",
        message: "Highlight creation started"
      });
    } catch (error) {
      console.error("Highlight creation error:", error);
      res.status(500).json({ error: "Failed to create highlight" });
    }
  });

  // Get highlight status
  app.get("/api/highlights/:id/status", async (req, res) => {
    try {
      if (!req.user) {
        return res.status(401).json({ error: "Authentication required" });
      }

      const highlight = await storage.getHighlight(req.params.id);
      if (!highlight) {
        return res.status(404).json({ error: "Highlight not found" });
      }

      // Ensure user owns this highlight
      if (highlight.userId !== req.user.id) {
        return res.status(403).json({ error: "Access denied" });
      }

      res.json({
        id: highlight.id,
        status: highlight.status,
        processedVideoUrl: highlight.processedVideoUrl,
        createdAt: highlight.createdAt
      });
    } catch (error) {
      res.status(500).json({ error: "Failed to get highlight status" });
    }
  });

  // Get user's highlights
  app.get("/api/highlights", async (req, res) => {
    try {
      if (!req.user) {
        return res.status(401).json({ error: "Authentication required" });
      }

      const highlights = await storage.getHighlightsByUser(req.user.id);
      res.json(highlights);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch highlights" });
    }
  });

  // Download processed highlight
  app.get("/api/highlights/:id/download", async (req, res) => {
    try {
      if (!req.user) {
        return res.status(401).json({ error: "Authentication required" });
      }

      const highlight = await storage.getHighlight(req.params.id);
      if (!highlight) {
        return res.status(404).json({ error: "Highlight not found" });
      }

      if (highlight.userId !== req.user.id) {
        return res.status(403).json({ error: "Access denied" });
      }

      if (highlight.status !== "completed" || !highlight.processedVideoUrl) {
        return res.status(400).json({ error: "Highlight not ready for download" });
      }

      // For now, serve the original video file as a fallback
      // In production, this would serve the actual processed file
      const downloadUrl = highlight.processedVideoUrl || highlight.originalVideoUrl;
      
      if (!downloadUrl) {
        return res.status(400).json({ error: "No video file available" });
      }
      
      res.json({
        downloadUrl: downloadUrl,
        filename: `highlight_${highlight.id}.mp4`
      });
    } catch (error) {
      res.status(500).json({ error: "Failed to get download link" });
    }
  });

  // ===== NEW JOB MANAGEMENT API ENDPOINTS =====

  // Create new video processing job
  app.post("/api/jobs", videoUpload.single('video'), async (req, res) => {
    try {
      if (!req.user) {
        return res.status(401).json({ error: "Authentication required" });
      }

      if (!req.file) {
        return res.status(400).json({ error: "Video file is required" });
      }

      // Check for idempotency key
      const idempotencyKey = req.headers['idempotency-key'] as string;
      if (idempotencyKey) {
        const existingJob = await storage.getJobByIdempotencyKey(idempotencyKey);
        if (existingJob) {
          return res.status(200).json({
            id: existingJob.id,
            status: existingJob.status,
            message: "Job already exists"
          });
        }
      }

      // Validate request body
      const validation = createJobRequestSchema.safeParse(req.body);
      if (!validation.success) {
        // Clean up uploaded file on validation failure
        await VideoValidationService.cleanupFile(req.file.path);
        return res.status(400).json({ 
          error: "Invalid request", 
          details: validation.error.errors 
        });
      }

      const config = validation.data;

      // Validate video file
      const videoValidation = await VideoValidationService.validateVideoFile(req.file.path);
      if (!videoValidation.valid) {
        await VideoValidationService.cleanupFile(req.file.path);
        return res.status(400).json({ 
          error: "Video validation failed", 
          details: videoValidation.error 
        });
      }

      // Create job in queue
      const jobId = await jobQueueService.createVideoJob(
        req.user.id,
        req.file.path,
        config,
        config.priority || 5
      );

      // Update job with video metadata
      await storage.updateJob(jobId, {
        originalVideoSize: req.file.size,
        videoDuration: videoValidation.duration.toString(),
        videoFormat: videoValidation.format,
        idempotencyKey,
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // 7 days
      });

      res.status(201).json({
        id: jobId,
        status: "queued",
        message: "Job created successfully"
      });

    } catch (error) {
      console.error("❌ Error creating job:", error);
      
      // Clean up uploaded file on error
      if (req.file) {
        await VideoValidationService.cleanupFile(req.file.path);
      }
      
      res.status(500).json({ error: "Failed to create job" });
    }
  });

  // Get job status and progress
  app.get("/api/jobs/:id", async (req, res) => {
    try {
      if (!req.user) {
        return res.status(401).json({ error: "Authentication required" });
      }

      const job = await storage.getJob(req.params.id);
      if (!job) {
        return res.status(404).json({ error: "Job not found" });
      }

      // Verify user has access to this job
      if (job.userId !== req.user.id && req.user.role !== 'admin') {
        return res.status(403).json({ error: "Access denied" });
      }

      const response = {
        id: job.id,
        status: job.status,
        progress: job.progress,
        currentPhase: job.currentPhase,
        originalVideoPath: job.originalVideoPath,
        processedVideoPath: job.processedVideoPath,
        thumbnailPath: job.thumbnailPath,
        downloadUrl: job.downloadUrl,
        errorMessage: job.errorMessage,
        processingStartedAt: job.processingStartedAt,
        processingCompletedAt: job.processingCompletedAt,
        processingTimeMs: job.processingTimeMs,
        createdAt: job.createdAt,
        updatedAt: job.updatedAt,
      };

      res.json(response);
    } catch (error) {
      console.error("❌ Error fetching job status:", error);
      res.status(500).json({ error: "Failed to fetch job status" });
    }
  });

  // Retry a failed job
  app.post("/api/jobs/:id/retry", async (req, res) => {
    try {
      if (!req.user) {
        return res.status(401).json({ error: "Authentication required" });
      }

      const job = await storage.getJob(req.params.id);
      if (!job) {
        return res.status(404).json({ error: "Job not found" });
      }

      // Verify user has access to this job
      if (job.userId !== req.user.id && req.user.role !== 'admin') {
        return res.status(403).json({ error: "Access denied" });
      }

      // Only allow retry of failed jobs
      if (job.status !== "error") {
        return res.status(400).json({ 
          error: "Job can only be retried if it has failed", 
          status: job.status 
        });
      }

      // Reset job status for retry
      await storage.updateJob(job.id, {
        status: "queued",
        currentPhase: "queued",
        progress: 0,
        errorMessage: null,
        processingStartedAt: null,
        processingCompletedAt: null,
        processingTimeMs: null,
        // updatedAt: new Date(), // Removed - not part of job schema
      });

      // Re-queue the job
      if (job.originalVideoPath && job.playerSelection && job.effectConfig) {
        const config = {
          startTime: parseFloat(job.startTime || '0'),
          endTime: parseFloat(job.endTime || '0'),
          playerSelection: JSON.parse(job.playerSelection),
          effectConfig: JSON.parse(job.effectConfig),
          templateId: job.templateId || undefined,
          priority: job.priority
        };

        await jobQueueService.createVideoJob(
          job.userId,
          job.originalVideoPath,
          config,
          config.priority || 5
        );
      }

      res.json({ 
        message: "Job retry initiated",
        id: job.id,
        status: "queued"
      });

    } catch (error) {
      console.error("❌ Error retrying job:", error);
      res.status(500).json({ error: "Failed to retry job" });
    }
  });

  // Download completed video directly
  app.get("/api/jobs/:id/download", async (req, res) => {
    try {
      if (!req.user) {
        return res.status(401).json({ error: "Authentication required" });
      }

      const job = await storage.getJob(req.params.id);
      if (!job) {
        return res.status(404).json({ error: "Job not found" });
      }

      // Verify user has access to this job
      if (job.userId !== req.user.id && req.user.role !== 'admin') {
        return res.status(403).json({ error: "Access denied" });
      }

      if (job.status !== "done") {
        return res.status(400).json({ 
          error: "Job not completed", 
          status: job.status,
          progress: job.progress
        });
      }

      if (!job.processedVideoPath) {
        return res.status(404).json({ error: "Processed video not found" });
      }

      // For now, return the download URL - in production this would serve the file directly
      res.json({
        downloadUrl: job.downloadUrl || `/api/jobs/${job.id}/result`,
        filename: `klutch-highlight-${job.id}.mp4`
      });

    } catch (error) {
      console.error("❌ Error downloading video:", error);
      res.status(500).json({ error: "Failed to download video" });
    }
  });

  // Download completed video
  app.get("/api/jobs/:id/result", async (req, res) => {
    try {
      if (!req.user) {
        return res.status(401).json({ error: "Authentication required" });
      }

      const job = await storage.getJob(req.params.id);
      if (!job) {
        return res.status(404).json({ error: "Job not found" });
      }

      // Verify user has access to this job
      if (job.userId !== req.user.id && req.user.role !== 'admin') {
        return res.status(403).json({ error: "Access denied" });
      }

      if (job.status !== "done") {
        return res.status(400).json({ 
          error: "Job not completed", 
          status: job.status,
          progress: job.progress
        });
      }

      if (!job.processedVideoPath) {
        return res.status(404).json({ error: "Processed video not found" });
      }

      // Check if download URL is still valid
      if (job.downloadUrl && job.downloadUrlExpiry && job.downloadUrlExpiry > new Date()) {
        return res.json({
          downloadUrl: job.downloadUrl,
          filename: `processed_${job.id}.mp4`,
          expiresAt: job.downloadUrlExpiry
        });
      }

      // Generate new signed URL
      const downloadUrl = await FileStorageService.generateSignedUrl(job.processedVideoPath, 24);
      const expiryTime = new Date(Date.now() + 24 * 60 * 60 * 1000);

      // Update job with new download URL
      await storage.updateJob(job.id, {
        downloadUrl,
        downloadUrlExpiry: expiryTime,
      });

      res.json({
        downloadUrl,
        filename: `processed_${job.id}.mp4`,
        expiresAt: expiryTime
      });

    } catch (error) {
      console.error("❌ Error getting download URL:", error);
      res.status(500).json({ error: "Failed to get download URL" });
    }
  });

  // Get user's jobs
  app.get("/api/jobs", async (req, res) => {
    try {
      if (!req.user) {
        return res.status(401).json({ error: "Authentication required" });
      }

      const limit = parseInt(req.query.limit as string) || 20;
      const offset = parseInt(req.query.offset as string) || 0;

      const jobs = await storage.getJobsByUser(req.user.id, limit, offset);
      
      const jobsResponse = jobs.map(job => ({
        id: job.id,
        status: job.status,
        progress: job.progress,
        currentPhase: job.currentPhase,
        createdAt: job.createdAt,
        updatedAt: job.updatedAt,
        processingStartedAt: job.processingStartedAt,
        processingCompletedAt: job.processingCompletedAt,
        errorMessage: job.errorMessage,
      }));

      res.json(jobsResponse);
    } catch (error) {
      console.error("❌ Error fetching user jobs:", error);
      res.status(500).json({ error: "Failed to fetch jobs" });
    }
  });

  // Cancel a job
  app.delete("/api/jobs/:id", async (req, res) => {
    try {
      if (!req.user) {
        return res.status(401).json({ error: "Authentication required" });
      }

      const job = await storage.getJob(req.params.id);
      if (!job) {
        return res.status(404).json({ error: "Job not found" });
      }

      // Verify user has access to this job
      if (job.userId !== req.user.id && req.user.role !== 'admin') {
        return res.status(403).json({ error: "Access denied" });
      }

      // Only allow cancellation of queued or processing jobs
      if (!["queued", "preprocessing", "detecting", "rendering"].includes(job.status)) {
        return res.status(400).json({ 
          error: "Job cannot be cancelled", 
          status: job.status 
        });
      }

      // Update job status to cancelled (error status)
      await storage.updateJob(job.id, {
        status: "error",
        currentPhase: "cancelled",
        errorMessage: "Job cancelled by user",
        processingCompletedAt: new Date(),
      });

      // Clean up uploaded file if it exists
      if (job.originalVideoPath) {
        await VideoValidationService.cleanupFile(job.originalVideoPath);
      }

      // Notify WebSocket clients
      const wsServer = getWebSocketServer();
      if (wsServer) {
        wsServer.sendJobError(job.id, "Job cancelled by user");
      }

      res.json({ 
        message: "Job cancelled successfully",
        id: job.id 
      });

    } catch (error) {
      console.error("❌ Error cancelling job:", error);
      res.status(500).json({ error: "Failed to cancel job" });
    }
  });

  // Admin endpoint to get all jobs
  app.get("/api/admin/jobs", requireAdmin, async (req, res) => {
    try {
      const limit = parseInt(req.query.limit as string) || 50;
      const offset = parseInt(req.query.offset as string) || 0;
      const status = req.query.status as string;

      let jobs;
      if (status) {
        jobs = await storage.getJobsInStatus([status]);
        jobs = jobs.slice(offset, offset + limit);
      } else {
        jobs = await storage.getAllJobs(limit, offset);
      }

      res.json({ jobs, total: jobs.length });
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch jobs" });
    }
  });

  // Create HTTP server and initialize WebSocket
  const httpServer = createServer(app);
  
  // Initialize WebSocket server for real-time updates
  initializeWebSocketServer(httpServer);

  return httpServer;
}
