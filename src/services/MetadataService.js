// src/services/MetadataService.js - FIXED: Complete with Import Configuration
const fs = require('fs-extra');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const logger = require('../utils/logger');

class MetadataService {
  constructor() {
    this.dbPath = path.join(process.env.METADATA_DIR || './data/metadata', 'database.json');
    this.data = null;
  }

  getDefaultData() {
    return {
      files: [],
      system: {
        version: '1.0.0',
        initialized: new Date().toISOString(),
        encodingEnabled: true,
        stats: {
          totalFiles: 0,
          totalEncoded: 0,
          totalFailed: 0,
          totalSize: 0
        }
      },
      // Radio state management
      radio: {
        status: 'stopped', // stopped, starting, playing, stopping
        currentTrack: null,
        currentIndex: 0,
        playlist: [],
        processId: null,
        startTime: null,
        stopTime: null,
        isStopping: false,
        trackStartTime: null,
        lastRefresh: null,
        lastPlaylistUpdate: null,
        skipCount: 0
      },
      // Radio configuration with correct defaults
      radioConfig: {
        // Legacy RTP fields (kept for backward compatibility)
        targetIP: '185.80.51.95',
        targetPort: '8088',
        // Janus AudioBridge configuration with correct defaults
        janusIP: '185.80.51.95',
        janusPort: '8088',
        janusRoomId: '3183360752998701',
        janusParticipantName: 'RadioStation',
        janusRoomSecret: '',
        janusRoomPin: '',
        maxConsecutiveSkips: 5,
        autoRestart: false,
        updatedAt: null
      },
      // NEW: File import configuration
      importConfig: {
        autoImportEnabled: false,
        autoEncodingEnabled: false,
        autoImportReencodedEnabled: false, // NEW: For reencoded directory
        monitoringInterval: 3600000, // 1 hour in milliseconds
        reencodedMonitoringInterval: 3600000, // 1 hour in milliseconds
        updatedAt: null
      },
      // Active encoding jobs persistence
      activeJobs: [],
      jobHistory: []
    };
  }

  async initialize() {
    try {
      // Ensure directory exists
      await fs.ensureDir(path.dirname(this.dbPath));
      
      // Read or create database
      if (await fs.pathExists(this.dbPath)) {
        this.data = await fs.readJSON(this.dbPath);
        logger.info('Database loaded from file');
      } else {
        this.data = this.getDefaultData();
        await this.writeData();
        logger.info('Database initialized with default data');
      }
      
      // Perform migrations if needed
      await this.performMigrations();
      
      logger.info('MetadataService initialized', { path: this.dbPath });
    } catch (error) {
      logger.error('Failed to initialize MetadataService:', error);
      throw error;
    }
  }

  async performMigrations() {
    const currentVersion = this.data.system.version;
    let needsWrite = false;
    
    // Add new fields if they don't exist
    if (!this.data.activeJobs) {
      this.data.activeJobs = [];
      needsWrite = true;
    }
    if (!this.data.jobHistory) {
      this.data.jobHistory = [];
      needsWrite = true;
    }
    
    // Add radio state management
    if (!this.data.radio) {
      this.data.radio = {
        status: 'stopped',
        currentTrack: null,
        currentIndex: 0,
        playlist: [],
        processId: null,
        startTime: null,
        stopTime: null,
        trackStartTime: null,
        lastRefresh: null,
        lastPlaylistUpdate: null,
        skipCount: 0
      };
      needsWrite = true;
      logger.info('Added radio state management to database');
    }
    
    // Add/update radio configuration with correct defaults
    if (!this.data.radioConfig) {
      this.data.radioConfig = {
        // Legacy RTP fields
        targetIP: '185.80.51.95',
        targetPort: '8088',
        // Janus configuration with correct defaults
        janusIP: '185.80.51.95',
        janusPort: '8088',
        janusRoomId: '3183360752998701',
        janusParticipantName: 'RadioStation',
        janusRoomSecret: '',
        janusRoomPin: '',
        maxConsecutiveSkips: 5,
        autoRestart: false,
        updatedAt: new Date().toISOString()
      };
      needsWrite = true;
      logger.info('Added radio configuration to database');
    } else {
      // Update existing config with new defaults if fields are missing
      const defaultConfig = {
        janusIP: '185.80.51.95',
        janusPort: '8088',
        janusRoomId: '3183360752998701',
        janusParticipantName: 'RadioStation',
        janusRoomSecret: '',
        janusRoomPin: '',
        maxConsecutiveSkips: 5,
        autoRestart: false
      };
      
      let configUpdated = false;
      for (const [key, defaultValue] of Object.entries(defaultConfig)) {
        if (!(key in this.data.radioConfig)) {
          this.data.radioConfig[key] = defaultValue;
          configUpdated = true;
        }
      }
      
      if (configUpdated) {
        this.data.radioConfig.updatedAt = new Date().toISOString();
        needsWrite = true;
        logger.info('Updated radio configuration with missing Janus fields');
      }
    }
    
    // NEW: Add import configuration
    if (!this.data.importConfig) {
      this.data.importConfig = {
        autoImportEnabled: false,
        autoEncodingEnabled: false,
        autoImportReencodedEnabled: false, // NEW: For reencoded directory
        monitoringInterval: 3600000, // 1 hour
        reencodedMonitoringInterval: 3600000, // 1 hour
        updatedAt: new Date().toISOString()
      };
      needsWrite = true;
      logger.info('Added import configuration to database');
    } else {
      // Update existing config with new defaults if fields are missing
      if (!this.data.importConfig.hasOwnProperty('autoImportReencodedEnabled')) {
        this.data.importConfig.autoImportReencodedEnabled = false;
        needsWrite = true;
      }
      if (!this.data.importConfig.hasOwnProperty('reencodedMonitoringInterval')) {
        this.data.importConfig.reencodedMonitoringInterval = 3600000;
        needsWrite = true;
      }
      
      if (needsWrite) {
        this.data.importConfig.updatedAt = new Date().toISOString();
        logger.info('Updated import configuration with reencoded directory support');
      }
    }
    
    // Version migration
    if (!currentVersion || currentVersion < '1.0.0') {
      this.data.system.version = '1.0.0';
      needsWrite = true;
    }
    
    if (needsWrite) {
      await this.writeData();
    }
  }

  async writeData() {
    try {
      await fs.writeJSON(this.dbPath, this.data, { spaces: 2 });
    } catch (error) {
      logger.error('Failed to write database:', error);
      throw error;
    }
  }

  // FILE MANAGEMENT METHODS
  
  async addFile(fileData) {
    const fileRecord = {
      id: fileData.id || uuidv4(),
      originalName: fileData.originalName,
      fileName: fileData.fileName,
      originalPath: fileData.originalPath,
      encodedPath: fileData.encodedPath || null,
      
      // Status management
      status: 'uploaded', // uploaded|encoding|completed|failed
      progress: 0,
      
      // File info
      size: fileData.size,
      mimeType: fileData.mimeType,
      uploadDate: new Date().toISOString(),
      
      // Import info (if applicable)
      imported: fileData.imported || false,
      importDate: fileData.importDate || null,
      
      // Bull queue compatibility (for future)
      jobId: null,
      priority: 'normal',
      retryCount: 0,
      
      // Error handling
      error: null,
      logs: [],
      
      // Audio metadata (will be populated by FFmpeg)
      metadata: {
        duration: null,
        bitrate: null,
        title: null,
        artist: null,
        album: null
      }
    };
    
    this.data.files.push(fileRecord);
    
    // Update stats
    this.data.system.stats.totalFiles++;
    this.data.system.stats.totalSize += fileData.size;
    
    await this.writeData();
    
    logger.info('File metadata added', { 
      fileId: fileRecord.id, 
      originalName: fileRecord.originalName 
    });
    
    return fileRecord;
  }

  async updateFile(fileId, updates) {
    const fileIndex = this.data.files.findIndex(f => f.id === fileId);
    if (fileIndex === -1) {
      throw new Error(`File not found: ${fileId}`);
    }
    
    const file = this.data.files[fileIndex];
    const oldStatus = file.status;
    
    // Update file record
    Object.assign(file, updates);
    file.lastModified = new Date().toISOString();
    
    // Update system stats if status changed
    if (updates.status === 'completed' && oldStatus !== 'completed') {
      this.data.system.stats.totalEncoded++;
    } else if (updates.status === 'failed' && oldStatus !== 'failed') {
      this.data.system.stats.totalFailed++;
    }
    
    await this.writeData();
    
    logger.debug('File metadata updated', { fileId, updates });
    return file;
  }

  async getFile(fileId) {
    return this.data.files.find(f => f.id === fileId) || null;
  }

  async getFiles(filters = {}) {
    let files = [...this.data.files];
    
    // Apply filters
    if (filters.status) {
      files = files.filter(f => f.status === filters.status);
    }
    
    if (filters.search) {
      const search = filters.search.toLowerCase();
      files = files.filter(f => 
        f.originalName.toLowerCase().includes(search) ||
        (f.metadata.title && f.metadata.title.toLowerCase().includes(search)) ||
        (f.metadata.artist && f.metadata.artist.toLowerCase().includes(search))
      );
    }
    
    // Sort by upload date (newest first)
    files.sort((a, b) => new Date(b.uploadDate) - new Date(a.uploadDate));
    
    return files;
  }

  async deleteFile(fileId) {
    const fileIndex = this.data.files.findIndex(f => f.id === fileId);
    if (fileIndex === -1) {
      return false;
    }
    
    const file = this.data.files[fileIndex];
    
    // Remove from database
    this.data.files.splice(fileIndex, 1);
    
    // Update stats
    this.data.system.stats.totalFiles--;
    this.data.system.stats.totalSize -= file.size;
    if (file.status === 'completed') {
      this.data.system.stats.totalEncoded--;
    } else if (file.status === 'failed') {
      this.data.system.stats.totalFailed--;
    }
    
    await this.writeData();
    
    // Clean up physical files
    try {
      if (await fs.pathExists(file.originalPath)) {
        await fs.remove(file.originalPath);
      }
      if (file.encodedPath && await fs.pathExists(file.encodedPath)) {
        await fs.remove(file.encodedPath);
      }
      logger.info('File deleted successfully', { fileId, originalName: file.originalName });
    } catch (error) {
      logger.warn('Failed to delete physical files:', error);
    }
    
    return true;
  }

  // NEW: Get file by file path (for duplicate detection in import)
  async getFileByPath(filePath) {
    return this.data.files.find(f => f.originalPath === filePath) || null;
  }

  // RADIO STATE MANAGEMENT METHODS

  /**
   * Get current radio state
   */
  async getRadioState() {
    return { ...this.data.radio };
  }

  /**
   * Update radio state
   */
  async updateRadioState(updates) {
    Object.assign(this.data.radio, updates);
    this.data.radio.lastUpdate = new Date().toISOString();
    
    await this.writeData();
    
    logger.debug('Radio state updated', updates);
    return { ...this.data.radio };
  }

  /**
   * Get radio configuration
   */
  async getRadioConfig() {
    return { ...this.data.radioConfig };
  }

  /**
   * Update radio configuration
   */
  async updateRadioConfig(config) {
    Object.assign(this.data.radioConfig, config);
    this.data.radioConfig.updatedAt = new Date().toISOString();
    
    await this.writeData();
    
    logger.info('Radio configuration updated', config);
    return { ...this.data.radioConfig };
  }

  /**
   * Save radio playlist
   */
  async updateRadioPlaylist(playlist) {
    this.data.radio.playlist = playlist;
    this.data.radio.lastPlaylistUpdate = new Date().toISOString();
    
    await this.writeData();
    
    logger.debug('Radio playlist saved', { count: playlist.length });
    return true;
  }

  /**
   * Clear radio state (on service restart)
   */
  async clearRadioState() {
    this.data.radio = {
      status: 'stopped',
      currentTrack: null,
      currentIndex: 0,
      playlist: this.data.radio.playlist || [], // Keep playlist
      processId: null,
      startTime: null,
      stopTime: new Date().toISOString(),
      trackStartTime: null,
      lastRefresh: this.data.radio.lastRefresh,
      lastPlaylistUpdate: this.data.radio.lastPlaylistUpdate,
      skipCount: 0
    };
    
    await this.writeData();
    
    logger.info('Radio state cleared');
    return true;
  }

  // NEW: IMPORT CONFIGURATION METHODS

  /**
   * Get import configuration
   */
  async getImportConfig() {
    return { ...this.data.importConfig };
  }

  /**
   * Update import configuration
   */
  async updateImportConfig(config) {
    Object.assign(this.data.importConfig, config);
    this.data.importConfig.updatedAt = new Date().toISOString();
    
    await this.writeData();
    
    logger.info('Import configuration updated', config);
    return { ...this.data.importConfig };
  }

  // LOG MANAGEMENT METHODS

  async addLog(fileId, logEntry) {
    const file = this.data.files.find(f => f.id === fileId);
    if (file) {
      if (!file.logs) file.logs = [];
      
      file.logs.push({
        timestamp: new Date().toISOString(),
        level: logEntry.level || 'info',
        message: logEntry.message,
        details: logEntry.details || null
      });
      
      // Keep only last 50 log entries per file
      if (file.logs.length > 50) {
        file.logs = file.logs.slice(-50);
      }
      
      await this.writeData();
    }
  }

  // SYSTEM STATS METHODS

  async getSystemStats() {
    const files = this.data.files;
    const now = new Date();
    const last24h = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    
    return {
      ...this.data.system.stats,
      recent: {
        uploaded24h: files.filter(f => new Date(f.uploadDate) > last24h).length,
        encoded24h: files.filter(f => 
          f.status === 'completed' && 
          f.lastModified && 
          new Date(f.lastModified) > last24h
        ).length
      },
      currentStatus: {
        encoding: files.filter(f => f.status === 'encoding').length,
        pending: files.filter(f => f.status === 'uploaded').length,
        failed: files.filter(f => f.status === 'failed').length
      },
      activeJobs: (this.data.activeJobs || []).length,
      // Radio stats
      radio: {
        status: this.data.radio.status,
        playlistSize: this.data.radio.playlist.length,
        currentTrack: this.data.radio.currentTrack?.originalName || null,
        uptime: this.data.radio.startTime ? 
          now.getTime() - new Date(this.data.radio.startTime).getTime() : 0
      }
    };
  }

  // BACKUP AND RESTORE METHODS

  async backup() {
    const backupPath = path.join(
      path.dirname(this.dbPath), 
      `backup-${Date.now()}.json`
    );
    
    await fs.writeJSON(backupPath, this.data, { spaces: 2 });
    
    logger.info('Database backup created', { path: backupPath });
    return backupPath;
  }

  async restore(backupPath) {
    if (!await fs.pathExists(backupPath)) {
      throw new Error(`Backup file not found: ${backupPath}`);
    }
    
    this.data = await fs.readJSON(backupPath);
    await this.writeData();
    
    logger.info('Database restored from backup', { path: backupPath });
  }

  // ACTIVE JOB MANAGEMENT METHODS

  async addActiveJob(jobData) {
    if (!this.data.activeJobs) {
      this.data.activeJobs = [];
    }
    
    const job = {
      id: jobData.id || uuidv4(),
      fileId: jobData.fileId,
      startTime: new Date().toISOString(),
      progress: 0,
      status: 'active',
      processId: jobData.processId || null,
      inputPath: jobData.inputPath,
      outputPath: jobData.outputPath,
      ...jobData
    };
    
    // Remove any existing job for the same file
    this.data.activeJobs = this.data.activeJobs.filter(j => j.fileId !== jobData.fileId);
    
    // Add new job
    this.data.activeJobs.push(job);
    
    await this.writeData();
    
    logger.info('Active job added', { jobId: job.id, fileId: job.fileId });
    return job;
  }

  async updateActiveJob(fileId, updates) {
    if (!this.data.activeJobs) {
      this.data.activeJobs = [];
      return null;
    }
    
    const jobIndex = this.data.activeJobs.findIndex(j => j.fileId === fileId);
    if (jobIndex !== -1) {
      Object.assign(this.data.activeJobs[jobIndex], updates);
      this.data.activeJobs[jobIndex].lastUpdate = new Date().toISOString();
      
      await this.writeData();
      
      logger.debug('Active job updated', { fileId, updates });
      return this.data.activeJobs[jobIndex];
    }
    
    return null;
  }

  async removeActiveJob(fileId, reason = 'completed') {
    if (!this.data.activeJobs) {
      this.data.activeJobs = [];
      return null;
    }
    
    const jobIndex = this.data.activeJobs.findIndex(j => j.fileId === fileId);
    if (jobIndex !== -1) {
      const job = this.data.activeJobs[jobIndex];
      
      // Initialize jobHistory if it doesn't exist
      if (!this.data.jobHistory) {
        this.data.jobHistory = [];
      }
      
      // Move to history
      this.data.jobHistory.unshift({
        ...job,
        endTime: new Date().toISOString(),
        status: reason
      });
      
      // Keep only last 100 job history entries
      if (this.data.jobHistory.length > 100) {
        this.data.jobHistory = this.data.jobHistory.slice(0, 100);
      }
      
      // Remove from active jobs
      this.data.activeJobs.splice(jobIndex, 1);
      
      await this.writeData();
      
      logger.info('Active job removed', { fileId, reason });
      return job;
    }
    
    return null;
  }

  async getActiveJobs() {
    if (!this.data.activeJobs) {
      this.data.activeJobs = [];
    }
    return [...this.data.activeJobs];
  }

  async getActiveJob(fileId) {
    if (!this.data.activeJobs) {
      return null;
    }
    return this.data.activeJobs.find(j => j.fileId === fileId) || null;
  }

  async getIncompleteJobs() {
    // Find files that were encoding but don't have active jobs
    const encodingFiles = this.data.files.filter(f => f.status === 'encoding');
    const activeJobFileIds = (this.data.activeJobs || []).map(j => j.fileId);
    
    const incompleteJobs = encodingFiles.filter(f => !activeJobFileIds.includes(f.id));
    
    if (incompleteJobs.length > 0) {
      logger.info(`Found ${incompleteJobs.length} incomplete encoding jobs`);
    }
    
    return incompleteJobs;
  }
}

module.exports = MetadataService;