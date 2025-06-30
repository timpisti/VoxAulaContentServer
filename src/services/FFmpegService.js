// src/services/FFmpegService.js - OPTIMIZED: Direct Spawn with Resource Management
const { spawn } = require('child_process');
const ffmpegPath = require('@ffmpeg-installer/ffmpeg').path;
const ffprobePath = require('@ffprobe-installer/ffprobe').path;
const { parseFile } = require('music-metadata');
const fs = require('fs-extra');
const path = require('path');
const logger = require('../utils/logger');

class FFmpegService {
  constructor(metadataService, socketIO) {
    this.metadataService = metadataService;
    this.io = socketIO;
    this.activeJobs = new Map(); // In-memory process tracking
    this.maxConcurrent = parseInt(process.env.MAX_CONCURRENT_ENCODING) || 1;
    
    // Reference to FileImportService (set later)
    this.fileImportService = null;
    
    // Resource management for low-end VPS
    this.isLowResourceMode = this.maxConcurrent === 1;
    
    // Initialize job recovery on startup
    this.initializeJobRecovery();
  }

  // Set FileImportService reference
  setFileImportService(fileImportService) {
    this.fileImportService = fileImportService;
  }

  // Initialize job recovery on service startup
  async initializeJobRecovery() {
    try {
      logger.info('Initializing FFmpegService with direct spawn implementation');
      
      // Check for incomplete jobs from previous session
      const incompleteJobs = await this.metadataService.getIncompleteJobs();
      
      if (incompleteJobs.length > 0) {
        logger.info(`Found ${incompleteJobs.length} incomplete jobs to reset`);
        
        // Reset incomplete jobs to uploaded status
        for (const file of incompleteJobs) {
          await this.metadataService.updateFile(file.id, {
            status: 'uploaded',
            progress: 0,
            error: {
              message: 'Encoding was interrupted by server restart',
              timestamp: new Date().toISOString(),
              technical: 'Previous encoding session was terminated unexpectedly'
            }
          });
          
          await this.metadataService.addLog(file.id, {
            level: 'warn',
            message: 'Encoding job reset due to server restart',
            details: { 
              previousStatus: 'encoding',
              resetReason: 'server_restart'
            }
          });
          
          logger.info('Reset incomplete job', { 
            fileId: file.id, 
            originalName: file.originalName 
          });
        }
        
        // Emit events to notify frontend about reset jobs
        if (this.io) {
          incompleteJobs.forEach(file => {
            this.io.to('file-updates').emit('encoding-reset', {
              fileId: file.id,
              message: 'Encoding was reset due to server restart'
            });
          });
        }
      }
      
      logger.info('Job recovery initialization completed');
    } catch (error) {
      logger.error('Failed to initialize job recovery:', error);
    }
  }

  async encodeFile(fileId) {
    try {
      // Check if already encoding
      if (this.activeJobs.has(fileId)) {
        throw new Error('File is already being encoded');
      }

      // Check concurrent limit
      if (this.activeJobs.size >= this.maxConcurrent) {
        throw new Error('Maximum concurrent encoding limit reached');
      }

      const file = await this.metadataService.getFile(fileId);
      if (!file) {
        throw new Error('File not found');
      }

      if (file.status === 'completed') {
        throw new Error('File is already encoded');
      }

      if (!await fs.pathExists(file.originalPath)) {
        throw new Error('Original file not found on disk');
      }

      logger.info('Starting encoding process', { 
        fileId, 
        originalName: file.originalName 
      });

      // Update status to encoding
      await this.metadataService.updateFile(fileId, {
        status: 'encoding',
        progress: 0,
        error: null
      });

      // Add active job to persistent storage
      const outputPath = this.generateOutputPath(file);
      const activeJob = await this.metadataService.addActiveJob({
        fileId,
        inputPath: file.originalPath,
        outputPath,
        startTime: new Date().toISOString(),
        progress: 0
      });

      // Extract metadata first (lightweight operation)
      await this.extractMetadata(fileId, file.originalPath);

      // Start encoding with direct spawn
      const result = await this.performDirectEncoding(fileId, file.originalPath, outputPath, activeJob);

      // Update file record with success
      await this.metadataService.updateFile(fileId, {
        status: 'completed',
        progress: 100,
        encodedPath: outputPath,
        error: null
      });

      await this.metadataService.addLog(fileId, {
        level: 'info',
        message: 'Encoding completed successfully',
        details: { 
          duration: result.duration,
          outputSize: result.size 
        }
      });

      // Remove from active jobs
      await this.metadataService.removeActiveJob(fileId, 'completed');

      // Emit success to frontend
      this.io.to('file-updates').emit('encoding-completed', {
        fileId,
        success: true,
        outputPath
      });

      logger.info('Encoding completed successfully', { 
        fileId, 
        duration: result.duration 
      });

      return result;

    } catch (error) {
      logger.error('Encoding failed', { fileId, error: error.message });

      // Update file record with error
      await this.metadataService.updateFile(fileId, {
        status: 'failed',
        error: {
          message: error.message,
          timestamp: new Date().toISOString(),
          technical: error.stack || error.toString()
        }
      });

      await this.metadataService.addLog(fileId, {
        level: 'error',
        message: 'Encoding failed',
        details: {
          error: error.message,
          technical: error.stack
        }
      });

      // Remove from active jobs with failure reason
      await this.metadataService.removeActiveJob(fileId, 'failed');

      // Emit error to frontend
      this.io.to('file-updates').emit('encoding-failed', {
        fileId,
        error: {
          message: error.message,
          userFriendly: this.getUserFriendlyError(error)
        }
      });

      throw error;
    } finally {
      this.activeJobs.delete(fileId);
    }
  }

  async extractMetadata(fileId, filePath) {
    try {
      logger.info('Extracting metadata', { fileId, filePath: path.basename(filePath) });
      
      const metadata = await parseFile(filePath);
      
      await this.metadataService.updateFile(fileId, {
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

      await this.metadataService.addLog(fileId, {
        level: 'info',
        message: 'Metadata extracted successfully',
        details: {
          duration: metadata.format.duration,
          bitrate: metadata.format.bitrate,
          title: metadata.common.title,
          artist: metadata.common.artist
        }
      });

      logger.info('Metadata extraction completed', { 
        fileId, 
        duration: metadata.format.duration,
        title: metadata.common.title 
      });

    } catch (error) {
      logger.warn('Failed to extract metadata', { fileId, error: error.message });
      
      await this.metadataService.addLog(fileId, {
        level: 'warn',
        message: 'Failed to extract metadata',
        details: { error: error.message }
      });
    }
  }

  // OPTIMIZED: Direct spawn encoding (following RadioService.js pattern)
  async performDirectEncoding(fileId, inputPath, outputPath, activeJob) {
    return new Promise((resolve, reject) => {
      const startTime = Date.now();

      logger.info('Starting direct FFmpeg encoding', { 
        fileId, 
        inputPath: path.basename(inputPath),
        outputPath: path.basename(outputPath)
      });

      // Build FFmpeg arguments for Opus encoding
      const args = [
        '-i', inputPath,                                    // Input file
        '-c:a', process.env.FFMPEG_OUTPUT_CODEC || 'libopus', // Audio codec
        '-ar', process.env.FFMPEG_SAMPLE_RATE || '48000',   // Sample rate
        '-ac', process.env.FFMPEG_CHANNELS || '2',          // Channels
        '-b:a', process.env.FFMPEG_BITRATE || '128k',       // Bitrate
        '-application', 'audio',                            // Opus application type
        '-frame_duration', '20',                            // Frame duration
        '-packet_loss', '1',                                // Packet loss resilience
        '-y',                                               // Overwrite output
        outputPath                                          // Output file
      ];

      // Spawn FFmpeg process (same pattern as RadioService.js)
      const ffmpegProcess = spawn(ffmpegPath, args);

      // Store process reference for cleanup
      this.activeJobs.set(fileId, {
        process: ffmpegProcess,
        startTime,
        inputPath,
        outputPath,
        pid: ffmpegProcess.pid
      });

      // Handle process start
      ffmpegProcess.on('spawn', async () => {
        logger.info('FFmpeg process started', { 
          fileId, 
          pid: ffmpegProcess.pid,
          command: `ffmpeg ${args.join(' ')}`
        });

        // Update active job with process info
        await this.metadataService.updateActiveJob(fileId, {
          processId: ffmpegProcess.pid,
          status: 'running',
          command: args.join(' ')
        });

        await this.metadataService.addLog(fileId, {
          level: 'info',
          message: 'FFmpeg encoding started',
          details: { 
            processId: ffmpegProcess.pid,
            command: args.join(' ')
          }
        });

        // Initial progress update
        await this.updateProgress(fileId, 5);
      });

      // Handle stderr for progress parsing (FFmpeg outputs progress to stderr)
      let progressData = '';
      ffmpegProcess.stderr.on('data', async (data) => {
        const output = data.toString();
        progressData += output;

        // Parse progress from FFmpeg stderr
        const progressMatch = output.match(/time=(\d+):(\d+):(\d+\.\d+)/);
        if (progressMatch) {
          const hours = parseInt(progressMatch[1]);
          const minutes = parseInt(progressMatch[2]);
          const seconds = parseFloat(progressMatch[3]);
          const currentTime = hours * 3600 + minutes * 60 + seconds;

          // Estimate progress (we'll get duration from metadata)
          const file = await this.metadataService.getFile(fileId);
          if (file?.metadata?.duration) {
            const percent = Math.min(95, Math.max(5, Math.floor((currentTime / file.metadata.duration) * 100)));
            await this.updateProgress(fileId, percent);
          }
        }

        // Log any errors or warnings
        if (output.includes('error') || output.includes('Error')) {
          logger.warn(`FFmpeg warning [${fileId}]:`, output.trim());
        }
      });

      // Handle process errors
      ffmpegProcess.on('error', async (error) => {
        logger.error(`FFmpeg process error for file ${fileId}:`, error);
        
        await this.metadataService.updateActiveJob(fileId, {
          status: 'failed',
          endTime: new Date().toISOString(),
          error: error.message
        });
        
        reject(new Error(`FFmpeg process error: ${error.message}`));
      });

      // Handle process completion
      ffmpegProcess.on('close', async (code, signal) => {
        try {
          const duration = Date.now() - startTime;
          
          logger.info(`FFmpeg process finished for ${fileId}`, {
            code,
            signal,
            duration: `${Math.round(duration / 1000)}s`
          });

          if (code === 0) {
            // Success - check output file
            const stats = await fs.stat(outputPath);
            
            if (stats.size === 0) {
              throw new Error('Output file is empty');
            }

            // Update final job status
            await this.metadataService.updateActiveJob(fileId, {
              progress: 100,
              status: 'completed',
              endTime: new Date().toISOString(),
              outputSize: stats.size
            });

            logger.info('FFmpeg encoding completed successfully', {
              fileId,
              duration,
              outputSize: stats.size
            });

            resolve({
              success: true,
              duration,
              size: stats.size,
              outputPath
            });

          } else if (signal === 'SIGTERM') {
            // Cancelled by user
            reject(new Error('Encoding was cancelled'));
          } else {
            // Process failed
            throw new Error(`FFmpeg exited with code ${code}`);
          }

        } catch (error) {
          await this.metadataService.updateActiveJob(fileId, {
            status: 'failed',
            endTime: new Date().toISOString(),
            error: error.message
          });
          
          reject(error);
        }
      });

      // Handle unexpected exit
      ffmpegProcess.on('exit', (code, signal) => {
        if (code !== 0 && signal !== 'SIGTERM') {
          logger.warn(`FFmpeg exited unexpectedly`, { 
            fileId, 
            code, 
            signal 
          });
        }
      });
    });
  }

  // Helper method to update progress
  async updateProgress(fileId, percent) {
    // Update database
    await this.metadataService.updateFile(fileId, { progress: percent });
    await this.metadataService.updateActiveJob(fileId, { 
      progress: percent,
      lastProgressUpdate: new Date().toISOString()
    });
    
    // Emit real-time progress
    this.io.to('file-updates').emit('encoding-progress', {
      fileId,
      progress: percent
    });

    logger.debug('Encoding progress', { fileId, percent });
  }

  generateOutputPath(file) {
    const reencodedDir = process.env.REENCODED_DIR || './data/reencoded';
    const baseName = path.basename(file.originalName, path.extname(file.originalName));
    const safeName = baseName.replace(/[^a-zA-Z0-9_-]/g, '_');
    return path.join(reencodedDir, `${safeName}_${file.id}.opus`);
  }

  getUserFriendlyError(error) {
    const message = error.message.toLowerCase();
    
    if (message.includes('invalid data found')) {
      return 'The audio file appears to be corrupted or in an unsupported format.';
    }
    
    if (message.includes('no such file')) {
      return 'The audio file could not be found.';
    }
    
    if (message.includes('permission denied')) {
      return 'Permission denied when accessing the file.';
    }
    
    if (message.includes('codec')) {
      return 'Unsupported audio codec or format.';
    }
    
    return 'An unexpected error occurred during encoding. Please try again.';
  }

  // Enhanced job cancellation with better cleanup
  async cancelEncoding(fileId) {
    const job = this.activeJobs.get(fileId);
    if (job && job.process) {
      logger.info('Cancelling encoding job', { fileId });
      
      // Kill FFmpeg process (same pattern as RadioService.js)
      job.process.removeAllListeners();
      job.process.kill('SIGTERM');
      
      // Force kill after timeout
      setTimeout(() => {
        if (job.process && !job.process.killed) {
          logger.warn('Force killing FFmpeg process', { fileId });
          job.process.kill('SIGKILL');
        }
      }, 5000);
      
      this.activeJobs.delete(fileId);
      
      // Update persistent job status
      await this.metadataService.updateActiveJob(fileId, {
        status: 'cancelled',
        endTime: new Date().toISOString()
      });
      
      await this.metadataService.updateFile(fileId, {
        status: 'uploaded',
        progress: 0,
        error: {
          message: 'Encoding cancelled by user',
          timestamp: new Date().toISOString()
        }
      });

      await this.metadataService.addLog(fileId, {
        level: 'info',
        message: 'Encoding cancelled by user'
      });

      // Remove from active jobs
      await this.metadataService.removeActiveJob(fileId, 'cancelled');

      this.io.to('file-updates').emit('encoding-cancelled', { fileId });
      
      logger.info('Encoding cancelled', { fileId });
      return true;
    }
    
    return false;
  }

  // Get active jobs with persistent data
  async getActiveJobs() {
    const memoryJobs = Array.from(this.activeJobs.entries()).map(([fileId, job]) => ({
      fileId,
      inputPath: job.inputPath,
      outputPath: job.outputPath,
      duration: Date.now() - job.startTime,
      pid: job.pid
    }));

    const persistentJobs = await this.metadataService.getActiveJobs();
    
    // Combine memory and persistent data
    return memoryJobs.map(memJob => {
      const persistentJob = persistentJobs.find(pJob => pJob.fileId === memJob.fileId);
      return {
        ...memJob,
        ...persistentJob,
        runtime: memJob.duration
      };
    });
  }

  async retryEncoding(fileId) {
    const file = await this.metadataService.getFile(fileId);
    if (!file) {
      throw new Error('File not found');
    }

    if (file.status === 'encoding') {
      throw new Error('File is currently being encoded');
    }

    logger.info('Retrying encoding', { fileId, retryCount: (file.retryCount || 0) + 1 });

    // Reset file status
    await this.metadataService.updateFile(fileId, {
      status: 'uploaded',
      progress: 0,
      error: null,
      retryCount: (file.retryCount || 0) + 1
    });

    await this.metadataService.addLog(fileId, {
      level: 'info',
      message: `Encoding retry attempt ${(file.retryCount || 0) + 1}`
    });

    // Start encoding
    return this.encodeFile(fileId);
  }

  // Check if encoding is currently active (for resource management)
  isEncodingActive() {
    return this.activeJobs.size > 0;
  }

  // Cleanup method for graceful shutdown
  async cleanup() {
    logger.info('Cleaning up FFmpegService');
    
    const activeJobIds = Array.from(this.activeJobs.keys());
    
    if (activeJobIds.length > 0) {
      logger.info(`Cleaning up ${activeJobIds.length} active encoding jobs`);
      
      for (const fileId of activeJobIds) {
        try {
          await this.cancelEncoding(fileId);
        } catch (error) {
          logger.error('Error cancelling job during cleanup:', error);
        }
      }
    }
    
    logger.info('FFmpegService cleanup completed');
  }

  // Health check method
  async healthCheck() {
    const activeJobs = await this.getActiveJobs();
    const memoryJobs = this.activeJobs.size;
    const persistentJobs = await this.metadataService.getActiveJobs();
    
    return {
      service: 'FFmpegService',
      status: 'healthy',
      implementation: 'direct-spawn',
      activeJobs: activeJobs.length,
      memoryJobs,
      persistentJobs: persistentJobs.length,
      maxConcurrent: this.maxConcurrent,
      capacityUsed: Math.round((activeJobs.length / this.maxConcurrent) * 100),
      lowResourceMode: this.isLowResourceMode
    };
  }
}

module.exports = FFmpegService;