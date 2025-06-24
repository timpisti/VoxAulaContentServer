# VoxAula Radio Station Service

A modern, containerized webradio podcast station streaming service built with Node.js and Angular. This application provides automated audio file processing, real-time streaming to VoxAula.com, and a comprehensive web-based administration interface.

## 🎵 Features

### Core Functionality
- **Audio File Processing**: Upload MP3/MP4 files with automatic encoding to Opus format
- **Real-time Streaming**: Stream audio to VoxAula with RTP protocol
- **Playlist Management**: Dynamic playlist creation with shuffle and manual ordering
- **Live Controls**: Start/stop radio stream, skip tracks, and monitor status
- **Metadata Extraction**: Automatic extraction of audio metadata (title, artist, album, duration)

### Administrative Features
- **Real-time Dashboard**: Monitor system health, encoding progress, and radio status
- **File Management**: Upload, encode, download, and delete audio files
- **System Monitoring**: Health checks, logs, performance metrics, and error tracking
- **Configuration Management**: Server settings and encoding parameters
- **Backup & Maintenance**: Database backups and system cleanup tools

### Technical Features
- **Containerized Deployment**: Docker support with production-ready configuration
- **Real-time Updates**: WebSocket communication for live status updates
- **Graceful Shutdown**: Proper cleanup of FFmpeg processes and connections
- **Error Recovery**: Automatic job recovery after server restarts
- **Session Management**: VoxAula session keepalive and reconnection handling

## 🏗️ Architecture

### Backend (Node.js)
```
├── server.js                 # Main application server
├── src/
│   ├── services/
│   │   ├── FFmpegService.js   # Audio encoding management
│   │   ├── JanusService.js    # VoxAula server integration
│   │   ├── MetadataService.js # Database and file metadata
│   │   └── RadioService.js    # Radio streaming control
│   ├── routes/
│   │   ├── fileRoutes.js      # File upload/management API
│   │   ├── radioRoutes.js     # Radio control API
│   │   ├── systemRoutes.js    # System monitoring API
│   │   └── monitoringRoutes.js # Advanced monitoring
│   └── utils/
│       └── logger.js          # Winston logging configuration
```

### Frontend (Angular 19+)
```
├── src/app/
│   ├── components/
│   │   ├── radio-dashboard/       # Radio control interface
│   │   ├── file-upload/          # File upload component
│   │   ├── file-list/            # File management interface
│   │   ├── system-dashboard/     # System monitoring
│   │   └── file-details-dialog/  # File details modal
│   ├── services/
│   │   ├── radio.service.ts      # Radio API communication
│   │   ├── file.service.ts       # File management API
│   │   ├── socket.service.ts     # WebSocket communication
│   │   └── system.service.ts     # System monitoring API
│   └── models/
│       ├── file.model.ts         # File-related interfaces
│       └── system.model.ts       # System monitoring interfaces
```

## 🛠️ Technology Stack

### Backend
- **Runtime**: Node.js 18+
- **Framework**: Express.js with Socket.IO
- **Audio Processing**: FFmpeg with fluent-ffmpeg
- **Streaming**: VoxAula server (Janus Gateway)
- **Database**: LowDB (JSON file-based)
- **Logging**: Winston
- **File Upload**: Multer
- **Validation**: Joi

### Frontend
- **Framework**: Angular 19+ (Standalone Components)
- **UI Library**: PrimeNG with Aura theme
- **HTTP Client**: Angular HttpClient
- **WebSocket**: Socket.IO Client
- **Build Tool**: Angular CLI

### Infrastructure
- **Containerization**: Docker & Docker Compose
- **Process Management**: PM2 (production)
- **Reverse Proxy**: Nginx (production)
- **Volume Management**: Docker volumes for persistent data

## 🚀 Quick Start

### Prerequisites
- Docker and Docker Compose
- Node.js 18+ (for development)
- FFmpeg (automatically installed in container)
- VoxAula publisher account

### Development Setup

1. **Clone the repository**:
```bash
git clone <repository-url>
cd radio-station-service
```

2. **Install dependencies**:
```bash
npm install
```

3. **Configure environment**:
```bash
cp .env.example .env
# Edit .env with your Janus server details
```

4. **Start development server**:
```bash
npm run dev
```

5. **Access the application**:
   - Frontend: http://[ServerIP]:3000
   - API: http://[ServerIP]:3000/api
   - Health Check: http://[ServerIP]:3000/api/health

### Production Deployment

1. **Deploy with Docker Compose**:
```bash
# Start production environment
./deploy.sh production deploy

# Or manually:
docker-compose -f docker-compose.yml -f docker-compose.prod.yml up -d
```

2. **Check deployment status**:
```bash
./deploy.sh production status
```

3. **View logs**:
```bash
./deploy.sh production logs
```

## ⚙️ Configuration

### Environment Variables

Create a `.env` file in the root directory:

```env
# Server Configuration
NODE_ENV=development
PORT=3000

# Directories
INCOMING_DIR=./data/incoming
REENCODED_DIR=./data/reencoded
METADATA_DIR=./data/metadata
LOGS_DIR=./data/logs

# Logging
LOG_LEVEL=info

# Encoding Settings
MAX_CONCURRENT_ENCODING=2
FFMPEG_OUTPUT_CODEC=libopus
FFMPEG_SAMPLE_RATE=48000
FFMPEG_BITRATE=128k
FFMPEG_CHANNELS=2

# Janus AudioBridge Configuration
EXTERNAL_JANUS_IP=[ServerIP]
EXTERNAL_JANUS_PORT=[Port]
```

### Janus AudioBridge Setup

The application requires a Janus Gateway server with the AudioBridge plugin configured:

1. **Install Janus Gateway** on your server
2. **Configure AudioBridge plugin** with a room
3. **Update configuration** in the web interface:
   - **Server IP**: Your Janus server IP
   - **HTTP Port**: Janus HTTP API port (default: 8088)
   - **Room ID**: AudioBridge room ID
   - **Participant Name**: Display name for the radio station
   - **Room Secret/PIN**: Optional authentication

### Example Janus Room Configuration
```json
{
  "room": [roomID],
  "description": "Radio Station Stream",
  "secret": "your-secret-here",
  "pin": "your-pin-here",
  "sampling_rate": 48000,
  "spatial_audio": false,
  "record": false
}
```

## 📡 API Documentation

### Radio Control Endpoints

#### Start Radio Stream
```http
POST /api/radio/start
Content-Type: application/json

{
  "config": {
    "janusIP": "[ServerIP]",
    "janusPort": "8088",
    "janusRoomId": "[RoomID]"
  }
}
```

#### Stop Radio Stream
```http
POST /api/radio/stop
```

#### Skip Current Track
```http
POST /api/radio/skip
```

#### Get Radio Status
```http
GET /api/radio/status
```

**Response**:
```json
{
  "success": true,
  "status": {
    "isRunning": true,
    "currentTrack": {
      "id": "file-id",
      "originalName": "song.mp3",
      "metadata": {
        "title": "Song Title",
        "artist": "Artist Name",
        "duration": 180
      }
    },
    "currentIndex": 2,
    "playlistSize": 10,
    "target": "[ServerIP]:[Port]",
    "uptime": 1800000
  }
}
```

### File Management Endpoints

#### Upload Files
```http
POST /api/files/upload
Content-Type: multipart/form-data

files: [File, File, ...]
```

#### List Files
```http
GET /api/files?status=completed&search=artist&limit=20&offset=0
```

#### Encode File
```http
POST /api/files/{fileId}/encode
```

#### Download Encoded File
```http
GET /api/files/{fileId}/download
```

### System Monitoring Endpoints

#### Health Check
```http
GET /api/system/status
```

#### System Statistics
```http
GET /api/system/stats
```

#### System Logs
```http
GET /api/system/logs?level=error&limit=50
```

## 🔧 Deployment Scripts

The project includes deployment scripts for easy management:

### Available Commands

```bash
# Deploy to development environment
./deploy.sh development deploy

# Deploy to production environment
./deploy.sh production deploy

# Stop services
./deploy.sh production stop

# Restart services
./deploy.sh production restart

# View logs
./deploy.sh production logs
./deploy.sh production logs follow  # Follow logs in real-time

# Check status
./deploy.sh production status

# Access container shell
./deploy.sh production shell

# Create backup
./deploy.sh production backup

# Complete rebuild
./rebuild.sh
```

### Production Deployment

For production deployment, the system creates necessary directories and sets up proper permissions:

```bash
# Production directories
/opt/radio-station/data/incoming     # Uploaded files
/opt/radio-station/data/reencoded    # Encoded files
/opt/radio-station/data/metadata     # Database and metadata
/opt/radio-station/data/logs         # Application logs
```

## 🐳 Docker Configuration

### Development
```yaml
# docker-compose.yml
services:
  radio-station:
    build: .
    ports:
      - "3000:3000"
    volumes:
      - radio_incoming:/app/data/incoming
      - radio_reencoded:/app/data/reencoded
      - radio_metadata:/app/data/metadata
      - radio_logs:/app/data/logs
    environment:
      - NODE_ENV=development
```

### Production
```yaml
# docker-compose.prod.yml
services:
  radio-station:
    restart: unless-stopped
    ports:
      - "80:3000"
    volumes:
      - /opt/radio-station/data/incoming:/app/data/incoming
      - /opt/radio-station/data/reencoded:/app/data/reencoded
      - /opt/radio-station/data/metadata:/app/data/metadata
      - /opt/radio-station/data/logs:/app/data/logs
    environment:
      - NODE_ENV=production
```

## 🔍 Monitoring and Logging

### Health Checks

The application provides comprehensive health monitoring:

- **System Health**: Memory usage, CPU, uptime
- **Service Health**: FFmpeg, Database, VoxAula Janus connection
- **Directory Health**: File system permissions and access
- **Active Jobs**: Current encoding processes

### Logging

Structured logging with Winston:

```javascript
// Log levels: error, warn, info, debug
// Logs are written to:
// - Console (development)
// - /app/data/logs/app.log (all logs)
// - /app/data/logs/error.log (errors only)
// - /app/data/logs/exceptions.log (uncaught exceptions)
```

### Metrics

Monitor key metrics via the `/api/monitoring/metrics` endpoint:

- File processing statistics
- Encoding performance
- System resource usage
- Error rates and patterns

## 🔒 Security Considerations

### Input Validation
- File type validation (MP3, MP4, M4A only)
- File size limits (500MB default)
- Filename sanitization
- API input validation with Joi

### Process Security
- No shell command injection vulnerabilities
- Proper FFmpeg process management
- Secure file upload handling
- Error message sanitization

### Network Security
- CORS configuration
- No sensitive data in client responses
- Secure Janus communication
- Input sanitization

## 🐛 Troubleshooting

### Common Issues

#### 1. Frontend Not Loading
```bash
# Check if frontend files exist
curl http://[ServerIP]:3000/api/health
# Look for frontend.available: true

# Rebuild if needed
./rebuild.sh
```

#### 2. Encoding Fails
```bash
# Check FFmpeg availability
docker exec -it radio-station ffmpeg -version

# Check file permissions
docker exec -it radio-station ls -la /app/data/

# View encoding logs
./deploy.sh production logs | grep FFmpeg
```

#### 3. Janus Connection Issues
```bash
# Test Janus connectivity
curl http://[ServerIP]:[Port]/janus/info

# Check Janus configuration in UI
# Radio Dashboard > Voxaula Janus Configuration
```

#### 4. File Upload Problems
```bash
# Check incoming directory permissions
docker exec -it radio-station ls -la /app/data/incoming/

# Monitor upload process
./deploy.sh production logs follow
```

### Log Analysis

Key log patterns to monitor:

```bash
# Successful operations
grep "successfully" /opt/radio-station/data/logs/app.log

# Errors
tail -f /opt/radio-station/data/logs/error.log

# Encoding progress
grep "Encoding" /opt/radio-station/data/logs/app.log

# Janus connectivity
grep "Janus" /opt/radio-station/data/logs/app.log
```

## 🧪 Development

### Running Tests

```bash
# Install development dependencies
npm install

# Run unit tests
npm test

# Run with coverage
npm run test:coverage
```

### Development Workflow

1. **Start development server**:
```bash
npm run dev
```

2. **Watch for changes**:
   - Backend: Nodemon automatically restarts on changes
   - Frontend: Angular CLI serves with hot reload

3. **Debug mode**:
```bash
DEBUG=* npm run dev
```

### Code Quality

The project follows these standards:

- **ESLint** for JavaScript linting
- **Prettier** for code formatting
- **Angular Style Guide** for frontend
- **JSDoc** for documentation
- **Conventional Commits** for version control

### Adding New Features

1. **Backend Services**: Add to `src/services/`
2. **API Routes**: Add to `src/routes/`
3. **Frontend Components**: Add to `src/app/components/`
4. **Frontend Services**: Add to `src/app/services/`

## 📊 Performance Optimization

### Backend Optimizations
- FFmpeg process pooling
- Efficient file streaming
- Database query optimization
- Memory usage monitoring
- Graceful shutdown handling

### Frontend Optimizations
- Angular OnPush change detection
- Lazy loading for routes
- Efficient WebSocket management
- Component reusability
- Bundle size optimization

### System Optimizations
- Docker multi-stage builds
- Volume optimization
- Log rotation
- Process resource limits
- Health check efficiency

## 🤝 Contributing

### Getting Started

1. **Fork the repository**
2. **Create a feature branch**: `git checkout -b feature/amazing-feature`
3. **Make your changes** following the coding standards
4. **Test your changes**: `npm test`
5. **Commit your changes**: `git commit -m 'Add amazing feature'`
6. **Push to the branch**: `git push origin feature/amazing-feature`
7. **Open a Pull Request**

### Coding Standards

- Use TypeScript for type safety
- Follow Angular style guide
- Use Prettier for formatting
- Add JSDoc comments for functions
- Write unit tests for new features
- Update documentation as needed

### Pull Request Guidelines

- Describe changes in detail
- Include relevant issue numbers
- Add screenshots for UI changes
- Ensure tests pass
- Update documentation if needed

## 📜 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## 🙏 Acknowledgments

- **FFmpeg** - Audio processing and encoding
- **Janus Gateway** - WebRTC and streaming infrastructure
- **Angular** - Frontend framework
- **PrimeNG** - UI component library
- **Socket.IO** - Real-time communication
- **Express.js** - Backend framework

## 📞 Support

For support and questions:

1. **Documentation**: Check this README and inline code comments
2. **Issues**: Create a GitHub issue with detailed information
3. **Logs**: Always include relevant log files with issue reports
4. **Health Check**: Include `/api/health` output when reporting problems

## 🗺️ Roadmap

- [ ] Automatic /reencoded directory scan and DB import
- [ ] Legal document upload for media files

---

**Version**: 1.0.0  
**Last Updated**: 2024  
**Node.js**: 18+  
**Angular**: 19+  
**Docker**: Required for deployment