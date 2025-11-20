// Blueprint: javascript_auth_all_persistance - server auth implementation
import passport from "passport";
import { Strategy as LocalStrategy } from "passport-local";
import { Express } from "express";
import session from "express-session";
import { scrypt, randomBytes, timingSafeEqual } from "crypto";
import { promisify } from "util";
import { storage } from "./storage";
import { User as SelectUser, forgotPasswordSchema, resetPasswordSchema } from "@shared/schema";
import { sendEmail, generatePasswordResetEmail } from "./email";

// Safe user response type - excludes sensitive fields
type SafeUserResponse = Omit<SelectUser, 'password' | 'stripeCustomerId' | 'stripeSubscriptionId'>;

// Helper function to safely serialize user data for API responses
export function safeUserResponse(user: SelectUser): SafeUserResponse {
  const { password, stripeCustomerId, stripeSubscriptionId, ...safeUser } = user;
  return safeUser;
}

// Helper function to safely serialize arrays of users
export function safeUsersResponse(users: SelectUser[]): SafeUserResponse[] {
  return users.map(safeUserResponse);
}

declare global {
  namespace Express {
    interface User extends SelectUser {}
  }
}

const scryptAsync = promisify(scrypt);

async function hashPassword(password: string) {
  const salt = randomBytes(16).toString("hex");
  const buf = (await scryptAsync(password, salt, 64)) as Buffer;
  return `${buf.toString("hex")}.${salt}`;
}

async function comparePasswords(supplied: string, stored: string) {
  const [hashed, salt] = stored.split(".");
  const hashedBuf = Buffer.from(hashed, "hex");
  const suppliedBuf = (await scryptAsync(supplied, salt, 64)) as Buffer;
  return timingSafeEqual(hashedBuf, suppliedBuf);
}

async function createDefaultAdminUser() {
  try {
    const adminUsername = process.env.ADMIN_USERNAME;
    const adminPassword = process.env.ADMIN_PASSWORD;
    
    // In production, require proper credentials
    if (process.env.NODE_ENV === "production" && (!adminUsername || !adminPassword)) {
      console.error("❌ ADMIN_USERNAME and ADMIN_PASSWORD must be set in production");
      process.exit(1);
    }
    
    if (!adminUsername || !adminPassword) {
      console.log("⚠️  No admin credentials provided. Admin setup required.");
      return;
    }
    
    // Check if ANY admin exists
    const allUsers = await storage.getAllUsers();
    const existingAdmins = allUsers.filter(user => user.role === "admin" || user.role === "super_admin");
    
    if (existingAdmins.length > 0) {
      console.log("✅ Admin account already exists. Skipping creation.");
      return;
    }
    
    console.log("Creating admin user from environment variables...");
    console.log("Admin username will be:", adminUsername);
    const hashedPassword = await hashPassword(adminPassword);
    const adminUser = await storage.createUser({
      username: adminUsername,
      password: hashedPassword
    });
    
    if (adminUser) {
      await storage.updateUserRole(adminUser.id, "admin");
      console.log("✅ Admin user created successfully with username:", adminUser.username);
    }
  } catch (error) {
    console.error("❌ Failed to create admin user:", error);
    if (process.env.NODE_ENV === "production") {
      process.exit(1);
    }
  }
}


export function setupAuth(app: Express) {
  const sessionSettings: session.SessionOptions = {
    secret: process.env.SESSION_SECRET || 'dev-only-secret',
    resave: false,
    saveUninitialized: false,
    store: storage.sessionStore,
    cookie: {
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production'
    }
  };

  app.set("trust proxy", 1);
  app.use(session(sessionSettings));
  app.use(passport.initialize());
  app.use(passport.session());

  // Create default admin user on startup
  createDefaultAdminUser();

  passport.use(
    new LocalStrategy(async (username, password, done) => {
      const user = await storage.getUserByUsername(username);
      if (!user || !(await comparePasswords(password, user.password))) {
        return done(null, false);
      } else {
        return done(null, user);
      }
    }),
  );

  passport.serializeUser((user, done) => done(null, user.id));
  passport.deserializeUser(async (id: string, done) => {
    const user = await storage.getUser(id);
    if (user) {
      // Store full user data in session for full functionality
      done(null, user);
    } else {
      done(null, null);
    }
  });

  app.post("/api/register", async (req, res, next) => {
    try {
      const existingUser = await storage.getUserByUsername(req.body.username);
      if (existingUser) {
        return res.status(400).send("Username already exists");
      }

      const user = await storage.createUser({
        ...req.body,
        password: await hashPassword(req.body.password),
      });

      req.login(user, (err) => {
        if (err) return next(err);
        res.status(201).json(safeUserResponse(user));
      });
    } catch (error) {
      console.error("Registration error:", error);
      res.status(500).send("Internal server error");
    }
  });

  app.post("/api/login", passport.authenticate("local"), (req, res) => {
    res.status(200).json(safeUserResponse(req.user!));
  });

  app.post("/api/logout", (req, res, next) => {
    req.logout((err) => {
      if (err) return next(err);
      res.sendStatus(200);
    });
  });

  app.get("/api/user", (req, res) => {
    if (!req.isAuthenticated()) return res.sendStatus(401);
    res.json(safeUserResponse(req.user!));
  });

  // Forgot Password Endpoint
  app.post("/api/forgot-password", async (req, res) => {
    try {
      const { email } = forgotPasswordSchema.parse(req.body);
      
      const user = await storage.getUserByEmail(email);
      if (!user) {
        // Don't reveal whether email exists for security
        return res.json({ success: true, message: "If an account with that email exists, we've sent password reset instructions." });
      }

      // Generate reset token
      const resetToken = randomBytes(32).toString('hex');
      const expiry = new Date(Date.now() + 60 * 60 * 1000); // 1 hour from now

      // Save reset token
      await storage.setPasswordResetToken(user.id, resetToken, expiry);

      // Send email
      const resetUrl = `${req.protocol}://${req.get('host')}/reset-password?token=${resetToken}`;
      const emailContent = generatePasswordResetEmail(resetUrl, user.username);
      
      const emailSent = await sendEmail({
        to: email,
        from: process.env.FROM_EMAIL || 'noreply@klutchmoments.com',
        ...emailContent
      });

      if (!emailSent) {
        console.error('Failed to send password reset email');
        return res.status(500).json({ error: "Failed to send reset email" });
      }

      res.json({ success: true, message: "If an account with that email exists, we've sent password reset instructions." });
    } catch (error) {
      console.error("Forgot password error:", error);
      res.status(400).json({ error: error instanceof Error ? error.message : "Invalid request" });
    }
  });

  // Reset Password Endpoint
  app.post("/api/reset-password", async (req, res) => {
    try {
      const { token, password } = resetPasswordSchema.parse(req.body);
      
      const user = await storage.getUserByResetToken(token);
      if (!user) {
        return res.status(400).json({ error: "Invalid or expired reset token" });
      }

      // Hash new password
      const hashedPassword = await hashPassword(password);
      
      // Update password and clear reset token
      await storage.updateUserAuth(user.id, { password: hashedPassword });
      await storage.clearPasswordResetToken(user.id);

      res.json({ success: true, message: "Password has been reset successfully" });
    } catch (error) {
      console.error("Reset password error:", error);
      res.status(400).json({ error: error instanceof Error ? error.message : "Invalid request" });
    }
  });
}