import { useState, useRef } from 'react';
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Upload, Film, FileVideo, X } from "lucide-react";

interface VideoUploadProps {
  onVideoSelect?: (file: File) => void;
  maxSizeGB?: number;
}

export default function VideoUpload({ onVideoSelect, maxSizeGB = 2 }: VideoUploadProps) {
  const [isDragging, setIsDragging] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [error, setError] = useState<string>('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  const supportedFormats = ['MP4', 'MOV', 'AVI', 'MKV'];
  const maxSizeBytes = maxSizeGB * 1024 * 1024 * 1024;

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    
    const files = Array.from(e.dataTransfer.files);
    if (files.length > 0) {
      handleFileSelection(files[0]);
    }
  };

  const handleFileSelection = (file: File) => {
    setError('');
    
    // Validate file type
    const fileExtension = file.name.split('.').pop()?.toUpperCase();
    if (!fileExtension || !supportedFormats.includes(fileExtension)) {
      setError(`Please select a video file. Supported formats: ${supportedFormats.join(', ')}`);
      return;
    }

    // Validate file size
    if (file.size > maxSizeBytes) {
      setError(`File size must be less than ${maxSizeGB}GB. Your file is ${(file.size / 1024 / 1024 / 1024).toFixed(1)}GB`);
      return;
    }

    setSelectedFile(file);
    onVideoSelect?.(file);
    console.log('Video selected:', file.name, `${(file.size / 1024 / 1024).toFixed(1)}MB`);
  };

  const handleFileInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (files && files.length > 0) {
      handleFileSelection(files[0]);
    }
  };

  const handleBrowseClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    fileInputRef.current?.click();
  };

  const handleContainerClick = () => {
    fileInputRef.current?.click();
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      fileInputRef.current?.click();
    }
  };

  const handleRemoveFile = () => {
    setSelectedFile(null);
    setError('');
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  return (
    <Card className="p-4 sm:p-6 lg:p-8">
      <div className="text-center mb-4 sm:mb-6">
        <h2 className="text-xl sm:text-2xl font-display font-bold mb-2">Upload Your Game Clip</h2>
        <p className="text-sm sm:text-base text-muted-foreground">
          Upload a video from your phone or camera to get started
        </p>
      </div>

      {!selectedFile ? (
        <div
          className={`
            border-2 border-dashed rounded-lg p-4 sm:p-6 lg:p-8 text-center transition-all duration-200 min-h-[200px] sm:min-h-[240px] flex items-center justify-center cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2
            ${isDragging 
              ? 'border-primary bg-primary/5 scale-[1.02]' 
              : 'border-border hover:border-primary/50 hover:bg-accent/30'
            }
          `}
          onClick={handleContainerClick}
          onKeyDown={handleKeyDown}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          role="button"
          tabIndex={0}
          aria-label="Click to upload video or drag and drop video files here"
          data-testid="video-upload-zone"
        >
          <div className="flex flex-col items-center gap-3 sm:gap-4">
            <div className={`
              w-12 h-12 sm:w-16 sm:h-16 rounded-full flex items-center justify-center transition-colors
              ${isDragging ? 'bg-primary text-primary-foreground' : 'bg-accent text-accent-foreground'}
            `}>
              <Upload className="w-6 h-6 sm:w-8 sm:h-8" />
            </div>
            
            <div>
              <p className="text-base sm:text-lg font-medium mb-2">
                {isDragging ? 'Drop your video here' : 'Drag and drop your video here'}
              </p>
              <p className="text-sm text-muted-foreground mb-3 sm:mb-4">
                or tap to browse from your device
              </p>
              
              <Button 
                onClick={handleBrowseClick}
                variant="outline"
                data-testid="button-browse-video"
              >
                <FileVideo className="w-4 h-4 mr-2" />
                Browse Files
              </Button>
            </div>

            <div className="text-xs sm:text-sm text-muted-foreground space-y-1">
              <p>Supported formats: {supportedFormats.join(', ')}</p>
              <p>Maximum file size: {maxSizeGB}GB</p>
            </div>
          </div>
        </div>
      ) : (
        <div className="border rounded-lg p-4 sm:p-6 bg-accent/20">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3 min-w-0 flex-1">
              <div className="w-10 h-10 sm:w-12 sm:h-12 rounded-lg bg-primary/10 flex items-center justify-center flex-shrink-0">
                <Film className="w-5 h-5 sm:w-6 sm:h-6 text-primary" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="font-medium text-sm sm:text-base truncate" data-testid="text-selected-filename">{selectedFile.name}</p>
                <p className="text-xs sm:text-sm text-muted-foreground">
                  {(selectedFile.size / 1024 / 1024).toFixed(1)} MB
                </p>
              </div>
            </div>
            <Button
              variant="ghost"
              size="icon"
              onClick={handleRemoveFile}
              data-testid="button-remove-video"
            >
              <X className="w-4 h-4" />
            </Button>
          </div>
        </div>
      )}

      {error && (
        <div className="mt-4 p-3 bg-destructive/10 border border-destructive/20 rounded-md">
          <p className="text-sm text-destructive" data-testid="text-upload-error">{error}</p>
        </div>
      )}

      <input
        ref={fileInputRef}
        type="file"
        accept="video/*"
        className="hidden"
        onChange={handleFileInputChange}
      />
    </Card>
  );
}