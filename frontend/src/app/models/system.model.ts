// src/app/models/system.model.ts - System-related interfaces
export interface SystemStatus {
  success: boolean;
  status: 'healthy' | 'unhealthy';
  timestamp: string;
  system: SystemInfo;
  directories: DirectoryStatus;
  encoding: EncodingStatus;
}

export interface SystemInfo {
  nodeVersion: string;
  platform: string;
  uptime: number;
  memory: MemoryUsage;
  cpuUsage: CpuUsage;
}

export interface MemoryUsage {
  rss: number;
  heapTotal: number;
  heapUsed: number;
  external: number;
  arrayBuffers: number;
}

export interface CpuUsage {
  user: number;
  system: number;
}

export interface DirectoryStatus {
  [key: string]: {
    exists: boolean;
    writable: boolean;
    path: string;
    error?: string;
  };
}

export interface EncodingStatus {
  maxConcurrent: number;
  activeJobs: number;
  jobs: ActiveJob[];
}

export interface ActiveJob {
  fileId: string;
  inputPath: string;
  outputPath: string;
  duration: number;
}

export interface SystemStats {
  totalFiles: number;
  totalEncoded: number;
  totalFailed: number;
  totalSize: number;
  recent: {
    uploaded24h: number;
    encoded24h: number;
  };
  currentStatus: {
    encoding: number;
    pending: number;
    failed: number;
  };
  diskUsage: DiskUsage;
  timestamp: string;
}

export interface DiskUsage {
  [directory: string]: {
    fileCount: number;
    totalSize: number;
    totalSizeMB: number;
  } | {
    error: string;
  };
}

export interface SystemConfig {
  maxFileSize: string;
  maxConcurrentEncoding: string;
  ffmpegSettings: {
    codec: string;
    sampleRate: string;
    bitrate: string;
    channels: string;
  };
  directories: {
    incoming: string;
    reencoded: string;
    metadata: string;
    logs: string;
  };
}

export interface LogsResponse {
  success: boolean;
  logs: SystemLogEntry[];
  total: number;
}

export interface SystemLogEntry {
  timestamp: string;
  level: string;
  message: string;
  service: string;
  [key: string]: any;
}

export interface BackupResponse {
  success: boolean;
  message: string;
  backupPath: string;
  timestamp: string;
}

export interface CleanupResponse {
  success: boolean;
  message: string;
  cleaned: {
    count: number;
    sizeMB: number;
  };
}

// API Response wrapper
export interface ApiResponse<T = any> {
  success: boolean;
  message?: string;
  error?: string;
  data?: T;
}