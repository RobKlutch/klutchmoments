import { 
  type User, 
  type InsertUser,
  type InsertOAuthUser,
  type Athlete, 
  type InsertAthlete, 
  type Template,
  type InsertTemplate,
  type Highlight, 
  type InsertHighlight, 
  type Order, 
  type InsertOrder, 
  type OnboardingProgress, 
  type InsertOnboarding,
  type AdminLog,
  type InsertAdminLog,
  type SystemSetting,
  type InsertSystemSetting,
  type Job,
  type InsertJob
} from "@shared/schema";
import { randomUUID } from "crypto";
import session, { SessionOptions } from "express-session";
import createMemoryStore from "memorystore";

const MemoryStore = createMemoryStore(session);

// modify the interface with any CRUD methods
// you might need

export interface IStorage {
  // User methods
  getUser(id: string): Promise<User | undefined>;
  getUserByUsername(username: string): Promise<User | undefined>;
  getUserByEmail(email: string): Promise<User | undefined>;
  createUser(user: InsertUser): Promise<User>;
  createOAuthUser(user: InsertOAuthUser): Promise<User>; // For Google/Apple OAuth
  updateUserCredits(userId: string, credits: number): Promise<User | undefined>;
  updateUserStripeInfo(userId: string, stripeCustomerId: string, stripeSubscriptionId?: string): Promise<User | undefined>;
  updateUserAuth(userId: string, updates: { username?: string; password?: string }): Promise<User | undefined>;
  setPasswordResetToken(userId: string, token: string, expiry: Date): Promise<User | undefined>;
  getUserByResetToken(token: string): Promise<User | undefined>;
  clearPasswordResetToken(userId: string): Promise<User | undefined>;
  
  // Athlete methods
  getAthlete(id: string): Promise<Athlete | undefined>;
  getAthletesByParent(parentId: string): Promise<Athlete[]>;
  createAthlete(athlete: InsertAthlete): Promise<Athlete>;
  updateAthlete(id: string, updates: Partial<InsertAthlete>): Promise<Athlete | undefined>;
  deleteAthlete(id: string): Promise<boolean>;
  
  // Template methods
  getTemplate(id: string): Promise<Template | undefined>;
  getTemplatesBySport(sport: string): Promise<Template[]>;
  getAllTemplates(): Promise<Template[]>;
  getPopularTemplates(): Promise<Template[]>;
  createTemplate(template: InsertTemplate): Promise<Template>;
  
  // Highlight methods
  getHighlight(id: string): Promise<Highlight | undefined>;
  getHighlightsByUser(userId: string): Promise<Highlight[]>;
  getHighlightsByAthlete(athleteId: string): Promise<Highlight[]>;
  createHighlight(highlight: InsertHighlight): Promise<Highlight>;
  updateHighlight(id: string, updates: Partial<InsertHighlight>): Promise<Highlight | undefined>;
  deleteHighlight(id: string): Promise<boolean>;
  
  // Order methods
  createOrder(order: InsertOrder): Promise<Order>;
  getOrder(id: string): Promise<Order | undefined>;
  getOrdersByUser(userId: string): Promise<Order[]>;
  updateOrderStatus(id: string, status: string): Promise<Order | undefined>;
  
  // Onboarding methods
  getOnboardingProgress(userId: string): Promise<OnboardingProgress | undefined>;
  createOnboardingProgress(progress: InsertOnboarding): Promise<OnboardingProgress>;
  updateOnboardingProgress(userId: string, updates: Partial<InsertOnboarding>): Promise<OnboardingProgress | undefined>;
  
  // Admin methods
  getAllUsers(limit?: number, offset?: number): Promise<User[]>;
  getAllOrders(limit?: number, offset?: number): Promise<Order[]>;
  getAllHighlights(limit?: number, offset?: number): Promise<Highlight[]>;
  updateUserRole(userId: string, role: string): Promise<User | undefined>;
  suspendUser(userId: string): Promise<User | undefined>;
  activateUser(userId: string): Promise<User | undefined>;
  logAdminAction(adminLog: InsertAdminLog): Promise<AdminLog>;
  getAdminLogs(limit?: number, offset?: number): Promise<AdminLog[]>;
  getSystemSettings(): Promise<SystemSetting[]>;
  updateSystemSetting(key: string, value: string, adminUserId: string): Promise<SystemSetting | undefined>;
  
  // Job methods
  createJob(job: InsertJob): Promise<Job>;
  getJob(id: string): Promise<Job | undefined>;
  getJobsByUser(userId: string, limit?: number, offset?: number): Promise<Job[]>;
  updateJob(id: string, updates: Partial<InsertJob>): Promise<Job | undefined>;
  deleteJob(id: string): Promise<boolean>;
  getJobByIdempotencyKey(key: string): Promise<Job | undefined>;
  getAllJobs(limit?: number, offset?: number): Promise<Job[]>;
  getJobsInStatus(status: string[]): Promise<Job[]>;
  cleanupExpiredJobs(): Promise<number>;
  
  sessionStore: session.Store;
}

export class MemStorage implements IStorage {
  private users: Map<string, User>;
  private athletes: Map<string, Athlete>;
  private templates: Map<string, Template>;
  private highlights: Map<string, Highlight>;
  private orders: Map<string, Order>;
  private onboardingProgress: Map<string, OnboardingProgress>;
  private adminLogs: Map<string, AdminLog>;
  private systemSettings: Map<string, SystemSetting>;
  private jobs: Map<string, Job>;
  sessionStore: session.Store;

  constructor() {
    this.users = new Map();
    this.athletes = new Map();
    this.templates = new Map();
    this.highlights = new Map();
    this.orders = new Map();
    this.onboardingProgress = new Map();
    this.adminLogs = new Map();
    this.systemSettings = new Map();
    this.jobs = new Map();
    this.sessionStore = new MemoryStore({
      checkPeriod: 86400000,
    });
    
    // Initialize with default data
    this.initializeDefaultTemplates();
    this.initializeSystemSettings();
  }

  private async initializeDefaultTemplates() {
    const defaultTemplates = [
      {
        name: "Quick Highlight",
        description: "Perfect for single amazing plays - spotlight effect with slow motion",
        sport: "football",
        style: "highlight",
        aspectRatio: "16:9",
        duration: 15,
        creditCost: 1,
        isPopular: true,
        isPremium: false,
        effects: JSON.stringify({ spotlight: true, slowMotion: true }),
        tags: JSON.stringify(["single-play", "spotlight", "social-ready"])
      },
      {
        name: "Instagram Reel",
        description: "Vertical format perfect for Instagram and TikTok with trendy effects",
        sport: "basketball",
        style: "social",
        aspectRatio: "9:16",
        duration: 30,
        creditCost: 2,
        isPopular: true,
        isPremium: false,
        effects: JSON.stringify({ spotlight: true, transitions: true }),
        tags: JSON.stringify(["vertical", "instagram", "tiktok", "trendy"])
      },
      {
        name: "Recruiting Tape Pro",
        description: "Professional recruiting highlight with stats overlay and multiple angles",
        sport: "football",
        style: "recruiting",
        aspectRatio: "16:9",
        duration: 60,
        creditCost: 3,
        isPopular: true,
        isPremium: true,
        effects: JSON.stringify({ statsOverlay: true, multiAngle: true, professional: true }),
        tags: JSON.stringify(["recruiting", "professional", "stats", "multi-angle"])
      }
    ];

    for (const template of defaultTemplates) {
      await this.createTemplate(template);
    }
  }

  private async initializeSystemSettings() {
    const defaultSettings = [
      {
        key: "max_upload_size_gb",
        value: "2",
        description: "Maximum video upload size in GB",
        isPublic: true
      },
      {
        key: "default_watermark_enabled",
        value: "true", 
        description: "Whether watermarks are enabled by default",
        isPublic: false
      },
      {
        key: "new_template_system_enabled",
        value: "true",
        description: "Enable new template selection workflow",
        isPublic: false
      }
    ];

    for (const setting of defaultSettings) {
      const id = randomUUID();
      const systemSetting: SystemSetting = {
        ...setting,
        id,
        updatedBy: null,
        createdAt: new Date(),
        updatedAt: new Date()
      };
      this.systemSettings.set(setting.key, systemSetting);
    }
  }

  // User methods
  async getUser(id: string): Promise<User | undefined> {
    return this.users.get(id);
  }

  async getUserByUsername(username: string): Promise<User | undefined> {
    return Array.from(this.users.values()).find(
      (user) => user.username === username,
    );
  }

  async getUserByEmail(email: string): Promise<User | undefined> {
    return Array.from(this.users.values()).find(
      (user) => user.email === email,
    );
  }

  async createUser(insertUser: InsertUser): Promise<User> {
    const id = randomUUID();
    const user: User = { 
      ...insertUser, 
      id,
      password: insertUser.password ?? null,
      username: null, // No username for email-based auth
      provider: "local", // Local email/password authentication
      providerId: null,
      profileImageUrl: null,
      emailVerified: false, // Will be verified via email confirmation
      stripeCustomerId: null,
      stripeSubscriptionId: null,
      credits: process.env.NODE_ENV === "development" ? 10 : 0, // Give 10 credits in development
      accountType: "parent",
      role: "user",
      isActive: true,
      resetToken: null,
      resetTokenExpiry: null,
      lastLoginAt: null,
      createdAt: new Date()
    };
    this.users.set(id, user);
    
    // Create initial onboarding progress
    await this.createOnboardingProgress({
      userId: id,
      currentStep: 1,
      accountCreated: true,
      athleteAdded: false,
      firstHighlightCreated: false,
      onboardingCompleted: false
    });
    
    return user;
  }

  async createOAuthUser(insertOAuthUser: InsertOAuthUser): Promise<User> {
    const id = randomUUID();
    const user: User = {
      ...insertOAuthUser,
      id,
      password: null, // OAuth users don't have passwords
      username: null, // No username for OAuth users
      profileImageUrl: insertOAuthUser.profileImageUrl ?? null, // Handle undefined
      stripeCustomerId: null,
      stripeSubscriptionId: null,
      credits: process.env.NODE_ENV === "development" ? 10 : 0, // Give 10 credits in development
      accountType: "parent",
      role: "user",
      isActive: true,
      resetToken: null,
      resetTokenExpiry: null,
      lastLoginAt: null,
      createdAt: new Date()
    };
    this.users.set(id, user);
    
    // Create initial onboarding progress
    await this.createOnboardingProgress({
      userId: id,
      currentStep: 1,
      accountCreated: true,
      athleteAdded: false,
      firstHighlightCreated: false,
      onboardingCompleted: false
    });
    
    return user;
  }

  async updateUserCredits(userId: string, credits: number): Promise<User | undefined> {
    const user = this.users.get(userId);
    if (!user) return undefined;
    
    const updatedUser = { ...user, credits };
    this.users.set(userId, updatedUser);
    return updatedUser;
  }

  async updateUserStripeInfo(userId: string, stripeCustomerId: string, stripeSubscriptionId?: string): Promise<User | undefined> {
    const user = this.users.get(userId);
    if (!user) return undefined;
    
    const updatedUser = { ...user, stripeCustomerId, stripeSubscriptionId: stripeSubscriptionId || user.stripeSubscriptionId };
    this.users.set(userId, updatedUser);
    return updatedUser;
  }

  async updateUserAuth(userId: string, updates: { username?: string; password?: string }): Promise<User | undefined> {
    const user = this.users.get(userId);
    if (!user) return undefined;
    
    const updatedUser = { 
      ...user, 
      ...(updates.username && { username: updates.username }),
      ...(updates.password && { password: updates.password })
    };
    this.users.set(userId, updatedUser);
    return updatedUser;
  }

  async setPasswordResetToken(userId: string, token: string, expiry: Date): Promise<User | undefined> {
    const user = this.users.get(userId);
    if (!user) return undefined;
    
    const updatedUser = { 
      ...user, 
      resetToken: token, 
      resetTokenExpiry: expiry 
    };
    this.users.set(userId, updatedUser);
    return updatedUser;
  }

  async getUserByResetToken(token: string): Promise<User | undefined> {
    return Array.from(this.users.values()).find(
      (user) => user.resetToken === token && user.resetTokenExpiry && user.resetTokenExpiry > new Date(),
    );
  }

  async clearPasswordResetToken(userId: string): Promise<User | undefined> {
    const user = this.users.get(userId);
    if (!user) return undefined;
    
    const updatedUser = { 
      ...user, 
      resetToken: null, 
      resetTokenExpiry: null 
    };
    this.users.set(userId, updatedUser);
    return updatedUser;
  }

  // Athlete methods
  async getAthlete(id: string): Promise<Athlete | undefined> {
    return this.athletes.get(id);
  }

  async getAthletesByParent(parentId: string): Promise<Athlete[]> {
    return Array.from(this.athletes.values()).filter(
      (athlete) => athlete.parentId === parentId,
    );
  }

  async createAthlete(insertAthlete: InsertAthlete): Promise<Athlete> {
    const id = randomUUID();
    const athlete: Athlete = { 
      ...insertAthlete, 
      id,
      sport: insertAthlete.sport ?? null,
      position: insertAthlete.position ?? null,
      jerseyNumber: insertAthlete.jerseyNumber ?? null,
      teamName: insertAthlete.teamName ?? null,
      grade: insertAthlete.grade ?? null,
      createdAt: new Date()
    };
    this.athletes.set(id, athlete);
    
    // Update onboarding progress
    await this.updateOnboardingProgress(insertAthlete.parentId, {
      athleteAdded: true,
      currentStep: 2
    });
    
    return athlete;
  }

  async updateAthlete(id: string, updates: Partial<InsertAthlete>): Promise<Athlete | undefined> {
    const athlete = this.athletes.get(id);
    if (!athlete) return undefined;
    
    const updatedAthlete = { ...athlete, ...updates };
    this.athletes.set(id, updatedAthlete);
    return updatedAthlete;
  }

  async deleteAthlete(id: string): Promise<boolean> {
    return this.athletes.delete(id);
  }

  // Template methods
  async getTemplate(id: string): Promise<Template | undefined> {
    return this.templates.get(id);
  }

  async getTemplatesBySport(sport: string): Promise<Template[]> {
    return Array.from(this.templates.values()).filter(
      (template) => template.sport === sport,
    );
  }

  async getAllTemplates(): Promise<Template[]> {
    return Array.from(this.templates.values());
  }

  async getPopularTemplates(): Promise<Template[]> {
    return Array.from(this.templates.values()).filter(
      (template) => template.isPopular,
    );
  }

  async createTemplate(insertTemplate: InsertTemplate): Promise<Template> {
    const id = randomUUID();
    const template: Template = { 
      ...insertTemplate, 
      id,
      description: insertTemplate.description ?? null,
      aspectRatio: insertTemplate.aspectRatio ?? "16:9",
      creditCost: insertTemplate.creditCost ?? 1,
      effects: insertTemplate.effects ?? null,
      isPopular: insertTemplate.isPopular ?? false,
      isPremium: insertTemplate.isPremium ?? false,
      thumbnailUrl: insertTemplate.thumbnailUrl ?? null,
      previewVideoUrl: insertTemplate.previewVideoUrl ?? null,
      tags: insertTemplate.tags ?? null,
      createdAt: new Date()
    };
    this.templates.set(id, template);
    return template;
  }

  // Highlight methods
  async getHighlight(id: string): Promise<Highlight | undefined> {
    return this.highlights.get(id);
  }

  async getHighlightsByUser(userId: string): Promise<Highlight[]> {
    return Array.from(this.highlights.values()).filter(
      (highlight) => highlight.userId === userId,
    );
  }

  async getHighlightsByAthlete(athleteId: string): Promise<Highlight[]> {
    return Array.from(this.highlights.values()).filter(
      (highlight) => highlight.athleteId === athleteId,
    );
  }

  async createHighlight(insertHighlight: InsertHighlight): Promise<Highlight> {
    const id = randomUUID();
    const highlight: Highlight = { 
      ...insertHighlight, 
      id,
      athleteId: insertHighlight.athleteId ?? null,
      templateId: insertHighlight.templateId ?? null,
      description: insertHighlight.description ?? null,
      originalVideoUrl: insertHighlight.originalVideoUrl ?? null,
      processedVideoUrl: insertHighlight.processedVideoUrl ?? null,
      thumbnailUrl: insertHighlight.thumbnailUrl ?? null,
      effect: insertHighlight.effect ?? "spotlight",
      playerPosition: insertHighlight.playerPosition ?? null,
      duration: insertHighlight.duration ?? null,
      status: insertHighlight.status ?? "pending",
      timeStart: insertHighlight.timeStart ?? null,
      timeEnd: insertHighlight.timeEnd ?? null,
      isWatermarked: insertHighlight.isWatermarked ?? true,
      shareUrl: insertHighlight.shareUrl ?? null,
      createdAt: new Date(),
      updatedAt: new Date()
    };
    this.highlights.set(id, highlight);
    
    // Update onboarding progress for first highlight
    const existingHighlights = await this.getHighlightsByUser(insertHighlight.userId);
    if (existingHighlights.length === 1) { // This is the first one
      await this.updateOnboardingProgress(insertHighlight.userId, {
        firstHighlightCreated: true,
        currentStep: 3,
        onboardingCompleted: true
      });
    }
    
    return highlight;
  }

  async updateHighlight(id: string, updates: Partial<InsertHighlight>): Promise<Highlight | undefined> {
    const highlight = this.highlights.get(id);
    if (!highlight) return undefined;
    
    const updatedHighlight = { ...highlight, ...updates, updatedAt: new Date() };
    this.highlights.set(id, updatedHighlight);
    return updatedHighlight;
  }

  // Order methods
  async createOrder(insertOrder: InsertOrder): Promise<Order> {
    const id = randomUUID();
    const order: Order = { 
      ...insertOrder, 
      id,
      stripePaymentIntentId: insertOrder.stripePaymentIntentId ?? null,
      status: insertOrder.status ?? "pending",
      createdAt: new Date()
    };
    this.orders.set(id, order);
    return order;
  }

  async getOrder(id: string): Promise<Order | undefined> {
    return this.orders.get(id);
  }

  async getOrdersByUser(userId: string): Promise<Order[]> {
    return Array.from(this.orders.values()).filter(
      (order) => order.userId === userId,
    );
  }

  async updateOrderStatus(id: string, status: string): Promise<Order | undefined> {
    const order = this.orders.get(id);
    if (!order) return undefined;
    
    const updatedOrder = { ...order, status };
    this.orders.set(id, updatedOrder);
    
    // If order completed, add credits to user
    if (status === "completed" && order.status !== "completed") {
      await this.updateUserCredits(order.userId, (await this.getUser(order.userId))!.credits + order.creditsAdded);
    }
    
    return updatedOrder;
  }

  // Onboarding methods
  async getOnboardingProgress(userId: string): Promise<OnboardingProgress | undefined> {
    return Array.from(this.onboardingProgress.values()).find(
      (progress) => progress.userId === userId,
    );
  }

  async createOnboardingProgress(insertOnboarding: InsertOnboarding): Promise<OnboardingProgress> {
    const id = randomUUID();
    const progress: OnboardingProgress = { 
      ...insertOnboarding, 
      id,
      currentStep: insertOnboarding.currentStep ?? 1,
      accountCreated: insertOnboarding.accountCreated ?? null,
      athleteAdded: insertOnboarding.athleteAdded ?? null,
      templateSelected: insertOnboarding.templateSelected ?? null,
      firstHighlightCreated: insertOnboarding.firstHighlightCreated ?? null,
      onboardingCompleted: insertOnboarding.onboardingCompleted ?? null,
      createdAt: new Date(),
      updatedAt: new Date()
    };
    this.onboardingProgress.set(id, progress);
    return progress;
  }

  async updateOnboardingProgress(userId: string, updates: Partial<InsertOnboarding>): Promise<OnboardingProgress | undefined> {
    const existing = await this.getOnboardingProgress(userId);
    if (!existing) return undefined;
    
    const updatedProgress = { ...existing, ...updates, updatedAt: new Date() };
    this.onboardingProgress.set(existing.id, updatedProgress);
    return updatedProgress;
  }

  // Admin methods
  async getAllUsers(limit = 50, offset = 0): Promise<User[]> {
    const users = Array.from(this.users.values())
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .slice(offset, offset + limit);
    return users;
  }

  async getAllOrders(limit = 50, offset = 0): Promise<Order[]> {
    const orders = Array.from(this.orders.values())
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .slice(offset, offset + limit);
    return orders;
  }

  async getAllHighlights(limit = 50, offset = 0): Promise<Highlight[]> {
    const highlights = Array.from(this.highlights.values())
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .slice(offset, offset + limit);
    return highlights;
  }

  async updateUserRole(userId: string, role: string): Promise<User | undefined> {
    const user = this.users.get(userId);
    if (!user) return undefined;
    
    const updatedUser = { ...user, role };
    this.users.set(userId, updatedUser);
    return updatedUser;
  }

  async suspendUser(userId: string): Promise<User | undefined> {
    const user = this.users.get(userId);
    if (!user) return undefined;
    
    const updatedUser = { ...user, isActive: false };
    this.users.set(userId, updatedUser);
    return updatedUser;
  }

  async activateUser(userId: string): Promise<User | undefined> {
    const user = this.users.get(userId);
    if (!user) return undefined;
    
    const updatedUser = { ...user, isActive: true };
    this.users.set(userId, updatedUser);
    return updatedUser;
  }

  async logAdminAction(insertAdminLog: InsertAdminLog): Promise<AdminLog> {
    const id = randomUUID();
    const adminLog: AdminLog = {
      ...insertAdminLog,
      id,
      details: insertAdminLog.details ?? null,
      ipAddress: insertAdminLog.ipAddress ?? null,
      targetId: insertAdminLog.targetId ?? null,
      createdAt: new Date()
    };
    this.adminLogs.set(id, adminLog);
    return adminLog;
  }

  async getAdminLogs(limit = 100, offset = 0): Promise<AdminLog[]> {
    const logs = Array.from(this.adminLogs.values())
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .slice(offset, offset + limit);
    return logs;
  }

  async getSystemSettings(): Promise<SystemSetting[]> {
    return Array.from(this.systemSettings.values());
  }

  async updateSystemSetting(key: string, value: string, adminUserId: string): Promise<SystemSetting | undefined> {
    const setting = this.systemSettings.get(key);
    if (!setting) return undefined;
    
    const updatedSetting = { 
      ...setting, 
      value, 
      updatedBy: adminUserId, 
      updatedAt: new Date() 
    };
    this.systemSettings.set(key, updatedSetting);
    return updatedSetting;
  }

  // Highlight deletion method
  async deleteHighlight(id: string): Promise<boolean> {
    return this.highlights.delete(id);
  }

  // Job methods
  async createJob(insertJob: InsertJob): Promise<Job> {
    const id = insertJob.id || randomUUID();
    const job: Job = {
      ...insertJob,
      id,
      idempotencyKey: insertJob.idempotencyKey ?? null,
      status: insertJob.status ?? "queued",
      progress: insertJob.progress ?? 0,
      currentPhase: insertJob.currentPhase ?? "queued",
      priority: insertJob.priority ?? 0,
      originalVideoPath: insertJob.originalVideoPath ?? null,
      originalVideoSize: insertJob.originalVideoSize ?? null,
      videoDuration: insertJob.videoDuration ?? null,
      videoFormat: insertJob.videoFormat ?? null,
      startTime: insertJob.startTime ?? "0",
      endTime: insertJob.endTime ?? null,
      playerSelection: insertJob.playerSelection ?? null,
      effectConfig: insertJob.effectConfig ?? null,
      templateId: insertJob.templateId ?? null,
      processedVideoPath: insertJob.processedVideoPath ?? null,
      processedVideoSize: insertJob.processedVideoSize ?? null,
      thumbnailPath: insertJob.thumbnailPath ?? null,
      previewFrames: insertJob.previewFrames ?? null,
      downloadUrl: insertJob.downloadUrl ?? null,
      downloadUrlExpiry: insertJob.downloadUrlExpiry ?? null,
      processingStartedAt: insertJob.processingStartedAt ?? null,
      processingCompletedAt: insertJob.processingCompletedAt ?? null,
      processingTimeMs: insertJob.processingTimeMs ?? null,
      gpuServiceJobId: insertJob.gpuServiceJobId ?? null,
      errorMessage: insertJob.errorMessage ?? null,
      retryCount: insertJob.retryCount ?? 0,
      maxRetries: insertJob.maxRetries ?? 3,
      expiresAt: insertJob.expiresAt ?? null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    
    this.jobs.set(id, job);
    return job;
  }

  async getJob(id: string): Promise<Job | undefined> {
    return this.jobs.get(id);
  }

  async getJobsByUser(userId: string, limit = 50, offset = 0): Promise<Job[]> {
    const userJobs = Array.from(this.jobs.values())
      .filter(job => job.userId === userId)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .slice(offset, offset + limit);
    return userJobs;
  }

  async updateJob(id: string, updates: Partial<InsertJob>): Promise<Job | undefined> {
    const job = this.jobs.get(id);
    if (!job) return undefined;

    const updatedJob = { 
      ...job, 
      ...updates, 
      updatedAt: new Date() 
    };
    this.jobs.set(id, updatedJob);
    return updatedJob;
  }

  async deleteJob(id: string): Promise<boolean> {
    return this.jobs.delete(id);
  }

  async getJobByIdempotencyKey(key: string): Promise<Job | undefined> {
    return Array.from(this.jobs.values()).find(
      job => job.idempotencyKey === key
    );
  }

  async getAllJobs(limit = 50, offset = 0): Promise<Job[]> {
    const jobs = Array.from(this.jobs.values())
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .slice(offset, offset + limit);
    return jobs;
  }

  async getJobsInStatus(statuses: string[]): Promise<Job[]> {
    return Array.from(this.jobs.values()).filter(
      job => statuses.includes(job.status)
    );
  }

  async cleanupExpiredJobs(): Promise<number> {
    const now = new Date();
    let deletedCount = 0;
    
    for (const [id, job] of this.jobs.entries()) {
      if (job.expiresAt && job.expiresAt < now) {
        this.jobs.delete(id);
        deletedCount++;
      }
    }
    
    return deletedCount;
  }
}

export const storage = new MemStorage();
