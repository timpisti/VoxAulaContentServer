// src/services/RadioService.js - Sequential FFmpeg Radio Stream Management
const { spawn } = require('child_process');
const ffmpegPath = require('@ffmpeg-installer/ffmpeg').path;
const fs = require('fs-extra');
const path = require('path');
const logger = require('../utils/logger');
const JanusService = require('./JanusService'); // NEW

class RadioService {
  constructor(metadataService, socketIO) {
    this.metadataService = metadataService;
    this.io = socketIO;
    
    // Core state
    this.ffmpegProcess = null;
    this.isRunning = false;
    this.isStopping = false;
    
    // Playlist management
    this.playlist = [];
    this.currentIndex = 0;
    this.currentTrack = null;
    
    // Error handling
    this.skipCount = 0;
    this.maxConsecutiveSkips = 5;
    this.lastTrackStart = null;
    
    // NEW: Janus integration
    this.janusService = new JanusService(metadataService);
    this.rtpTarget = null;
    
    logger.info('RadioService initialized');
  }

  /**
   * Initialize radio service and restore state if needed
   */
  async initialize() {
    try {
      // Load saved radio state from database
      const radioState = await this.metadataService.getRadioState();
      
      if (radioState && radioState.playlist) {
        this.playlist = radioState.playlist;
        this.currentIndex = radioState.currentIndex || 0;
      }
      
      logger.info('RadioService initialized', {
        playlistSize: this.playlist.length,
        currentIndex: this.currentIndex
      });
      
      return true;
    } catch (error) {
      logger.error('Failed to initialize RadioService:', error);
      return false;
    }
  }

  /**
   * Start the radio stream
   */
  async start() {
    try {
      if (this.isRunning) {
        logger.warn('Radio is already running');
        return { success: false, message: 'Radio is already running' };
      }

      logger.info('Starting radio service...');
      
      // NEW: Establish Janus session and get RTP details
      try {
        this.rtpTarget = await this.janusService.establishSession();
        logger.info('Janus session established', { rtpTarget: this.rtpTarget });
      } catch (error) {
        logger.error('Failed to establish Janus session:', error);
        return { success: false, message: `Janus connection failed: ${error.message}` };
      }
      
      // Refresh playlist from database
      await this.refreshPlaylist();
      
      if (this.playlist.length === 0) {
        logger.warn('Cannot start radio: no encoded files available');
        await this.janusService.cleanup(); // NEW: Cleanup on failure
        return { success: false, message: 'No encoded files available for streaming' };
      }

      // Update state
      this.isRunning = true;
      this.isStopping = false;
      this.skipCount = 0;
      
      // Save radio state
      await this.metadataService.updateRadioState({
        status: 'starting',
        playlist: this.playlist,
        currentIndex: this.currentIndex,
        startTime: new Date().toISOString()
      });

      // Start playing
      this.playNextTrack();
      
      // Emit to clients
      this.io.emit('radio-started', {
        playlist: this.playlist,
        currentIndex: this.currentIndex
      });

      logger.info('Radio started successfully', {
        playlistSize: this.playlist.length,
        firstTrack: this.playlist[this.currentIndex]?.originalName
      });

      return { success: true, message: 'Radio started successfully' };
      
    } catch (error) {
      logger.error('Failed to start radio:', error);
      this.isRunning = false;
      await this.janusService.cleanup(); // NEW: Cleanup on error
      
      return { success: false, message: 'Failed to start radio: ' + error.message };
    }
  }

  /**
   * Stop the radio stream
   */
  async stop() {
    try {
      if (!this.isRunning && !this.isStopping) {
        logger.warn('Radio is not running');
        return { success: false, message: 'Radio is not running' };
      }

      logger.info('Stopping radio service...');
      
      // Set stopping flag
      this.isStopping = true;
      this.isRunning = false;

      // Update state immediately to show stopping status
      await this.metadataService.updateRadioState({
        status: 'stopping',
        isStopping: true,
        isRunning: false
      });

      // Kill current FFmpeg process if running
      if (this.ffmpegProcess) {
        // Remove listeners to prevent auto-restart
        this.ffmpegProcess.removeAllListeners('close');
        this.ffmpegProcess.removeAllListeners('exit');
        
        // Gracefully terminate
        this.ffmpegProcess.kill('SIGTERM');
        
        // Force kill after timeout
        setTimeout(() => {
          if (this.ffmpegProcess && !this.ffmpegProcess.killed) {
            logger.warn('Force killing FFmpeg process');
            this.ffmpegProcess.kill('SIGKILL');
          }
        }, 5000);
        
        this.ffmpegProcess = null;
      }

      // Cleanup Janus session
      await this.janusService.cleanup();
      this.rtpTarget = null;

      // Clear current track
      this.currentTrack = null;
      
      // FIXED: Properly clear both flags and update state
      this.isStopping = false;
      this.isRunning = false;
      
      // Update final state - this is the key fix
      await this.metadataService.updateRadioState({
        status: 'stopped',
        isRunning: false,
        isStopping: false,  // CRITICAL: Reset this flag
        currentTrack: null,
        stopTime: new Date().toISOString()
      });

      // Emit to clients
      this.io.emit('radio-stopped', {
        message: 'Radio stopped by user'
      });

      logger.info('Radio stopped successfully');
      return { success: true, message: 'Radio stopped successfully' };
      
    } catch (error) {
      logger.error('Failed to stop radio:', error);
      
      // FIXED: Even on error, clear the stopping flag
      this.isStopping = false;
      this.isRunning = false;
      
      await this.metadataService.updateRadioState({
        status: 'stopped',
        isRunning: false,
        isStopping: false,  // Reset flag even on error
        stopTime: new Date().toISOString()
      });
      
      return { success: false, message: 'Failed to stop radio: ' + error.message };
    }
  }

  /**
   * Skip to next track
   */
  async skip() {
    try {
      if (!this.isRunning) {
        return { success: false, message: 'Radio is not running' };
      }

      logger.info('Skipping current track...');
      
      // Kill current process - this will trigger playNextTrack via 'close' event
      if (this.ffmpegProcess) {
        this.ffmpegProcess.kill('SIGTERM');
      } else {
        // No process running, start next track directly
        this.playNextTrack();
      }
      
      return { success: true, message: 'Skipped to next track' };
      
    } catch (error) {
      logger.error('Failed to skip track:', error);
      return { success: false, message: 'Failed to skip track: ' + error.message };
    }
  }

  /**
   * Update playlist order
   */
  async updatePlaylist(newPlaylist) {
    try {
      logger.info('Updating playlist order', { newSize: newPlaylist.length });
      
      // Validate playlist items
      const validatedPlaylist = [];
      for (const item of newPlaylist) {
        const file = await this.metadataService.getFile(item.id);
        if (file && file.status === 'completed' && await fs.pathExists(file.encodedPath)) {
          validatedPlaylist.push(file);
        } else {
          logger.warn('Skipping invalid playlist item:', item.id);
        }
      }
      
      this.playlist = validatedPlaylist;
      this.currentIndex = 0; // Reset to start of new playlist
      
      // Save updated playlist
      await this.metadataService.updateRadioState({
        playlist: this.playlist,
        currentIndex: this.currentIndex,
        lastPlaylistUpdate: new Date().toISOString()
      });
      
      // Emit to clients
      this.io.emit('radio-playlist-updated', {
        playlist: this.playlist,
        currentIndex: this.currentIndex
      });
      
      logger.info('Playlist updated successfully', { validTracks: validatedPlaylist.length });
      return { success: true, playlist: this.playlist };
      
    } catch (error) {
      logger.error('Failed to update playlist:', error);
      return { success: false, message: 'Failed to update playlist: ' + error.message };
    }
  }

  /**
   * Refresh playlist from database
   */
  async refreshPlaylist(shuffle = true) {
    try {
      logger.info('Refreshing playlist from database...');
      
      // Get all encoded files
      const files = await this.metadataService.getFiles({ status: 'completed' });
      
      // Validate files exist on disk
      const validFiles = [];
      for (const file of files) {
        if (file.encodedPath && await fs.pathExists(file.encodedPath)) {
          validFiles.push(file);
        } else {
          logger.warn('Encoded file missing, marking as failed:', file.id);
          await this.metadataService.updateFile(file.id, { 
            status: 'failed',
            error: {
              message: 'Encoded file not found on disk',
              timestamp: new Date().toISOString()
            }
          });
        }
      }
      
      // Shuffle if requested
      if (shuffle) {
        validFiles.sort(() => 0.5 - Math.random());
      }
      
      this.playlist = validFiles;
      this.currentIndex = 0;
      
      // Save updated playlist
      await this.metadataService.updateRadioState({
        playlist: this.playlist,
        currentIndex: this.currentIndex,
        lastRefresh: new Date().toISOString()
      });
      
      logger.info('Playlist refreshed', { 
        totalFiles: files.length,
        validFiles: validFiles.length,
        shuffled: shuffle
      });
      
      return { success: true, playlist: this.playlist };
      
    } catch (error) {
      logger.error('Failed to refresh playlist:', error);
      return { success: false, message: 'Failed to refresh playlist: ' + error.message };
    }
  }

  /**
   * Play the next track in sequence
   */
  playNextTrack() {
    if (this.isStopping || !this.isRunning) {
      logger.info('Not playing next track - radio is stopping/stopped');
      return;
    }

    // Check for too many consecutive skips
    if (this.skipCount >= this.maxConsecutiveSkips) {
      logger.error('Too many consecutive skips, stopping radio');
      this.stop();
      return;
    }

    // Check if playlist is empty
    if (this.playlist.length === 0) {
      logger.warn('Playlist is empty, stopping radio');
      this.stop();
      return;
    }

    // Loop back to start if at end
    if (this.currentIndex >= this.playlist.length) {
      this.currentIndex = 0;
      this.skipCount = 0; // Reset skip count on playlist loop
    }

    const track = this.playlist[this.currentIndex];
    this.currentIndex++;
    
    logger.info('Playing next track', {
      track: track.originalName,
      index: this.currentIndex - 1,
      total: this.playlist.length
    });

    this.spawnFFmpegForTrack(track);
  }

  /**
   * Spawn FFmpeg process for a specific track
   */
  async spawnFFmpegForTrack(track) {
    try {
      // Validate track file exists
      if (!await fs.pathExists(track.encodedPath)) {
        logger.error('Track file not found:', track.encodedPath);
        await this.handleTrackError(track, 'File not found on disk');
        return;
      }

      // NEW: Use Janus RTP details instead of hardcoded values
      if (!this.rtpTarget) {
        logger.error('No RTP target available from Janus session');
        await this.handleTrackError(track, 'Janus session not established');
        return;
      }

      // Build FFmpeg command for RTP streaming to Janus
      const args = [
        '-re',                           // Read input at native frame rate
        '-i', track.encodedPath,         // Input file
        '-c', 'copy',                    // Copy without re-encoding (ZERO CPU)
        '-f', 'rtp',                     // RTP output format
        '-payload_type', '111',          // Opus payload type
        `rtp://${this.rtpTarget.ip}:${this.rtpTarget.port}`
      ];

      logger.info('Starting FFmpeg for track', {
        track: track.originalName,
        file: path.basename(track.encodedPath),
        target: `${this.rtpTarget.ip}:${this.rtpTarget.port}`,
        ssrc: this.rtpTarget.ssrc,
        command: `ffmpeg ${args.join(' ')}`
      });

      // Spawn FFmpeg process
      this.ffmpegProcess = spawn(ffmpegPath, args);
      this.currentTrack = track;
      this.lastTrackStart = Date.now();
      this.skipCount = 0; // Reset skip count on successful start

      // Update radio state
      await this.metadataService.updateRadioState({
        status: 'playing',
        currentTrack: track,
        currentIndex: this.currentIndex - 1,
        processId: this.ffmpegProcess.pid,
        trackStartTime: new Date().toISOString()
      });

      // Emit track change to clients
      this.io.emit('radio-track-changed', {
        track: track,
        index: this.currentIndex - 1,
        total: this.playlist.length,
        timestamp: new Date().toISOString()
      });

      // Setup process event handlers
      this.setupFFmpegHandlers(track);

    } catch (error) {
      logger.error('Failed to spawn FFmpeg for track:', error);
      await this.handleTrackError(track, error.message);
    }
  }

  /**
   * Setup event handlers for FFmpeg process
   */
  setupFFmpegHandlers(track) {
    if (!this.ffmpegProcess) return;

    // Handle stderr output for debugging
    this.ffmpegProcess.stderr.on('data', (data) => {
      const output = data.toString().trim();
      if (output.includes('time=') || output.includes('bitrate=')) {
        logger.debug(`FFmpeg [${track.id}]: ${output}`);
      } else if (output.includes('error') || output.includes('Error')) {
        logger.warn(`FFmpeg [${track.id}] Warning: ${output}`);
      }
    });

    // Handle process errors
    this.ffmpegProcess.on('error', (error) => {
      logger.error(`FFmpeg process error for track ${track.originalName}:`, error);
      this.handleTrackError(track, `Process error: ${error.message}`);
    });

    // Handle process completion/termination
    this.ffmpegProcess.on('close', (code, signal) => {
      const duration = this.lastTrackStart ? Date.now() - this.lastTrackStart : 0;
      
      logger.info(`Track finished: ${track.originalName}`, {
        code,
        signal,
        duration: `${Math.round(duration / 1000)}s`
      });

      this.ffmpegProcess = null;
      
      // Only continue if radio is still running and not stopping
      if (this.isRunning && !this.isStopping) {
        // Small delay to ensure clean handoff
        setTimeout(() => {
          this.playNextTrack();
        }, 100);
      }
    });

    // Handle unexpected exit
    this.ffmpegProcess.on('exit', (code, signal) => {
      if (code !== 0 && signal !== 'SIGTERM') {
        logger.warn(`FFmpeg exited unexpectedly`, { code, signal, track: track.originalName });
        this.handleTrackError(track, `Unexpected exit: code ${code}, signal ${signal}`);
      }
    });
  }

  /**
   * Handle track playback errors
   */
  async handleTrackError(track, errorMessage) {
    try {
      logger.error('Track error occurred', {
        track: track.originalName,
        error: errorMessage
      });

      this.skipCount++;

      // Mark file as failed in database
      await this.metadataService.updateFile(track.id, {
        status: 'failed',
        error: {
          message: `Radio playback failed: ${errorMessage}`,
          timestamp: new Date().toISOString()
        }
      });

      // Emit error to clients
      this.io.emit('radio-track-error', {
        track: track,
        error: errorMessage,
        skipCount: this.skipCount
      });

      // Continue to next track if radio is still running
      if (this.isRunning && !this.isStopping) {
        setTimeout(() => {
          this.playNextTrack();
        }, 1000);
      }

    } catch (error) {
      logger.error('Failed to handle track error:', error);
    }
  }

  /**
   * Get current radio status
   */
  async getStatus() {
    try {
      const radioState = await this.metadataService.getRadioState();
      
      return {
        isRunning: this.isRunning,
        isStopping: this.isStopping,
        currentTrack: this.currentTrack,
        currentIndex: this.currentIndex - 1,
        playlistSize: this.playlist.length,
        skipCount: this.skipCount,
        target: this.rtpTarget ? `${this.rtpTarget.ip}:${this.rtpTarget.port}` : 'Not connected',
        processId: this.ffmpegProcess?.pid || null,
        uptime: radioState?.startTime ? Date.now() - new Date(radioState.startTime).getTime() : 0,
        lastTrackStart: this.lastTrackStart,
        // NEW: Include Janus status for debugging
        janusStatus: this.janusService.getStatus()
      };
    } catch (error) {
      logger.error('Failed to get radio status:', error);
      return { error: error.message };
    }
  }

  /**
   * Update radio configuration
   */
  async updateConfig(config) {
    try {
      // Save config to database (JanusService will read from there)
      await this.metadataService.updateRadioConfig(config);

      logger.info('Radio configuration updated', config);

      return { success: true, config };
    } catch (error) {
      logger.error('Failed to update radio config:', error);
      return { success: false, message: error.message };
    }
  }

  /**
   * Cleanup resources (called on server shutdown)
   */
  async cleanup() {
    logger.info('Cleaning up RadioService...');
    
    this.isStopping = true;
    this.isRunning = false;

    if (this.ffmpegProcess) {
      try {
        this.ffmpegProcess.removeAllListeners();
        this.ffmpegProcess.kill('SIGTERM');
        
        // Wait for graceful shutdown
        await new Promise(resolve => {
          setTimeout(resolve, 2000);
          if (this.ffmpegProcess && !this.ffmpegProcess.killed) {
            this.ffmpegProcess.kill('SIGKILL');
          }
        });
      } catch (error) {
        logger.error('Error during FFmpeg cleanup:', error);
      }
    }

    // NEW: Cleanup Janus session
    try {
      await this.janusService.cleanup();
      this.rtpTarget = null;
    } catch (error) {
      logger.error('Error during Janus cleanup:', error);
    }

    logger.info('RadioService cleanup completed');
  }
}

module.exports = RadioService;