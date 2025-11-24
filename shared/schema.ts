import { sql } from "drizzle-orm";
import { pgTable, text, varchar, integer, timestamp, decimal, boolean, uniqueIndex, check } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

export const users = pgTable("users", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  email: text("email").notNull().unique(), // Primary identifier (required for all auth methods)
  password: text("password"), // Optional - not needed for OAuth-only users
  username: text("username").unique(), // Optional - for backward compatibility
  
  // OAuth provider fields
  provider: varchar("provider", { length: 20 }).default("local").notNull(), // 'local', 'google', 'apple'
  providerId: text("provider_id"), // Unique ID from OAuth provider - required when provider != 'local'
  profileImageUrl: text("profile_image_url"), // Profile picture from OAuth provider
  emailVerified: boolean("email_verified").default(false).notNull(),
  
  // Account management
  stripeCustomerId: text("stripe_customer_id"),
  stripeSubscriptionId: text("stripe_subscription_id"),
  credits: integer("credits").default(0).notNull(),
  accountType: varchar("account_type", { length: 20 }).default("parent").notNull(), // 'parent' or 'athlete'
  role: varchar("role", { length: 20 }).default("user").notNull(), // 'user', 'admin', 'super_admin'
  isActive: boolean("is_active").default(true).notNull(),
  
  // Password reset (for local auth only)
  resetToken: text("reset_token"),
  resetTokenExpiry: timestamp("reset_token_expiry"),
  
  lastLoginAt: timestamp("last_login_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => ({
  // Composite unique index: prevent duplicate OAuth logins
  providerAccountIdx: uniqueIndex("users_provider_provider_id_key").on(table.provider, table.providerId),
  // CHECK constraint: ensure provider_id is present for OAuth, absent for local
  providerIdCheck: check("users_provider_id_check", 
    sql`(provider = 'local' AND provider_id IS NULL) OR (provider IN ('google', 'apple') AND provider_id IS NOT NULL)`
  ),
}));

export const athletes = pgTable("athletes", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  parentId: varchar("parent_id").notNull().references(() => users.id),
  name: text("name").notNull(),
  sport: varchar("sport", { length: 50 }),
  position: varchar("position", { length: 50 }),
  jerseyNumber: varchar("jersey_number", { length: 10 }),
  teamName: text("team_name"),
  grade: varchar("grade", { length: 20 }),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const highlights = pgTable("highlights", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull().references(() => users.id),
  athleteId: varchar("athlete_id").references(() => athletes.id),
  templateId: varchar("template_id").references(() => templates.id),
  title: text("title").notNull(),
  description: text("description"),
  originalVideoUrl: text("original_video_url"),
  processedVideoUrl: text("processed_video_url"),
  thumbnailUrl: text("thumbnail_url"),
  effect: varchar("effect", { length: 50 }).default("spotlight"),
  playerPosition: text("player_position"), // JSON string for x,y coordinates
  duration: integer("duration"), // in seconds
  status: varchar("status", { length: 20 }).default("pending"), // 'pending', 'processing', 'completed', 'failed'
  timeStart: decimal("time_start", { precision: 10, scale: 2 }),
  timeEnd: decimal("time_end", { precision: 10, scale: 2 }),
  isWatermarked: boolean("is_watermarked").default(true),
  shareUrl: text("share_url"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const orders = pgTable("orders", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull().references(() => users.id),
  stripePaymentIntentId: text("stripe_payment_intent_id"),
  amount: decimal("amount", { precision: 10, scale: 2 }).notNull(),
  creditsAdded: integer("credits_added").notNull(),
  status: varchar("status", { length: 20 }).default("pending").notNull(), // 'pending', 'completed', 'failed'
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const templates = pgTable("templates", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  name: text("name").notNull(),
  description: text("description"),
  sport: varchar("sport", { length: 50 }).notNull(), // 'football', 'basketball', 'soccer', etc.
  style: varchar("style", { length: 50 }).notNull(), // 'highlight', 'recruiting', 'social', 'full-reel'
  aspectRatio: varchar("aspect_ratio", { length: 20 }).default("16:9"), // '16:9', '9:16', '1:1'
  duration: integer("duration").notNull(), // target duration in seconds
  creditCost: integer("credit_cost").default(1).notNull(),
  effects: text("effects"), // JSON string for effect configurations
  isPopular: boolean("is_popular").default(false),
  isPremium: boolean("is_premium").default(false),
  thumbnailUrl: text("thumbnail_url"),
  previewVideoUrl: text("preview_video_url"),
  tags: text("tags"), // JSON array of searchable tags
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const onboardingProgress = pgTable("onboarding_progress", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull().references(() => users.id),
  currentStep: integer("current_step").default(1).notNull(), // 1-4 (added template step)
  accountCreated: boolean("account_created").default(false),
  athleteAdded: boolean("athlete_added").default(false),
  templateSelected: boolean("template_selected").default(false),
  firstHighlightCreated: boolean("first_highlight_created").default(false),
  onboardingCompleted: boolean("onboarding_completed").default(false),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const adminLogs = pgTable("admin_logs", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  adminUserId: varchar("admin_user_id").notNull().references(() => users.id),
  action: varchar("action", { length: 100 }).notNull(), // 'user_suspended', 'credits_adjusted', 'template_created', etc.
  targetType: varchar("target_type", { length: 50 }).notNull(), // 'user', 'highlight', 'template', 'order'
  targetId: varchar("target_id"),
  details: text("details"), // JSON string with action details
  ipAddress: varchar("ip_address", { length: 45 }),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const systemSettings = pgTable("system_settings", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  key: varchar("key", { length: 100 }).notNull().unique(),
  value: text("value").notNull(),
  description: text("description"),
  isPublic: boolean("is_public").default(false), // Whether setting is visible to non-admin users
  updatedBy: varchar("updated_by").references(() => users.id),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const jobs = pgTable("jobs", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull().references(() => users.id),
  idempotencyKey: varchar("idempotency_key", { length: 255 }).unique(), // For preventing duplicate jobs
  status: varchar("status", { length: 50 }).default("queued").notNull(), // queued, preprocessing, detecting, rendering, finalizing, done, error
  progress: integer("progress").default(0).notNull(), // 0-100
  currentPhase: varchar("current_phase", { length: 50 }).default("queued"), // Current processing phase
  priority: integer("priority").default(0).notNull(), // Job priority (higher = more priority)
  
  // Video information
  originalVideoPath: text("original_video_path"), // Path to uploaded video
  originalVideoSize: integer("original_video_size"), // File size in bytes
  videoDuration: decimal("video_duration", { precision: 10, scale: 2 }), // Video duration in seconds
  videoFormat: varchar("video_format", { length: 20 }), // mp4, avi, etc.
  
  // Processing configuration
  startTime: decimal("start_time", { precision: 10, scale: 2 }).default("0"), // Start time for processing
  endTime: decimal("end_time", { precision: 10, scale: 2 }), // End time for processing
  playerSelection: text("player_selection"), // JSON: Player selection data
  effectConfig: text("effect_config"), // JSON: Effect configuration
  templateId: varchar("template_id").references(() => templates.id),
  
  // Results
  processedVideoPath: text("processed_video_path"), // Path to processed video
  processedVideoSize: integer("processed_video_size"), // Processed file size
  thumbnailPath: text("thumbnail_path"), // Generated thumbnail
  previewFrames: text("preview_frames"), // JSON: Array of preview frame data
  downloadUrl: text("download_url"), // Signed URL for download
  downloadUrlExpiry: timestamp("download_url_expiry"), // When download URL expires
  
  // Processing metadata
  processingStartedAt: timestamp("processing_started_at"),
  processingCompletedAt: timestamp("processing_completed_at"),
  processingTimeMs: integer("processing_time_ms"), // Total processing time
  gpuServiceJobId: varchar("gpu_service_job_id", { length: 255 }), // GPU service job reference
  
  // Error handling
  errorMessage: text("error_message"),
  retryCount: integer("retry_count").default(0),
  maxRetries: integer("max_retries").default(3),
  
  // Cleanup
  expiresAt: timestamp("expires_at"), // When to auto-cleanup job files
  
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

// Insert schemas for authentication
// Local email/password signup
export const insertUserSchema = createInsertSchema(users).pick({
  email: true,
  password: true,
}).extend({
  email: z.string().email("Please enter a valid email address"),
  password: z.string().min(8, "Password must be at least 8 characters"),
});

// OAuth user creation (no password required)
export const insertOAuthUserSchema = createInsertSchema(users).pick({
  email: true,
  provider: true,
  providerId: true,
  profileImageUrl: true,
  emailVerified: true,
}).extend({
  email: z.string().email("Valid email is required"),
  provider: z.enum(["google", "apple"], { required_error: "OAuth provider is required" }),
  providerId: z.string().min(1, "Provider ID is required for OAuth users"),
  emailVerified: z.boolean().default(true), // OAuth providers verify emails
});

// Forgot password schema
export const forgotPasswordSchema = z.object({
  email: z.string().email("Please enter a valid email address"),
});

// Reset password schema
export const resetPasswordSchema = z.object({
  token: z.string().min(1, "Reset token is required"),
  password: z.string().min(6, "Password must be at least 6 characters"),
});

export const insertAthleteSchema = createInsertSchema(athletes).omit({
  id: true,
  createdAt: true,
});

export const insertTemplateSchema = createInsertSchema(templates).omit({
  id: true,
  createdAt: true,
});

export const insertHighlightSchema = createInsertSchema(highlights).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertOrderSchema = createInsertSchema(orders).omit({
  id: true,
  createdAt: true,
});

export const insertOnboardingSchema = createInsertSchema(onboardingProgress).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertAdminLogSchema = createInsertSchema(adminLogs).omit({
  id: true,
  createdAt: true,
});

export const insertSystemSettingSchema = createInsertSchema(systemSettings).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertJobSchema = createInsertSchema(jobs).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

// Job API schemas
export const createJobRequestSchema = z.object({
  templateId: z.string().optional(),
  startTime: z.number().min(0).optional(),
  endTime: z.number().min(0).optional(),
  playerSelection: z.object({
    playerId: z.string().optional(),
    selectionBox: z.object({
      x: z.number().min(0).max(1),
      y: z.number().min(0).max(1),
      width: z.number().min(0).max(1),
      height: z.number().min(0).max(1),
    }).optional(),
    autoSelect: z.boolean().default(true),
  }).optional(),
  effectConfig: z.object({
    type: z.enum(["circle", "beam", "gradient"]).default("circle"),
    radius: z.number().min(50).max(500).default(150),
    feather: z.number().min(0).max(200).default(50),
    intensity: z.number().min(0).max(1).default(0.7),
    color: z.string().default("#FFFFFF"),
  }).optional(),
  priority: z.number().min(0).max(10).default(0),
});

// Define detectedPlayerSchema first (before it's used)
export const detectedPlayerSchema = z.object({
  id: z.string(),
  centerX: z.number().min(0).max(1),
  centerY: z.number().min(0).max(1),
  x: z.number().min(0).max(1),
  y: z.number().min(0).max(1),
  width: z.number().min(0).max(1),
  height: z.number().min(0).max(1),
  confidence: z.number().min(0).max(1)
});

export const jobStatusResponseSchema = z.object({
  id: z.string(),
  status: z.enum(["queued", "preprocessing", "detecting", "rendering", "finalizing", "done", "error"]),
  progress: z.number().min(0).max(100),
  currentPhase: z.string(),
  originalVideoPath: z.string().optional(),
  processedVideoPath: z.string().optional(),
  thumbnailPath: z.string().optional(),
  downloadUrl: z.string().optional(),
  errorMessage: z.string().optional(),
  processingStartedAt: z.date().optional(),
  processingCompletedAt: z.date().optional(),
  processingTimeMs: z.number().optional(),
  createdAt: z.date(),
  updatedAt: z.date(),
});

export const previewFrameSchema = z.object({
  timestamp: z.number(),
  detections: z.array(detectedPlayerSchema),
  imageDataUrl: z.string(),
});

// Types
export type InsertUser = z.infer<typeof insertUserSchema>;
export type InsertOAuthUser = z.infer<typeof insertOAuthUserSchema>;
export type User = typeof users.$inferSelect;
export type ForgotPasswordRequest = z.infer<typeof forgotPasswordSchema>;
export type ResetPasswordRequest = z.infer<typeof resetPasswordSchema>;
export type InsertAthlete = z.infer<typeof insertAthleteSchema>;
export type Athlete = typeof athletes.$inferSelect;
export type InsertTemplate = z.infer<typeof insertTemplateSchema>;
export type Template = typeof templates.$inferSelect;
export type InsertHighlight = z.infer<typeof insertHighlightSchema>;
export type Highlight = typeof highlights.$inferSelect;
export type InsertOrder = z.infer<typeof insertOrderSchema>;
export type Order = typeof orders.$inferSelect;
export type InsertOnboarding = z.infer<typeof insertOnboardingSchema>;
export type OnboardingProgress = typeof onboardingProgress.$inferSelect;
export type InsertAdminLog = z.infer<typeof insertAdminLogSchema>;
export type AdminLog = typeof adminLogs.$inferSelect;
export type InsertSystemSetting = z.infer<typeof insertSystemSettingSchema>;
export type SystemSetting = typeof systemSettings.$inferSelect;
export type InsertJob = z.infer<typeof insertJobSchema>;
export type Job = typeof jobs.$inferSelect;
export type CreateJobRequest = z.infer<typeof createJobRequestSchema>;
export type JobStatusResponse = z.infer<typeof jobStatusResponseSchema>;
export type PreviewFrame = z.infer<typeof previewFrameSchema>;

// Player Detection API Schemas
// Maximum base64 image size: ~4MB (base64 is ~1.33x larger than binary)
const MAX_BASE64_IMAGE_SIZE = 5_500_000; // ~4MB binary = ~5.5MB base64

export const playerDetectionRequestSchema = z.object({
  imageDataUrl: z.string()
    .min(1, "Image data is required")
    .max(MAX_BASE64_IMAGE_SIZE, "Image data too large (max 4MB)") // DoS protection
    .refine((data) => data.startsWith('data:image/'), "Must be a valid data URL"), // Validate data URL format
  timestampMs: z.number().min(0, "Timestamp must be non-negative"), // timestamp in milliseconds
  videoId: z.string().optional(), // optional video identifier for context
  detectionMethod: z.enum(['local', 'replicate']).optional().default('replicate') // Detection service to use
});


export const playerDetectionResponseSchema = z.object({
  success: z.boolean(),
  timestamp: z.number(),
  frameAnalysis: z.object({
    totalPlayers: z.number(),
  }),
  players: z.array(detectedPlayerSchema),
  error: z.string().optional(),
  fallbackMode: z.boolean().optional(), // Indicates if mock data was used (dev only)
});

// Types
export type PlayerDetectionRequest = z.infer<typeof playerDetectionRequestSchema>;
export type DetectedPlayer = z.infer<typeof detectedPlayerSchema>;
export type PlayerDetectionResponse = z.infer<typeof playerDetectionResponseSchema>;
