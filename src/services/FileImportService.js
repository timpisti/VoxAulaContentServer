// src/services/FileImportService.js - OPTIMIZED: Adaptive Resource-Aware Directory Monitoring
const fs = require('fs-extra');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const { parseFile } = require('music-metadata');
const logger = require('../utils/logger');

class FileImportService {
  constructor(metadataService, ffmpegService, socketIO) {
    this.metadataService = metadataService;
    this.ffmpegService = ffmpegService;
    this.io = socketIO;
    
    // Configuration
    this.incomingDir = process.env.INCOMING_DIR || './data/incoming';
    this.reencodedDir = process.env.REENCODED_DIR || './data/reencoded';
    
    // Monitoring intervals
    this.incomingMonitoringInterval = null;
    this.reencodedMonitoringInterval = null;
    
    // Status flags
    this.autoImportEnabled = false;
    this.autoEncodingEnabled = false;
    this.autoImportReencodedEnabled = false;
    this.isMonitoringIncoming = false;
    this.isMonitoringReencoded = false;
    
    // OPTIMIZED: Adaptive scanning state
    this.recentIncomingActivity = false;
    this.recentReencodedActivity = false;
    this.lastIncomingFileCount = 0;
    this.lastReencodedFileCount = 0;
    this.activityResetTimeout = null;
    
    // OPTIMIZED: Resource-aware intervals (optimized for 1 vCPU)
    this.intervals = {
      // When encoding is active (save CPU for encoding)
      encodingActive: 300000,        // 5 minutes
      // When expecting more files (recent activity detected)
      highActivity: 30000,           // 30 seconds
      // Normal monitoring when auto-encoding enabled
      normal: 120000,                // 2 minutes  
      // When auto-encoding disabled
      disabled: 3600000,             // 1 hour
      // Activity reset timeout
      activityTimeout: 180000        // 3 minutes
    };
    
    // Supported file extensions
    this.incomingSupportedExtensions = ['.mp3', '.mp4', '.m4a'];
    this.reencodedSupportedExtensions = ['.opus', '.ogg', '.mp3'];
    
    logger.info('FileImportService initialized with adaptive scanning');
  }

  /**
   * Initialize service and restore settings
   */
  async initialize() {
    try {
      // Load configuration from database
      const config = await this.metadataService.getImportConfig();
      
      this.autoImportEnabled = config.autoImportEnabled || false;
      this.autoEncodingEnabled = config.autoEncodingEnabled || false;
      this.autoImportReencodedEnabled = config.autoImportReencodedEnabled || false;
      
      // OPTIMIZED: Set resource-aware intervals from config
      if (config.monitoringInterval) {
        this.intervals.normal = Math.max(60000, config.monitoringInterval); // Min 1 minute
      }
      if (config.reencodedMonitoringInterval) {
        this.intervals.disabled = Math.max(300000, config.reencodedMonitoringInterval); // Min 5 minutes
      }
      
      // Get initial file counts for activity detection
      await this.updateFileCountBaselines();
      
      // Start monitoring if auto-import is enabled
      if (this.autoImportEnabled) {
        await this.startIncomingMonitoring();
      }
      
      if (this.autoImportReencodedEnabled) {
        await this.startReencodedMonitoring();
      }
      
      logger.info('FileImportService initialized with adaptive config:', {
        autoImport: this.autoImportEnabled,
        autoEncoding: this.autoEncodingEnabled,
        autoImportReencoded: this.autoImportReencodedEnabled,
        intervals: this.intervals
      });
      
    } catch (error) {
      logger.error('Failed to initialize FileImportService:', error);
    }
  }

  /**
   * OPTIMIZED: Update file count baselines for activity detection
   */
  async updateFileCountBaselines() {
    try {
      if (await fs.pathExists(this.incomingDir)) {
        const incomingFiles = await fs.readdir(this.incomingDir);
        this.lastIncomingFileCount = incomingFiles.filter(file => 
          this.incomingSupportedExtensions.includes(path.extname(file).toLowerCase())
        ).length;
      }
      
      if (await fs.pathExists(this.reencodedDir)) {
        const reencodedFiles = await fs.readdir(this.reencodedDir);
        this.lastReencodedFileCount = reencodedFiles.filter(file => 
          this.reencodedSupportedExtensions.includes(path.extname(file).toLowerCase())
        ).length;
      }
    } catch (error) {
      logger.warn('Failed to update file count baselines:', error);
    }
  }

  /**
   * OPTIMIZED: Calculate adaptive scan interval based on current state
   */
  calculateAdaptiveInterval(directoryType) {
    const isIncoming = directoryType === 'incoming';
    const autoEnabled = isIncoming ? this.autoImportEnabled : this.autoImportReencodedEnabled;
    const recentActivity = isIncoming ? this.recentIncomingActivity : this.recentReencodedActivity;
    
    // Don't scan frequently if auto-import is disabled
    if (!autoEnabled) {
      return this.intervals.disabled;
    }
    
    // If encoding is active, reduce scan frequency to save CPU
    if (this.ffmpegService && this.ffmpegService.isEncodingActive && this.ffmpegService.isEncodingActive()) {
      logger.debug(`Encoding active, using slower scan interval for ${directoryType}`);
      return this.intervals.encodingActive;
    }
    
    // If recent activity detected, scan more frequently
    if (recentActivity) {
      logger.debug(`Recent activity detected, using fast scan interval for ${directoryType}`);
      return this.intervals.highActivity;
    }
    
    // Normal monitoring interval
    return this.intervals.normal;
  }

  /**
   * OPTIMIZED: Detect if new files have appeared
   */
  async detectNewActivity(directoryType) {
    const isIncoming = directoryType === 'incoming';
    const targetDir = isIncoming ? this.incomingDir : this.reencodedDir;
    const supportedExtensions = isIncoming ? this.incomingSupportedExtensions : this.reencodedSupportedExtensions;
    const lastCount = isIncoming ? this.lastIncomingFileCount : this.lastReencodedFileCount;
    
    try {
      if (!await fs.pathExists(targetDir)) {
        return false;
      }
      
      const files = await fs.readdir(targetDir);
      const audioFiles = files.filter(file => 
        supportedExtensions.includes(path.extname(file).toLowerCase())
      );
      
      const currentCount = audioFiles.length;
      const hasNewFiles = currentCount > lastCount;
      
      // Update baseline
      if (isIncoming) {
        this.lastIncomingFileCount = currentCount;
      } else {
        this.lastReencodedFileCount = currentCount;
      }
      
      if (hasNewFiles) {
        logger.info(`New files detected in ${directoryType}:`, {
          previousCount: lastCount,
          currentCount,
          newFiles: currentCount - lastCount
        });
        
        // Set activity flag and schedule reset
        if (isIncoming) {
          this.recentIncomingActivity = true;
        } else {
          this.recentReencodedActivity = true;
        }
        
        this.scheduleActivityReset(directoryType);
        return true;
      }
      
      return false;
    } catch (error) {
      logger.warn(`Failed to detect activity in ${directoryType}:`, error);
      return false;
    }
  }

  /**
   * OPTIMIZED: Schedule activity flag reset
   */
  scheduleActivityReset(directoryType) {
    // Clear existing timeout
    if (this.activityResetTimeout) {
      clearTimeout(this.activityResetTimeout);
    }
    
    // Schedule activity flag reset
    this.activityResetTimeout = setTimeout(() => {
      if (directoryType === 'incoming') {
        this.recentIncomingActivity = false;
        logger.debug('Reset incoming activity flag');
      } else {
        this.recentReencodedActivity = false;
        logger.debug('Reset reencoded activity flag');
      }
    }, this.intervals.activityTimeout);
  }

  /**
   * OPTIMIZED: Lightweight scan during encoding (just check if new files exist)
   */
  async performLightweightScan(directoryType) {
    const newActivity = await this.detectNewActivity(directoryType);
    
    if (newActivity) {
      logger.info(`Lightweight scan detected new files in ${directoryType}, scheduling full scan`);
      
      // If encoding is active but new files detected, schedule a full scan after a short delay
      setTimeout(async () => {
        if (this.ffmpegService && this.ffmpegService.isEncodingActive && !this.ffmpegService.isEncodingActive()) {
          logger.info(`Encoding finished, performing delayed full scan of ${directoryType}`);
          await this.performFullScan(directoryType);
        }
      }, 30000); // 30 second delay
    }
    
    return newActivity;
  }

  /**
   * OPTIMIZED: Full scan and import
   */
  async performFullScan(directoryType) {
    const isIncoming = directoryType === 'incoming';
    
    try {
      logger.debug(`Performing full scan of ${directoryType} directory`);
      
      const results = isIncoming 
        ? await this.scanAndImportIncoming()
        : await this.scanAndImportReencoded();
      
      if (results.imported > 0) {
        logger.info(`Full scan imported ${results.imported} new files from ${directoryType}`);
        
        // Emit to frontend
        this.io.emit('files-auto-imported', {
          directoryType,
          imported: results.imported,
          timestamp: new Date().toISOString()
        });
        
        // OPTIMIZED: Trigger immediate encoding if auto-encoding enabled and new files imported
        if (isIncoming && this.autoEncodingEnabled && results.imported > 0) {
          logger.info('Auto-encoding enabled, triggering immediate encoding check');
          // Small delay to ensure database is updated
          setTimeout(() => {
            this.triggerAutoEncoding();
          }, 1000);
        }
      }
      
      return results;
    } catch (error) {
      logger.error(`Full scan failed for ${directoryType}:`, error);
      return { imported: 0, errors: 1 };
    }
  }

  /**
   * OPTIMIZED: Adaptive directory monitoring
   */
  async performAdaptiveDirectoryScan(directoryType) {
    const isEncodingActive = this.ffmpegService && this.ffmpegService.isEncodingActive && this.ffmpegService.isEncodingActive();
    
    if (isEncodingActive) {
      // During encoding, perform lightweight scan only
      await this.performLightweightScan(directoryType);
    } else {
      // When not encoding, perform full scan
      await this.performFullScan(directoryType);
    }
    
    // Calculate next interval adaptively
    const nextInterval = this.calculateAdaptiveInterval(directoryType);
    
    logger.debug(`Next ${directoryType} scan scheduled in ${Math.round(nextInterval / 1000)}s`, {
      encodingActive: isEncodingActive,
      recentActivity: directoryType === 'incoming' ? this.recentIncomingActivity : this.recentReencodedActivity
    });
    
    return nextInterval;
  }

  /**
   * Start incoming directory monitoring with adaptive intervals
   */
  async startIncomingMonitoring() {
    if (this.isMonitoringIncoming) {
      logger.warn('Incoming directory monitoring already active');
      return;
    }

    try {
      await this.updateFileCountBaselines();
      
      const performScan = async () => {
        try {
          const nextInterval = await this.performAdaptiveDirectoryScan('incoming');
          
          // Schedule next scan with adaptive interval
          this.incomingMonitoringInterval = setTimeout(performScan, nextInterval);
          
        } catch (error) {
          logger.error('Scheduled incoming directory scan failed:', error);
          
          // Retry with default interval on error
          this.incomingMonitoringInterval = setTimeout(performScan, this.intervals.normal);
        }
      };

      // Start initial scan
      setTimeout(performScan, 5000); // 5 second initial delay

      this.isMonitoringIncoming = true;
      this.autoImportEnabled = true;

      logger.info('Adaptive incoming directory monitoring started');

    } catch (error) {
      logger.error('Failed to start incoming directory monitoring:', error);
      throw error;
    }
  }

  /**
   * Start reencoded directory monitoring with adaptive intervals
   */
  async startReencodedMonitoring() {
    if (this.isMonitoringReencoded) {
      logger.warn('Reencoded directory monitoring already active');
      return;
    }

    try {
      await this.updateFileCountBaselines();
      
      const performScan = async () => {
        try {
          const nextInterval = await this.performAdaptiveDirectoryScan('reencoded');
          
          // Schedule next scan with adaptive interval
          this.reencodedMonitoringInterval = setTimeout(performScan, nextInterval);
          
        } catch (error) {
          logger.error('Scheduled reencoded directory scan failed:', error);
          
          // Retry with default interval on error
          this.reencodedMonitoringInterval = setTimeout(performScan, this.intervals.normal);
        }
      };

      // Start initial scan
      setTimeout(performScan, 10000); // 10 second initial delay (offset from incoming)

      this.isMonitoringReencoded = true;
      this.autoImportReencodedEnabled = true;

      logger.info('Adaptive reencoded directory monitoring started');

    } catch (error) {
      logger.error('Failed to start reencoded directory monitoring:', error);
      throw error;
    }
  }

  /**
   * Stop incoming directory monitoring
   */
  async stopIncomingMonitoring() {
    if (this.incomingMonitoringInterval) {
      clearTimeout(this.incomingMonitoringInterval);
      this.incomingMonitoringInterval = null;
    }

    this.isMonitoringIncoming = false;
    this.autoImportEnabled = false;
    this.recentIncomingActivity = false;

    logger.info('Incoming directory monitoring stopped');
  }

  /**
   * Stop reencoded directory monitoring
   */
  async stopReencodedMonitoring() {
    if (this.reencodedMonitoringInterval) {
      clearTimeout(this.reencodedMonitoringInterval);
      this.reencodedMonitoringInterval = null;
    }

    this.isMonitoringReencoded = false;
    this.autoImportReencodedEnabled = false;
    this.recentReencodedActivity = false;

    logger.info('Reencoded directory monitoring stopped');
  }

  /**
   * OPTIMIZED: Immediate auto-encoding trigger (ASAP processing)
   */
  async triggerAutoEncoding() {
    if (!this.autoEncodingEnabled) {
      return;
    }

    try {
      logger.debug('Checking for auto-encoding opportunities');
      
      // Get active jobs count
      const activeJobs = await this.ffmpegService.getActiveJobs();
      const maxConcurrent = parseInt(process.env.MAX_CONCURRENT_ENCODING) || 1;
      
      if (activeJobs.length >= maxConcurrent) {
        logger.debug('Auto-encoding skipped: encoding queue is full');
        return;
      }

      // Get next uploaded file (newest first for ASAP processing)
      const files = await this.metadataService.getFiles({ 
        status: 'uploaded',
        limit: maxConcurrent - activeJobs.length 
      });

      if (files.length === 0) {
        logger.debug('Auto-encoding skipped: no uploaded files found');
        return;
      }

      // OPTIMIZED: Sort by upload date (newest first) for ASAP processing
      files.sort((a, b) => new Date(b.uploadDate) - new Date(a.uploadDate));

      // Start encoding for available slots
      for (const file of files) {
        logger.info('Auto-encoding triggered for newest file:', {
          fileId: file.id,
          originalName: file.originalName,
          uploadDate: file.uploadDate
        });
        
        // Start encoding (don't await - let it run asynchronously)
        this.ffmpegService.encodeFile(file.id).catch(error => {
          logger.error(`Auto-encoding failed for file ${file.id}:`, error);
        });
      }

    } catch (error) {
      logger.error('Auto-encoding trigger failed:', error);
    }
  }

  /**
   * Update monitoring configuration with adaptive optimization
   */
  async updateConfig(config) {
    try {
      // Update database
      await this.metadataService.updateImportConfig(config);
      
      // OPTIMIZED: Update intervals if provided
      if (config.monitoringInterval) {
        this.intervals.normal = Math.max(60000, config.monitoringInterval);
      }
      if (config.reencodedMonitoringInterval) {
        this.intervals.disabled = Math.max(300000, config.reencodedMonitoringInterval);
      }
      
      // Apply changes for incoming monitoring
      if (config.hasOwnProperty('autoImportEnabled')) {
        if (config.autoImportEnabled && !this.isMonitoringIncoming) {
          await this.startIncomingMonitoring();
        } else if (!config.autoImportEnabled && this.isMonitoringIncoming) {
          await this.stopIncomingMonitoring();
        }
      }

      // Apply changes for reencoded monitoring
      if (config.hasOwnProperty('autoImportReencodedEnabled')) {
        if (config.autoImportReencodedEnabled && !this.isMonitoringReencoded) {
          await this.startReencodedMonitoring();
        } else if (!config.autoImportReencodedEnabled && this.isMonitoringReencoded) {
          await this.stopReencodedMonitoring();
        }
      }

      if (config.hasOwnProperty('autoEncodingEnabled')) {
        this.autoEncodingEnabled = config.autoEncodingEnabled;
        
        // OPTIMIZED: Trigger immediate encoding check if auto-encoding was just enabled
        if (config.autoEncodingEnabled) {
          setTimeout(() => {
            this.triggerAutoEncoding();
          }, 2000);
        }
      }

      // Restart monitoring with new intervals if needed
      if ((config.hasOwnProperty('monitoringInterval') || config.hasOwnProperty('adaptiveScanning')) && this.isMonitoringIncoming) {
        await this.stopIncomingMonitoring();
        await this.startIncomingMonitoring();
      }

      if ((config.hasOwnProperty('reencodedMonitoringInterval') || config.hasOwnProperty('adaptiveScanning')) && this.isMonitoringReencoded) {
        await this.stopReencodedMonitoring();
        await this.startReencodedMonitoring();
      }

      logger.info('Import configuration updated with adaptive optimizations:', config);
      return await this.metadataService.getImportConfig();

    } catch (error) {
      logger.error('Failed to update import configuration:', error);
      throw error;
    }
  }

  // Original methods preserved for API compatibility...
  async scanAndImportIncoming() {
    return await this.scanAndImportFromDirectory('incoming');
  }

  async scanAndImportReencoded() {
    return await this.scanAndImportFromDirectory('reencoded');
  }

  async scanAndImportFromDirectory(directoryType) {
    try {
      const isIncoming = directoryType === 'incoming';
      const targetDir = isIncoming ? this.incomingDir : this.reencodedDir;
      const supportedExtensions = isIncoming ? this.incomingSupportedExtensions : this.reencodedSupportedExtensions;
      const logPrefix = isIncoming ? 'incoming' : 'reencoded';
      
      logger.info(`Starting ${logPrefix} directory scan and import`);
      
      if (!await fs.pathExists(targetDir)) {
        throw new Error(`${logPrefix} directory does not exist: ${targetDir}`);
      }

      const files = await fs.readdir(targetDir);
      const audioFiles = files.filter(file => 
        supportedExtensions.includes(path.extname(file).toLowerCase())
      );

      logger.info(`Found ${audioFiles.length} audio files to process in ${logPrefix} directory`);

      const results = {
        directoryType,
        total: audioFiles.length,
        imported: 0,
        skipped: 0,
        errors: 0,
        files: []
      };

      // OPTIMIZED: Process files in reverse order (newest first based on file modification time)
      const filesWithStats = [];
      for (const fileName of audioFiles) {
        try {
          const filePath = path.join(targetDir, fileName);
          const stats = await fs.stat(filePath);
          filesWithStats.push({ fileName, mtime: stats.mtime });
        } catch (error) {
          logger.warn(`Failed to get stats for ${fileName}:`, error);
          filesWithStats.push({ fileName, mtime: new Date(0) });
        }
      }
      
      // Sort by modification time (newest first) for ASAP processing
      filesWithStats.sort((a, b) => b.mtime - a.mtime);

      for (const { fileName } of filesWithStats) {
        try {
          const result = await this.importSingleFile(fileName, directoryType);
          if (result.imported) {
            results.imported++;
            results.files.push({
              name: fileName,
              id: result.fileId,
              status: 'imported'
            });
          } else {
            results.skipped++;
            results.files.push({
              name: fileName,
              status: 'skipped',
              reason: result.reason
            });
          }
        } catch (error) {
          results.errors++;
          results.files.push({
            name: fileName,
            status: 'error',
            error: error.message
          });
          logger.error(`Failed to import file ${fileName} from ${logPrefix}:`, error);
        }
      }

      logger.info(`${logPrefix} import completed:`, {
        total: results.total,
        imported: results.imported,
        skipped: results.skipped,
        errors: results.errors
      });

      return results;

    } catch (error) {
      logger.error(`Scan and import failed for ${directoryType}:`, error);
      throw error;
    }
  }

  async importSingleFile(fileName, directoryType) {
    const isIncoming = directoryType === 'incoming';
    const targetDir = isIncoming ? this.incomingDir : this.reencodedDir;
    const filePath = path.join(targetDir, fileName);
    
    try {
      // Check if file exists and get stats
      const stats = await fs.stat(filePath);
      if (!stats.isFile()) {
        return { imported: false, reason: 'Not a file' };
      }

      // Check if file already exists in database by path
      const existingFile = await this.metadataService.getFileByPath(filePath);
      if (existingFile) {
        return { imported: false, reason: 'Already exists in database' };
      }

      // Generate unique file ID
      const fileId = uuidv4();
      
      // Create file record with appropriate status
      const fileRecord = {
        id: fileId,
        originalName: fileName,
        fileName: fileName,
        originalPath: filePath,
        encodedPath: isIncoming ? null : filePath,
        size: stats.size,
        mimeType: this.getMimeType(fileName, directoryType),
        uploadDate: new Date().toISOString(),
        status: isIncoming ? 'uploaded' : 'completed',
        progress: isIncoming ? 0 : 100,
        imported: true,
        importDate: new Date().toISOString(),
        importSource: directoryType
      };

      // Add to database
      const savedFile = await this.metadataService.addFile(fileRecord);
      
      // Try to extract metadata (non-blocking)
      this.extractMetadataAsync(savedFile);

      logger.info(`File imported successfully from ${directoryType}:`, {
        fileName,
        fileId,
        size: stats.size,
        status: fileRecord.status
      });

      return { imported: true, fileId };

    } catch (error) {
      logger.error(`Failed to import file ${fileName} from ${directoryType}:`, error);
      throw error;
    }
  }

  async extractMetadataAsync(file) {
    try {
      const metadata = await parseFile(file.originalPath);
      
      await this.metadataService.updateFile(file.id, {
        metadata: {
          duration: metadata.format.duration || null,
          bitrate: metadata.format.bitrate || null,
          title: metadata.common.title || null,
          artist: metadata.common.artist || null,
          album: metadata.common.album || null,
          year: metadata.common.year || null,
          genre: metadata.common.genre?.[0] || null
        }
      });

      logger.debug('Metadata extracted for imported file:', {
        fileId: file.id,
        duration: metadata.format.duration,
        title: metadata.common.title
      });

    } catch (error) {
      logger.warn('Failed to extract metadata for imported file:', {
        fileId: file.id,
        error: error.message
      });
    }
  }

  async triggerBatchEncoding() {
    try {
      logger.info('Starting batch encoding of uploaded files');
      
      // Get all uploaded files (newest first for ASAP processing)
      const files = await this.metadataService.getFiles({ status: 'uploaded' });
      
      if (files.length === 0) {
        logger.info('No uploaded files found for batch encoding');
        return { queued: 0, message: 'No files to encode' };
      }

      // OPTIMIZED: Sort by upload date (newest first)
      files.sort((a, b) => new Date(b.uploadDate) - new Date(a.uploadDate));

      let queued = 0;
      
      for (const file of files) {
        try {
          // Check if we can start encoding (respect concurrency limits)
          const activeJobs = await this.ffmpegService.getActiveJobs();
          const maxConcurrent = parseInt(process.env.MAX_CONCURRENT_ENCODING) || 1;
          
          if (activeJobs.length >= maxConcurrent) {
            // Queue is full, remaining files will be picked up by auto-encoding
            break;
          }

          // Start encoding
          this.ffmpegService.encodeFile(file.id).catch(error => {
            logger.error(`Batch encoding failed for file ${file.id}:`, error);
          });
          
          queued++;

        } catch (error) {
          logger.error(`Failed to queue file ${file.id} for encoding:`, error);
        }
      }

      logger.info(`Batch encoding started: ${queued} files queued (newest first)`);
      
      return {
        queued,
        total: files.length,
        message: `${queued} files started encoding (ASAP order)`
      };

    } catch (error) {
      logger.error('Batch encoding failed:', error);
      throw error;
    }
  }

  getMimeType(fileName, directoryType) {
    const ext = path.extname(fileName).toLowerCase();
    const isIncoming = directoryType === 'incoming';
    
    if (isIncoming) {
      switch (ext) {
        case '.mp3': return 'audio/mpeg';
        case '.mp4': return 'audio/mp4';
        case '.m4a': return 'audio/x-m4a';
        default: return 'audio/mpeg';
      }
    } else {
      switch (ext) {
        case '.opus': return 'audio/opus';
        case '.ogg': return 'audio/ogg';
        case '.mp3': return 'audio/mpeg';
        default: return 'audio/opus';
      }
    }
  }

  async getConfig() {
    return await this.metadataService.getImportConfig();
  }

  getStatus() {
    return {
      incoming: {
        monitoring: this.isMonitoringIncoming,
        autoImportEnabled: this.autoImportEnabled,
        directory: this.incomingDir,
        recentActivity: this.recentIncomingActivity,
        lastFileCount: this.lastIncomingFileCount
      },
      reencoded: {
        monitoring: this.isMonitoringReencoded,
        autoImportEnabled: this.autoImportReencodedEnabled,
        directory: this.reencodedDir,
        recentActivity: this.recentReencodedActivity,
        lastFileCount: this.lastReencodedFileCount
      },
      autoEncodingEnabled: this.autoEncodingEnabled,
      adaptiveIntervals: this.intervals,
      isEncodingActive: this.ffmpegService && this.ffmpegService.isEncodingActive ? this.ffmpegService.isEncodingActive() : false
    };
  }

  async cleanup() {
    logger.info('Cleaning up FileImportService');
    
    if (this.incomingMonitoringInterval) {
      clearTimeout(this.incomingMonitoringInterval);
      this.incomingMonitoringInterval = null;
    }
    
    if (this.reencodedMonitoringInterval) {
      clearTimeout(this.reencodedMonitoringInterval);
      this.reencodedMonitoringInterval = null;
    }
    
    if (this.activityResetTimeout) {
      clearTimeout(this.activityResetTimeout);
      this.activityResetTimeout = null;
    }
    
    this.isMonitoringIncoming = false;
    this.isMonitoringReencoded = false;
    this.recentIncomingActivity = false;
    this.recentReencodedActivity = false;
    
    logger.info('FileImportService cleanup completed');
  }
}

module.exports = FileImportService;