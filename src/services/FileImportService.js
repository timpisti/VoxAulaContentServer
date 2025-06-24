// src/services/FileImportService.js - Directory monitoring and file import service
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
    this.monitoringInterval = null;
    this.autoImportEnabled = false;
    this.autoEncodingEnabled = false;
    this.isMonitoring = false;
    
    // Supported file extensions
    this.supportedExtensions = ['.mp3', '.mp4', '.m4a'];
    
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
      
      // Start monitoring if auto-import is enabled
      if (this.autoImportEnabled) {
        await this.startMonitoring();
      }
      
      logger.info('FileImportService initialized with config:', {
        autoImport: this.autoImportEnabled,
        autoEncoding: this.autoEncodingEnabled,
        monitoringInterval: config.monitoringInterval || 3600000
      });
      
    } catch (error) {
      logger.error('Failed to initialize FileImportService:', error);
    }
  }

  /**
   * Manually scan and import files from directory
   */
  async scanAndImport() {
    try {
      logger.info('Starting manual directory scan and import');
      
      if (!await fs.pathExists(this.incomingDir)) {
        throw new Error(`Incoming directory does not exist: ${this.incomingDir}`);
      }

      const files = await fs.readdir(this.incomingDir);
      const audioFiles = files.filter(file => 
        this.supportedExtensions.includes(path.extname(file).toLowerCase())
      );

      logger.info(`Found ${audioFiles.length} audio files to process`);

      const results = {
        total: audioFiles.length,
        imported: 0,
        skipped: 0,
        errors: 0,
        files: []
      };

      for (const fileName of audioFiles) {
        try {
          const result = await this.importSingleFile(fileName);
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
          logger.error(`Failed to import file ${fileName}:`, error);
        }
      }

      logger.info('Manual import completed:', {
        total: results.total,
        imported: results.imported,
        skipped: results.skipped,
        errors: results.errors
      });

      // Trigger auto-encoding if enabled
      if (this.autoEncodingEnabled && results.imported > 0) {
        setTimeout(() => {
          this.triggerAutoEncoding();
        }, 1000);
      }

      return results;

    } catch (error) {
      logger.error('Manual scan and import failed:', error);
      throw error;
    }
  }

  /**
   * Import a single file from the directory
   */
  async importSingleFile(fileName) {
    const filePath = path.join(this.incomingDir, fileName);
    
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
      
      // Create file record
      const fileRecord = {
        id: fileId,
        originalName: fileName,
        fileName: fileName, // Keep original name for imported files
        originalPath: filePath,
        size: stats.size,
        mimeType: this.getMimeType(fileName),
        uploadDate: new Date().toISOString(),
        status: 'uploaded',
        progress: 0,
        imported: true, // Mark as imported
        importDate: new Date().toISOString()
      };

      // Add to database
      const savedFile = await this.metadataService.addFile(fileRecord);
      
      // Try to extract metadata (non-blocking)
      this.extractMetadataAsync(savedFile);

      logger.info('File imported successfully:', {
        fileName,
        fileId,
        size: stats.size
      });

      return { imported: true, fileId };

    } catch (error) {
      logger.error(`Failed to import file ${fileName}:`, error);
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
   * Start directory monitoring
   */
  async startMonitoring() {
    if (this.isMonitoring) {
      logger.warn('Directory monitoring already active');
      return;
    }

    try {
      const config = await this.metadataService.getImportConfig();
      const interval = config.monitoringInterval || 3600000; // Default: 1 hour

      this.monitoringInterval = setInterval(async () => {
        try {
          logger.debug('Performing scheduled directory scan');
          const results = await this.scanAndImport();
          
          if (results.imported > 0) {
            logger.info(`Scheduled scan imported ${results.imported} new files`);
            
            // Emit to frontend
            this.io.emit('files-auto-imported', {
              imported: results.imported,
              timestamp: new Date().toISOString()
            });
          }
        } catch (error) {
          logger.error('Scheduled directory scan failed:', error);
        }
      }, interval);

      this.isMonitoring = true;
      this.autoImportEnabled = true;

      logger.info('Directory monitoring started', { interval });

    } catch (error) {
      logger.error('Failed to start directory monitoring:', error);
      throw error;
    }
  }

  /**
   * Stop directory monitoring
   */
  async stopMonitoring() {
    if (this.monitoringInterval) {
      clearInterval(this.monitoringInterval);
      this.monitoringInterval = null;
    }

    this.isMonitoring = false;
    this.autoImportEnabled = false;

    // Save state to database
    await this.metadataService.updateImportConfig({
      autoImportEnabled: false
    });

    logger.info('Directory monitoring stopped');
  }

  /**
   * Update monitoring configuration
   */
  async updateConfig(config) {
    try {
      // Update database
      await this.metadataService.updateImportConfig(config);
      
      // Apply changes
      if (config.hasOwnProperty('autoImportEnabled')) {
        if (config.autoImportEnabled && !this.isMonitoring) {
          await this.startMonitoring();
        } else if (!config.autoImportEnabled && this.isMonitoring) {
          await this.stopMonitoring();
        }
      }

      if (config.hasOwnProperty('autoEncodingEnabled')) {
        this.autoEncodingEnabled = config.autoEncodingEnabled;
      }

      if (config.hasOwnProperty('monitoringInterval') && this.isMonitoring) {
        // Restart monitoring with new interval
        await this.stopMonitoring();
        await this.startMonitoring();
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
   * Get MIME type from file extension
   */
  getMimeType(fileName) {
    const ext = path.extname(fileName).toLowerCase();
    switch (ext) {
      case '.mp3': return 'audio/mpeg';
      case '.mp4': return 'audio/mp4';
      case '.m4a': return 'audio/x-m4a';
      default: return 'audio/mpeg';
    }
  }

  /**
   * Get service status
   */
  getStatus() {
    return {
      monitoring: this.isMonitoring,
      autoImportEnabled: this.autoImportEnabled,
      autoEncodingEnabled: this.autoEncodingEnabled,
      incomingDir: this.incomingDir
    };
  }

  /**
   * Cleanup on service shutdown
   */
  async cleanup() {
    logger.info('Cleaning up FileImportService');
    
    if (this.monitoringInterval) {
      clearInterval(this.monitoringInterval);
      this.monitoringInterval = null;
    }
    
    this.isMonitoring = false;
    
    logger.info('FileImportService cleanup completed');
  }
}

module.exports = FileImportService;