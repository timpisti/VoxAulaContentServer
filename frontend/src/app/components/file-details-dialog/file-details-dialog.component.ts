// src/app/components/file-details-dialog/file-details-dialog.component.ts
import { Component, Input, Output, EventEmitter, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';

// PrimeNG Imports
import { DialogModule } from 'primeng/dialog';
import { ButtonModule } from 'primeng/button';
import { PanelModule } from 'primeng/panel';
import { ProgressBarModule } from 'primeng/progressbar';
import { TagModule } from 'primeng/tag';
import { AccordionModule } from 'primeng/accordion';
import { ProgressSpinnerModule } from 'primeng/progressspinner';

import { AudioFile, LogEntry } from '../../models/file.model';
import { FileService } from '../../services/file.service';
import { NotificationService } from '../../services/notification.service';

@Component({
  selector: 'app-file-details-dialog',
  standalone: true,
  imports: [
    CommonModule,
    DialogModule,
    ButtonModule,
    PanelModule,
    ProgressBarModule,
    TagModule,
    AccordionModule,
    ProgressSpinnerModule
  ],
  template: `
    <p-dialog 
      [(visible)]="visible" 
      [modal]="true"
      [closable]="true"
      [resizable]="true"
      [style]="{width: '80vw', maxWidth: '800px'}"
      header="File Details"
      (onHide)="onDialogHide()">>
      
      <div *ngIf="file" class="file-details">
        <!-- File Info Section -->
        <p-panel header="File Information" [toggleable]="true" styleClass="mb-3">
          <div class="grid">
            <div class="col-12 md:col-6">
              <div class="field">
                <label class="font-semibold">Original Name:</label>
                <div class="mt-1">{{ file.originalName }}</div>
              </div>
              
              <div class="field">
                <label class="font-semibold">File Size:</label>
                <div class="mt-1">{{ formatFileSize(file.size) }}</div>
              </div>
              
              <div class="field">
                <label class="font-semibold">MIME Type:</label>
                <div class="mt-1">{{ file.mimeType }}</div>
              </div>
              
              <div class="field">
                <label class="font-semibold">Upload Date:</label>
                <div class="mt-1">{{ formatDate(file.uploadDate) }}</div>
              </div>
            </div>
            
            <div class="col-12 md:col-6">
              <div class="field">
                <label class="font-semibold">Status:</label>
                <div class="mt-1">
                  <p-tag [value]="file.status | titlecase" 
                         [severity]="getStatusSeverity(file.status)"
                         [icon]="getStatusIcon(file.status)"></p-tag>
                </div>
              </div>
              
              <div class="field" *ngIf="file.status === 'encoding'">
                <label class="font-semibold">Progress:</label>
                <div class="mt-1">
                  <p-progressBar [value]="file.progress" 
                                [showValue]="true"
                                styleClass="h-1rem"></p-progressBar>
                </div>
              </div>
              
              <div class="field" *ngIf="file.retryCount > 0">
                <label class="font-semibold">Retry Count:</label>
                <div class="mt-1">{{ file.retryCount }}</div>
              </div>
              
              <div class="field" *ngIf="file.encodedPath">
                <label class="font-semibold">Encoded File:</label>
                <div class="mt-1 text-600 text-sm">{{ file.encodedPath }}</div>
              </div>
            </div>
          </div>
        </p-panel>

        <!-- Audio Metadata Section -->
        <p-panel header="Audio Metadata" [toggleable]="true" styleClass="mb-3">
          <div class="grid">
            <div class="col-12 md:col-6">
              <div class="field" *ngIf="file.metadata.title">
                <label class="font-semibold">Title:</label>
                <div class="mt-1">{{ file.metadata.title }}</div>
              </div>
              
              <div class="field" *ngIf="file.metadata.artist">
                <label class="font-semibold">Artist:</label>
                <div class="mt-1">{{ file.metadata.artist }}</div>
              </div>
              
              <div class="field" *ngIf="file.metadata.album">
                <label class="font-semibold">Album:</label>
                <div class="mt-1">{{ file.metadata.album }}</div>
              </div>
            </div>
            
            <div class="col-12 md:col-6">
              <div class="field" *ngIf="file.metadata.duration">
                <label class="font-semibold">Duration:</label>
                <div class="mt-1">{{ formatDuration(file.metadata.duration) }}</div>
              </div>
              
              <div class="field" *ngIf="file.metadata.bitrate">
                <label class="font-semibold">Bitrate:</label>
                <div class="mt-1">{{ file.metadata.bitrate }} kbps</div>
              </div>
              
              <div class="field" *ngIf="file.metadata.genre">
                <label class="font-semibold">Genre:</label>
                <div class="mt-1">{{ file.metadata.genre }}</div>
              </div>
              
              <div class="field" *ngIf="file.metadata.year">
                <label class="font-semibold">Year:</label>
                <div class="mt-1">{{ file.metadata.year }}</div>
              </div>
            </div>
          </div>
        </p-panel>

        <!-- Error Information -->
        <p-panel *ngIf="file.error" header="Error Information" [toggleable]="true" styleClass="mb-3">
          <div class="field">
            <label class="font-semibold text-red-500">Error Message:</label>
            <div class="mt-1 text-red-600">{{ file.error.message }}</div>
          </div>
          
          <div class="field" *ngIf="file.error.timestamp">
            <label class="font-semibold">Error Time:</label>
            <div class="mt-1">{{ formatDate(file.error.timestamp) }}</div>
          </div>
          
          <div class="field" *ngIf="file.error.technical">
            <label class="font-semibold">Technical Details:</label>
            <div class="mt-1">
              <p-accordion>
                <p-accordionTab header="Show Technical Details">
                  <pre class="text-sm bg-gray-50 p-2 border-round overflow-auto">{{ file.error.technical }}</pre>
                </p-accordionTab>
              </p-accordion>
            </div>
          </div>
        </p-panel>

        <!-- Processing Logs -->
        <p-panel header="Processing Logs" [toggleable]="true" [collapsed]="true" styleClass="mb-3">
          <div class="logs-container">
            <div class="flex justify-content-between align-items-center mb-3">
              <span class="font-semibold">Recent Logs ({{ logs.length }})</span>
              <p-button label="Refresh Logs" 
                       icon="pi pi-refresh" 
                       size="small"
                       [text]="true"
                       (onClick)="loadLogs()"></p-button>
            </div>
            
            <div *ngIf="logsLoading" class="text-center p-3">
              <p-progressSpinner [style]="{width: '30px', height: '30px'}"></p-progressSpinner>
              <div class="mt-2">Loading logs...</div>
            </div>
            
            <div *ngIf="!logsLoading && logs.length === 0" class="text-center text-600 p-3">
              No logs available
            </div>
            
            <div *ngIf="!logsLoading && logs.length > 0" class="logs-list">
              <div *ngFor="let log of logs; trackBy: trackByLog" 
                   class="log-entry p-2 border-bottom-1 surface-border">
                <div class="flex align-items-start gap-2">
                  <i class="pi" 
                     [class]="getLogLevelIcon(log.level)"
                     [style.color]="getLogLevelColor(log.level)"></i>
                  
                  <div class="flex-1">
                    <div class="flex justify-content-between align-items-start mb-1">
                      <span class="font-medium">{{ log.message }}</span>
                      <small class="text-600">{{ formatDate(log.timestamp) }}</small>
                    </div>
                    
                    <div *ngIf="log.details" class="text-sm text-600">
                      <p-accordion *ngIf="isComplexDetails(log.details)">
                        <p-accordionTab header="Show Details">
                          <pre class="text-xs bg-gray-50 p-2 border-round overflow-auto">{{ formatLogDetails(log.details) }}</pre>
                        </p-accordionTab>
                      </p-accordion>
                      <span *ngIf="!isComplexDetails(log.details)">{{ formatLogDetails(log.details) }}</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </p-panel>
      </div>

      <ng-template pTemplate="footer">
        <div class="flex justify-content-between">
          <div class="flex gap-2">
            <p-button *ngIf="file?.status === 'completed'" 
                     label="Download" 
                     icon="pi pi-download"
                     severity="success"
                     (onClick)="downloadFile()"></p-button>
            
            <p-button *ngIf="file?.status === 'uploaded'" 
                     label="Encode" 
                     icon="pi pi-play"
                     severity="info"
                     (onClick)="encodeFile()"></p-button>
            
            <p-button *ngIf="file?.status === 'failed'" 
                     label="Retry" 
                     icon="pi pi-refresh"
                     severity="warn"
                     (onClick)="retryEncoding()"></p-button>
          </div>
          
          <p-button label="Close" 
                   icon="pi pi-times"
                   severity="secondary"
                   (onClick)="onClose.emit()"></p-button>
        </div>
      </ng-template>
    </p-dialog>
  `,
  styles: [`
    .file-details {
      max-height: 70vh;
      overflow-y: auto;
    }

    .field {
      margin-bottom: 1rem;
    }

    .field label {
      display: block;
      margin-bottom: 0.25rem;
    }

    .logs-container {
      max-height: 400px;
      overflow-y: auto;
    }

    .log-entry:hover {
      background-color: var(--surface-100);
    }

    pre {
      white-space: pre-wrap;
      word-wrap: break-word;
      max-height: 200px;
      overflow-y: auto;
    }

    ::ng-deep .p-panel .p-panel-content {
      padding: 1rem;
    }

    ::ng-deep .p-accordion .p-accordion-content {
      padding: 0.5rem;
    }
  `]
})
export class FileDetailsDialogComponent implements OnInit {
  @Input() visible = false;
  @Input() file: AudioFile | null = null;
  @Output() onClose = new EventEmitter<void>();
  @Output() visibleChange = new EventEmitter<boolean>();

  logs: LogEntry[] = [];
  logsLoading = false;

  constructor(
    private fileService: FileService,
    private notificationService: NotificationService
  ) {}

  ngOnInit() {
    if (this.file) {
      this.loadLogs();
    }
  }

  loadLogs() {
    if (!this.file) return;

    this.logsLoading = true;
    
    this.fileService.getFileLogs(this.file.id).subscribe({
      next: (response) => {
        this.logs = response.logs || [];
        this.logsLoading = false;
      },
      error: (error) => {
        this.notificationService.showError('Failed to load logs', error.message);
        this.logsLoading = false;
      }
    });
  }

  downloadFile() {
    if (!this.file) return;

    this.fileService.downloadFile(this.file.id).subscribe({
      next: (blob) => {
        const url = window.URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = `${this.file!.originalName.replace(/\.[^/.]+$/, '')}.opus`;
        link.click();
        window.URL.revokeObjectURL(url);
        
        this.notificationService.showSuccess(`Downloaded: ${this.file!.originalName}`);
      },
      error: (error) => {
        this.notificationService.showError('Failed to download file', error.message);
      }
    });
  }

  encodeFile() {
    if (!this.file) return;

    this.fileService.encodeFile(this.file.id).subscribe({
      next: () => {
        this.notificationService.showInfo(`Encoding started for: ${this.file!.originalName}`);
        this.onClose.emit();
      },
      error: (error) => {
        this.notificationService.showError('Failed to start encoding', error.message);
      }
    });
  }

  retryEncoding() {
    if (!this.file) return;

    this.fileService.retryEncoding(this.file.id).subscribe({
      next: () => {
        this.notificationService.showInfo(`Retry encoding started for: ${this.file!.originalName}`);
        this.onClose.emit();
      },
      error: (error) => {
        this.notificationService.showError('Failed to retry encoding', error.message);
      }
    });
  }

  onDialogHide() {
    this.visible = false;
    this.visibleChange.emit(this.visible);
    this.onClose.emit();
  }

  // Helper methods
  formatFileSize(bytes: number): string {
    return this.fileService.formatFileSize(bytes);
  }

  formatDuration(seconds: number): string {
    return this.fileService.formatDuration(seconds);
  }

  formatDate(dateString: string): string {
    return new Date(dateString).toLocaleString();
  }

  getStatusSeverity(status: string): any {
    return this.fileService.getStatusSeverity(status);
  }

  getStatusIcon(status: string): string {
    return this.fileService.getStatusIcon(status);
  }

  getLogLevelIcon(level: string): string {
    switch (level.toLowerCase()) {
      case 'debug': return 'pi-info-circle';
      case 'info': return 'pi-check-circle';
      case 'warn': return 'pi-exclamation-triangle';
      case 'error': return 'pi-times-circle';
      default: return 'pi-circle';
    }
  }

  getLogLevelColor(level: string): string {
    switch (level.toLowerCase()) {
      case 'debug': return '#6b7280';
      case 'info': return '#10b981';
      case 'warn': return '#f59e0b';
      case 'error': return '#ef4444';
      default: return '#6b7280';
    }
  }

  isComplexDetails(details: any): boolean {
    return details && typeof details === 'object' && Object.keys(details).length > 1;
  }

  formatLogDetails(details: any): string {
    if (!details) return '';
    
    if (typeof details === 'string') {
      return details;
    }
    
    if (typeof details === 'object') {
      return JSON.stringify(details, null, 2);
    }
    
    return String(details);
  }

  trackByLog(index: number, log: LogEntry): string {
    return log.timestamp + log.message;
  }
}