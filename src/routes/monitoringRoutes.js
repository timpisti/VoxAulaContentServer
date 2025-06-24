// src/routes/monitoringRoutes.js - NEW: Advanced Monitoring Endpoints
const express = require('express');
const fs = require('fs-extra');
const path = require('path');
const logger = require('../utils/logger');

const router = express.Router();

// GET /api/monitoring/health - Comprehensive health check
router.get('/health', async (req, res) => {
  try {
    const { metadataService, ffmpegService } = req.services;
    
    // System metrics
    const systemHealth = {
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      memory: {
        ...process.memoryUsage(),
        percentage: Math.round((process.memoryUsage().heapUsed / process.memoryUsage().heapTotal) * 100)
      },
      cpu: process.cpuUsage(),
      environment: process.env.NODE_ENV || 'development'
    };

    // Service health checks
    const services = {};
    
    // FFmpeg service health
    if (ffmpegService) {
      services.ffmpeg = await ffmpegService.healthCheck();
    }
    
    // Database health
    if (metadataService) {
      const stats = await metadataService.getSystemStats();
      services.database = {
        status: 'healthy',
        totalFiles: stats.totalFiles,
        activeJobs: stats.activeJobs || 0,
        recentUploads: stats.recent.uploaded24h,
        recentEncodes: stats.recent.encoded24h
      };
    }

    // Directory health checks
    const directories = {
      incoming: process.env.INCOMING_DIR || './data/incoming',
      reencoded: process.env.REENCODED_DIR || './data/reencoded',
      metadata: process.env.METADATA_DIR || './data/metadata',
      logs: process.env.LOGS_DIR || './data/logs'
    };

    const directoryHealth = {};
    for (const [name, dir] of Object.entries(directories)) {
      try {
        await fs.ensureDir(dir);
        const stats = await fs.stat(dir);
        const files = await fs.readdir(dir);
        
        directoryHealth[name] = {
          status: 'healthy',
          path: path.resolve(dir),
          exists: true,
          writable: true,
          fileCount: files.length,
          lastModified: stats.mtime
        };
      } catch (error) {
        directoryHealth[name] = {
          status: 'unhealthy',
          path: path.resolve(dir),
          exists: false,
          error: error.message
        };
      }
    }

    // Overall health status
    const isHealthy = Object.values(services).every(s => s.status === 'healthy') &&
                     Object.values(directoryHealth).every(d => d.status === 'healthy');

    const healthReport = {
      status: isHealthy ? 'healthy' : 'degraded',
      system: systemHealth,
      services,
      directories: directoryHealth,
      checks: {
        total: Object.keys(services).length + Object.keys(directoryHealth).length,
        passed: Object.values(services).filter(s => s.status === 'healthy').length +
                Object.values(directoryHealth).filter(d => d.status === 'healthy').length
      }
    };

    res.status(isHealthy ? 200 : 503).json(healthReport);
    
  } catch (error) {
    logger.error('Health check failed:', error);
    res.status(503).json({
      status: 'unhealthy',
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

// GET /api/monitoring/metrics - Performance metrics
router.get('/metrics', async (req, res) => {
  try {
    const { metadataService, ffmpegService } = req.services;
    
    // File processing metrics
    const files = await metadataService.getFiles();
    const now = new Date();
    const last24h = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const lastHour = new Date(now.getTime() - 60 * 60 * 1000);

    const metrics = {
      timestamp: now.toISOString(),
      processing: {
        totalFiles: files.length,
        statusBreakdown: {
          uploaded: files.filter(f => f.status === 'uploaded').length,
          encoding: files.filter(f => f.status === 'encoding').length,
          completed: files.filter(f => f.status === 'completed').length,
          failed: files.filter(f => f.status === 'failed').length
        },
        recent: {
          last24h: {
            uploaded: files.filter(f => new Date(f.uploadDate) > last24h).length,
            completed: files.filter(f => f.status === 'completed' && 
              f.lastModified && new Date(f.lastModified) > last24h).length,
            failed: files.filter(f => f.status === 'failed' && 
              f.lastModified && new Date(f.lastModified) > last24h).length
          },
          lastHour: {
            uploaded: files.filter(f => new Date(f.uploadDate) > lastHour).length,
            completed: files.filter(f => f.status === 'completed' && 
              f.lastModified && new Date(f.lastModified) > lastHour).length,
            failed: files.filter(f => f.status === 'failed' && 
              f.lastModified && new Date(f.lastModified) > lastHour).length
          }
        }
      },
      encoding: {
        activeJobs: 0,
        averageTime: 0,
        successRate: 0,
        capacity: {
          used: 0,
          available: parseInt(process.env.MAX_CONCURRENT_ENCODING) || 1,
          percentage: 0
        }
      },
      system: {
        uptime: process.uptime(),
        memory: process.memoryUsage(),
        cpu: process.cpuUsage(),
        loadAverage: process.platform !== 'win32' ? require('os').loadavg() : [0, 0, 0]
      }
    };

    // Get encoding metrics if service is available
    if (ffmpegService) {
      const activeJobs = await ffmpegService.getActiveJobs();
      const completedFiles = files.filter(f => f.status === 'completed');
      
      metrics.encoding.activeJobs = activeJobs.length;
      metrics.encoding.capacity.used = activeJobs.length;
      metrics.encoding.capacity.percentage = Math.round(
        (activeJobs.length / metrics.encoding.capacity.available) * 100
      );
      
      if (completedFiles.length > 0) {
        metrics.encoding.successRate = Math.round(
          (completedFiles.length / (completedFiles.length + files.filter(f => f.status === 'failed').length)) * 100
        );
      }
    }

    res.json(metrics);
    
  } catch (error) {
    logger.error('Failed to fetch metrics:', error);
    res.status(500).json({
      error: 'Failed to fetch metrics',
      message: error.message
    });
  }
});

// GET /api/monitoring/active-jobs - Real-time job monitoring
router.get('/active-jobs', async (req, res) => {
  try {
    const { metadataService, ffmpegService } = req.services;
    
    const activeJobs = await ffmpegService.getActiveJobs();
    const jobDetails = [];
    
    for (const job of activeJobs) {
      const file = await metadataService.getFile(job.fileId);
      if (file) {
        jobDetails.push({
          jobId: job.id,
          fileId: job.fileId,
          fileName: file.originalName,
          progress: file.progress,
          startTime: job.startTime,
          duration: job.runtime || 0,
          status: job.status,
          inputSize: file.size,
          estimatedTimeRemaining: calculateEstimatedTime(file.progress, job.runtime)
        });
      }
    }
    
    res.json({
      timestamp: new Date().toISOString(),
      totalActiveJobs: jobDetails.length,
      jobs: jobDetails
    });
    
  } catch (error) {
    logger.error('Failed to fetch active jobs:', error);
    res.status(500).json({
      error: 'Failed to fetch active jobs',
      message: error.message
    });
  }
});

// Helper function to calculate estimated time remaining
function calculateEstimatedTime(progress, runtime) {
  if (!progress || progress <= 0 || !runtime) return null;
  
  const progressDecimal = progress / 100;
  const estimatedTotal = runtime / progressDecimal;
  const remaining = estimatedTotal - runtime;
  
  return Math.max(0, Math.round(remaining / 1000)); // Convert to seconds
}

// GET /api/monitoring/errors - Recent error analysis
router.get('/errors', async (req, res) => {
  try {
    const { limit = 50 } = req.query;
    const logFile = path.join(process.env.LOGS_DIR || './data/logs', 'error.log');
    
    if (!await fs.pathExists(logFile)) {
      return res.json({
        errors: [],
        message: 'No error log file found'
      });
    }
    
    const logContent = await fs.readFile(logFile, 'utf8');
    const logLines = logContent.trim().split('\n').filter(line => line.trim());
    
    const errors = [];
    for (const line of logLines.slice(-limit * 2)) {
      try {
        const logEntry = JSON.parse(line);
        if (logEntry.level === 'error') {
          errors.push(logEntry);
        }
      } catch (parseError) {
        // Skip invalid JSON lines
      }
    }
    
    // Sort by timestamp (newest first) and limit
    const sortedErrors = errors
      .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))
      .slice(0, parseInt(limit));
    
    // Analyze error patterns
    const errorPatterns = {};
    sortedErrors.forEach(error => {
      const key = error.message || 'Unknown error';
      errorPatterns[key] = (errorPatterns[key] || 0) + 1;
    });
    
    res.json({
      timestamp: new Date().toISOString(),
      totalErrors: sortedErrors.length,
      errors: sortedErrors,
      patterns: errorPatterns
    });
    
  } catch (error) {
    logger.error('Failed to fetch error logs:', error);
    res.status(500).json({
      error: 'Failed to fetch error logs',
      message: error.message
    });
  }
});

// POST /api/monitoring/test-encoding - Test encoding capability
router.post('/test-encoding', async (req, res) => {
  try {
    const { ffmpegService } = req.services;
    
    // Create a simple test to verify FFmpeg is working
    const testResult = {
      timestamp: new Date().toISOString(),
      ffmpegAvailable: false,
      version: null,
      error: null
    };
    
    try {
      // Test FFmpeg availability
      const ffmpeg = require('fluent-ffmpeg');
      
      // Get FFmpeg version (this will throw if FFmpeg is not available)
      await new Promise((resolve, reject) => {
        ffmpeg.getAvailableFormats((err, formats) => {
          if (err) {
            reject(err);
          } else {
            testResult.ffmpegAvailable = true;
            testResult.supportedFormats = Object.keys(formats || {}).length;
            resolve();
          }
        });
      });
      
      // Check if we can create FFmpeg command
      const testCommand = ffmpeg();
      testResult.canCreateCommands = true;
      
    } catch (error) {
      testResult.error = error.message;
    }
    
    // Check encoding capacity
    if (ffmpegService) {
      const activeJobs = await ffmpegService.getActiveJobs();
      const maxConcurrent = parseInt(process.env.MAX_CONCURRENT_ENCODING) || 1;
      
      testResult.encoding = {
        activeJobs: activeJobs.length,
        maxConcurrent,
        availableSlots: maxConcurrent - activeJobs.length,
        canAcceptJobs: activeJobs.length < maxConcurrent
      };
    }
    
    res.json(testResult);
    
  } catch (error) {
    logger.error('Encoding test failed:', error);
    res.status(500).json({
      error: 'Encoding test failed',
      message: error.message
    });
  }
});

// GET /api/monitoring/disk-usage - Disk space monitoring
router.get('/disk-usage', async (req, res) => {
  try {
    const directories = {
      incoming: process.env.INCOMING_DIR || './data/incoming',
      reencoded: process.env.REENCODED_DIR || './data/reencoded',
      metadata: process.env.METADATA_DIR || './data/metadata',
      logs: process.env.LOGS_DIR || './data/logs'
    };
    
    const diskUsage = {};
    let totalSize = 0;
    
    for (const [name, dir] of Object.entries(directories)) {
      try {
        if (await fs.pathExists(dir)) {
          const usage = await calculateDirectorySize(dir);
          diskUsage[name] = usage;
          totalSize += usage.totalSize;
        }
      } catch (error) {
        diskUsage[name] = { error: error.message };
      }
    }
    
    res.json({
      timestamp: new Date().toISOString(),
      directories: diskUsage,
      total: {
        size: totalSize,
        sizeFormatted: formatBytes(totalSize)
      }
    });
    
  } catch (error) {
    logger.error('Failed to calculate disk usage:', error);
    res.status(500).json({
      error: 'Failed to calculate disk usage',
      message: error.message
    });
  }
});

// Helper function to calculate directory size
async function calculateDirectorySize(dirPath) {
  let totalSize = 0;
  let fileCount = 0;
  
  const files = await fs.readdir(dirPath);
  
  for (const file of files) {
    try {
      const filePath = path.join(dirPath, file);
      const stat = await fs.stat(filePath);
      
      if (stat.isFile()) {
        totalSize += stat.size;
        fileCount++;
      }
    } catch (error) {
      // Skip files that can't be accessed
    }
  }
  
  return {
    totalSize,
    fileCount,
    sizeFormatted: formatBytes(totalSize),
    path: dirPath
  };
}

// Helper function to format bytes
function formatBytes(bytes) {
  if (bytes === 0) return '0 Bytes';
  
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

module.exports = router;