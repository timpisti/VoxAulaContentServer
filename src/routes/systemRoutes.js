// src/routes/systemRoutes.js - System management endpoints
const express = require('express');
const fs = require('fs-extra');
const path = require('path');
const logger = require('../utils/logger');

const router = express.Router();

// GET /api/system/status - System health check
router.get('/status', async (req, res) => {
  try {
    const { metadataService, ffmpegService } = req.services;
    
    // Check directory accessibility
    const directories = {
      incoming: process.env.INCOMING_DIR || './data/incoming',
      reencoded: process.env.REENCODED_DIR || './data/reencoded',
      metadata: process.env.METADATA_DIR || './data/metadata',
      logs: process.env.LOGS_DIR || './data/logs'
    };
    
    const directoryStatus = {};
    for (const [name, dir] of Object.entries(directories)) {
      try {
        await fs.ensureDir(dir);
        const stats = await fs.stat(dir);
        directoryStatus[name] = {
          exists: true,
          writable: true,
          path: path.resolve(dir)
        };
      } catch (error) {
        directoryStatus[name] = {
          exists: false,
          writable: false,
          error: error.message,
          path: path.resolve(dir)
        };
      }
    }
    
    // Get active jobs
    const activeJobs = ffmpegService.getActiveJobs();
    
    // System info
    const systemInfo = {
      nodeVersion: process.version,
      platform: process.platform,
      uptime: process.uptime(),
      memory: process.memoryUsage(),
      cpuUsage: process.cpuUsage()
    };
    
    res.json({
      success: true,
      status: 'healthy',
      timestamp: new Date().toISOString(),
      system: systemInfo,
      directories: directoryStatus,
      encoding: {
        maxConcurrent: ffmpegService.maxConcurrent,
        activeJobs: activeJobs.length,
        jobs: activeJobs
      }
    });

  } catch (error) {
    logger.error('System status check failed:', error);
    res.status(500).json({
      success: false,
      status: 'unhealthy',
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

// GET /api/system/stats - System statistics
router.get('/stats', async (req, res) => {
  try {
    const { metadataService } = req.services;
    const stats = await metadataService.getSystemStats();
    
    // Add disk usage information
    const directories = {
      incoming: process.env.INCOMING_DIR || './data/incoming',
      reencoded: process.env.REENCODED_DIR || './data/reencoded'
    };
    
    const diskUsage = {};
    for (const [name, dir] of Object.entries(directories)) {
      try {
        if (await fs.pathExists(dir)) {
          const files = await fs.readdir(dir);
          let totalSize = 0;
          
          for (const file of files) {
            try {
              const filePath = path.join(dir, file);
              const stat = await fs.stat(filePath);
              if (stat.isFile()) {
                totalSize += stat.size;
              }
            } catch (error) {
              // Skip files that can't be accessed
            }
          }
          
          diskUsage[name] = {
            fileCount: files.filter(async f => {
              try {
                const stat = await fs.stat(path.join(dir, f));
                return stat.isFile();
              } catch {
                return false;
              }
            }).length,
            totalSize,
            totalSizeMB: Math.round(totalSize / (1024 * 1024) * 100) / 100
          };
        }
      } catch (error) {
        diskUsage[name] = { error: error.message };
      }
    }
    
    res.json({
      success: true,
      stats: {
        ...stats,
        diskUsage,
        timestamp: new Date().toISOString()
      }
    });

  } catch (error) {
    logger.error('Failed to fetch system stats:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch system stats',
      error: error.message
    });
  }
});

// GET /api/system/logs - Recent log entries
router.get('/logs', async (req, res) => {
  try {
    const { level = 'info', limit = 100 } = req.query;
    const logFile = path.join(process.env.LOGS_DIR || './data/logs', 'app.log');
    
    if (!await fs.pathExists(logFile)) {
      return res.json({
        success: true,
        logs: [],
        message: 'No logs available yet'
      });
    }
    
    // Read log file and parse JSON lines
    const logContent = await fs.readFile(logFile, 'utf8');
    const logLines = logContent.trim().split('\n').filter(line => line.trim());
    
    const logs = [];
    for (const line of logLines.slice(-limit * 2)) { // Get more than needed for filtering
      try {
        const logEntry = JSON.parse(line);
        
        // Filter by level if specified
        if (level === 'all' || logEntry.level === level || 
            (level === 'error' && ['error', 'warn'].includes(logEntry.level))) {
          logs.push(logEntry);
        }
      } catch (error) {
        // Skip invalid JSON lines
      }
    }
    
    // Sort by timestamp (newest first) and limit
    const sortedLogs = logs
      .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))
      .slice(0, parseInt(limit));
    
    res.json({
      success: true,
      logs: sortedLogs,
      total: logs.length
    });

  } catch (error) {
    logger.error('Failed to fetch logs:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch logs',
      error: error.message
    });
  }
});

// POST /api/system/backup - Create system backup
router.post('/backup', async (req, res) => {
  try {
    const { metadataService } = req.services;
    const backupPath = await metadataService.backup();
    
    res.json({
      success: true,
      message: 'Backup created successfully',
      backupPath,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    logger.error('Failed to create backup:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to create backup',
      error: error.message
    });
  }
});

// POST /api/system/cleanup - Clean up old files
router.post('/cleanup', async (req, res) => {
  try {
    const { days = 30 } = req.body;
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - parseInt(days));
    
    const { metadataService } = req.services;
    
    // Get old failed files
    const allFiles = await metadataService.getFiles();
    const oldFailedFiles = allFiles.filter(file => 
      file.status === 'failed' && 
      new Date(file.uploadDate) < cutoffDate
    );
    
    let cleanedCount = 0;
    let cleanedSize = 0;
    
    for (const file of oldFailedFiles) {
      try {
        cleanedSize += file.size;
        await metadataService.deleteFile(file.id);
        cleanedCount++;
      } catch (error) {
        logger.warn('Failed to cleanup file:', { fileId: file.id, error: error.message });
      }
    }
    
    logger.info('System cleanup completed', { 
      cleanedCount, 
      cleanedSizeMB: Math.round(cleanedSize / (1024 * 1024) * 100) / 100 
    });
    
    res.json({
      success: true,
      message: 'Cleanup completed',
      cleaned: {
        count: cleanedCount,
        sizeMB: Math.round(cleanedSize / (1024 * 1024) * 100) / 100
      }
    });

  } catch (error) {
    logger.error('System cleanup failed:', error);
    res.status(500).json({
      success: false,
      message: 'Cleanup failed',
      error: error.message
    });
  }
});

// GET /api/system/config - Get current configuration
router.get('/config', (req, res) => {
  try {
    const config = {
      maxFileSize: process.env.MAX_FILE_SIZE || '524288000',
      maxConcurrentEncoding: process.env.MAX_CONCURRENT_ENCODING || '1',
      ffmpegSettings: {
        codec: process.env.FFMPEG_OUTPUT_CODEC || 'libopus',
        sampleRate: process.env.FFMPEG_SAMPLE_RATE || '48000',
        bitrate: process.env.FFMPEG_BITRATE || '128k',
        channels: process.env.FFMPEG_CHANNELS || '2'
      },
      directories: {
        incoming: process.env.INCOMING_DIR || './data/incoming',
        reencoded: process.env.REENCODED_DIR || './data/reencoded',
        metadata: process.env.METADATA_DIR || './data/metadata',
        logs: process.env.LOGS_DIR || './data/logs'
      }
    };
    
    res.json({
      success: true,
      config
    });

  } catch (error) {
    logger.error('Failed to fetch config:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch config',
      error: error.message
    });
  }
});

module.exports = router;