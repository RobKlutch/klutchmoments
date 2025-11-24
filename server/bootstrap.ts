import { storage } from "./storage";
import { scrypt, randomBytes } from "crypto";
import { promisify } from "util";

const scryptAsync = promisify(scrypt);

async function hashPassword(password: string) {
  const salt = randomBytes(16).toString("hex");
  const buf = (await scryptAsync(password, salt, 64)) as Buffer;
  return `${buf.toString("hex")}.${salt}`;
}

export async function createSuperAdmin() {
  try {
    const adminPassword = process.env.ADMIN_PASSWORD;
    
    // Require admin password in production
    if (process.env.NODE_ENV === "production" && !adminPassword) {
      console.error("❌ ADMIN_PASSWORD must be set in production");
      throw new Error("Missing ADMIN_PASSWORD in production");
    }
    
    if (!adminPassword) {
      console.log("⚠️  No ADMIN_PASSWORD provided. Super admin setup required.");
      return;
    }
    
    // Check if there's already a super admin
    const users = await storage.getAllUsers();
    const existingSuperAdmin = users.find(user => user.role === "super_admin");
    
    if (existingSuperAdmin) {
      console.log("✅ Super admin account already configured");
      return;
    }
    
    // Create the first super admin account with secure scrypt hashing
    const hashedPassword = await hashPassword(adminPassword);
    const adminUser = await storage.createUser({
      username: process.env.ADMIN_USERNAME || "admin",
      password: hashedPassword,
      email: "admin@klutchmoments.com"
    });
    
    // Promote to super admin
    await storage.updateUserRole(adminUser.id, "super_admin");
    
    console.log("✅ Super admin account initialized");
  } catch (error) {
    console.error("❌ Failed to create super admin:", error);
    if (process.env.NODE_ENV === "production") {
      throw error;
    }
  }
}

// Only run if this file is executed directly
if (require.main === module) {
  createSuperAdmin().then(() => {
    process.exit(0);
  }).catch((error) => {
    console.error("Failed to create super admin:", error);
    process.exit(1);
  });
}