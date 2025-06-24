// src/app/components/encoding-status/encoding-status.component.ts
import { Component, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { Subscription } from 'rxjs';

// PrimeNG Imports
import { ButtonModule } from 'primeng/button';
import { CardModule } from 'primeng/card';
import { ProgressBarModule } from 'primeng/progressbar';
import { BadgeModule } from 'primeng/badge';
import { TooltipModule } from 'primeng/tooltip';

import { FileService } from '../../services/file.service';
import { SocketService } from '../../services/socket.service';
import { NotificationService } from '../../services/notification.service';
import { AudioFile } from '../../models/file.model';

@Component({
  selector: 'app-encoding-status',
  standalone: true,
  imports: [
    CommonModule,
    RouterModule,
    ButtonModule,
    CardModule,
    ProgressBarModule,
    BadgeModule,
    TooltipModule
  ],
  template: `
    <p-card header="Encoding Status" styleClass="w-full">
      <div class="encoding-status-container">
        
        <!-- Summary -->
        <div class="grid mb-4">
          <div class="col-12 md:col-3">
            <div class="stat-card text-center p-3 border-round bg-blue-50">
              <div class="text-2xl font-bold text-blue-600">{{ stats.encoding }}</div>
              <div class="text-600">Currently Encoding</div>
            </div>
          </div>
          
          <div class="col-12 md:col-3">
            <div class="stat-card text-center p-3 border-round bg-orange-50">
              <div class="text-2xl font-bold text-orange-600">{{ stats.pending }}</div>
              <div class="text-600">Pending</div>
            </div>
          </div>
          
          <div class="col-12 md:col-3">
            <div class="stat-card text-center p-3 border-round bg-green-50">
              <div class="text-2xl font-bold text-green-600">{{ stats.completed }}</div>
              <div class="text-600">Completed Today</div>
            </div>
          </div>
          
          <div class="col-12 md:col-3">
            <div class="stat-card text-center p-3 border-round bg-red-50">
              <div class="text-2xl font-bold text-red-600">{{ stats.failed }}</div>
              <div class="text-600">Failed</div>
            </div>
          </div>
        </div>

        <!-- Active Encoding Jobs -->
        <div *ngIf="encodingFiles.length > 0" class="mb-4">
          <h5 class="mb-3">
            <i class="pi pi-spin pi-cog mr-2"></i>
            Active Encoding Jobs ({{ encodingFiles.length }})
          </h5>
          
          <div class="encoding-jobs">
            <div *ngFor="let file of encodingFiles; trackBy: trackByFile" 
                 class="encoding-job-card p-3 mb-3 border-1 surface-border border-round">
              
              <div class="flex align-items-center justify-content-between mb-2">
                <div class="flex-1">
                  <div class="font-medium text-lg">{{ file.originalName }}</div>
                  <div class="text-sm text-600">
                    Size: {{ formatFileSize(file.size) }}
                    <span *ngIf="file.metadata.duration"> • Duration: {{ formatDuration(file.metadata.duration) }}</span>
                  </div>
                </div>
                
                <div class="flex align-items-center gap-2">
                  <p-button icon="pi pi-stop" 
                           severity="danger" 
                           size="small"
                           [text]="true"
                           pTooltip="Cancel Encoding"
                           (onClick)="cancelEncoding(file)"></p-button>
                </div>
              </div>
              
              <!-- Progress Bar -->
              <div class="progress-container">
                <div class="flex justify-content-between align-items-center mb-2">
                  <span class="text-sm font-medium">Progress</span>
                  <span class="text-sm font-bold">{{ file.progress }}%</span>
                </div>
                
                <p-progressBar [value]="file.progress" 
                              [showValue]="false"
                              styleClass="h-1rem"
                              [style]="{'background-color': '#e5e7eb'}">
                </p-progressBar>
                
                <!-- Progress Details -->
                <div *ngIf="progressDetails[file.id]" class="text-xs text-600 mt-1">
                  <div class="flex justify-content-between">
                    <span *ngIf="progressDetails[file.id].fps">FPS: {{ progressDetails[file.id].fps }}</span>
                    <span *ngIf="progressDetails[file.id].bitrate">Bitrate: {{ progressDetails[file.id].bitrate }} kbps</span>
                    <span>Elapsed: {{ getElapsedTime(file.id) }}</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        <!-- Pending Files -->
        <div *ngIf="pendingFiles.length > 0" class="mb-4">
          <h5 class="mb-3">
            <i class="pi pi-clock mr-2"></i>
            Pending Files ({{ pendingFiles.length }})
          </h5>
          
          <div class="pending-files">
            <div *ngFor="let file of pendingFiles.slice(0, 5); trackBy: trackByFile" 
                 class="pending-file-card p-2 mb-2 surface-100 border-round">
              
              <div class="flex align-items-center justify-content-between">
                <div class="flex-1">
                  <div class="font-medium">{{ file.originalName }}</div>
                  <div class="text-sm text-600">
                    {{ formatFileSize(file.size) }} • Uploaded {{ formatRelativeTime(file.uploadDate) }}
                  </div>
                </div>
                
                <p-button label="Encode Now" 
                         icon="pi pi-play"
                         severity="success"
                         size="small"
                         [text]="true"
                         (onClick)="startEncoding(file)"></p-button>
              </div>
            </div>
            
            <div *ngIf="pendingFiles.length > 5" class="text-center text-600 mt-2">
              ... and {{ pendingFiles.length - 5 }} more pending files
            </div>
          </div>
        </div>

        <!-- Failed Files -->
        <div *ngIf="failedFiles.length > 0" class="mb-4">
          <h5 class="mb-3">
            <i class="pi pi-times-circle mr-2 text-red-500"></i>
            Failed Files ({{ failedFiles.length }})
          </h5>
          
          <div class="failed-files">
            <div *ngFor="let file of failedFiles.slice(0, 3); trackBy: trackByFile" 
                 class="failed-file-card p-2 mb-2 bg-red-50 border-red-200 border-1 border-round">
              
              <div class="flex align-items-center justify-content-between">
                <div class="flex-1">
                  <div class="font-medium">{{ file.originalName }}</div>
                  <div class="text-sm text-red-600" *ngIf="file.error">
                    {{ file.error.message }}
                  </div>
                  <div class="text-xs text-600">
                    Failed {{ formatRelativeTime(file.error?.timestamp || file.uploadDate) }}
                  </div>
                </div>
                
                <div class="flex gap-1">
                  <p-button icon="pi pi-info-circle" 
                           severity="secondary"
                           size="small"
                           [text]="true"
                           pTooltip="View Details"
                           (onClick)="showFileDetails(file)"></p-button>
                  
                  <p-button icon="pi pi-refresh" 
                           severity="warn"
                           size="small"
                           [text]="true"
                           pTooltip="Retry Encoding"
                           (onClick)="retryEncoding(file)"></p-button>
                </div>
              </div>
            </div>
            
            <div *ngIf="failedFiles.length > 3" class="text-center text-600 mt-2">
              ... and {{ failedFiles.length - 3 }} more failed files
            </div>
          </div>
        </div>

        <!-- Empty State -->
        <div *ngIf="encodingFiles.length === 0 && pendingFiles.length === 0 && failedFiles.length === 0" 
             class="empty-state text-center p-4">
          <i class="pi pi-check-circle text-4xl text-green-500 mb-3"></i>
          <h4 class="mb-2">All caught up!</h4>
          <p class="text-600">No files are currently being processed.</p>
        </div>

        <!-- Quick Actions -->
        <div class="quick-actions mt-4 pt-3 border-top-1 surface-border">
          <div class="flex justify-content-between align-items-center">
            <div class="text-600">
              Last updated: {{ lastUpdated | date:'medium' }}
            </div>
            
            <div class="flex gap-2">
              <p-button label="Refresh" 
                       icon="pi pi-refresh"
                       severity="secondary"
                       size="small"
                       [loading]="refreshing"
                       (onClick)="refreshStatus()"></p-button>
              
              <p-button label="View All Files" 
                       icon="pi pi-list"
                       severity="info"
                       size="small"
                       routerLink="/files/list"></p-button>
            </div>
          </div>
        </div>
      </div>
    </p-card>
  `,
  styles: [`
    .encoding-status-container {
      min-height: 200px;
    }

    .stat-card {
      transition: transform 0.2s ease;
    }

    .stat-card:hover {
      transform: translateY(-2px);
    }

    .encoding-job-card {
      background: linear-gradient(45deg, #f8fafc, #e2e8f0);
      border-left: 4px solid #3b82f6;
    }

    .pending-file-card {
      transition: background-color 0.2s ease;
    }

    .pending-file-card:hover {
      background-color: var(--surface-200);
    }

    .failed-file-card {
      border-left: 4px solid #ef4444;
    }

    .progress-container {
      margin-top: 0.5rem;
    }

    ::ng-deep .p-progressbar {
      background-color: #e5e7eb;
    }

    ::ng-deep .p-progressbar .p-progressbar-value {
      background: linear-gradient(90deg, #3b82f6, #1d4ed8);
    }

    .empty-state {
      background: linear-gradient(135deg, #f0fdf4, #dcfce7);
      border-radius: 0.5rem;
    }

    .quick-actions {
      background-color: var(--surface-50);
      margin: 0 -1.5rem -1.5rem -1.5rem;
      padding: 1rem 1.5rem;
      border-radius: 0 0 0.375rem 0.375rem;
    }
  `]
})
export class EncodingStatusComponent implements OnInit, OnDestroy {
  encodingFiles: AudioFile[] = [];
  pendingFiles: AudioFile[] = [];
  failedFiles: AudioFile[] = [];
  
  stats = {
    encoding: 0,
    pending: 0,
    completed: 0,
    failed: 0
  };

  progressDetails: { [fileId: string]: any } = {};
  startTimes: { [fileId: string]: Date } = {};
  lastUpdated = new Date();
  refreshing = false;

  private subscriptions: Subscription[] = [];

  constructor(
    private fileService: FileService,
    private socketService: SocketService,
    private notificationService: NotificationService
  ) {}

  ngOnInit() {
    this.loadFiles();
    this.setupSocketListeners();
    
    // Auto-refresh every 30 seconds
    setInterval(() => {
      this.loadFiles();
    }, 30000);
  }

  ngOnDestroy() {
    this.subscriptions.forEach(sub => sub.unsubscribe());
  }

  setupSocketListeners() {
    // Listen to encoding progress
    this.subscriptions.push(
      this.socketService.onEncodingProgress().subscribe(event => {
        this.updateFileProgress(event.fileId, event.progress, event.details);
      }),

      this.socketService.onEncodingCompleted().subscribe(event => {
        this.onEncodingCompleted(event.fileId);
      }),

      this.socketService.onEncodingFailed().subscribe(event => {
        this.onEncodingFailed(event.fileId);
      }),

      this.socketService.onEncodingCancelled().subscribe(event => {
        this.onEncodingCancelled(event.fileId);
      }),

      this.socketService.onFilesUploaded().subscribe(() => {
        this.loadFiles();
      })
    );
  }

  loadFiles() {
    this.fileService.getFiles({ limit: 100 }).subscribe({
      next: (response) => {
        this.categorizeFiles(response.files);
        this.updateStats();
        this.lastUpdated = new Date();
      },
      error: (error) => {
        console.error('Failed to load files:', error);
      }
    });
  }

  categorizeFiles(files: AudioFile[]) {
    this.encodingFiles = files.filter(f => f.status === 'encoding');
    this.pendingFiles = files.filter(f => f.status === 'uploaded').slice(0, 10); // Limit for display
    this.failedFiles = files.filter(f => f.status === 'failed').slice(0, 5); // Limit for display

    // Track start times for encoding files
    this.encodingFiles.forEach(file => {
      if (!this.startTimes[file.id]) {
        this.startTimes[file.id] = new Date();
      }
    });
  }

  updateStats() {
    this.stats = {
      encoding: this.encodingFiles.length,
      pending: this.pendingFiles.length,
      completed: this.getCompletedTodayCount(),
      failed: this.failedFiles.length
    };
  }

  getCompletedTodayCount(): number {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    // This would need to be fetched from the backend for accurate count
    // For now, return 0 as placeholder
    return 0;
  }

  updateFileProgress(fileId: string, progress: number, details?: any) {
    const file = this.encodingFiles.find(f => f.id === fileId);
    if (file) {
      file.progress = progress;
      if (details) {
        this.progressDetails[fileId] = details;
      }
    }
  }

  onEncodingCompleted(fileId: string) {
    // Remove from encoding list
    this.encodingFiles = this.encodingFiles.filter(f => f.id !== fileId);
    delete this.progressDetails[fileId];
    delete this.startTimes[fileId];
    
    this.updateStats();
    this.loadFiles(); // Refresh to get updated status
  }

  onEncodingFailed(fileId: string) {
    // Move from encoding to failed
    const file = this.encodingFiles.find(f => f.id === fileId);
    if (file) {
      this.encodingFiles = this.encodingFiles.filter(f => f.id !== fileId);
      file.status = 'failed';
      this.failedFiles.unshift(file);
      
      delete this.progressDetails[fileId];
      delete this.startTimes[fileId];
    }
    
    this.updateStats();
  }

  onEncodingCancelled(fileId: string) {
    // Move from encoding back to pending
    const file = this.encodingFiles.find(f => f.id === fileId);
    if (file) {
      this.encodingFiles = this.encodingFiles.filter(f => f.id !== fileId);
      file.status = 'uploaded';
      file.progress = 0;
      this.pendingFiles.unshift(file);
      
      delete this.progressDetails[fileId];
      delete this.startTimes[fileId];
    }
    
    this.updateStats();
  }

  startEncoding(file: AudioFile) {
    this.fileService.encodeFile(file.id).subscribe({
      next: () => {
        // Move from pending to encoding
        this.pendingFiles = this.pendingFiles.filter(f => f.id !== file.id);
        file.status = 'encoding';
        file.progress = 0;
        this.encodingFiles.push(file);
        this.startTimes[file.id] = new Date();
        
        this.updateStats();
        this.notificationService.showInfo(`Encoding started: ${file.originalName}`);
      },
      error: (error) => {
        this.notificationService.showError('Failed to start encoding', error.message);
      }
    });
  }

  cancelEncoding(file: AudioFile) {
    this.fileService.cancelEncoding(file.id).subscribe({
      next: () => {
        this.notificationService.showInfo(`Encoding cancelled: ${file.originalName}`);
      },
      error: (error) => {
        this.notificationService.showError('Failed to cancel encoding', error.message);
      }
    });
  }

  retryEncoding(file: AudioFile) {
    this.fileService.retryEncoding(file.id).subscribe({
      next: () => {
        // Move from failed to encoding
        this.failedFiles = this.failedFiles.filter(f => f.id !== file.id);
        file.status = 'encoding';
        file.progress = 0;
        file.error = undefined;
        this.encodingFiles.push(file);
        this.startTimes[file.id] = new Date();
        
        this.updateStats();
        this.notificationService.showInfo(`Retry encoding started: ${file.originalName}`);
      },
      error: (error) => {
        this.notificationService.showError('Failed to retry encoding', error.message);
      }
    });
  }

  showFileDetails(file: AudioFile) {
    // This would open the file details dialog
    // Implementation depends on how you want to handle this
    console.log('Show file details:', file);
  }

  refreshStatus() {
    this.refreshing = true;
    this.loadFiles();
    
    setTimeout(() => {
      this.refreshing = false;
    }, 1000);
  }

  getElapsedTime(fileId: string): string {
    const startTime = this.startTimes[fileId];
    if (!startTime) return '--:--';
    
    const elapsed = Math.floor((Date.now() - startTime.getTime()) / 1000);
    return this.formatDuration(elapsed);
  }

  // Helper methods
  formatFileSize(bytes: number): string {
    return this.fileService.formatFileSize(bytes);
  }

  formatDuration(seconds: number): string {
    return this.fileService.formatDuration(seconds);
  }

  formatRelativeTime(dateString: string): string {
    const date = new Date(dateString);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / (1000 * 60));
    const diffHours = Math.floor(diffMins / 60);
    const diffDays = Math.floor(diffHours / 24);
    
    if (diffMins < 1) return 'just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    if (diffDays < 7) return `${diffDays}d ago`;
    
    return date.toLocaleDateString();
  }

  trackByFile(index: number, file: AudioFile): string {
    return file.id;
  }
}