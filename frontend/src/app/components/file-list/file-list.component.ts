// src/app/components/file-list/file-list.component.ts
import { Component, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Subscription } from 'rxjs';
import { ConfirmationService } from 'primeng/api';

// PrimeNG Imports
import { ButtonModule } from 'primeng/button';
import { CardModule } from 'primeng/card';
import { TableModule } from 'primeng/table';
import { ProgressBarModule } from 'primeng/progressbar';
import { TagModule } from 'primeng/tag';
import { ToolbarModule } from 'primeng/toolbar';
import { InputTextModule } from 'primeng/inputtext';
import { DropdownModule } from 'primeng/dropdown';
import { TooltipModule } from 'primeng/tooltip';
import { ToggleButtonModule } from 'primeng/togglebutton';
import { PanelModule } from 'primeng/panel';
import { InputNumberModule } from 'primeng/inputnumber';

import { FileService } from '../../services/file.service';
import { SocketService } from '../../services/socket.service';
import { NotificationService } from '../../services/notification.service';
import { AudioFile, FileFilter, FileStatus } from '../../models/file.model';
import { FileDetailsDialogComponent } from '../file-details-dialog/file-details-dialog.component';

@Component({
  selector: 'app-file-list',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    ButtonModule,
    CardModule,
    TableModule,
    ProgressBarModule,
    TagModule,
    ToolbarModule,
    InputTextModule,
    DropdownModule,
    TooltipModule,
    ToggleButtonModule,
    PanelModule,
    InputNumberModule,
    FileDetailsDialogComponent
  ],
  template: `
    <div class="file-list-container">
      <p-card header="File Management" styleClass="w-full">
        
        <!-- Toolbar -->
        <p-toolbar styleClass="mb-4">
          <div class="p-toolbar-group-start">
            <p-button label="Refresh" 
                     icon="pi pi-refresh" 
                     severity="secondary"
                     (onClick)="refreshFiles()"
                     [loading]="loading"></p-button>
          </div>
          
          <div class="p-toolbar-group-end">
            <!-- Search -->
            <span class="p-input-icon-left mr-2">
              <i class="pi pi-search"></i>
              <input type="text" 
                     pInputText 
                     placeholder="Search files..."
                     [(ngModel)]="searchTerm"
                     (input)="onSearchChange()"
                     class="w-20rem">
            </span>
            
            <!-- Status Filter -->
            <p-dropdown [options]="statusOptions"
                       [(ngModel)]="selectedStatus"
                       placeholder="All Status"
                       (onChange)="onStatusFilterChange()"
                       [showClear]="true"
                       class="w-12rem"></p-dropdown>
          </div>
        </p-toolbar>

        <!-- File Import & Encoding Control Panel -->
        <p-panel header="Import & Encoding Controls" [toggleable]="true" styleClass="mb-4">
          <div class="grid">
            <!-- Manual Import -->
            <div class="col-12 md:col-6">
              <p-card header="Directory Import" styleClass="h-full">
                <div class="flex flex-column gap-3">
                  <p class="text-600 m-0">
                    Import audio files manually placed in the incoming directory.
                  </p>
                  
                  <p-button 
                    label="Import Files Now"
                    icon="pi pi-folder-open"
                    [loading]="importLoading"
                    (onClick)="importFiles()"
                    styleClass="w-full"></p-button>
                  
                  <div class="field">
                    <div class="flex align-items-center">
                      <p-toggleButton 
                        [(ngModel)]="autoImportEnabled"
                        onLabel="Auto-Import ON" 
                        offLabel="Auto-Import OFF"
                        (onChange)="toggleAutoImport()"
                        [disabled]="configLoading"
                        styleClass="w-full"></p-toggleButton>
                    </div>
                    <small class="text-600">Automatically import files from directory</small>
                  </div>
                  
                  <div class="field" *ngIf="autoImportEnabled">
                    <label for="monitoringInterval" class="block font-medium mb-1">Check Interval (hours)</label>
                    <p-inputNumber 
                      id="monitoringInterval"
                      [(ngModel)]="monitoringIntervalHours"
                      [min]="1" 
                      [max]="24"
                      [disabled]="configLoading"
                      (onBlur)="updateMonitoringInterval()"
                      styleClass="w-full"></p-inputNumber>
                  </div>
                </div>
              </p-card>
            </div>
            
            <!-- Auto Encoding -->
            <div class="col-12 md:col-6">
              <p-card header="Auto Encoding" styleClass="h-full">
                <div class="flex flex-column gap-3">
                  <p class="text-600 m-0">
                    Automatically encode uploaded files and start batch encoding.
                  </p>
                  
                  <p-button 
                    label="Start Batch Encoding"
                    icon="pi pi-cog"
                    [loading]="batchEncodingLoading"
                    (onClick)="startBatchEncoding()"
                    styleClass="w-full"></p-button>
                  
                  <div class="field">
                    <div class="flex align-items-center">
                      <p-toggleButton 
                        [(ngModel)]="autoEncodingEnabled"
                        onLabel="Auto-Encode ON" 
                        offLabel="Auto-Encode OFF"
                        (onChange)="toggleAutoEncoding()"
                        [disabled]="configLoading"
                        styleClass="w-full"></p-toggleButton>
                    </div>
                    <small class="text-600">Automatically encode new uploaded files</small>
                  </div>
                  
                  <div *ngIf="importStatus" class="import-status text-sm">
                    <div class="flex justify-content-between">
                      <span>Monitoring:</span>
                      <p-tag [value]="importStatus.monitoring ? 'Active' : 'Stopped'" 
                             [severity]="importStatus.monitoring ? 'success' : 'danger'"></p-tag>
                    </div>
                  </div>
                </div>
              </p-card>
            </div>
          </div>
        </p-panel>

        <!-- File Statistics -->
        <div class="grid mb-4">
          <div class="col-12 md:col-3">
            <p-card styleClass="text-center">
              <div class="text-2xl font-bold text-primary">{{ stats.total }}</div>
              <div class="text-600">Total Files</div>
            </p-card>
          </div>
          <div class="col-12 md:col-3">
            <p-card styleClass="text-center">
              <div class="text-2xl font-bold text-green-500">{{ stats.byStatus.completed }}</div>
              <div class="text-600">Encoded</div>
            </p-card>
          </div>
          <div class="col-12 md:col-3">
            <p-card styleClass="text-center">
              <div class="text-2xl font-bold text-blue-500">{{ stats.byStatus.encoding }}</div>
              <div class="text-600">Encoding</div>
            </p-card>
          </div>
          <div class="col-12 md:col-3">
            <p-card styleClass="text-center">
              <div class="text-2xl font-bold text-orange-500">{{ stats.byStatus.uploaded }}</div>
              <div class="text-600">Pending</div>
            </p-card>
          </div>
        </div>

        <!-- Files Table -->
        <p-table [value]="files" 
                 [loading]="loading"
                 [paginator]="true"
                 [rows]="20"
                 [totalRecords]="totalRecords"
                 [lazy]="true"
                 (onLazyLoad)="loadFiles($event)"
                 [sortField]="'uploadDate'"
                 [sortOrder]="-1"
                 responsiveLayout="scroll"
                 [tableStyle]="{'min-width': '80rem'}"
                 styleClass="p-datatable-sm">
          
          <ng-template pTemplate="header">
            <tr>
              <th style="width: 3rem"></th>
              <th pSortableColumn="originalName">File Name <p-sortIcon field="originalName"></p-sortIcon></th>
              <th pSortableColumn="status">Status <p-sortIcon field="status"></p-sortIcon></th>
              <th style="width: 10rem">Progress</th>
              <th pSortableColumn="size">Size <p-sortIcon field="size"></p-sortIcon></th>
              <th pSortableColumn="metadata.duration">Duration <p-sortIcon field="metadata.duration"></p-sortIcon></th>
              <th pSortableColumn="uploadDate">Upload Date <p-sortIcon field="uploadDate"></p-sortIcon></th>
              <th style="width: 12rem">Actions</th>
            </tr>
          </ng-template>
          
          <ng-template pTemplate="body" let-file let-index="rowIndex">
            <tr>
              <!-- Row Number -->
              <td>{{ index + 1 }}</td>
              
              <!-- File Name with Metadata -->
              <td>
                <div class="flex flex-column">
                  <div class="font-medium">{{ file.originalName }}</div>
                  <div *ngIf="file.metadata.title" class="text-sm text-600">
                    <i class="pi pi-music mr-1"></i>
                    {{ file.metadata.title }}
                    <span *ngIf="file.metadata.artist"> - {{ file.metadata.artist }}</span>
                  </div>
                </div>
              </td>
              
              <!-- Status -->
              <td>
                <p-tag [value]="file.status | titlecase" 
                       [severity]="getStatusSeverity(file.status)"
                       [icon]="getStatusIcon(file.status)"></p-tag>
              </td>
              
              <!-- Progress -->
              <td>
                <div *ngIf="file.status === 'encoding'" class="flex flex-column gap-1">
                  <p-progressBar [value]="file.progress" 
                                [showValue]="false"
                                styleClass="h-0-5rem"></p-progressBar>
                  <small class="text-center">{{ file.progress }}%</small>
                </div>
                <div *ngIf="file.status !== 'encoding'" class="text-center text-600">
                  {{ file.status === 'completed' ? '100%' : '--' }}
                </div>
              </td>
              
              <!-- Size -->
              <td>{{ formatFileSize(file.size) }}</td>
              
              <!-- Duration -->
              <td>{{ formatDuration(file.metadata.duration) }}</td>
              
              <!-- Upload Date -->
              <td>{{ formatDate(file.uploadDate) }}</td>
              
              <!-- Actions -->
              <td>
                <div class="flex gap-1">
                  <!-- Encode Button -->
                  <p-button *ngIf="file.status === 'uploaded'" 
                           icon="pi pi-play" 
                           size="small"
                           severity="success"
                           [text]="true"
                           pTooltip="Start Encoding"
                           (onClick)="encodeFile(file)"></p-button>
                  
                  <!-- Retry Button -->
                  <p-button *ngIf="file.status === 'failed'" 
                           icon="pi pi-refresh" 
                           size="small"
                           severity="warn"
                           [text]="true"
                           pTooltip="Retry Encoding"
                           (onClick)="retryEncoding(file)"></p-button>
                  
                  <!-- Cancel Button -->
                  <p-button *ngIf="file.status === 'encoding'" 
                           icon="pi pi-stop" 
                           size="small"
                           severity="danger"
                           [text]="true"
                           pTooltip="Cancel Encoding"
                           (onClick)="cancelEncoding(file)"></p-button>
                  
                  <!-- Download Button -->
                  <p-button *ngIf="file.status === 'completed'" 
                           icon="pi pi-download" 
                           size="small"
                           severity="info"
                           [text]="true"
                           pTooltip="Download Encoded File"
                           (onClick)="downloadFile(file)"></p-button>
                  
                  <!-- Details Button -->
                  <p-button icon="pi pi-info-circle" 
                           size="small"
                           severity="secondary"
                           [text]="true"
                           pTooltip="View Details"
                           (onClick)="showFileDetails(file)"></p-button>
                  
                  <!-- Delete Button -->
                  <p-button icon="pi pi-trash" 
                           size="small"
                           severity="danger"
                           [text]="true"
                           pTooltip="Delete File"
                           (onClick)="confirmDelete(file)"></p-button>
                </div>
              </td>
            </tr>
          </ng-template>
          
          <ng-template pTemplate="emptymessage">
            <tr>
              <td colspan="8" class="text-center p-4">
                <div class="flex flex-column align-items-center gap-2">
                  <i class="pi pi-file text-4xl text-400"></i>
                  <div class="text-xl">No files found</div>
                  <div class="text-600">Upload some audio files to get started</div>
                </div>
              </td>
            </tr>
          </ng-template>
        </p-table>
      </p-card>
    </div>

    <!-- File Details Dialog -->
    <app-file-details-dialog 
      [(visible)]="showDetailsDialog"
      [file]="selectedFile"
      (onClose)="onDetailsDialogClose()">
    </app-file-details-dialog>
  `,
  styles: [`
    .file-list-container {
      width: 100%;
    }

    ::ng-deep .p-datatable .p-datatable-tbody > tr > td {
      padding: 0.75rem 0.5rem;
    }

    ::ng-deep .p-progressbar {
      height: 0.5rem;
    }

    ::ng-deep .p-toolbar {
      border: 1px solid var(--surface-d);
      border-radius: var(--border-radius);
      background: var(--surface-a);
    }

    .p-toolbar-group-end {
      display: flex;
      align-items: center;
      gap: 0.5rem;
    }

    .field {
      margin-bottom: 1rem;
    }

    .import-status {
      padding: 0.5rem;
      background: var(--surface-100);
      border-radius: var(--border-radius);
    }
  `]
})
export class FileListComponent implements OnInit, OnDestroy {
  files: AudioFile[] = [];
  loading = false;
  totalRecords = 0;
  
  // Filters
  searchTerm = '';
  selectedStatus: FileStatus | null = null;
  
  // Import & Encoding Controls
  importLoading = false;
  batchEncodingLoading = false;
  configLoading = false;
  autoImportEnabled = false;
  autoEncodingEnabled = false;
  monitoringIntervalHours = 1;
  importStatus: any = null;
  
  // Statistics
  stats = {
    total: 0,
    byStatus: {
      uploaded: 0,
      encoding: 0,
      completed: 0,
      failed: 0
    }
  };

  // Dialog
  showDetailsDialog = false;
  selectedFile: AudioFile | null = null;

  // Options
  statusOptions = [
    { label: 'Uploaded', value: 'uploaded' },
    { label: 'Encoding', value: 'encoding' },
    { label: 'Completed', value: 'completed' },
    { label: 'Failed', value: 'failed' }
  ];

  private subscriptions: Subscription[] = [];
  private searchTimeout: any;

  constructor(
    private fileService: FileService,
    private socketService: SocketService,
    private notificationService: NotificationService,
    private confirmationService: ConfirmationService
  ) {}

  ngOnInit() {
    this.setupSocketListeners();
    this.loadFiles();
    this.updateStats();
    this.loadImportConfig();
    this.loadImportStatus();
  }

  ngOnDestroy() {
    this.subscriptions.forEach(sub => sub.unsubscribe());
    if (this.searchTimeout) {
      clearTimeout(this.searchTimeout);
    }
  }

  setupSocketListeners() {
    // Listen to real-time updates
    this.subscriptions.push(
      this.socketService.onEncodingProgress().subscribe(event => {
        this.updateFileProgress(event.fileId, event.progress);
      }),

      this.socketService.onEncodingCompleted().subscribe(event => {
        this.updateFileStatus(event.fileId, 'completed', 100);
        this.refreshFiles();
      }),

      this.socketService.onEncodingFailed().subscribe(event => {
        this.updateFileStatus(event.fileId, 'failed', 0);
        this.refreshFiles();
      }),

      this.socketService.onEncodingCancelled().subscribe(event => {
        this.updateFileStatus(event.fileId, 'uploaded', 0);
      }),

      this.socketService.onFilesUploaded().subscribe(() => {
        this.refreshFiles();
      }),

      this.socketService.onFileDeleted().subscribe(event => {
        this.removeFileFromList(event.fileId);
        this.updateStats();
      })
    );
  }

  loadFiles(event?: any) {
    this.loading = true;
    
    const filter: FileFilter = {
      limit: event?.rows || 20,
      offset: event?.first || 0
    };

    if (this.searchTerm.trim()) {
      filter.search = this.searchTerm.trim();
    }

    if (this.selectedStatus) {
      filter.status = this.selectedStatus;
    }

    this.fileService.getFiles(filter).subscribe({
      next: (response) => {
        this.files = response.files;
        this.totalRecords = response.pagination.total;
        this.loading = false;
        this.updateStats();
      },
      error: (error) => {
        this.notificationService.showError('Failed to load files', error.message);
        this.loading = false;
      }
    });
  }

  refreshFiles() {
    this.loadFiles();
  }

  onSearchChange() {
    if (this.searchTimeout) {
      clearTimeout(this.searchTimeout);
    }
    
    this.searchTimeout = setTimeout(() => {
      this.loadFiles();
    }, 500);
  }

  onStatusFilterChange() {
    this.loadFiles();
  }

  encodeFile(file: AudioFile) {
    this.fileService.encodeFile(file.id).subscribe({
      next: () => {
        this.notificationService.showInfo(`Encoding started for: ${file.originalName}`);
        this.updateFileStatus(file.id, 'encoding', 0);
      },
      error: (error) => {
        this.notificationService.showError('Failed to start encoding', error.message);
      }
    });
  }

  retryEncoding(file: AudioFile) {
    this.fileService.retryEncoding(file.id).subscribe({
      next: () => {
        this.notificationService.showInfo(`Retry encoding started for: ${file.originalName}`);
        this.updateFileStatus(file.id, 'encoding', 0);
      },
      error: (error) => {
        this.notificationService.showError('Failed to retry encoding', error.message);
      }
    });
  }

  cancelEncoding(file: AudioFile) {
    this.confirmationService.confirm({
      message: `Are you sure you want to cancel encoding for "${file.originalName}"?`,
      header: 'Cancel Encoding',
      icon: 'pi pi-exclamation-triangle',
      accept: () => {
        this.fileService.cancelEncoding(file.id).subscribe({
          next: () => {
            this.notificationService.showInfo(`Encoding cancelled for: ${file.originalName}`);
          },
          error: (error) => {
            this.notificationService.showError('Failed to cancel encoding', error.message);
          }
        });
      }
    });
  }

  downloadFile(file: AudioFile) {
    this.fileService.downloadFile(file.id).subscribe({
      next: (blob) => {
        const url = window.URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = `${file.originalName.replace(/\.[^/.]+$/, '')}.opus`;
        link.click();
        window.URL.revokeObjectURL(url);
        
        this.notificationService.showSuccess(`Downloaded: ${file.originalName}`);
      },
      error: (error) => {
        this.notificationService.showError('Failed to download file', error.message);
      }
    });
  }

  showFileDetails(file: AudioFile) {
    this.selectedFile = file;
    this.showDetailsDialog = true;
  }

  onDetailsDialogClose() {
    this.selectedFile = null;
    this.showDetailsDialog = false;
  }

  confirmDelete(file: AudioFile) {
    this.confirmationService.confirm({
      message: `Are you sure you want to delete "${file.originalName}"? This action cannot be undone.`,
      header: 'Delete File',
      icon: 'pi pi-exclamation-triangle',
      acceptButtonStyleClass: 'p-button-danger',
      accept: () => {
        this.deleteFile(file);
      }
    });
  }

  deleteFile(file: AudioFile) {
    this.fileService.deleteFile(file.id).subscribe({
      next: () => {
        this.notificationService.showDeleteSuccess(file.originalName);
        this.removeFileFromList(file.id);
        this.updateStats();
      },
      error: (error) => {
        this.notificationService.showError('Failed to delete file', error.message);
      }
    });
  }

  // Import & Encoding Methods

  /**
   * Load import configuration
   */
  loadImportConfig() {
    this.configLoading = true;
    
    this.fileService.getImportConfig().subscribe({
      next: (response) => {
        if (response.success) {
          this.autoImportEnabled = response.config.autoImportEnabled || false;
          this.autoEncodingEnabled = response.config.autoEncodingEnabled || false;
          this.monitoringIntervalHours = Math.floor((response.config.monitoringInterval || 3600000) / 3600000);
        }
        this.configLoading = false;
      },
      error: (error) => {
        this.notificationService.showError('Failed to load import configuration', error.message);
        this.configLoading = false;
      }
    });
  }

  /**
   * Load import service status
   */
  loadImportStatus() {
    this.fileService.getImportStatus().subscribe({
      next: (response) => {
        if (response.success) {
          this.importStatus = response.status;
        }
      },
      error: (error) => {
        console.error('Failed to load import status:', error);
      }
    });
  }

  /**
   * Manual import files from directory
   */
  importFiles() {
    this.importLoading = true;
    
    this.fileService.importFiles().subscribe({
      next: (response) => {
        this.importLoading = false;
        
        if (response.success) {
          const results = response.results;
          this.notificationService.showSuccess(
            `Import completed: ${results.imported} files imported, ${results.skipped} skipped`
          );
          this.refreshFiles();
        } else {
          this.notificationService.showError('Import failed', response.message);
        }
      },
      error: (error) => {
        this.importLoading = false;
        this.notificationService.showError('Import failed', error.message);
      }
    });
  }

  /**
   * Toggle auto-import
   */
  toggleAutoImport() {
    this.configLoading = true;
    
    const config = { autoImportEnabled: this.autoImportEnabled };
    
    this.fileService.updateImportConfig(config).subscribe({
      next: (response) => {
        this.configLoading = false;
        
        if (response.success) {
          this.notificationService.showSuccess(
            `Auto-import ${this.autoImportEnabled ? 'enabled' : 'disabled'}`
          );
          this.loadImportStatus();
        } else {
          this.autoImportEnabled = !this.autoImportEnabled; // Revert
          this.notificationService.showError('Failed to update configuration', response.message);
        }
      },
      error: (error) => {
        this.configLoading = false;
        this.autoImportEnabled = !this.autoImportEnabled; // Revert
        this.notificationService.showError('Failed to update configuration', error.message);
      }
    });
  }

  /**
   * Toggle auto-encoding
   */
  toggleAutoEncoding() {
    this.configLoading = true;
    
    const config = { autoEncodingEnabled: this.autoEncodingEnabled };
    
    this.fileService.updateImportConfig(config).subscribe({
      next: (response) => {
        this.configLoading = false;
        
        if (response.success) {
          this.notificationService.showSuccess(
            `Auto-encoding ${this.autoEncodingEnabled ? 'enabled' : 'disabled'}`
          );
        } else {
          this.autoEncodingEnabled = !this.autoEncodingEnabled; // Revert
          this.notificationService.showError('Failed to update configuration', response.message);
        }
      },
      error: (error) => {
        this.configLoading = false;
        this.autoEncodingEnabled = !this.autoEncodingEnabled; // Revert
        this.notificationService.showError('Failed to update configuration', error.message);
      }
    });
  }

  /**
   * Update monitoring interval
   */
  updateMonitoringInterval() {
    if (this.monitoringIntervalHours < 1 || this.monitoringIntervalHours > 24) {
      this.notificationService.showError('Monitoring interval must be between 1 and 24 hours');
      return;
    }
    
    this.configLoading = true;
    
    const config = { 
      monitoringInterval: this.monitoringIntervalHours * 3600000 // Convert to milliseconds
    };
    
    this.fileService.updateImportConfig(config).subscribe({
      next: (response) => {
        this.configLoading = false;
        
        if (response.success) {
          this.notificationService.showSuccess('Monitoring interval updated');
        } else {
          this.notificationService.showError('Failed to update interval', response.message);
        }
      },
      error: (error) => {
        this.configLoading = false;
        this.notificationService.showError('Failed to update interval', error.message);
      }
    });
  }

  /**
   * Start batch encoding
   */
  startBatchEncoding() {
    this.batchEncodingLoading = true;
    
    this.fileService.triggerBatchEncoding().subscribe({
      next: (response) => {
        this.batchEncodingLoading = false;
        
        if (response.success) {
          this.notificationService.showSuccess(response.message);
          this.refreshFiles();
        } else {
          this.notificationService.showError('Batch encoding failed', response.message);
        }
      },
      error: (error) => {
        this.batchEncodingLoading = false;
        this.notificationService.showError('Batch encoding failed', error.message);
      }
    });
  }

  // Helper methods
  updateFileProgress(fileId: string, progress: number) {
    const file = this.files.find(f => f.id === fileId);
    if (file) {
      file.progress = progress;
    }
  }

  updateFileStatus(fileId: string, status: FileStatus, progress: number) {
    const file = this.files.find(f => f.id === fileId);
    if (file) {
      file.status = status;
      file.progress = progress;
    }
  }

  removeFileFromList(fileId: string) {
    this.files = this.files.filter(f => f.id !== fileId);
  }

  updateStats() {
    this.stats.total = this.files.length;
    this.stats.byStatus = {
      uploaded: this.files.filter(f => f.status === 'uploaded').length,
      encoding: this.files.filter(f => f.status === 'encoding').length,
      completed: this.files.filter(f => f.status === 'completed').length,
      failed: this.files.filter(f => f.status === 'failed').length
    };
  }

  formatFileSize(bytes: number): string {
    return this.fileService.formatFileSize(bytes);
  }

  formatDuration(seconds: number | undefined): string {
    return this.fileService.formatDuration(seconds || 0);
  }

  formatDate(dateString: string): string {
    return new Date(dateString).toLocaleDateString() + ' ' + 
           new Date(dateString).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }

  getStatusSeverity(status: string): any {
    return this.fileService.getStatusSeverity(status);
  }

  getStatusIcon(status: string): string {
    return this.fileService.getStatusIcon(status);
  }
}