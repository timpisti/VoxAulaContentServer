// src/app/models/file.model.ts - File-related interfaces
export interface AudioFile {
  id: string;
  originalName: string;
  fileName: string;
  originalPath: string;
  encodedPath?: string;
  
  // Status management
  status: FileStatus;
  progress: number;
  
  // File info
  size: number;
  mimeType: string;
  uploadDate: string;
  
  // Bull queue compatibility (for future)
  jobId?: string;
  priority: FilePriority;
  retryCount: number;
  
  // Error handling
  error?: FileError;
  logs: LogEntry[];
  
  // Audio metadata
  metadata: AudioMetadata;
  
  // Timestamps
  lastModified?: string;
}

export type FileStatus = 'uploaded' | 'encoding' | 'completed' | 'failed';

export type FilePriority = 'low' | 'normal' | 'high';

export interface FileError {
  message: string;
  timestamp: string;
  technical?: string;
}

export interface LogEntry {
  timestamp: string;
  level: LogLevel;
  message: string;
  details?: any;
}

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface AudioMetadata {
  duration?: number;
  bitrate?: number;
  title?: string;
  artist?: string;
  album?: string;
  year?: number;
  genre?: string;
}

export interface FileUploadResponse {
  success: boolean;
  message: string;
  files: AudioFile[];
}

export interface FileListResponse {
  success: boolean;
  files: AudioFile[];
  pagination: {
    total: number;
    limit: number;
    offset: number;
    hasMore: boolean;
  };
}

export interface FileActionResponse {
  success: boolean;
  message: string;
  fileId?: string;
}

// File filter options
export interface FileFilter {
  status?: FileStatus;
  search?: string;
  limit?: number;
  offset?: number;
}

// File statistics
export interface FileStats {
  total: number;
  byStatus: Record<FileStatus, number>;
  totalSize: number;
  averageSize: number;
}

// Socket event data
export interface EncodingProgressEvent {
  fileId: string;
  progress: number;
  details?: {
    frames?: number;
    fps?: number;
    bitrate?: number;
  };
}

export interface EncodingCompletedEvent {
  fileId: string;
  success: boolean;
  outputPath?: string;
}

export interface EncodingFailedEvent {
  fileId: string;
  error: {
    message: string;
    userFriendly: string;
  };
}

export interface FilesUploadedEvent {
  files: AudioFile[];
}

export interface FileDeletedEvent {
  fileId: string;
}

export interface EncodingCancelledEvent {
  fileId: string;
}