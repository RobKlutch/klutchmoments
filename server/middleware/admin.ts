import { Request, Response, NextFunction } from "express";
import { storage } from "../storage";
import { User } from "@shared/schema";

// Extend Express Request to include user
declare global {
  namespace Express {
    interface Request {
      user?: User;
    }
  }
}

export const requireAdmin = async (req: Request, res: Response, next: NextFunction) => {
  if (!req.isAuthenticated()) {
    return res.status(401).json({ error: "Authentication required" });
  }

  const user = req.user;
  if (!user || (user.role !== "admin" && user.role !== "super_admin")) {
    return res.status(403).json({ error: "Admin access required" });
  }

  if (!user.isActive) {
    return res.status(403).json({ error: "Account suspended" });
  }

  next();
};

export const requireSuperAdmin = async (req: Request, res: Response, next: NextFunction) => {
  if (!req.isAuthenticated()) {
    return res.status(401).json({ error: "Authentication required" });
  }

  const user = req.user;
  if (!user || user.role !== "super_admin") {
    return res.status(403).json({ error: "Super admin access required" });
  }

  if (!user.isActive) {
    return res.status(403).json({ error: "Account suspended" });
  }

  next();
};

export const logAdminAction = async (
  adminUserId: string,
  action: string,
  targetType: string,
  targetId?: string,
  details?: any,
  ipAddress?: string
) => {
  await storage.logAdminAction({
    adminUserId,
    action,
    targetType,
    targetId,
    details: details ? JSON.stringify(details) : undefined,
    ipAddress
  });
};