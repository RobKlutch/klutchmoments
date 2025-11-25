import express, { Request, Response, NextFunction } from "express";
import path from "path";
import { registerRoutes } from "./routes";
import { log } from "./vite";

function createApp() {
  const app = express();

  // Body parsing
  app.use(express.json({ limit: "10mb" }));
  app.use(express.urlencoded({ extended: false, limit: "10mb" }));

  // Static for processed videos (used by preview)
  app.use("/processed", express.static(path.join(process.cwd(), "processed")));

  // Lightweight API logging
  app.use((req, res, next) => {
    const start = Date.now();
    const reqPath = req.path;
    let capturedJson: any | undefined;

    const originalJson = res.json.bind(res);
    (res as any).json = (body: any, ...args: any[]) => {
      capturedJson = body;
      return originalJson(body, ...args);
    };

    res.on("finish", () => {
      const duration = Date.now() - start;
      if (reqPath.startsWith("/api")) {
        let line = `${req.method} ${reqPath} ${res.statusCode} in ${duration}ms`;
        if (capturedJson) {
          try {
            line += ` :: ${JSON.stringify(capturedJson)}`;
          } catch {
            // ignore JSON stringify errors
          }
        }
        if (line.length > 200) {
          line = line.slice(0, 199) + "…";
        }
        log(line);
      }
    });

    next();
  });

  // Register ALL your existing routes (/api/detect-players, /api/detections/latest, etc.)
  registerRoutes(app);

  // Error handler
  app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
    const status = err.status || err.statusCode || 500;
    const message = err.message || "Internal Server Error";
    log(`ERROR ${status}: ${message}`);
    res.status(status).json({ message });
  });

  return app;
}

// Single shared instance for all Vercel invocations
const app = createApp();
export default app;
