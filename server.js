// server.js - FIXED for HTTP serving without HTTPS issues
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const compression = require('compression');
const path = require('path');
const fs = require('fs-extra');
const { createServer } = require('http');
const { Server } = require('socket.io');

// Import services and routes
const logger = require('./src/utils/logger');
const MetadataService = require('./src/services/MetadataService');
const FFmpegService = require('./src/services/FFmpegService');
const RadioService = require('./src/services/RadioService');
const FileImportService = require('./src/services/FileImportService'); // NEW

// Import routes
const fileRoutes = require('./src/routes/fileRoutes');
const systemRoutes = require('./src/routes/systemRoutes');
const radioRoutes = require('./src/routes/radioRoutes');

const app = express();
const server = createServer(app);
const io = new Server(server, {
  cors: {
    origin: true,
    methods: ["GET", "POST"]
  },
  pingTimeout: 60000,
  pingInterval: 25000
});

const PORT = process.env.PORT || 3000;

// Initialize services
let metadataService;
let ffmpegService;
let radioService;
let fileImportService; // NEW
let isShuttingDown = false;

async function initializeServices() {
  try {
    logger.info('Starting service initialization...');
    
    // Ensure required directories exist
    await fs.ensureDir(process.env.INCOMING_DIR || './data/incoming');
    await fs.ensureDir(process.env.REENCODED_DIR || './data/reencoded');
    await fs.ensureDir(process.env.METADATA_DIR || './data/metadata');
    await fs.ensureDir(process.env.LOGS_DIR || './data/logs');

    // Initialize metadata service first
    metadataService = new MetadataService();
    await metadataService.initialize();

    // Initialize FFmpeg service with job recovery
    ffmpegService = new FFmpegService(metadataService, io);
    
    // Initialize Radio service
    radioService = new RadioService(metadataService, io);
    await radioService.initialize();
    
    // NEW: Initialize File Import service
    fileImportService = new FileImportService(metadataService, ffmpegService, io);
    await fileImportService.initialize();
    
    // Set cross-references between services
    ffmpegService.setFileImportService(fileImportService);
    
    // Clear any stale radio state from previous session
    await metadataService.clearRadioState();
    
    logger.info('All services initialized successfully');
    return { metadataService, ffmpegService, radioService, fileImportService };
  } catch (error) {
    logger.error('Failed to initialize services:', error);
    process.exit(1);
  }
}

// Enhanced graceful shutdown handler
async function gracefulShutdown(signal) {
  if (isShuttingDown) {
    logger.warn('Shutdown already in progress, forcing exit');
    process.exit(1);
  }
  
  isShuttingDown = true;
  logger.info(`${signal} received, starting graceful shutdown...`);
  
  try {
    server.close(() => {
      logger.info('HTTP server closed');
    });
    
    // Notify all clients about server shutdown
    io.emit('server_restart', {
      message: 'Server is restarting, please reconnect shortly',
      timestamp: new Date().toISOString()
    });
    
    // Give clients time to receive the message
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    // Cleanup RadioService first (stops FFmpeg processes)
    if (radioService) {
      logger.info('Cleaning up RadioService...');
      await radioService.cleanup();
    }
    
    // Cleanup FFmpeg processes and active jobs
    if (ffmpegService) {
      logger.info('Cleaning up FFmpegService...');
      await ffmpegService.cleanup();
    }
    
    // NEW: Cleanup FileImportService
    if (fileImportService) {
      logger.info('Cleaning up FileImportService...');
      await fileImportService.cleanup();
    }
    
    // Close Socket.IO connections
    io.close(() => {
      logger.info('Socket.IO server closed');
    });
    
    // Final cleanup wait
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    logger.info('Graceful shutdown completed');
    process.exit(0);
    
  } catch (error) {
    logger.error('Error during graceful shutdown:', error);
    process.exit(1);
  }
}

// Basic middleware (NO HELMET - causes HTTPS issues)
app.use(compression());
app.use(cors({
  origin: true,
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With']
}));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Request logging middleware
app.use((req, res, next) => {
  if (!req.path.includes('api/health')) {
    logger.debug(`${req.method} ${req.path}`);
  }
  next();
});

// Make services available to routes
app.use((req, res, next) => {
  req.services = { metadataService, ffmpegService, radioService, fileImportService, io };
  next();
});

// Serve static files FIRST
const publicPath = path.join(__dirname, 'public');
app.use(express.static(publicPath, {
  index: false,
  maxAge: 0,
  setHeaders: (res, path) => {
    // Ensure proper MIME types and no HTTPS forcing
    if (path.endsWith('.js')) {
      res.set('Content-Type', 'application/javascript');
    } else if (path.endsWith('.css')) {
      res.set('Content-Type', 'text/css');
    }
    // No security headers that force HTTPS
    res.removeHeader('Cross-Origin-Opener-Policy');
    res.removeHeader('Origin-Agent-Cluster');
  }
}));

// API Routes
app.use('/api/files', fileRoutes);
app.use('/api/system', systemRoutes);
app.use('/api/radio', radioRoutes);

// Enhanced health check endpoint
app.get('/api/health', async (req, res) => {
  try {
    let encodingHealth = null;
    if (ffmpegService) {
      encodingHealth = await ffmpegService.healthCheck();
    }
    
    // Radio health check
    let radioHealth = null;
    if (radioService) {
      const radioStatus = await radioService.getStatus();
      radioHealth = {
        service: 'RadioService',
        status: radioStatus.error ? 'unhealthy' : 'healthy',
        isRunning: radioStatus.isRunning,
        playlistSize: radioStatus.playlistSize,
        target: radioStatus.target,
        error: radioStatus.error || null
      };
    }
    
    // NEW: File import health check
    let importHealth = null;
    if (fileImportService) {
      const importStatus = fileImportService.getStatus();
      importHealth = {
        service: 'FileImportService',
        status: 'healthy',
        monitoring: importStatus.monitoring,
        autoImportEnabled: importStatus.autoImportEnabled,
        autoEncodingEnabled: importStatus.autoEncodingEnabled
      };
    }
    
    // Check frontend availability
    const indexPath = path.join(publicPath, 'index.html');
    const frontendHealth = {
      available: fs.existsSync(indexPath),
      path: indexPath,
      publicDir: fs.existsSync(publicPath) ? fs.readdirSync(publicPath).length : 0
    };
    
    const health = {
      status: 'healthy',
      timestamp: new Date().toISOString(),
      version: process.env.npm_package_version || '1.0.0',
      uptime: process.uptime(),
      memory: process.memoryUsage(),
      encoding: encodingHealth,
      radio: radioHealth,
      import: importHealth, // NEW
      frontend: frontendHealth,
      environment: process.env.NODE_ENV || 'development'
    };
    
    res.json(health);
  } catch (error) {
    logger.error('Health check failed:', error);
    res.status(503).json({
      status: 'unhealthy',
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

// API 404 handler
app.use('/api/*', (req, res) => {
  res.status(404).json({
    success: false,
    message: `API endpoint not found: ${req.method} ${req.originalUrl}`
  });
});

// SPA Routes - serve index.html for all non-API routes
app.get('*', (req, res) => {
  const indexPath = path.join(publicPath, 'index.html');
  
  if (fs.existsSync(indexPath)) {
    // Set headers to prevent HTTPS issues
    res.removeHeader('Cross-Origin-Opener-Policy');
    res.removeHeader('Origin-Agent-Cluster');
    res.set('Content-Type', 'text/html');
    res.sendFile(indexPath);
  } else {
    res.status(404).send(`
      <!DOCTYPE html>
      <html>
      <head><title>Frontend Not Available</title></head>
      <body>
        <h1>Frontend Not Available</h1>
        <p>The Angular frontend is not built or not found.</p>
        <p><a href="/api/health">API Health Check</a></p>
      </body>
      </html>
    `);
  }
});

// Enhanced Socket.IO connection handling
io.on('connection', (socket) => {
  logger.info(`Client connected: ${socket.id}`);
  
  socket.on('disconnect', (reason) => {
    logger.info(`Client disconnected: ${socket.id}, reason: ${reason}`);
  });
  
  // Join room for file updates
  socket.on('subscribe-file-updates', () => {
    socket.join('file-updates');
    logger.debug(`Client ${socket.id} subscribed to file updates`);
  });
  
  // Join room for radio updates
  socket.on('subscribe-radio-updates', () => {
    socket.join('radio-updates');
    logger.debug(`Client ${socket.id} subscribed to radio updates`);
  });
  
  // Handle ping/pong for connection health
  socket.on('ping', (data) => {
    socket.emit('pong', {
      ...data,
      serverTime: Date.now()
    });
  });
  
  // Handle client reconnection
  socket.on('client_reconnected', (data) => {
    logger.info(`Client ${socket.id} reconnected after ${data.reconnectAttempts} attempts`);
    
    // Send current encoding status
    if (ffmpegService) {
      ffmpegService.getActiveJobs().then(jobs => {
        socket.emit('encoding_status_update', {
          activeJobs: jobs,
          timestamp: new Date().toISOString()
        });
      }).catch(error => {
        logger.error('Failed to send encoding status on reconnect:', error);
      });
    }
    
    // Send current radio status
    if (radioService) {
      radioService.getStatus().then(status => {
        socket.emit('radio_status_update', {
          status: status,
          timestamp: new Date().toISOString()
        });
      }).catch(error => {
        logger.error('Failed to send radio status on reconnect:', error);
      });
    }
  });
  
  // Handle status requests
  socket.on('request_encoding_status', async () => {
    try {
      if (ffmpegService) {
        const jobs = await ffmpegService.getActiveJobs();
        socket.emit('encoding_status_update', {
          activeJobs: jobs,
          timestamp: new Date().toISOString()
        });
      }
    } catch (error) {
      logger.error('Failed to provide encoding status:', error);
    }
  });
  
  // Handle radio status requests
  socket.on('request_radio_status', async () => {
    try {
      if (radioService) {
        const status = await radioService.getStatus();
        socket.emit('radio_status_update', {
          status: status,
          timestamp: new Date().toISOString()
        });
      }
    } catch (error) {
      logger.error('Failed to provide radio status:', error);
    }
  });
  
  socket.on('request_file_list_refresh', () => {
    socket.emit('file_list_refresh_requested', {
      timestamp: new Date().toISOString()
    });
  });
  
  // Radio control via Socket.IO
  socket.on('radio_start', async () => {
    try {
      if (radioService) {
        const result = await radioService.start();
        socket.emit('radio_command_result', {
          command: 'start',
          result: result,
          timestamp: new Date().toISOString()
        });
      }
    } catch (error) {
      logger.error('Failed to start radio via socket:', error);
      socket.emit('radio_command_error', {
        command: 'start',
        error: error.message,
        timestamp: new Date().toISOString()
      });
    }
  });
  
  socket.on('radio_stop', async () => {
    try {
      if (radioService) {
        const result = await radioService.stop();
        socket.emit('radio_command_result', {
          command: 'stop',
          result: result,
          timestamp: new Date().toISOString()
        });
      }
    } catch (error) {
      logger.error('Failed to stop radio via socket:', error);
      socket.emit('radio_command_error', {
        command: 'stop',
        error: error.message,
        timestamp: new Date().toISOString()
      });
    }
  });
  
  socket.on('radio_skip', async () => {
    try {
      if (radioService) {
        const result = await radioService.skip();
        socket.emit('radio_command_result', {
          command: 'skip',
          result: result,
          timestamp: new Date().toISOString()
        });
      }
    } catch (error) {
      logger.error('Failed to skip track via socket:', error);
      socket.emit('radio_command_error', {
        command: 'skip',
        error: error.message,
        timestamp: new Date().toISOString()
      });
    }
  });
});

// Signal handlers for graceful shutdown
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

// Handle uncaught exceptions
process.on('uncaughtException', (error) => {
  logger.error('Uncaught Exception:', error);
  gracefulShutdown('UNCAUGHT_EXCEPTION');
});

process.on('unhandledRejection', (reason, promise) => {
  logger.error('Unhandled Rejection at:', promise, 'reason:', reason);
  gracefulShutdown('UNHANDLED_REJECTION');
});

// Start server
initializeServices().then(() => {
  server.listen(PORT, () => {
    logger.info(`Radio Station Backend running on port ${PORT}`);
    logger.info(`Environment: ${process.env.NODE_ENV || 'development'}`);
    logger.info(`Frontend URL: ${process.env.FRONTEND_URL || 'http://localhost:3200'}`);
    logger.info(`Static files served from: ${publicPath}`);
    logger.info(`Process ID: ${process.pid}`);
    
    // Check if frontend files exist
    const indexPath = path.join(publicPath, 'index.html');
    if (fs.existsSync(indexPath)) {
      logger.info('Frontend files found - SPA serving enabled');
    } else {
      logger.warn('Frontend files not found - only API endpoints available');
    }
    
    // Log service status
    if (ffmpegService) {
      ffmpegService.healthCheck().then(health => {
        logger.info('FFmpeg service status:', health);
      });
    }
    
    // Log radio service status
    if (radioService) {
      radioService.getStatus().then(status => {
        logger.info('Radio service status:', {
          target: status.target,
          playlistSize: status.playlistSize
        });
      });
    }
    
    // NEW: Log file import service status
    if (fileImportService) {
      const importStatus = fileImportService.getStatus();
      logger.info('File import service status:', importStatus);
    }
  });
}).catch(error => {
  logger.error('Failed to start server:', error);
  process.exit(1);
});