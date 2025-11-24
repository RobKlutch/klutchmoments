// Email-based authentication with Google and Apple OAuth
import passport from "passport";
import { Strategy as LocalStrategy } from "passport-local";
import { Strategy as GoogleStrategy } from "passport-google-oauth20";
// @ts-ignore - No type definitions available
import { Strategy as AppleStrategy } from "@nicokaiser/passport-apple";
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
    const adminEmail = process.env.ADMIN_EMAIL || process.env.ADMIN_USERNAME; // Support legacy ADMIN_USERNAME
    const adminPassword = process.env.ADMIN_PASSWORD;
    
    // In production, require proper credentials
    if (process.env.NODE_ENV === "production" && (!adminEmail || !adminPassword)) {
      console.error("❌ ADMIN_EMAIL and ADMIN_PASSWORD must be set in production");
      process.exit(1);
    }
    
    if (!adminEmail || !adminPassword) {
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
    console.log("📧 Admin email:", adminEmail);
    const hashedPassword = await hashPassword(adminPassword);
    const adminUser = await storage.createUser({
      email: adminEmail,
      password: hashedPassword
    });
    
    if (adminUser) {
      const updatedAdmin = await storage.updateUserRole(adminUser.id, "admin");
      console.log("✅ Admin user created successfully");
      console.log("📋 Admin user details:", { id: updatedAdmin?.id, email: updatedAdmin?.email, role: updatedAdmin?.role });
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

  // Local Strategy - Email/Password Authentication
  passport.use(
    new LocalStrategy({ usernameField: 'email' }, async (email, password, done) => {
      try {
        console.log("🔍 LocalStrategy: Looking up user with email:", email);
        const user = await storage.getUserByEmail(email);
        if (!user) {
          console.log("❌ LocalStrategy: No user found with email:", email);
          return done(null, false, { message: 'Invalid email or password' });
        }
        
        console.log("✅ LocalStrategy: User found:", { id: user.id, email: user.email, hasPassword: !!user.password });
        
        // Check if user has a password (OAuth users don't)
        if (!user.password) {
          console.log("❌ LocalStrategy: User has no password (OAuth user)");
          return done(null, false, { message: 'Please use social sign-in' });
        }
        
        const isValid = await comparePasswords(password, user.password);
        console.log("🔐 LocalStrategy: Password valid:", isValid);
        if (!isValid) {
          return done(null, false, { message: 'Invalid email or password' });
        }
        
        return done(null, user);
      } catch (error) {
        console.error("❌ LocalStrategy error:", error);
        return done(error);
      }
    }),
  );

  // Google OAuth Strategy
  if (process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET) {
    passport.use(
      new GoogleStrategy(
        {
          clientID: process.env.GOOGLE_CLIENT_ID,
          clientSecret: process.env.GOOGLE_CLIENT_SECRET,
          callbackURL: "/api/auth/google/callback",
        },
        async (accessToken, refreshToken, profile, done) => {
          try {
            const email = profile.emails?.[0]?.value;
            if (!email) {
              return done(new Error('No email from Google'));
            }

            // Check if user exists
            let user = await storage.getUserByEmail(email);
            
            if (user) {
              // User exists - update last login
              return done(null, user);
            }

            // Create new OAuth user
            user = await storage.createOAuthUser({
              email,
              provider: 'google',
              providerId: profile.id,
              profileImageUrl: profile.photos?.[0]?.value,
              emailVerified: true, // Google verifies emails
            });

            return done(null, user);
          } catch (error) {
            return done(error as Error);
          }
        }
      )
    );
  }

  // Apple OAuth Strategy
  if (process.env.APPLE_CLIENT_ID && process.env.APPLE_TEAM_ID && process.env.APPLE_KEY_ID && process.env.APPLE_PRIVATE_KEY) {
    passport.use(
      new AppleStrategy(
        {
          clientID: process.env.APPLE_CLIENT_ID,
          teamID: process.env.APPLE_TEAM_ID,
          keyID: process.env.APPLE_KEY_ID,
          key: process.env.APPLE_PRIVATE_KEY,
          callbackURL: "/api/auth/apple/callback",
          scope: ['email', 'name'],
        },
        async (accessToken: string, refreshToken: string, profile: any, done: any) => {
          try {
            const providerId = profile.sub;
            const email = profile.email; // Apple only sends this on FIRST login!

            // First, try to find user by provider ID (for returning users)
            const allUsers = await storage.getAllUsers();
            let user = allUsers.find(u => u.provider === 'apple' && u.providerId === providerId);
            
            if (user) {
              // Returning user - email not needed
              return done(null, user);
            }

            // New user - require email
            if (!email) {
              return done(new Error('Email required for first-time Apple sign-in'));
            }

            // Create new OAuth user
            // Note: Apple only provides name/email on FIRST sign-in!
            user = await storage.createOAuthUser({
              email,
              provider: 'apple',
              providerId,
              profileImageUrl: null, // Apple doesn't provide profile pictures
              emailVerified: true, // Apple verifies emails
            });

            return done(null, user);
          } catch (error) {
            return done(error as Error);
          }
        }
      )
    );
  }

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

  // Email/Password Registration
  app.post("/api/register", async (req, res, next) => {
    try {
      const { email, password } = req.body;
      
      const existingUser = await storage.getUserByEmail(email);
      if (existingUser) {
        return res.status(400).json({ error: "Email already exists" });
      }

      const user = await storage.createUser({
        email,
        password: await hashPassword(password),
      });

      req.login(user, (err) => {
        if (err) return next(err);
        res.status(201).json(safeUserResponse(user));
      });
    } catch (error) {
      console.error("Registration error:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // Email/Password Login
  app.post("/api/login", (req, res, next) => {
    console.log("🔐 Login attempt for email:", req.body.email);
    passport.authenticate("local", (err, user, info) => {
      if (err) {
        console.error("❌ Login error:", err);
        return next(err);
      }
      if (!user) {
        console.log("❌ Login failed:", info?.message || "Unknown reason");
        return res.status(401).json({ error: info?.message || "Invalid credentials" });
      }
      req.login(user, (err) => {
        if (err) {
          console.error("❌ Session error:", err);
          return next(err);
        }
        console.log("✅ Login successful for:", user.email);
        res.status(200).json(safeUserResponse(user));
      });
    })(req, res, next);
  });

  // Google OAuth Routes (only if configured)
  if (process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET) {
    app.get("/api/auth/google", passport.authenticate("google", { scope: ["profile", "email"] }));
    
    app.get(
      "/api/auth/google/callback",
      passport.authenticate("google", { failureRedirect: "/auth?error=google" }),
      (req, res) => {
        // Successful authentication, redirect to upload workflow
        res.redirect("/?step=upload");
      }
    );
  }

  // Apple OAuth Routes (only if configured)
  if (process.env.APPLE_CLIENT_ID && process.env.APPLE_TEAM_ID && process.env.APPLE_KEY_ID && process.env.APPLE_PRIVATE_KEY) {
    app.get("/api/auth/apple", passport.authenticate("apple"));
    
    app.post(
      "/api/auth/apple/callback",
      passport.authenticate("apple", { failureRedirect: "/auth?error=apple" }),
      (req, res) => {
        // Successful authentication, redirect to upload workflow
        res.redirect("/?step=upload");
      }
    );
  }

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

  // OAuth Configuration Endpoint
  app.get("/api/auth/config", (req, res) => {
    res.json({
      googleEnabled: !!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET),
      appleEnabled: !!(process.env.APPLE_CLIENT_ID && process.env.APPLE_TEAM_ID && process.env.APPLE_KEY_ID && process.env.APPLE_PRIVATE_KEY)
    });
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
      const emailContent = generatePasswordResetEmail(resetUrl, user.email);
      
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