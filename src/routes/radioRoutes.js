// src/routes/radioRoutes.js - FIXED: Radio Control API with Janus Config Support
const express = require('express');
const Joi = require('joi');
const logger = require('../utils/logger');

const router = express.Router();

// Validation schemas
const playlistUpdateSchema = Joi.object({
  playlist: Joi.array().items(Joi.object({
    id: Joi.string().required(),
    originalName: Joi.string().required()
  })).required()
});

const configUpdateSchema = Joi.object({
  janusIP: Joi.string().ip().optional(),
  janusPort: Joi.string().pattern(/^\d+$/).optional(),
  janusRoomId: Joi.string().pattern(/^\d+$/).optional(),
  janusParticipantName: Joi.string().min(1).max(50).optional(),
  janusRoomSecret: Joi.string().allow('').optional(),
  janusRoomPin: Joi.string().allow('').optional(),
  maxConsecutiveSkips: Joi.number().min(1).max(20).optional(),
  autoRestart: Joi.boolean().optional()
});

// FIXED: Start request with optional config
const startRequestSchema = Joi.object({
  config: configUpdateSchema.optional()
});

// GET /api/radio/status - Get current radio status
router.get('/status', async (req, res) => {
  try {
    const { radioService } = req.services;
    
    if (!radioService) {
      return res.status(503).json({
        success: false,
        message: 'Radio service not available'
      });
    }

    const status = await radioService.getStatus();
    
    if (status.error) {
      return res.status(500).json({
        success: false,
        message: 'Failed to get radio status',
        error: status.error
      });
    }

    res.json({
      success: true,
      status
    });

  } catch (error) {
    logger.error('Failed to get radio status:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
      error: error.message
    });
  }
});

// FIXED: POST /api/radio/start - Start radio streaming with optional config
router.post('/start', async (req, res) => {
  try {
    const { radioService, metadataService } = req.services;
    
    if (!radioService) {
      return res.status(503).json({
        success: false,
        message: 'Radio service not available'
      });
    }

    // Validate request body if present
    const { error, value } = startRequestSchema.validate(req.body);
    if (error) {
      return res.status(400).json({
        success: false,
        message: 'Invalid request data',
        error: error.details[0].message
      });
    }

    // Update config if provided
    if (value.config) {
      logger.info('Updating Janus config before starting radio', value.config);
      await metadataService.updateRadioConfig(value.config);
    }

    logger.info('Radio start requested via API');
    const result = await radioService.start();
    
    if (result.success) {
      res.json(result);
    } else {
      res.status(400).json(result);
    }

  } catch (error) {
    logger.error('Failed to start radio:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to start radio',
      error: error.message
    });
  }
});

// POST /api/radio/stop - Stop radio streaming
router.post('/stop', async (req, res) => {
  try {
    const { radioService } = req.services;
    
    if (!radioService) {
      return res.status(503).json({
        success: false,
        message: 'Radio service not available'
      });
    }

    logger.info('Radio stop requested via API');
    const result = await radioService.stop();
    
    if (result.success) {
      res.json(result);
    } else {
      res.status(400).json(result);
    }

  } catch (error) {
    logger.error('Failed to stop radio:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to stop radio',
      error: error.message
    });
  }
});

// POST /api/radio/skip - Skip current track
router.post('/skip', async (req, res) => {
  try {
    const { radioService } = req.services;
    
    if (!radioService) {
      return res.status(503).json({
        success: false,
        message: 'Radio service not available'
      });
    }

    logger.info('Radio skip requested via API');
    const result = await radioService.skip();
    
    if (result.success) {
      res.json(result);
    } else {
      res.status(400).json(result);
    }

  } catch (error) {
    logger.error('Failed to skip track:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to skip track',
      error: error.message
    });
  }
});

// POST /api/radio/playlist/refresh - Refresh playlist from database
router.post('/playlist/refresh', async (req, res) => {
  try {
    const { radioService } = req.services;
    
    if (!radioService) {
      return res.status(503).json({
        success: false,
        message: 'Radio service not available'
      });
    }

    const { shuffle = true } = req.body;
    
    logger.info('Playlist refresh requested via API', { shuffle });
    const result = await radioService.refreshPlaylist(shuffle);
    
    if (result.success) {
      res.json({
        success: true,
        message: 'Playlist refreshed successfully',
        playlist: result.playlist,
        count: result.playlist.length
      });
    } else {
      res.status(400).json(result);
    }

  } catch (error) {
    logger.error('Failed to refresh playlist:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to refresh playlist',
      error: error.message
    });
  }
});

// POST /api/radio/playlist/update - Update playlist order
router.post('/playlist/update', async (req, res) => {
  try {
    const { radioService } = req.services;
    
    if (!radioService) {
      return res.status(503).json({
        success: false,
        message: 'Radio service not available'
      });
    }

    // Validate request body
    const { error, value } = playlistUpdateSchema.validate(req.body);
    if (error) {
      return res.status(400).json({
        success: false,
        message: 'Invalid playlist data',
        error: error.details[0].message
      });
    }

    logger.info('Playlist update requested via API', { 
      trackCount: value.playlist.length 
    });

    const result = await radioService.updatePlaylist(value.playlist);
    
    if (result.success) {
      res.json({
        success: true,
        message: 'Playlist updated successfully',
        playlist: result.playlist,
        count: result.playlist.length
      });
    } else {
      res.status(400).json(result);
    }

  } catch (error) {
    logger.error('Failed to update playlist:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update playlist',
      error: error.message
    });
  }
});

// GET /api/radio/playlist - Get current playlist
router.get('/playlist', async (req, res) => {
  try {
    const { radioService } = req.services;
    
    if (!radioService) {
      return res.status(503).json({
        success: false,
        message: 'Radio service not available'
      });
    }

    const status = await radioService.getStatus();
    
    if (status.error) {
      return res.status(500).json({
        success: false,
        message: 'Failed to get playlist',
        error: status.error
      });
    }

    res.json({
      success: true,
      playlist: radioService.playlist || [],
      currentIndex: status.currentIndex,
      currentTrack: status.currentTrack,
      total: status.playlistSize
    });

  } catch (error) {
    logger.error('Failed to get playlist:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get playlist',
      error: error.message
    });
  }
});

// GET /api/radio/config - Get radio configuration
router.get('/config', async (req, res) => {
  try {
    const { metadataService } = req.services;
    
    if (!metadataService) {
      return res.status(503).json({
        success: false,
        message: 'Metadata service not available'
      });
    }

    const config = await metadataService.getRadioConfig();
    
    res.json({
      success: true,
      config: {
        janusIP: config?.janusIP || '',
        janusPort: config?.janusPort || '8088',
        janusRoomId: config?.janusRoomId || '',
        janusParticipantName: config?.janusParticipantName || 'RadioStation',
        janusRoomSecret: config?.janusRoomSecret || '',
        janusRoomPin: config?.janusRoomPin || '',
        maxConsecutiveSkips: config?.maxConsecutiveSkips || 5,
        autoRestart: config?.autoRestart || false
      }
    });

  } catch (error) {
    logger.error('Failed to get radio config:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get radio configuration',
      error: error.message
    });
  }
});

// POST /api/radio/config - Update radio configuration
router.post('/config', async (req, res) => {
  try {
    const { metadataService } = req.services;
    
    if (!metadataService) {
      return res.status(503).json({
        success: false,
        message: 'Metadata service not available'
      });
    }

    // Validate request body
    const { error, value } = configUpdateSchema.validate(req.body);
    if (error) {
      return res.status(400).json({
        success: false,
        message: 'Invalid configuration data',
        error: error.details[0].message
      });
    }

    logger.info('Radio config update requested via API', value);
    const updatedConfig = await metadataService.updateRadioConfig(value);
    
    res.json({
      success: true,
      message: 'Radio configuration updated successfully',
      config: updatedConfig
    });

  } catch (error) {
    logger.error('Failed to update radio config:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update radio configuration',
      error: error.message
    });
  }
});

// GET /api/radio/health - Radio service health check
router.get('/health', async (req, res) => {
  try {
    const { radioService } = req.services;
    
    if (!radioService) {
      return res.status(503).json({
        success: false,
        message: 'Radio service not available',
        healthy: false
      });
    }

    const status = await radioService.getStatus();
    
    const health = {
      healthy: !status.error,
      service: 'RadioService',
      status: status.isRunning ? 'running' : 'stopped',
      uptime: status.uptime || 0,
      playlist: {
        size: status.playlistSize || 0,
        currentIndex: status.currentIndex || 0
      },
      process: {
        pid: status.processId,
        skipCount: status.skipCount || 0
      },
      target: status.target,
      timestamp: new Date().toISOString()
    };

    if (status.error) {
      health.error = status.error;
    }

    res.json({
      success: true,
      health
    });

  } catch (error) {
    logger.error('Radio health check failed:', error);
    res.status(500).json({
      success: false,
      message: 'Radio health check failed',
      healthy: false,
      error: error.message
    });
  }
});

// FIXED: POST /api/radio/test - Test Janus connectivity
router.post('/test', async (req, res) => {
  try {
    const { janusIP, janusPort } = req.body;
    
    if (!janusIP || !janusPort) {
      return res.status(400).json({
        success: false,
        message: 'janusIP and janusPort are required for testing'
      });
    }

    logger.info('Janus connectivity test requested', { janusIP, janusPort });

    // Test Janus HTTP API connectivity
    try {
      const axios = require('axios');
      const testUrl = `http://${janusIP}:${janusPort}/janus/info`;
      
      const startTime = Date.now();
      const response = await axios.get(testUrl, { timeout: 10000 });
      const endTime = Date.now();
      
      const testResult = {
        janusIP,
        janusPort,
        timestamp: new Date().toISOString(),
        reachable: true,
        latency: endTime - startTime,
        janusVersion: response.data?.version_string || 'Unknown',
        janusName: response.data?.name || 'Unknown'
      };

      res.json({
        success: true,
        message: 'Janus connectivity test successful',
        result: testResult
      });

    } catch (testError) {
      const testResult = {
        janusIP,
        janusPort,
        timestamp: new Date().toISOString(),
        reachable: false,
        error: testError.message || 'Connection failed'
      };

      res.json({
        success: false,
        message: 'Janus connectivity test failed',
        result: testResult
      });
    }

  } catch (error) {
    logger.error('Janus test failed:', error);
    res.status(500).json({
      success: false,
      message: 'Janus connectivity test failed',
      error: error.message
    });
  }
});

module.exports = router;