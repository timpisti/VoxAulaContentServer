// src/app/components/system-dashboard/system-dashboard.component.ts
import { Component, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { Subscription, interval, firstValueFrom } from 'rxjs';

// PrimeNG Imports
import { ButtonModule } from 'primeng/button';
import { CardModule } from 'primeng/card';
import { TagModule } from 'primeng/tag';
import { ProgressBarModule } from 'primeng/progressbar';
import { BadgeModule } from 'primeng/badge';
import { ToolbarModule } from 'primeng/toolbar';
import { DropdownModule } from 'primeng/dropdown';
import { ProgressSpinnerModule } from 'primeng/progressspinner';

import { SystemService } from '../../services/system.service';
import { FileService } from '../../services/file.service';
import { NotificationService } from '../../services/notification.service';
import { SocketService } from '../../services/socket.service';
import { 
  SystemStatus, 
  SystemStats, 
  SystemConfig, 
  SystemLogEntry 
} from '../../models/system.model';

@Component({
  selector: 'app-system-dashboard',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    ButtonModule,
    CardModule,
    TagModule,
    ProgressBarModule,
    BadgeModule,
    ToolbarModule,
    DropdownModule,
    ProgressSpinnerModule
  ],
  template: `
    <div class="system-dashboard">
      <div class="grid">
        <!-- Header -->
        <div class="col-12">
          <p-card header="System Dashboard" styleClass="mb-4">
            <div class="flex justify-content-between align-items-center">
              <div class="text-600">
                Monitor system health, performance metrics, and processing status
              </div>
              
              <div class="flex gap-2">
                <p-button label="Refresh" 
                         icon="pi pi-refresh"
                         severity="secondary"
                         [loading]="refreshing"
                         (onClick)="refreshAll()"></p-button>
                
                <p-button label="Create Backup" 
                         icon="pi pi-save"
                         severity="info"
                         (onClick)="createBackup()"></p-button>
              </div>
            </div>
          </p-card>
        </div>

        <!-- System Status Cards -->
        <div class="col-12 lg:col-4">
          <p-card header="System Health" styleClass="h-full">
            <div *ngIf="systemStatus" class="flex flex-column gap-3">
              <div class="flex align-items-center justify-content-between">
                <span>Status</span>
                <p-tag [value]="systemStatus.status" 
                       [severity]="systemStatus.status === 'healthy' ? 'success' : 'danger'"
                       [icon]="systemStatus.status === 'healthy' ? 'pi pi-check' : 'pi pi-times'"></p-tag>
              </div>
              
              <div class="flex align-items-center justify-content-between">
                <span>Uptime</span>
                <span class="font-medium">{{ formatUptime(systemStatus.system.uptime) }}</span>
              </div>
              
              <div class="flex align-items-center justify-content-between">
                <span>Platform</span>
                <span class="font-medium">{{ systemStatus.system.platform }}</span>
              </div>
              
              <div class="flex align-items-center justify-content-between">
                <span>Node.js</span>
                <span class="font-medium">{{ systemStatus.system.nodeVersion }}</span>
              </div>
              
              <div class="flex align-items-center justify-content-between">
                <span>Socket Status</span>
                <p-tag [value]="socketConnected ? 'Connected' : 'Disconnected'" 
                       [severity]="socketConnected ? 'success' : 'danger'"
                       [icon]="socketConnected ? 'pi pi-check' : 'pi pi-times'"></p-tag>
              </div>
            </div>
            
            <div *ngIf="!systemStatus && !loading" class="text-center text-600">
              <i class="pi pi-exclamation-triangle text-orange-500 text-2xl mb-2"></i>
              <div>Unable to load system status</div>
            </div>
          </p-card>
        </div>

        <!-- Memory Usage -->
        <div class="col-12 lg:col-4">
          <p-card header="Memory Usage" styleClass="h-full">
            <div *ngIf="systemStatus" class="flex flex-column gap-3">
              <div>
                <div class="flex justify-content-between mb-2">
                  <span>Heap Used</span>
                  <span class="font-medium">{{ formatMemory(systemStatus.system.memory.heapUsed) }}</span>
                </div>
                <p-progressBar [value]="getMemoryUsagePercentage(systemStatus.system.memory.heapUsed, systemStatus.system.memory.heapTotal)"></p-progressBar>
              </div>
              
              <div>
                <div class="flex justify-content-between mb-2">
                  <span>RSS</span>
                  <span class="font-medium">{{ formatMemory(systemStatus.system.memory.rss) }}</span>
                </div>
              </div>
              
              <div>
                <div class="flex justify-content-between mb-2">
                  <span>External</span>
                  <span class="font-medium">{{ formatMemory(systemStatus.system.memory.external) }}</span>
                </div>
              </div>
            </div>
          </p-card>
        </div>

        <!-- Encoding Status -->
        <div class="col-12 lg:col-4">
          <p-card header="Encoding Status" styleClass="h-full">
            <div *ngIf="systemStatus" class="flex flex-column gap-3">
              <div class="flex align-items-center justify-content-between">
                <span>Active Jobs</span>
                <p-badge [value]="systemStatus.encoding.activeJobs" 
                         [severity]="systemStatus.encoding.activeJobs > 0 ? 'info' : 'secondary'"></p-badge>
              </div>
              
              <div class="flex align-items-center justify-content-between">
                <span>Max Concurrent</span>
                <span class="font-medium">{{ systemStatus.encoding.maxConcurrent }}</span>
              </div>
              
              <div *ngIf="systemStatus.encoding.jobs.length > 0">
                <div class="text-sm font-semibold mb-2">Active Jobs:</div>
                <div *ngFor="let job of systemStatus.encoding.jobs" 
                     class="text-sm p-2 bg-blue-50 border-round mb-1">
                  <div class="font-medium">{{ getFileNameFromPath(job.inputPath) }}</div>
                  <div class="text-600">Duration: {{ formatDuration(job.duration / 1000) }}</div>
                </div>
              </div>
            </div>
          </p-card>
        </div>

        <!-- File Statistics -->
        <div class="col-12 lg:col-8">
          <p-card header="File Statistics" styleClass="mb-4">
            <div *ngIf="systemStats" class="grid">
              <div class="col-6 lg:col-3 text-center">
                <div class="text-2xl font-bold text-primary">{{ systemStats.totalFiles }}</div>
                <div class="text-600">Total Files</div>
              </div>
              
              <div class="col-6 lg:col-3 text-center">
                <div class="text-2xl font-bold text-green-500">{{ systemStats.totalEncoded }}</div>
                <div class="text-600">Encoded</div>
              </div>
              
              <div class="col-6 lg:col-3 text-center">
                <div class="text-2xl font-bold text-red-500">{{ systemStats.totalFailed }}</div>
                <div class="text-600">Failed</div>
              </div>
              
              <div class="col-6 lg:col-3 text-center">
                <div class="text-2xl font-bold text-blue-500">{{ systemStats.currentStatus.encoding }}</div>
                <div class="text-600">Encoding</div>
              </div>
              
              <div class="col-6 lg:col-3 text-center">
                <div class="text-xl font-bold text-orange-500">{{ systemStats.recent.uploaded24h }}</div>
                <div class="text-600 text-sm">Uploaded (24h)</div>
              </div>
              
              <div class="col-6 lg:col-3 text-center">
                <div class="text-xl font-bold text-teal-500">{{ systemStats.recent.encoded24h }}</div>
                <div class="text-600 text-sm">Encoded (24h)</div>
              </div>
              
              <div class="col-6 lg:col-3 text-center">
                <div class="text-xl font-bold text-purple-500">{{ formatFileSize(systemStats.totalSize) }}</div>
                <div class="text-600 text-sm">Total Size</div>
              </div>
              
              <div class="col-6 lg:col-3 text-center">
                <div class="text-xl font-bold text-indigo-500">{{ systemStats.currentStatus.pending }}</div>
                <div class="text-600 text-sm">Pending</div>
              </div>
            </div>
          </p-card>
        </div>

        <!-- Directory Status -->
        <div class="col-12 lg:col-4">
          <p-card header="Directory Status" styleClass="mb-4">
            <div *ngIf="systemStatus" class="flex flex-column gap-2">
              <div *ngFor="let dir of getDirectoryEntries(systemStatus.directories)" 
                   class="flex align-items-center justify-content-between p-2 border-round"
                   [class]="getDirectoryStatusClass(dir.status)">
                <div>
                  <div class="font-medium">{{ dir.name | titlecase }}</div>
                  <div class="text-sm text-600">{{ dir.status.path }}</div>
                </div>
                <i class="pi" 
                   [class]="dir.status.exists && dir.status.writable ? 'pi-check-circle text-green-500' : 'pi-times-circle text-red-500'"></i>
              </div>
            </div>
          </p-card>
        </div>

        <!-- System Logs -->
        <div class="col-12">
          <p-card header="System Logs" styleClass="mb-4">
            <p-toolbar styleClass="mb-3">
              <div class="p-toolbar-group-start">
                <p-dropdown [options]="logLevelOptions"
                           [(ngModel)]="selectedLogLevel"
                           (onChange)="loadLogs()"
                           placeholder="Log Level"></p-dropdown>
              </div>
              
              <div class="p-toolbar-group-end">
                <p-button label="Refresh Logs" 
                         icon="pi pi-refresh"
                         severity="secondary"
                         [loading]="logsLoading"
                         (onClick)="loadLogs()"></p-button>
              </div>
            </p-toolbar>

            <div class="logs-container" style="max-height: 400px; overflow-y: auto;">
              <div *ngIf="logsLoading" class="text-center p-4">
                <p-progressSpinner [style]="{width: '30px', height: '30px'}"></p-progressSpinner>
                <div class="mt-2">Loading logs...</div>
              </div>

              <div *ngIf="!logsLoading && logs.length === 0" class="text-center text-600 p-4">
                No logs available
              </div>

              <div *ngIf="!logsLoading && logs.length > 0">
                <div *ngFor="let log of logs; trackBy: trackByLog" 
                     class="log-entry p-2 border-bottom-1 surface-border">
                  <div class="flex align-items-start gap-2">
                    <i class="pi mt-1" 
                       [class]="getLogLevelIcon(log.level)"
                       [style.color]="getLogLevelColor(log.level)"></i>
                    
                    <div class="flex-1">
                      <div class="flex justify-content-between align-items-start mb-1">
                        <span class="font-medium">{{ log.message }}</span>
                        <small class="text-600">{{ formatDate(log.timestamp) }}</small>
                      </div>
                      
                      <div class="text-sm text-600">
                        Service: {{ log.service || 'system' }}
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </p-card>
        </div>
      </div>
    </div>
  `,
  styles: [`
    .system-dashboard {
      width: 100%;
    }

    .log-entry:hover {
      background-color: var(--surface-100);
    }

    ::ng-deep .p-progressbar {
      height: 0.5rem;
    }

    ::ng-deep .p-card .p-card-content {
      padding: 1.5rem;
    }

    .directory-status-ok {
      background-color: var(--green-50);
      border: 1px solid var(--green-200);
    }

    .directory-status-error {
      background-color: var(--red-50);
      border: 1px solid var(--red-200);
    }
  `]
})
export class SystemDashboardComponent implements OnInit, OnDestroy {
  systemStatus: SystemStatus | null = null;
  systemStats: SystemStats | null = null;
  systemConfig: SystemConfig | null = null;
  logs: SystemLogEntry[] = [];
  
  loading = false;
  refreshing = false;
  logsLoading = false;
  socketConnected = false;
  
  selectedLogLevel = 'info';
  logLevelOptions = [
    { label: 'All Levels', value: 'all' },
    { label: 'Debug', value: 'debug' },
    { label: 'Info', value: 'info' },
    { label: 'Warning', value: 'warn' },
    { label: 'Error', value: 'error' }
  ];

  private subscriptions: Subscription[] = [];
  private refreshInterval: Subscription | null = null;

  constructor(
    private systemService: SystemService,
    private fileService: FileService,
    private notificationService: NotificationService,
    private socketService: SocketService,
    private router: Router
  ) {}

  ngOnInit() {
    this.loadAllData();
    this.setupAutoRefresh();
    this.setupSocketListeners();
  }

  ngOnDestroy() {
    this.subscriptions.forEach(sub => sub.unsubscribe());
    if (this.refreshInterval) {
      this.refreshInterval.unsubscribe();
    }
  }

  setupSocketListeners() {
    this.subscriptions.push(
      this.socketService.getConnectionStatus().subscribe(connected => {
        this.socketConnected = connected;
      })
    );
  }

  setupAutoRefresh() {
    // Auto-refresh every 30 seconds
    this.refreshInterval = interval(30000).subscribe(() => {
      this.loadSystemStatus();
      this.loadSystemStats();
    });
  }

  loadAllData() {
    this.loading = true;
    
    Promise.all([
      this.loadSystemStatus(),
      this.loadSystemStats(),
      this.loadSystemConfig(),
      this.loadLogs()
    ]).finally(() => {
      this.loading = false;
    });
  }

  async loadSystemStatus(): Promise<void> {
    try {
      const status = await firstValueFrom(this.systemService.getStatus());
      this.systemStatus = status || null;
    } catch (error) {
      console.error('Failed to load system status:', error);
      this.systemStatus = null;
      // Only show error notification if it's a real network error
      if (error && (error as any).status !== 200) {
        this.notificationService.showError('Failed to load system status');
      }
    }
  }

  async loadSystemStats(): Promise<void> {
    try {
      const response = await firstValueFrom(this.systemService.getStats());
      if (response && response.stats) {
        this.systemStats = response.stats;
      }
    } catch (error) {
      console.error('Failed to load system stats:', error);
      if (error && (error as any).status !== 200) {
        this.notificationService.showError('Failed to load system statistics');
      }
    }
  }

  async loadSystemConfig(): Promise<void> {
    try {
      const response = await firstValueFrom(this.systemService.getConfig());
      if (response && response.config) {
        this.systemConfig = response.config;
      }
    } catch (error) {
      console.error('Failed to load system config:', error);
      if (error && (error as any).status !== 200) {
        this.notificationService.showError('Failed to load system configuration');
      }
    }
  }

  loadLogs() {
    this.logsLoading = true;
    
    this.systemService.getLogs(this.selectedLogLevel, 50).subscribe({
      next: (response) => {
        this.logs = response.logs;
        this.logsLoading = false;
      },
      error: (error) => {
        this.notificationService.showError('Failed to load logs', error.message);
        this.logsLoading = false;
      }
    });
  }

  refreshAll() {
    this.refreshing = true;
    this.loadAllData();
    
    setTimeout(() => {
      this.refreshing = false;
    }, 1000);
  }

  createBackup() {
    this.systemService.createBackup().subscribe({
      next: (response) => {
        this.notificationService.showSuccess('Backup created successfully', response.backupPath);
      },
      error: (error) => {
        this.notificationService.showError('Failed to create backup', error.message);
      }
    });
  }

  // Helper methods
  formatUptime(seconds: number): string {
    return this.systemService.formatUptime(seconds);
  }

  formatMemory(bytes: number): string {
    return this.systemService.formatMemory(bytes);
  }

  formatFileSize(bytes: number): string {
    return this.fileService.formatFileSize(bytes);
  }

  formatDuration(seconds: number): string {
    return this.fileService.formatDuration(seconds);
  }

  formatDate(dateString: string): string {
    return new Date(dateString).toLocaleString();
  }

  getMemoryUsagePercentage(used: number, total: number): number {
    return this.systemService.getMemoryUsagePercentage(used, total);
  }

  getDirectoryEntries(directories: any): Array<{name: string, status: any}> {
    return Object.entries(directories).map(([name, status]) => ({
      name,
      status
    }));
  }

  getDirectoryStatusClass(status: any): string {
    return status.exists && status.writable ? 'directory-status-ok' : 'directory-status-error';
  }

  getFileNameFromPath(path: string): string {
    return path.split(/[\\/]/).pop() || path;
  }

  getLogLevelIcon(level: string): string {
    return this.systemService.getLogLevelIcon(level);
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

  trackByLog(index: number, log: SystemLogEntry): string {
    return log.timestamp + log.message;
  }
}