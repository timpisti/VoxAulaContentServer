// src/services/FileImportService.js - EXTENDED: Directory monitoring for both incoming and reencoded
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
    
    // Supported file extensions
    this.incomingSupportedExtensions = ['.mp3', '.mp4', '.m4a'];
    this.reencodedSupportedExtensions = ['.opus', '.ogg', '.mp3']; // Encoded formats
    
    logger.info('FileImportService initialized');
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
      
      // Start monitoring if auto-import is enabled
      if (this.autoImportEnabled) {
        await this.startIncomingMonitoring();
      }
      
      if (this.autoImportReencodedEnabled) {
        await this.startReencodedMonitoring();
      }
      
      logger.info('FileImportService initialized with config:', {
        autoImport: this.autoImportEnabled,
        autoEncoding: this.autoEncodingEnabled,
        autoImportReencoded: this.autoImportReencodedEnabled,
        incomingInterval: config.monitoringInterval || 3600000,
        reencodedInterval: config.reencodedMonitoringInterval || 3600000
      });
      
    } catch (error) {
      logger.error('Failed to initialize FileImportService:', error);
    }
  }

  /**
   * Manually scan and import files from incoming directory
   */
  async scanAndImportIncoming() {
    return await this.scanAndImportFromDirectory('incoming');
  }

  /**
   * Manually scan and import files from reencoded directory
   */
  async scanAndImportReencoded() {
    return await this.scanAndImportFromDirectory('reencoded');
  }

  /**
   * Generic scan and import from specified directory type
   */
  async scanAndImportFromDirectory(directoryType) {
    try {
      const isIncoming = directoryType === 'incoming';
      const targetDir = isIncoming ? this.incomingDir : this.reencodedDir;
      const supportedExtensions = isIncoming ? this.incomingSupportedExtensions : this.reencodedSupportedExtensions;
      const logPrefix = isIncoming ? 'incoming' : 'reencoded';
      
      logger.info(`Starting manual ${logPrefix} directory scan and import`);
      
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

      for (const fileName of audioFiles) {
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

      logger.info(`Manual ${logPrefix} import completed:`, {
        total: results.total,
        imported: results.imported,
        skipped: results.skipped,
        errors: results.errors
      });

      // Trigger auto-encoding if enabled and importing from incoming
      if (isIncoming && this.autoEncodingEnabled && results.imported > 0) {
        setTimeout(() => {
          this.triggerAutoEncoding();
        }, 1000);
      }

      return results;

    } catch (error) {
      logger.error(`Manual scan and import failed for ${directoryType}:`, error);
      throw error;
    }
  }

  /**
   * Import a single file from specified directory type
   */
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
        fileName: fileName, // Keep original name for imported files
        originalPath: filePath,
        encodedPath: isIncoming ? null : filePath, // For reencoded, set encodedPath
        size: stats.size,
        mimeType: this.getMimeType(fileName, directoryType),
        uploadDate: new Date().toISOString(),
        status: isIncoming ? 'uploaded' : 'completed', // Different status based on directory
        progress: isIncoming ? 0 : 100,
        imported: true, // Mark as imported
        importDate: new Date().toISOString(),
        importSource: directoryType // Track where it was imported from
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

  /**
   * Extract metadata asynchronously
   */
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

  /**
   * Start incoming directory monitoring
   */
  async startIncomingMonitoring() {
    if (this.isMonitoringIncoming) {
      logger.warn('Incoming directory monitoring already active');
      return;
    }

    try {
      const config = await this.metadataService.getImportConfig();
      const interval = config.monitoringInterval || 3600000; // Default: 1 hour

      this.incomingMonitoringInterval = setInterval(async () => {
        try {
          logger.debug('Performing scheduled incoming directory scan');
          const results = await this.scanAndImportIncoming();
          
          if (results.imported > 0) {
            logger.info(`Scheduled incoming scan imported ${results.imported} new files`);
            
            // Emit to frontend
            this.io.emit('files-auto-imported', {
              directoryType: 'incoming',
              imported: results.imported,
              timestamp: new Date().toISOString()
            });
          }
        } catch (error) {
          logger.error('Scheduled incoming directory scan failed:', error);
        }
      }, interval);

      this.isMonitoringIncoming = true;
      this.autoImportEnabled = true;

      logger.info('Incoming directory monitoring started', { interval });

    } catch (error) {
      logger.error('Failed to start incoming directory monitoring:', error);
      throw error;
    }
  }

  /**
   * Start reencoded directory monitoring
   */
  async startReencodedMonitoring() {
    if (this.isMonitoringReencoded) {
      logger.warn('Reencoded directory monitoring already active');
      return;
    }

    try {
      const config = await this.metadataService.getImportConfig();
      const interval = config.reencodedMonitoringInterval || 3600000; // Default: 1 hour

      this.reencodedMonitoringInterval = setInterval(async () => {
        try {
          logger.debug('Performing scheduled reencoded directory scan');
          const results = await this.scanAndImportReencoded();
          
          if (results.imported > 0) {
            logger.info(`Scheduled reencoded scan imported ${results.imported} new files`);
            
            // Emit to frontend
            this.io.emit('files-auto-imported', {
              directoryType: 'reencoded',
              imported: results.imported,
              timestamp: new Date().toISOString()
            });
          }
        } catch (error) {
          logger.error('Scheduled reencoded directory scan failed:', error);
        }
      }, interval);

      this.isMonitoringReencoded = true;
      this.autoImportReencodedEnabled = true;

      logger.info('Reencoded directory monitoring started', { interval });

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
      clearInterval(this.incomingMonitoringInterval);
      this.incomingMonitoringInterval = null;
    }

    this.isMonitoringIncoming = false;
    this.autoImportEnabled = false;

    logger.info('Incoming directory monitoring stopped');
  }

  /**
   * Stop reencoded directory monitoring
   */
  async stopReencodedMonitoring() {
    if (this.reencodedMonitoringInterval) {
      clearInterval(this.reencodedMonitoringInterval);
      this.reencodedMonitoringInterval = null;
    }

    this.isMonitoringReencoded = false;
    this.autoImportReencodedEnabled = false;

    logger.info('Reencoded directory monitoring stopped');
  }

  /**
   * Update monitoring configuration
   */
  async updateConfig(config) {
    try {
      // Update database
      await this.metadataService.updateImportConfig(config);
      
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
      }

      // Restart monitoring with new intervals if changed
      if (config.hasOwnProperty('monitoringInterval') && this.isMonitoringIncoming) {
        await this.stopIncomingMonitoring();
        await this.startIncomingMonitoring();
      }

      if (config.hasOwnProperty('reencodedMonitoringInterval') && this.isMonitoringReencoded) {
        await this.stopReencodedMonitoring();
        await this.startReencodedMonitoring();
      }

      logger.info('Import configuration updated:', config);
      return await this.metadataService.getImportConfig();

    } catch (error) {
      logger.error('Failed to update import configuration:', error);
      throw error;
    }
  }

  /**
   * Get current configuration
   */
  async getConfig() {
    return await this.metadataService.getImportConfig();
  }

  /**
   * Trigger batch encoding of all uploaded files
   */
  async triggerBatchEncoding() {
    try {
      logger.info('Starting batch encoding of uploaded files');
      
      // Get all uploaded files
      const files = await this.metadataService.getFiles({ status: 'uploaded' });
      
      if (files.length === 0) {
        logger.info('No uploaded files found for batch encoding');
        return { queued: 0, message: 'No files to encode' };
      }

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

      logger.info(`Batch encoding started: ${queued} files queued`);
      
      return {
        queued,
        total: files.length,
        message: `${queued} files started encoding`
      };

    } catch (error) {
      logger.error('Batch encoding failed:', error);
      throw error;
    }
  }

  /**
   * Auto-encoding trigger (respects concurrency)
   */
  async triggerAutoEncoding() {
    if (!this.autoEncodingEnabled) {
      return;
    }

    try {
      // Get active jobs count
      const activeJobs = await this.ffmpegService.getActiveJobs();
      const maxConcurrent = parseInt(process.env.MAX_CONCURRENT_ENCODING) || 1;
      
      if (activeJobs.length >= maxConcurrent) {
        logger.debug('Auto-encoding skipped: queue is full');
        return;
      }

      // Get next uploaded file
      const files = await this.metadataService.getFiles({ 
        status: 'uploaded',
        limit: maxConcurrent - activeJobs.length 
      });

      if (files.length === 0) {
        return;
      }

      // Start encoding for available slots
      for (const file of files) {
        this.ffmpegService.encodeFile(file.id).catch(error => {
          logger.error(`Auto-encoding failed for file ${file.id}:`, error);
        });
        
        logger.debug('Auto-encoding started for file:', file.id);
      }

    } catch (error) {
      logger.error('Auto-encoding trigger failed:', error);
    }
  }

  /**
   * Get MIME type from file extension and directory type
   */
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
      // Reencoded directory
      switch (ext) {
        case '.opus': return 'audio/opus';
        case '.ogg': return 'audio/ogg';
        case '.mp3': return 'audio/mpeg';
        default: return 'audio/opus';
      }
    }
  }

  /**
   * Get service status
   */
  getStatus() {
    return {
      incoming: {
        monitoring: this.isMonitoringIncoming,
        autoImportEnabled: this.autoImportEnabled,
        directory: this.incomingDir
      },
      reencoded: {
        monitoring: this.isMonitoringReencoded,
        autoImportEnabled: this.autoImportReencodedEnabled,
        directory: this.reencodedDir
      },
      autoEncodingEnabled: this.autoEncodingEnabled
    };
  }

  /**
   * Cleanup on service shutdown
   */
  async cleanup() {
    logger.info('Cleaning up FileImportService');
    
    if (this.incomingMonitoringInterval) {
      clearInterval(this.incomingMonitoringInterval);
      this.incomingMonitoringInterval = null;
    }
    
    if (this.reencodedMonitoringInterval) {
      clearInterval(this.reencodedMonitoringInterval);
      this.reencodedMonitoringInterval = null;
    }
    
    this.isMonitoringIncoming = false;
    this.isMonitoringReencoded = false;
    
    logger.info('FileImportService cleanup completed');
  }
}

module.exports = FileImportService;