// src/config/multerConfig.js - UPDATED: Multer 2.x Compatibility
const multer = require('multer');
const path = require('path');
const fs = require('fs-extra');
const { v4: uuidv4 } = require('uuid');
const logger = require('../utils/logger');

class MulterConfig {
  constructor() {
    this.incomingDir = process.env.INCOMING_DIR || './data/incoming';
    this.maxFileSize = parseInt(process.env.MAX_FILE_SIZE) || 500 * 1024 * 1024; // 500MB default
    this.allowedMimeTypes = [
      'audio/mpeg',      // MP3
      'audio/mp4',       // M4A/MP4 audio
      'audio/x-m4a',     // M4A alternative
      'audio/mp3',       // MP3 alternative
      'video/mp4',       // MP4 files with audio
      'audio/wav',       // WAV files
      'audio/flac',      // FLAC files
      'audio/ogg',       // OGG files
      'application/octet-stream' // Fallback for various audio files
    ];
    
    this.allowedExtensions = ['.mp3', '.m4a', '.mp4', '.wav', '.flac', '.ogg'];
    
    this.initializeStorage();
  }

  async initializeStorage() {
    try {
      await fs.ensureDir(this.incomingDir);
      logger.info(`Multer storage initialized: ${this.incomingDir}`);
    } catch (error) {
      logger.error('Failed to initialize multer storage:', error);
      throw error;
    }
  }

  // Multer 2.x compatible storage configuration
  createStorage() {
    return multer.diskStorage({
      destination: async (req, file, cb) => {
        try {
          await fs.ensureDir(this.incomingDir);
          cb(null, this.incomingDir);
        } catch (error) {
          logger.error('Storage destination error:', error);
          cb(error);
        }
      },
      
      filename: (req, file, cb) => {
        try {
          // Generate unique filename with original extension
          const ext = path.extname(file.originalname).toLowerCase();
          const baseName = path.basename(file.originalname, ext);
          const safeName = baseName.replace(/[^a-zA-Z0-9_-]/g, '_');
          const uniqueId = uuidv4().split('-')[0]; // Use first part of UUID
          const filename = `${safeName}_${uniqueId}${ext}`;
          
          logger.debug('Generated filename:', { 
            original: file.originalname, 
            generated: filename 
          });
          
          cb(null, filename);
        } catch (error) {
          logger.error('Filename generation error:', error);
          cb(error);
        }
      }
    });
  }

  // File filter for Multer 2.x
  createFileFilter() {
    return (req, file, cb) => {
      try {
        const ext = path.extname(file.originalname).toLowerCase();
        const mimeType = file.mimetype.toLowerCase();
        
        logger.debug('File filter check:', {
          filename: file.originalname,
          extension: ext,
          mimeType: mimeType,
          size: file.size
        });

        // Check file extension
        if (!this.allowedExtensions.includes(ext)) {
          const error = new Error(`Unsupported file extension: ${ext}. Allowed: ${this.allowedExtensions.join(', ')}`);
          error.code = 'INVALID_FILE_TYPE';
          logger.warn('File rejected - invalid extension:', { filename: file.originalname, ext });
          return cb(error, false);
        }

        // Check MIME type (with some flexibility for audio files)
        const isValidMime = this.allowedMimeTypes.some(allowedType => 
          mimeType.includes(allowedType) || allowedType === 'application/octet-stream'
        );

        if (!isValidMime) {
          const error = new Error(`Unsupported file type: ${mimeType}. This appears to be a ${mimeType} file.`);
          error.code = 'INVALID_MIME_TYPE';
          logger.warn('File rejected - invalid MIME type:', { filename: file.originalname, mimeType });
          return cb(error, false);
        }

        // Additional validation for common audio file patterns
        if (ext === '.mp3' && !mimeType.includes('audio')) {
          logger.warn('MP3 file with non-audio MIME type, allowing anyway:', { filename: file.originalname, mimeType });
        }

        logger.info('File accepted:', { 
          filename: file.originalname, 
          extension: ext, 
          mimeType: mimeType 
        });
        
        cb(null, true);

      } catch (error) {
        logger.error('File filter error:', error);
        cb(error, false);
      }
    };
  }

  // Create configured multer instance for Multer 2.x
  createUploadMiddleware() {
    const storage = this.createStorage();
    const fileFilter = this.createFileFilter();

    // Multer 2.x configuration
    const multerConfig = {
      storage: storage,
      fileFilter: fileFilter,
      limits: {
        fileSize: this.maxFileSize,
        files: 10, // Maximum 10 files per upload
        parts: 20  // Maximum 20 parts total
      },
      // Multer 2.x specific options
      preservePath: false,
      abortOnLimit: true
    };

    const upload = multer(multerConfig);

    // Return middleware with error handling
    return {
      // Single file upload
      single: (fieldName = 'file') => {
        return (req, res, next) => {
          const middleware = upload.single(fieldName);
          middleware(req, res, (error) => {
            if (error) {
              this.handleMulterError(error, req, res, next);
            } else {
              next();
            }
          });
        };
      },

      // Multiple files upload
      array: (fieldName = 'files', maxCount = 10) => {
        return (req, res, next) => {
          const middleware = upload.array(fieldName, maxCount);
          middleware(req, res, (error) => {
            if (error) {
              this.handleMulterError(error, req, res, next);
            } else {
              next();
            }
          });
        };
      },

      // Fields upload (multiple fields)
      fields: (fields) => {
        return (req, res, next) => {
          const middleware = upload.fields(fields);
          middleware(req, res, (error) => {
            if (error) {
              this.handleMulterError(error, req, res, next);
            } else {
              next();
            }
          });
        };
      }
    };
  }

  // Enhanced error handling for Multer 2.x
  handleMulterError(error, req, res, next) {
    logger.error('Multer upload error:', {
      code: error.code,
      message: error.message,
      field: error.field,
      filename: req.file?.originalname,
      files: req.files?.length
    });

    // Handle specific Multer 2.x errors
    if (error.code === 'LIMIT_FILE_SIZE') {
      return res.status(413).json({
        success: false,
        error: {
          code: 'FILE_TOO_LARGE',
          message: `File too large. Maximum size is ${Math.round(this.maxFileSize / 1024 / 1024)}MB.`,
          maxSize: this.maxFileSize
        }
      });
    }

    if (error.code === 'LIMIT_FILE_COUNT') {
      return res.status(413).json({
        success: false,
        error: {
          code: 'TOO_MANY_FILES',
          message: `Too many files. Maximum is ${error.limit} files.`,
          maxFiles: error.limit
        }
      });
    }

    if (error.code === 'INVALID_FILE_TYPE' || error.code === 'INVALID_MIME_TYPE') {
      return res.status(400).json({
        success: false,
        error: {
          code: error.code,
          message: error.message,
          allowedExtensions: this.allowedExtensions,
          allowedMimeTypes: this.allowedMimeTypes
        }
      });
    }

    if (error.code === 'LIMIT_PART_COUNT') {
      return res.status(413).json({
        success: false,
        error: {
          code: 'TOO_MANY_PARTS',
          message: 'Too many parts in multipart upload.',
          maxParts: error.limit
        }
      });
    }

    if (error.code === 'LIMIT_FIELD_KEY') {
      return res.status(413).json({
        success: false,
        error: {
          code: 'FIELD_NAME_TOO_LONG',
          message: 'Field name too long.',
          maxLength: error.limit
        }
      });
    }

    if (error.code === 'LIMIT_FIELD_VALUE') {
      return res.status(413).json({
        success: false,
        error: {
          code: 'FIELD_VALUE_TOO_LONG',
          message: 'Field value too long.',
          maxLength: error.limit
        }
      });
    }

    if (error.code === 'LIMIT_FIELD_COUNT') {
      return res.status(413).json({
        success: false,
        error: {
          code: 'TOO_MANY_FIELDS',
          message: 'Too many fields.',
          maxFields: error.limit
        }
      });
    }

    // Handle file system errors
    if (error.code === 'ENOENT') {
      return res.status(500).json({
        success: false,
        error: {
          code: 'STORAGE_ERROR',
          message: 'Upload directory not accessible.'
        }
      });
    }

    if (error.code === 'EACCES' || error.code === 'EPERM') {
      return res.status(500).json({
        success: false,
        error: {
          code: 'PERMISSION_ERROR',
          message: 'Permission denied when saving file.'
        }
      });
    }

    // Default error handling
    return res.status(500).json({
      success: false,
      error: {
        code: 'UPLOAD_ERROR',
        message: 'An error occurred during file upload.',
        details: process.env.NODE_ENV === 'development' ? error.message : undefined
      }
    });
  }

  // Get upload limits info
  getLimits() {
    return {
      maxFileSize: this.maxFileSize,
      maxFileSizeMB: Math.round(this.maxFileSize / 1024 / 1024),
      maxFiles: 10,
      allowedExtensions: this.allowedExtensions,
      allowedMimeTypes: this.allowedMimeTypes,
      uploadDirectory: this.incomingDir
    };
  }

  // Health check for multer configuration
  async healthCheck() {
    try {
      await fs.access(this.incomingDir, fs.constants.W_OK);
      return {
        status: 'healthy',
        multerVersion: '2.x',
        storageWritable: true,
        configuration: this.getLimits()
      };
    } catch (error) {
      return {
        status: 'unhealthy',
        multerVersion: '2.x',
        storageWritable: false,
        error: error.message,
        configuration: this.getLimits()
      };
    }
  }
}

// Export singleton instance
const multerConfig = new MulterConfig();

module.exports = {
  MulterConfig,
  multerConfig,
  upload: multerConfig.createUploadMiddleware()
};