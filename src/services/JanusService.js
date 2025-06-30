// src/services/JanusService.js - FIXED: Added Session Keepalive to Prevent 60s Timeout
const axios = require('axios');
const logger = require('../utils/logger');

class JanusService {
  constructor(metadataService) {
    this.metadataService = metadataService;
    this.sessionId = null;
    this.handleId = null;
    this.participantId = null;
    this.rtpDetails = null;
    this.baseUrl = null;
    
    // NEW: Keepalive mechanism
    this.keepaliveTimer = null;
    this.keepaliveInterval = 30000; // 30 seconds (safe margin under 60s timeout)
    this.keepaliveFailureCount = 0;
    this.maxKeepaliveFailures = 3;
  }

  /**
   * Sanitize error objects to prevent circular reference issues
   */
  sanitizeError(error) {
    if (!error) return 'Unknown error';
    
    // If it's an axios error
    if (error.response) {
      return {
        message: error.message || 'HTTP request failed',
        status: error.response.status,
        statusText: error.response.statusText,
        data: error.response.data
      };
    }
    
    // If it's a regular error
    if (error.message) {
      return {
        message: error.message,
        name: error.name,
        stack: error.stack ? error.stack.split('\n').slice(0, 3).join('\n') : null
      };
    }
    
    // Fallback
    return { message: String(error) };
  }

  /**
   * Create a safe error message for user-facing responses
   */
  getSafeErrorMessage(error) {
    if (!error) return 'Unknown error occurred';
    
    if (error.response) {
      return `HTTP ${error.response.status}: ${error.response.data?.error || error.message || 'Request failed'}`;
    }
    
    return error.message || String(error);
  }

  /**
   * NEW: Start keepalive timer to prevent session timeout
   */
  startKeepalive() {
    if (this.keepaliveTimer) {
      clearInterval(this.keepaliveTimer);
    }
    
    logger.debug('Starting Janus session keepalive', { 
      interval: this.keepaliveInterval,
      sessionId: this.sessionId 
    });
    
    this.keepaliveTimer = setInterval(async () => {
      await this.sendKeepalive();
    }, this.keepaliveInterval);
  }

  /**
   * NEW: Send keepalive message to Janus session
   */
  async sendKeepalive() {
    if (!this.sessionId || !this.baseUrl) {
      logger.warn('Cannot send keepalive: no active session');
      return;
    }

    try {
      const response = await axios.post(`${this.baseUrl}/${this.sessionId}`, {
        janus: 'keepalive',
        transaction: this.generateTransactionId()
      }, {
        timeout: 5000,
        headers: {
          'Content-Type': 'application/json'
        }
      });

      if (response.data.janus === 'ack') {
        // Reset failure count on success
        this.keepaliveFailureCount = 0;
        logger.debug('Janus session keepalive sent successfully', { 
          sessionId: this.sessionId 
        });
      } else {
        throw new Error(`Unexpected keepalive response: ${response.data.janus}`);
      }

    } catch (error) {
      this.keepaliveFailureCount++;
      const sanitizedError = this.sanitizeError(error);
      
      logger.warn('Janus keepalive failed', { 
        sessionId: this.sessionId,
        attempt: this.keepaliveFailureCount,
        maxFailures: this.maxKeepaliveFailures,
        error: sanitizedError
      });

      // If too many failures, log error but continue trying
      if (this.keepaliveFailureCount >= this.maxKeepaliveFailures) {
        logger.error('Multiple keepalive failures detected - session may be dead', {
          sessionId: this.sessionId,
          failures: this.keepaliveFailureCount
        });
        // Note: We continue trying rather than destroying the session
        // The RadioService can detect if streaming actually fails
      }
    }
  }

  /**
   * NEW: Stop keepalive timer
   */
  stopKeepalive() {
    if (this.keepaliveTimer) {
      clearInterval(this.keepaliveTimer);
      this.keepaliveTimer = null;
      logger.debug('Janus session keepalive stopped');
    }
  }

  /**
   * Establish Janus session and join AudioBridge room
   */
  async establishSession() {
    try {
      const config = await this.metadataService.getRadioConfig();
      this.baseUrl = `http://${config.janusIP || '185.80.51.95'}:${config.janusPort || '8088'}/janus`;
      
      logger.info('Establishing Janus session...', { baseUrl: this.baseUrl });

      // Step 1: Create session
      await this.createSession();
      
      // Step 2: Attach to AudioBridge plugin
      await this.attachPlugin();
      
      // Step 3: Join room and get RTP details
      await this.joinRoom(config);
      
      // NEW: Step 4: Start keepalive to prevent session timeout
      this.startKeepalive();
      
      logger.info('Janus session established successfully', {
        sessionId: this.sessionId,
        participantId: this.participantId,
        rtpDetails: this.rtpDetails,
        keepaliveActive: !!this.keepaliveTimer
      });
      
      return this.rtpDetails;
      
    } catch (error) {
      const sanitizedError = this.sanitizeError(error);
      const safeMessage = this.getSafeErrorMessage(error);
      
      logger.error('Failed to establish Janus session:', sanitizedError);
      await this.cleanup();
      
      throw new Error(`Janus connection failed: ${safeMessage}`);
    }
  }

  /**
   * Create Janus session
   */
  async createSession() {
    try {
      const response = await axios.post(this.baseUrl, {
        janus: 'create',
        transaction: this.generateTransactionId()
      }, {
        timeout: 10000,
        headers: {
          'Content-Type': 'application/json'
        }
      });

      if (response.data.janus !== 'success') {
        throw new Error(`Failed to create Janus session: ${response.data.error || 'Unknown error'}`);
      }

      this.sessionId = response.data.data.id;
      logger.debug('Janus session created', { sessionId: this.sessionId });
      
    } catch (error) {
      const sanitizedError = this.sanitizeError(error);
      logger.error('Failed to create Janus session:', sanitizedError);
      throw new Error(`Session creation failed: ${this.getSafeErrorMessage(error)}`);
    }
  }

  /**
   * Attach to AudioBridge plugin
   */
  async attachPlugin() {
    try {
      const response = await axios.post(`${this.baseUrl}/${this.sessionId}`, {
        janus: 'attach',
        plugin: 'janus.plugin.audiobridge',
        transaction: this.generateTransactionId()
      }, {
        timeout: 10000,
        headers: {
          'Content-Type': 'application/json'
        }
      });

      if (response.data.janus !== 'success') {
        throw new Error(`Failed to attach to AudioBridge plugin: ${response.data.error || 'Unknown error'}`);
      }

      this.handleId = response.data.data.id;
      logger.debug('AudioBridge plugin attached', { handleId: this.handleId });
      
    } catch (error) {
      const sanitizedError = this.sanitizeError(error);
      logger.error('Failed to attach AudioBridge plugin:', sanitizedError);
      throw new Error(`Plugin attachment failed: ${this.getSafeErrorMessage(error)}`);
    }
  }

  /**
   * Join AudioBridge room with RTP configuration (handles async responses)
   */
  async joinRoom(config) {
    try {
      const roomId = parseInt(config.janusRoomId || '3183360752998701');
      const ssrc = this.generateSSRC();
      const transactionId = this.generateTransactionId();
      
      const joinRequest = {
        janus: 'message',
        transaction: transactionId,
        body: {
          request: 'join',
          room: roomId,
          display: config.janusParticipantName || 'RadioStation',
          audio: false, // Disable WebRTC audio for RTP mode
          rtp: {
            // For send-only RTP participant, don't specify ip/port initially
            payload_type: 111, // Opus payload type
            ssrc: ssrc
          }
        }
      };

      // Add optional authentication
      if (config.janusRoomSecret && config.janusRoomSecret.trim()) {
        joinRequest.body.secret = config.janusRoomSecret;
      }
      if (config.janusRoomPin && config.janusRoomPin.trim()) {
        joinRequest.body.pin = config.janusRoomPin;
      }

      logger.info('Sending join request to AudioBridge', {
        room: roomId,
        display: joinRequest.body.display,
        ssrc: ssrc,
        hasSecret: !!joinRequest.body.secret,
        hasPin: !!joinRequest.body.pin,
        transaction: transactionId
      });

      // Send join request
      const response = await axios.post(`${this.baseUrl}/${this.sessionId}/${this.handleId}`, joinRequest, {
        timeout: 15000,
        headers: {
          'Content-Type': 'application/json'
        }
      });

      logger.info('Initial join response', {
        janus: response.data.janus,
        transaction: response.data.transaction
      });

      // For asynchronous requests, we first get an "ack", then need to poll for the event
      if (response.data.janus === 'ack') {
        logger.info('Join request acknowledged, waiting for event...');
        
        // Now poll for the actual join event
        const eventResponse = await this.pollForEvent(transactionId, 30000); // 30 second timeout
        
        const pluginData = eventResponse.plugindata?.data;
        
        if (pluginData?.audiobridge === 'joined') {
          this.participantId = pluginData.id;
          
          // For RTP participants, extract connection details
          this.rtpDetails = {
            ip: config.janusIP || '185.80.51.95',
            port: pluginData.rtp?.port || 50000, // Port from Janus
            ssrc: ssrc // Our generated SSRC
          };
          
          logger.info('Successfully joined AudioBridge room', {
            room: roomId,
            participantId: this.participantId,
            rtpDetails: this.rtpDetails,
            participants: pluginData.participants?.length || 0
          });
          
        } else if (pluginData?.error) {
          throw new Error(`AudioBridge error: ${pluginData.error} (${pluginData.error_code || 'unknown code'})`);
        } else {
          logger.error('Unexpected event response', { pluginData });
          throw new Error(`Unexpected event response: ${pluginData?.audiobridge || 'unknown'}`);
        }
        
      } else if (response.data.janus === 'event') {
        // Immediate event response (synchronous)
        const pluginData = response.data.plugindata?.data;
        
        if (pluginData?.audiobridge === 'joined') {
          this.participantId = pluginData.id;
          this.rtpDetails = {
            ip: config.janusIP || '185.80.51.95',
            port: pluginData.rtp?.port || 50000,
            ssrc: ssrc
          };
          
          logger.info('Successfully joined AudioBridge room (immediate)', {
            room: roomId,
            participantId: this.participantId,
            rtpDetails: this.rtpDetails
          });
        } else if (pluginData?.error) {
          throw new Error(`AudioBridge error: ${pluginData.error}`);
        }
        
      } else if (response.data.janus === 'error') {
        const janusError = response.data.error?.reason || response.data.error || 'Unknown Janus error';
        throw new Error(`Janus error: ${janusError}`);
        
      } else {
        logger.error('Unexpected response type', { 
          janus: response.data.janus,
          data: response.data 
        });
        throw new Error(`Unexpected response type: ${response.data.janus}`);
      }
      
    } catch (error) {
      const sanitizedError = this.sanitizeError(error);
      logger.error('Failed to join AudioBridge room:', sanitizedError);
      
      if (error.response?.status === 404) {
        throw new Error(`Room ${config.janusRoomId} not found on Janus server`);
      } else if (error.response?.status === 403) {
        throw new Error(`Access denied to room ${config.janusRoomId} - check credentials`);
      } else if (error.message?.includes('AudioBridge error')) {
        throw new Error(error.message);
      } else {
        throw new Error(`Room join failed: ${this.getSafeErrorMessage(error)}`);
      }
    }
  }

  /**
   * Poll for asynchronous event response from Janus
   */
  async pollForEvent(transactionId, timeoutMs = 30000) {
    const startTime = Date.now();
    const pollInterval = 500; // Poll every 500ms
    
    while (Date.now() - startTime < timeoutMs) {
      try {
        const eventResponse = await axios.get(`${this.baseUrl}/${this.sessionId}`, {
          timeout: 5000,
          headers: {
            'Content-Type': 'application/json'
          }
        });
        
        logger.debug('Polling response', {
          janus: eventResponse.data.janus,
          transaction: eventResponse.data.transaction
        });
        
        // Check if this is the event we're waiting for
        if (eventResponse.data.janus === 'event' && 
            eventResponse.data.transaction === transactionId) {
          
          logger.info('Received awaited event', {
            audiobridge: eventResponse.data.plugindata?.data?.audiobridge,
            transaction: transactionId
          });
          
          return eventResponse.data;
        }
        
        // Wait before next poll
        await new Promise(resolve => setTimeout(resolve, pollInterval));
        
      } catch (error) {
        if (error.response?.status === 204) {
          // No events available, continue polling
          await new Promise(resolve => setTimeout(resolve, pollInterval));
          continue;
        }
        
        logger.warn('Error while polling for event:', this.sanitizeError(error));
        await new Promise(resolve => setTimeout(resolve, pollInterval));
      }
    }
    
    throw new Error(`Timeout waiting for join event (${timeoutMs}ms)`);
  }

  /**
   * Get current RTP streaming details
   */
  getRtpDetails() {
    return this.rtpDetails;
  }

  /**
   * Get session status for debugging
   */
  getStatus() {
    return {
      sessionId: this.sessionId,
      handleId: this.handleId,
      participantId: this.participantId,
      rtpDetails: this.rtpDetails,
      connected: !!(this.sessionId && this.handleId && this.participantId),
      keepaliveActive: !!this.keepaliveTimer,
      keepaliveFailures: this.keepaliveFailureCount
    };
  }

  /**
   * Cleanup session on radio stop
   */
  async cleanup() {
    try {
      // NEW: Stop keepalive first
      this.stopKeepalive();
      
      if (this.sessionId && this.handleId) {
        logger.info('Cleaning up Janus session...');
        
        // Leave room
        if (this.participantId) {
          try {
            await axios.post(`${this.baseUrl}/${this.sessionId}/${this.handleId}`, {
              janus: 'message',
              transaction: this.generateTransactionId(),
              body: { request: 'leave' }
            }, { timeout: 5000 });
          } catch (error) {
            const sanitizedError = this.sanitizeError(error);
            logger.warn('Failed to leave room during cleanup:', sanitizedError);
          }
        }

        // Destroy session
        try {
          await axios.post(`${this.baseUrl}/${this.sessionId}`, {
            janus: 'destroy',
            transaction: this.generateTransactionId()
          }, { timeout: 5000 });
        } catch (error) {
          const sanitizedError = this.sanitizeError(error);
          logger.warn('Failed to destroy session during cleanup:', sanitizedError);
        }
      }
    } catch (error) {
      const sanitizedError = this.sanitizeError(error);
      logger.error('Error during Janus cleanup:', sanitizedError);
    } finally {
      this.sessionId = null;
      this.handleId = null;
      this.participantId = null;
      this.rtpDetails = null;
      this.keepaliveFailureCount = 0;
      logger.info('Janus session cleaned up');
    }
  }

  /**
   * Generate unique transaction ID
   */
  generateTransactionId() {
    return `transaction_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Generate unique SSRC for RTP stream
   */
  generateSSRC() {
    return Math.floor(Math.random() * 0xFFFFFFFF);
  }
}

module.exports = JanusService;