// src/routes/fileRoutes.js - File management endpoints
const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs-extra');
const { v4: uuidv4 } = require('uuid');
const Joi = require('joi');
const logger = require('../utils/logger');

const router = express.Router();

// File validation schema
const fileValidationSchema = Joi.object({
  mimetype: Joi.string().valid('audio/mpeg', 'audio/mp4', 'audio/mp3', 'video/mp4').required(),
  size: Joi.number().max(500 * 1024 * 1024).required() // 500MB max
});

// Configure multer for file uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadDir = process.env.INCOMING_DIR || './data/incoming';
    fs.ensureDirSync(uploadDir);
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const fileId = uuidv4();
    const ext = path.extname(file.originalname);
    const safeName = path.basename(file.originalname, ext).replace(/[^a-zA-Z0-9_-]/g, '_');
    cb(null, `${safeName}_${fileId}${ext}`);
  }
});

const upload = multer({
  storage,
  limits: {
    fileSize: 500 * 1024 * 1024, // 500MB
    files: 10 // Max 10 files at once
  },
  fileFilter: (req, file, cb) => {
    // Validate file type
    const validation = fileValidationSchema.validate({
      mimetype: file.mimetype,
      size: file.size || 0
    });
    
    if (validation.error) {
      return cb(new Error(`Invalid file: ${validation.error.message}`), false);
    }
    
    // Additional extension check
    const allowedExtensions = ['.mp3', '.mp4', '.m4a'];
    const fileExt = path.extname(file.originalname).toLowerCase();
    
    if (!allowedExtensions.includes(fileExt)) {
      return cb(new Error(`Unsupported file extension: ${fileExt}`), false);
    }
    
    cb(null, true);
  }
});

// POST /api/files/upload - Upload multiple files
router.post('/upload', upload.array('files', 10), async (req, res) => {
  try {
    if (!req.files || req.files.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'No files provided'
      });
    }

    const { metadataService } = req.services;
    const uploadedFiles = [];

    // Process each uploaded file
    for (const file of req.files) {
      try {
        const fileRecord = await metadataService.addFile({
          id: uuidv4(),
          originalName: file.originalname,
          fileName: file.filename,
          originalPath: file.path,
          size: file.size,
          mimeType: file.mimetype
        });

        uploadedFiles.push({
          id: fileRecord.id,
          originalName: fileRecord.originalName,
          size: fileRecord.size,
          status: fileRecord.status
        });

        logger.info('File uploaded successfully', {
          fileId: fileRecord.id,
          originalName: file.originalname,
          size: file.size
        });

      } catch (error) {
        logger.error('Failed to process uploaded file', {
          filename: file.originalname,
          error: error.message
        });
        
        // Clean up file if metadata creation failed
        try {
          await fs.remove(file.path);
        } catch (cleanupError) {
          logger.warn('Failed to cleanup file after error', cleanupError);
        }
      }
    }

    // Emit upload completion to frontend
    req.services.io.to('file-updates').emit('files-uploaded', {
      files: uploadedFiles
    });

    res.json({
      success: true,
      message: `${uploadedFiles.length} files uploaded successfully`,
      files: uploadedFiles
    });

  } catch (error) {
    logger.error('File upload error:', error);
    res.status(500).json({
      success: false,
      message: 'Upload failed',
      error: error.message
    });
  }
});

// GET /api/files - List all files with optional filtering
router.get('/', async (req, res) => {
  try {
    const { metadataService } = req.services;
    const { status, search, limit = 50, offset = 0 } = req.query;
    
    const filters = {};
    if (status) filters.status = status;
    if (search) filters.search = search;
    
    const files = await metadataService.getFiles(filters);
    
    // Apply pagination
    const startIndex = parseInt(offset);
    const endIndex = startIndex + parseInt(limit);
    const paginatedFiles = files.slice(startIndex, endIndex);
    
    res.json({
      success: true,
      files: paginatedFiles,
      pagination: {
        total: files.length,
        limit: parseInt(limit),
        offset: parseInt(offset),
        hasMore: endIndex < files.length
      }
    });

  } catch (error) {
    logger.error('Failed to fetch files:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch files',
      error: error.message
    });
  }
});

// GET /api/files/:id - Get specific file details
router.get('/:id', async (req, res) => {
  try {
    const { metadataService } = req.services;
    const file = await metadataService.getFile(req.params.id);
    
    if (!file) {
      return res.status(404).json({
        success: false,
        message: 'File not found'
      });
    }
    
    res.json({
      success: true,
      file
    });

  } catch (error) {
    logger.error('Failed to fetch file details:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch file details',
      error: error.message
    });
  }
});

// POST /api/files/:id/encode - Manually trigger encoding
router.post('/:id/encode', async (req, res) => {
  try {
    const { ffmpegService } = req.services;
    const fileId = req.params.id;
    
    // Start encoding (async process)
    ffmpegService.encodeFile(fileId).catch(error => {
      logger.error('Encoding failed in background:', error);
    });
    
    res.json({
      success: true,
      message: 'Encoding started',
      fileId
    });

  } catch (error) {
    logger.error('Failed to start encoding:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to start encoding',
      error: error.message
    });
  }
});

// POST /api/files/:id/retry - Retry failed encoding
router.post('/:id/retry', async (req, res) => {
  try {
    const { ffmpegService } = req.services;
    const fileId = req.params.id;
    
    // Start retry encoding (async process)
    ffmpegService.retryEncoding(fileId).catch(error => {
      logger.error('Retry encoding failed in background:', error);
    });
    
    res.json({
      success: true,
      message: 'Encoding retry started',
      fileId
    });

  } catch (error) {
    logger.error('Failed to retry encoding:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to retry encoding',
      error: error.message
    });
  }
});

// POST /api/files/:id/cancel - Cancel active encoding
router.post('/:id/cancel', async (req, res) => {
  try {
    const { ffmpegService } = req.services;
    const fileId = req.params.id;
    
    const cancelled = await ffmpegService.cancelEncoding(fileId);
    
    if (cancelled) {
      res.json({
        success: true,
        message: 'Encoding cancelled',
        fileId
      });
    } else {
      res.status(404).json({
        success: false,
        message: 'No active encoding found for this file'
      });
    }

  } catch (error) {
    logger.error('Failed to cancel encoding:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to cancel encoding',
      error: error.message
    });
  }
});

// DELETE /api/files/:id - Delete file
router.delete('/:id', async (req, res) => {
  try {
    const { metadataService, ffmpegService } = req.services;
    const fileId = req.params.id;
    
    // Cancel any active encoding first
    await ffmpegService.cancelEncoding(fileId);
    
    // Delete file and metadata
    const deleted = await metadataService.deleteFile(fileId);
    
    if (deleted) {
      // Emit deletion to frontend
      req.services.io.to('file-updates').emit('file-deleted', { fileId });
      
      res.json({
        success: true,
        message: 'File deleted successfully'
      });
    } else {
      res.status(404).json({
        success: false,
        message: 'File not found'
      });
    }

  } catch (error) {
    logger.error('Failed to delete file:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to delete file',
      error: error.message
    });
  }
});

// GET /api/files/:id/download - Download encoded file
router.get('/:id/download', async (req, res) => {
  try {
    const { metadataService } = req.services;
    const file = await metadataService.getFile(req.params.id);
    
    if (!file) {
      return res.status(404).json({
        success: false,
        message: 'File not found'
      });
    }
    
    if (file.status !== 'completed' || !file.encodedPath) {
      return res.status(400).json({
        success: false,
        message: 'File is not yet encoded'
      });
    }
    
    if (!await fs.pathExists(file.encodedPath)) {
      return res.status(404).json({
        success: false,
        message: 'Encoded file not found on disk'
      });
    }
    
    const filename = `${path.basename(file.originalName, path.extname(file.originalName))}.opus`;
    res.download(file.encodedPath, filename);

  } catch (error) {
    logger.error('Failed to download file:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to download file',
      error: error.message
    });
  }
});

// GET /api/files/:id/logs - Get file processing logs
router.get('/:id/logs', async (req, res) => {
  try {
    const { metadataService } = req.services;
    const file = await metadataService.getFile(req.params.id);
    
    if (!file) {
      return res.status(404).json({
        success: false,
        message: 'File not found'
      });
    }
    
    res.json({
      success: true,
      logs: file.logs || []
    });

  } catch (error) {
    logger.error('Failed to fetch file logs:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch file logs',
      error: error.message
    });
  }
});

// NEW: POST /api/files/import - Manually import files from directory
router.post('/import', async (req, res) => {
  try {
    const { fileImportService } = req.services;
    
    if (!fileImportService) {
      return res.status(503).json({
        success: false,
        message: 'File import service not available'
      });
    }

    logger.info('Manual file import requested');
    const results = await fileImportService.scanAndImport();
    
    res.json({
      success: true,
      message: `Import completed: ${results.imported} files imported, ${results.skipped} skipped, ${results.errors} errors`,
      results
    });

  } catch (error) {
    logger.error('Manual file import failed:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to import files',
      error: error.message
    });
  }
});

// NEW: GET /api/files/import/config - Get import configuration
router.get('/import/config', async (req, res) => {
  try {
    const { fileImportService } = req.services;
    
    if (!fileImportService) {
      return res.status(503).json({
        success: false,
        message: 'File import service not available'
      });
    }

    const config = await fileImportService.getConfig();
    
    res.json({
      success: true,
      config
    });

  } catch (error) {
    logger.error('Failed to get import configuration:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get import configuration',
      error: error.message
    });
  }
});

// NEW: POST /api/files/import/config - Update import configuration
router.post('/import/config', async (req, res) => {
  try {
    const { fileImportService } = req.services;
    
    if (!fileImportService) {
      return res.status(503).json({
        success: false,
        message: 'File import service not available'
      });
    }

    const config = await fileImportService.updateConfig(req.body);
    
    res.json({
      success: true,
      message: 'Import configuration updated successfully',
      config
    });

  } catch (error) {
    logger.error('Failed to update import configuration:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update import configuration',
      error: error.message
    });
  }
});

// NEW: POST /api/files/batch-encode - Trigger batch encoding
router.post('/batch-encode', async (req, res) => {
  try {
    const { fileImportService } = req.services;
    
    if (!fileImportService) {
      return res.status(503).json({
        success: false,
        message: 'File import service not available'
      });
    }

    logger.info('Batch encoding requested');
    const results = await fileImportService.triggerBatchEncoding();
    
    res.json({
      success: true,
      message: results.message,
      results
    });

  } catch (error) {
    logger.error('Batch encoding failed:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to start batch encoding',
      error: error.message
    });
  }
});

// NEW: GET /api/files/import/status - Get import service status
router.get('/import/status', async (req, res) => {
  try {
    const { fileImportService } = req.services;
    
    if (!fileImportService) {
      return res.status(503).json({
        success: false,
        message: 'File import service not available'
      });
    }

    const status = fileImportService.getStatus();
    
    res.json({
      success: true,
      status
    });

  } catch (error) {
    logger.error('Failed to get import status:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get import status',
      error: error.message
    });
  }
});

module.exports = router;