// src/app/components/radio-dashboard/radio-dashboard.component.ts - FIXED: Complete Janus Integration
import { Component, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Subscription } from 'rxjs';

// PrimeNG Imports
import { ButtonModule } from 'primeng/button';
import { CardModule } from 'primeng/card';
import { TableModule } from 'primeng/table';
import { TagModule } from 'primeng/tag';
import { ProgressBarModule } from 'primeng/progressbar';
import { TooltipModule } from 'primeng/tooltip';
import { InputTextModule } from 'primeng/inputtext';
import { DividerModule } from 'primeng/divider';
import { SkeletonModule } from 'primeng/skeleton';
import { PanelModule } from 'primeng/panel';
import { ToolbarModule } from 'primeng/toolbar';
import { ConfirmationService } from 'primeng/api';

import { RadioService, RadioConfig, RadioStatus } from '../../services/radio.service';
import { FileService } from '../../services/file.service';
import { SocketService } from '../../services/socket.service';
import { NotificationService } from '../../services/notification.service';
import { AudioFile } from '../../models/file.model';

@Component({
  selector: 'app-radio-dashboard',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    ButtonModule,
    CardModule,
    TableModule,
    TagModule,
    ProgressBarModule,
    TooltipModule,
    InputTextModule,
    DividerModule,
    SkeletonModule,
    PanelModule,
    ToolbarModule
  ],
  template: `
    <div class="radio-dashboard">
      <div class="grid">
        <!-- Header Card -->
        <div class="col-12">
          <p-card header="Radio Stream Dashboard" styleClass="mb-4">
            <div class="flex justify-content-between align-items-center">
              <div class="text-600">
                Monitor and control your radio station streaming via Janus AudioBridge
              </div>
              <div class="flex gap-2">
                <p-button 
                  label="Refresh" 
                  icon="pi pi-refresh"
                  severity="secondary"
                  [loading]="loading"
                  (onClick)="refreshAll()"></p-button>
              </div>
            </div>
          </p-card>
        </div>

        <!-- Radio Status -->
        <div class="col-12 lg:col-8">
          <p-card header="Radio Status" styleClass="mb-4" [class]="getStatusCardClass()">
            <div *ngIf="radioStatus; else statusLoading">
              <div class="grid">
                <div class="col-12 md:col-6">
                  <div class="flex flex-column gap-2">
                    <div class="flex align-items-center gap-2">
                      <i [class]="getRadioStatusIcon()" class="text-2xl"></i>
                      <span class="text-xl font-medium">{{ getStatusText() }}</span>
                    </div>
                    
                    <div *ngIf="radioStatus.uptime" class="text-600">
                      <i class="pi pi-clock mr-1"></i>
                      Uptime: {{ formatUptime(radioStatus.uptime) }}
                    </div>
                    
                    <div class="text-600">
                      <i class="pi pi-broadcast mr-1"></i>
                      Target: {{ radioStatus.target }}
                    </div>
                  </div>
                </div>
                
                <div class="col-12 md:col-6">
                  <div *ngIf="radioStatus.currentTrack; else noTrackPlaying">
                    <div class="current-track-info">
                      <div class="font-medium mb-1">Now Playing:</div>
                      <div class="text-lg font-semibold">
                        {{ radioStatus.currentTrack.metadata.title || radioStatus.currentTrack.originalName }}
                      </div>
                      <div *ngIf="radioStatus.currentTrack.metadata?.artist" class="text-600">
                        {{ radioStatus.currentTrack.metadata.artist }}
                      </div>
                      <div class="text-sm text-600 mt-2">
                        Track {{ radioStatus.currentIndex + 1 }} of {{ radioStatus.playlistSize }} • 
                        {{ radioStatus.skipCount || 0 }} skips
                      </div>
                    </div>
                  </div>
                  
                  <ng-template #noTrackPlaying>
                    <div class="text-center text-600">
                      <i class="pi pi-music text-3xl mb-2"></i>
                      <div>No track currently playing</div>
                      <div class="text-sm mt-1">Start the radio to begin streaming</div>
                    </div>
                  </ng-template>
                </div>
              </div>
            </div>

            <ng-template #statusLoading>
              <div class="grid">
                <div class="col-12">
                  <p-skeleton height="3rem" styleClass="mb-2"></p-skeleton>
                  <p-skeleton width="60%" height="1.5rem"></p-skeleton>
                </div>
              </div>
            </ng-template>
          </p-card>
        </div>

        <!-- Radio Controls -->
        <div class="col-12 lg:col-4">
          <p-card header="Controls" styleClass="mb-4">
            <div class="flex flex-column gap-2">
              <p-button 
                [label]="radioStatus?.isRunning ? 'Stop Radio' : 'Start Radio'"
                [icon]="radioStatus?.isRunning ? 'pi pi-stop' : 'pi pi-play'"
                [severity]="radioStatus?.isRunning ? 'danger' : 'success'"
                [loading]="pendingAction === 'toggle'"
                [disabled]="loading || radioStatus?.isStopping"
                (onClick)="toggleRadio()"
                styleClass="w-full"></p-button>
              
              <p-button 
                label="Skip Track"
                icon="pi pi-step-forward"
                severity="secondary"
                [loading]="pendingAction === 'skip'"
                [disabled]="!radioStatus?.isRunning || loading"
                (onClick)="skipTrack()"
                styleClass="w-full"></p-button>
            </div>
          </p-card>
        </div>

        <!-- Playlist Management -->
        <div class="col-12">
          <p-card header="Playlist Management" styleClass="mb-4">
            <p-toolbar styleClass="mb-3">
              <div class="p-toolbar-group-start">
                <p-button 
                  label="Refresh from Files" 
                  icon="pi pi-refresh"
                  severity="secondary"
                  (onClick)="refreshPlaylist()"
                  [loading]="refreshingPlaylist"
                  pTooltip="Load all encoded files into playlist"></p-button>
              </div>
              
              <div class="p-toolbar-group-end">
                <span class="text-600 mr-3">
                  {{ playlist.length }} tracks in playlist
                </span>
                
                <p-button 
                  label="Save Order" 
                  icon="pi pi-save"
                  severity="info"
                  [disabled]="!playlistChanged || loading"
                  (onClick)="savePlaylistOrder()"
                  pTooltip="Save current playlist order"></p-button>
              </div>
            </p-toolbar>

            <!-- Playlist Table -->
            <p-table 
              [value]="playlist" 
              [paginator]="true"
              [rows]="20"
              [loading]="playlistLoading"
              responsiveLayout="scroll"
              [tableStyle]="{'min-width': '60rem'}"
              styleClass="p-datatable-sm">
              
              <ng-template pTemplate="header">
                <tr>
                  <th style="width: 3rem">#</th>
                  <th>Track</th>
                  <th style="width: 10rem">Duration</th>
                  <th style="width: 8rem">Size</th>
                  <th style="width: 10rem">Status</th>
                  <th style="width: 8rem">Actions</th>
                </tr>
              </ng-template>
              
              <ng-template pTemplate="body" let-track let-index="rowIndex">
                <tr [class.currently-playing]="isCurrentlyPlaying(track)">
                  
                  <!-- Position -->
                  <td>
                    <span class="font-medium">{{ index + 1 }}</span>
                    <i *ngIf="isCurrentlyPlaying(track)" 
                       class="pi pi-volume-up text-blue-500 ml-2"
                       pTooltip="Currently playing"></i>
                  </td>
                  
                  <!-- Track Info -->
                  <td>
                    <div class="track-info">
                      <div class="font-medium">
                        {{ track.metadata?.title || track.originalName }}
                      </div>
                      <div class="text-sm text-600" *ngIf="track.metadata?.artist">
                        {{ track.metadata.artist }}
                      </div>
                    </div>
                  </td>
                  
                  <!-- Duration -->
                  <td>
                    <span class="text-600">
                      {{ formatDuration(track.metadata?.duration) }}
                    </span>
                  </td>
                  
                  <!-- File Size -->
                  <td>
                    <span class="text-600">
                      {{ formatFileSize(track.size) }}
                    </span>
                  </td>
                  
                  <!-- Status -->
                  <td>
                    <p-tag [value]="track.status | titlecase" 
                           [severity]="getFileStatusSeverity(track.status)"
                           [icon]="getFileStatusIcon(track.status)"></p-tag>
                  </td>
                  
                  <!-- Actions -->
                  <td>
                    <div class="flex gap-1">
                      <p-button 
                        icon="pi pi-download"
                        severity="info"
                        size="small"
                        [text]="true"
                        pTooltip="Download"
                        (onClick)="downloadTrack(track)"></p-button>
                      
                      <p-button 
                        icon="pi pi-times"
                        severity="danger"
                        size="small"
                        [text]="true"
                        pTooltip="Remove from playlist"
                        (onClick)="removeFromPlaylist(track, index)"></p-button>
                    </div>
                  </td>
                </tr>
              </ng-template>
              
              <ng-template pTemplate="emptymessage">
                <tr>
                  <td colspan="6" class="text-center text-600 p-4">
                    <i class="pi pi-music text-4xl mb-3"></i>
                    <div>No tracks in playlist</div>
                    <div class="text-sm mt-2">
                      Click "Refresh from Files" to load available tracks
                    </div>
                  </td>
                </tr>
              </ng-template>
            </p-table>
          </p-card>
        </div>

        <!-- Janus AudioBridge Configuration -->
        <div class="col-12">
          <p-card header="Janus AudioBridge Configuration" styleClass="mb-4">
            <div *ngIf="radioConfig; else configLoading" class="config-form">
              <div class="grid">
                <div class="col-12 md:col-6">
                  <div class="field">
                    <label for="janusIP" class="block font-medium mb-1">Janus Server IP</label>
                    <input 
                      pInputText 
                      id="janusIP" 
                      [(ngModel)]="radioConfig.janusIP"
                      placeholder="Enter Janus server IP" 
                      class="w-full" />
                  </div>
                </div>
                
                <div class="col-12 md:col-6">
                  <div class="field">
                    <label for="janusPort" class="block font-medium mb-1">Janus HTTP Port</label>
                    <input 
                      pInputText 
                      id="janusPort" 
                      [(ngModel)]="radioConfig.janusPort"
                      placeholder="Enter Janus HTTP port (default: 8088)" 
                      class="w-full" />
                  </div>
                </div>
                
                <div class="col-12 md:col-6">
                  <div class="field">
                    <label for="janusRoomId" class="block font-medium mb-1">AudioBridge Room ID</label>
                    <input 
                      pInputText 
                      id="janusRoomId" 
                      [(ngModel)]="radioConfig.janusRoomId"
                      placeholder="Enter room ID" 
                      class="w-full" />
                  </div>
                </div>
                
                <div class="col-12 md:col-6">
                  <div class="field">
                    <label for="janusParticipantName" class="block font-medium mb-1">Participant Display Name</label>
                    <input 
                      pInputText 
                      id="janusParticipantName" 
                      [(ngModel)]="radioConfig.janusParticipantName"
                      placeholder="Enter display name" 
                      class="w-full" />
                  </div>
                </div>
                
                <div class="col-12 md:col-6">
                  <div class="field">
                    <label for="janusRoomSecret" class="block font-medium mb-1">Room Secret (Optional)</label>
                    <input 
                      pInputText 
                      id="janusRoomSecret" 
                      [(ngModel)]="radioConfig.janusRoomSecret"
                      placeholder="Enter room secret if required" 
                      type="password"
                      class="w-full" />
                  </div>
                </div>
                
                <div class="col-12 md:col-6">
                  <div class="field">
                    <label for="janusRoomPin" class="block font-medium mb-1">Room PIN (Optional)</label>
                    <input 
                      pInputText 
                      id="janusRoomPin" 
                      [(ngModel)]="radioConfig.janusRoomPin"
                      placeholder="Enter room PIN if required" 
                      type="password"
                      class="w-full" />
                  </div>
                </div>
                
                <div class="col-12">
                  <div class="flex gap-2">
                    <p-button 
                      label="Save Configuration"
                      icon="pi pi-save"
                      severity="primary"
                      [loading]="pendingAction === 'saveConfig'"
                      (onClick)="saveConfiguration()"></p-button>
                    
                    <p-button 
                      label="Test Janus Connection"
                      icon="pi pi-globe"
                      severity="secondary"
                      [loading]="pendingAction === 'testConnection'"
                      (onClick)="testConnection()"></p-button>
                  </div>
                </div>
              </div>
            </div>

            <ng-template #configLoading>
              <div class="config-placeholder">
                <div class="grid">
                  <div class="col-12 md:col-6">
                    <div class="field">
                      <p-skeleton height="1rem" width="6rem" styleClass="mb-2"></p-skeleton>
                      <p-skeleton height="2.5rem"></p-skeleton>
                    </div>
                  </div>
                  <div class="col-12 md:col-6">
                    <div class="field">
                      <p-skeleton height="1rem" width="6rem" styleClass="mb-2"></p-skeleton>
                      <p-skeleton height="2.5rem"></p-skeleton>
                    </div>
                  </div>
                </div>
              </div>
            </ng-template>
          </p-card>
        </div>
      </div>
    </div>
  `,
  styles: [`
    .currently-playing {
      background: var(--blue-50);
      border-left: 3px solid var(--blue-500);
    }

    .track-info {
      max-width: 300px;
    }

    .track-info div {
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .status-running {
      border-top: 3px solid var(--green-500);
    }

    .status-stopped {
      border-top: 3px solid var(--red-500);
    }

    .status-loading {
      border-top: 3px solid var(--orange-500);
    }

    .current-track-info {
      padding: 1rem;
      background: var(--surface-a);
      border-radius: var(--border-radius);
      border: 1px solid var(--surface-d);
    }

    .config-form {
      background: var(--surface-a);
    }

    .config-placeholder .field {
      margin-bottom: 1rem;
    }
  `]
})
export class RadioDashboardComponent implements OnInit, OnDestroy {
  radioStatus: RadioStatus | null = null;
  radioConfig: RadioConfig | null = null;
  playlist: AudioFile[] = [];
  
  loading = false;
  playlistLoading = false;
  refreshingPlaylist = false;
  playlistChanged = false;
  pendingAction: string | null = null;

  private subscriptions: Subscription[] = [];

  constructor(
    private radioService: RadioService,
    private fileService: FileService,
    private socketService: SocketService,
    private notificationService: NotificationService,
    private confirmationService: ConfirmationService
  ) {}

  ngOnInit() {
    this.loadRadioStatus();
    this.loadRadioConfig();
    this.loadPlaylist();
    this.setupSocketListeners();
  }

  ngOnDestroy() {
    this.subscriptions.forEach(sub => sub.unsubscribe());
  }

  setupSocketListeners() {
    // Subscribe to radio updates
    this.socketService.subscribeToRadioUpdates();

    // Listen to radio events
    this.subscriptions.push(
      this.socketService.onEvent('radio-started').subscribe(() => {
        this.loadRadioStatus();
        this.notificationService.showSuccess('Radio started successfully');
      }),

      this.socketService.onEvent('radio-stopped').subscribe(() => {
        this.loadRadioStatus();
        this.notificationService.showInfo('Radio stopped');
      }),

      this.socketService.onEvent('radio-track-changed').subscribe((event: any) => {
        this.radioStatus = { 
          ...this.radioStatus!, 
          currentTrack: event.track,
          currentIndex: event.index 
        };
        this.notificationService.showInfo(`Now playing: ${event.track.metadata?.title || event.track.originalName}`);
      })
    );
  }

  async loadRadioStatus() {
    try {
      this.loading = true;
      const response = await this.radioService.getStatus().toPromise();
      if (response?.success) {
        this.radioStatus = response.status;
      }
    } catch (error) {
      this.notificationService.showError('Failed to load radio status');
    } finally {
      this.loading = false;
    }
  }

  async loadRadioConfig() {
    try {
      const response = await this.radioService.getConfig().toPromise();
      if (response?.success) {
        this.radioConfig = response.config;
      }
    } catch (error) {
      this.notificationService.showError('Failed to load radio configuration');
    }
  }

  async loadPlaylist() {
    try {
      this.playlistLoading = true;
      const response = await this.radioService.getPlaylist().toPromise();
      if (response?.success) {
        this.playlist = response.playlist || [];
      }
    } catch (error) {
      this.notificationService.showError('Failed to load playlist');
    } finally {
      this.playlistLoading = false;
    }
  }

  async refreshAll() {
    await Promise.all([
      this.loadRadioStatus(),
      this.loadRadioConfig(),
      this.loadPlaylist()
    ]);
  }

  async toggleRadio() {
    if (!this.radioStatus) return;

    try {
      this.pendingAction = 'toggle';
      
      if (this.radioStatus.isRunning) {
        const response = await this.radioService.stop().toPromise();
        if (response?.success) {
          this.notificationService.showInfo('Radio stopped');
          this.loadRadioStatus();
        } else {
          this.notificationService.showError('Failed to stop radio', response?.message);
        }
      } else {
        // Send current Janus config when starting radio
        const response = await this.radioService.start(this.radioConfig || undefined).toPromise();
        if (response?.success) {
          this.notificationService.showSuccess('Radio started');
          this.loadRadioStatus();
        } else {
          this.notificationService.showError('Failed to start radio', response?.message);
        }
      }
    } catch (error) {
      this.notificationService.showError('Failed to toggle radio');
    } finally {
      this.pendingAction = null;
    }
  }

  async skipTrack() {
    try {
      this.pendingAction = 'skip';
      const response = await this.radioService.skip().toPromise();
      if (response?.success) {
        this.notificationService.showInfo('Track skipped');
        this.loadRadioStatus();
      } else {
        this.notificationService.showError('Failed to skip track', response?.message);
      }
    } catch (error) {
      this.notificationService.showError('Failed to skip track');
    } finally {
      this.pendingAction = null;
    }
  }

  async refreshPlaylist() {
    try {
      this.refreshingPlaylist = true;
      const response = await this.radioService.refreshPlaylist(true).toPromise();
      if (response?.success) {
        this.playlist = response.playlist || [];
        this.playlistChanged = false;
        this.notificationService.showSuccess('Playlist refreshed successfully');
      } else {
        this.notificationService.showError('Failed to refresh playlist', response?.message);
      }
    } catch (error) {
      this.notificationService.showError('Failed to refresh playlist');
    } finally {
      this.refreshingPlaylist = false;
    }
  }

  async savePlaylistOrder() {
    try {
      const playlistData = this.playlist.map(track => ({
        id: track.id,
        originalName: track.originalName
      }));

      const response = await this.radioService.updatePlaylist(playlistData).toPromise();
      if (response?.success) {
        this.playlistChanged = false;
        this.notificationService.showSuccess('Playlist order saved successfully');
      } else {
        this.notificationService.showError('Failed to save playlist order', response?.message);
      }
    } catch (error) {
      this.notificationService.showError('Failed to save playlist order');
    }
  }

  removeFromPlaylist(track: AudioFile, index: number) {
    this.confirmationService.confirm({
      message: `Remove "${track.metadata?.title || track.originalName}" from playlist?`,
      header: 'Confirm Removal',
      icon: 'pi pi-exclamation-triangle',
      accept: () => {
        this.playlist.splice(index, 1);
        this.playlistChanged = true;
        this.notificationService.showInfo('Track removed from playlist');
      }
    });
  }

  async downloadTrack(track: AudioFile) {
    try {
      const blob = await this.fileService.downloadFile(track.id).toPromise();
      if (!blob) {
        this.notificationService.showError('Failed to download track: No data received');
        return;
      }
      
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `${track.originalName.replace(/\.[^/.]+$/, '')}.opus`;
      link.click();
      window.URL.revokeObjectURL(url);
      
      this.notificationService.showSuccess(`Downloaded: ${track.originalName}`);
    } catch (error) {
      this.notificationService.showError('Failed to download track');
    }
  }

  async saveConfiguration() {
    if (!this.radioConfig) return;

    try {
      this.pendingAction = 'saveConfig';
      const response = await this.radioService.updateConfig(this.radioConfig).toPromise();
      if (response?.success) {
        this.notificationService.showSuccess('Configuration saved successfully');
      } else {
        this.notificationService.showError('Failed to save configuration', response?.message);
      }
    } catch (error) {
      this.notificationService.showError('Failed to save configuration');
    } finally {
      this.pendingAction = null;
    }
  }

  async testConnection() {
    if (!this.radioConfig) return;

    try {
      this.pendingAction = 'testConnection';
      const response = await this.radioService.testJanusConnectivity(
        this.radioConfig.janusIP, 
        this.radioConfig.janusPort
      ).toPromise();
      
      if (response?.success) {
        this.notificationService.showSuccess('Janus connection test successful');
      } else {
        this.notificationService.showError('Janus connection test failed', response?.message);
      }
    } catch (error) {
      this.notificationService.showError('Janus connection test failed');
    } finally {
      this.pendingAction = null;
    }
  }

  // Helper methods
  isCurrentlyPlaying(track: AudioFile): boolean {
    return this.radioStatus?.currentTrack?.id === track.id;
  }

  getStatusText(): string {
    if (!this.radioStatus) return 'Unknown';
    if (this.radioStatus.isStopping) return 'Stopping...';
    if (this.radioStatus.isRunning) return 'Streaming Live';
    return 'Stopped';
  }

  getStatusCardClass(): string {
    if (!this.radioStatus) return 'status-loading';
    if (this.radioStatus.isRunning) return 'status-running';
    return 'status-stopped';
  }

  getRadioStatusIcon(): string {
    if (!this.radioStatus) return 'pi-spin pi-spinner';
    if (this.radioStatus.isRunning) return 'pi-play';
    return 'pi-stop';
  }

  formatUptime(uptime: number): string {
    const hours = Math.floor(uptime / (1000 * 60 * 60));
    const minutes = Math.floor((uptime % (1000 * 60 * 60)) / (1000 * 60));
    return `${hours}h ${minutes}m`;
  }

  formatDuration(seconds: number | undefined): string {
    return this.fileService.formatDuration(seconds || 0);
  }

  formatFileSize(bytes: number): string {
    return this.fileService.formatFileSize(bytes);
  }

  getFileStatusSeverity(status: string): any {
    return this.fileService.getStatusSeverity(status);
  }

  getFileStatusIcon(status: string): string {
    return this.fileService.getStatusIcon(status);
  }
}