import multer from "multer";
import path from "path";
import fs from "fs/promises";
import { randomUUID } from "crypto";

// File upload configuration
const MAX_FILE_SIZE = 500 * 1024 * 1024; // 500MB
const MAX_DURATION = 300; // 5 minutes in seconds
const ALLOWED_FORMATS = ['.mp4', '.avi', '.mov', '.mkv', '.webm'];

// Storage configuration
const storage = multer.diskStorage({
  destination: async (req, file, cb) => {
    const uploadDir = path.join(process.cwd(), 'uploads', 'videos');
    try {
      await fs.mkdir(uploadDir, { recursive: true });
      cb(null, uploadDir);
    } catch (error) {
      cb(error, uploadDir);
    }
  },
  filename: (req, file, cb) => {
    const uniqueId = randomUUID();
    const extension = path.extname(file.originalname);
    const filename = `${uniqueId}${extension}`;
    cb(null, filename);
  }
});

// File filter
const fileFilter = (req: any, file: Express.Multer.File, cb: multer.FileFilterCallback) => {
  const extension = path.extname(file.originalname).toLowerCase();
  
  if (!ALLOWED_FORMATS.includes(extension)) {
    return cb(new Error(`Unsupported file format. Allowed formats: ${ALLOWED_FORMATS.join(', ')}`));
  }
  
  // Additional MIME type validation
  const allowedMimeTypes = [
    'video/mp4',
    'video/avi', 
    'video/quicktime',
    'video/x-msvideo',
    'video/x-matroska',
    'video/webm'
  ];
  
  if (!allowedMimeTypes.includes(file.mimetype)) {
    return cb(new Error(`Invalid MIME type: ${file.mimetype}`));
  }
  
  cb(null, true);
};

// Multer configuration
export const videoUpload = multer({
  storage,
  fileFilter,
  limits: {
    fileSize: MAX_FILE_SIZE,
    files: 1, // Only one file per upload
  },
});

// Video validation service
export class VideoValidationService {
  static async validateVideoFile(filePath: string): Promise<{
    duration: number;
    format: string;
    size: number;
    valid: boolean;
    error?: string;
  }> {
    try {
      const stats = await fs.stat(filePath);
      const size = stats.size;
      
      // Basic file existence and size check
      if (size === 0) {
        return {
          duration: 0,
          format: '',
          size,
          valid: false,
          error: 'File is empty'
        };
      }
      
      if (size > MAX_FILE_SIZE) {
        return {
          duration: 0,
          format: '',
          size,
          valid: false,
          error: `File too large. Maximum size: ${MAX_FILE_SIZE / (1024 * 1024)}MB`
        };
      }
      
      // Extract file format
      const format = path.extname(filePath).toLowerCase().slice(1);
      
      // For now, we'll do basic validation
      // In a real implementation, you'd use ffprobe or similar to get accurate metadata
      const mockDuration = Math.random() * 60 + 10; // Mock duration between 10-70 seconds
      
      if (mockDuration > MAX_DURATION) {
        return {
          duration: mockDuration,
          format,
          size,
          valid: false,
          error: `Video too long. Maximum duration: ${MAX_DURATION} seconds`
        };
      }
      
      return {
        duration: mockDuration,
        format,
        size,
        valid: true
      };
      
    } catch (error) {
      return {
        duration: 0,
        format: '',
        size: 0,
        valid: false,
        error: `Validation failed: ${error.message}`
      };
    }
  }

  static async cleanupFile(filePath: string): Promise<void> {
    try {
      await fs.unlink(filePath);
      console.log(`🗑️  Cleaned up file: ${filePath}`);
    } catch (error) {
      console.error(`❌ Failed to cleanup file ${filePath}:`, error);
    }
  }

  static async createThumbnail(videoPath: string): Promise<string> {
    // Mock thumbnail generation
    // In a real implementation, you'd use ffmpeg to extract a frame
    const thumbnailDir = path.join(process.cwd(), 'uploads', 'thumbnails');
    await fs.mkdir(thumbnailDir, { recursive: true });
    
    const videoName = path.basename(videoPath, path.extname(videoPath));
    const thumbnailPath = path.join(thumbnailDir, `${videoName}.jpg`);
    
    // Create a mock thumbnail file (in reality, you'd extract from video)
    await fs.writeFile(thumbnailPath, Buffer.from('mock-thumbnail-data'));
    
    return thumbnailPath;
  }
}

// File storage management
export class FileStorageService {
  static readonly PROCESSED_DIR = path.join(process.cwd(), 'processed');
  static readonly TEMP_DIR = path.join(process.cwd(), 'temp');
  
  static async initializeDirectories(): Promise<void> {
    await Promise.all([
      fs.mkdir(this.PROCESSED_DIR, { recursive: true }),
      fs.mkdir(this.TEMP_DIR, { recursive: true }),
      fs.mkdir(path.join(process.cwd(), 'uploads'), { recursive: true }),
      fs.mkdir(path.join(process.cwd(), 'uploads', 'videos'), { recursive: true }),
      fs.mkdir(path.join(process.cwd(), 'uploads', 'thumbnails'), { recursive: true }),
    ]);
    console.log('✅ File storage directories initialized');
  }
  
  static async moveToProcessedDirectory(srcPath: string, jobId: string): Promise<string> {
    const filename = `${jobId}_${path.basename(srcPath)}`;
    const destPath = path.join(this.PROCESSED_DIR, filename);
    
    await fs.rename(srcPath, destPath);
    return destPath;
  }
  
  static async generateSignedUrl(filePath: string, expiryHours: number = 24): Promise<string> {
    // In a real implementation, you'd generate a signed URL with expiration
    // For now, we'll create a simple token-based URL
    const token = randomUUID();
    const filename = path.basename(filePath);
    
    // Store the token mapping (in production, use Redis or database)
    // await redis.setex(`download:${token}`, expiryHours * 3600, filePath);
    
    return `/api/jobs/download/${token}/${filename}`;
  }
  
  static async cleanupExpiredFiles(): Promise<number> {
    let cleanedCount = 0;
    const expiredThreshold = Date.now() - (7 * 24 * 60 * 60 * 1000); // 7 days
    
    try {
      const processedFiles = await fs.readdir(this.PROCESSED_DIR);
      
      for (const file of processedFiles) {
        const filePath = path.join(this.PROCESSED_DIR, file);
        const stats = await fs.stat(filePath);
        
        if (stats.mtime.getTime() < expiredThreshold) {
          await fs.unlink(filePath);
          cleanedCount++;
        }
      }
      
      console.log(`🗑️  Cleaned up ${cleanedCount} expired files`);
    } catch (error) {
      console.error('❌ Error during file cleanup:', error);
    }
    
    return cleanedCount;
  }
}

// Initialize file storage on module load
FileStorageService.initializeDirectories().catch(console.error);