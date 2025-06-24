// src/app/app.component.ts - Main standalone application component
import { Component, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterOutlet } from '@angular/router';
import { MenuItem } from 'primeng/api';

// PrimeNG Imports
import { MenubarModule } from 'primeng/menubar';
import { ToastModule } from 'primeng/toast';
import { ConfirmDialogModule } from 'primeng/confirmdialog';

// Services
import { SocketService } from './services/socket.service';
import { SystemService } from './services/system.service';
import { NotificationService } from './services/notification.service';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [
    CommonModule,
    RouterOutlet,
    MenubarModule,
    ToastModule,
    ConfirmDialogModule
  ],
  template: `
    <div class="layout-wrapper">
      <!-- Top Navigation -->
      <p-menubar [model]="menuItems" styleClass="border-noround">
        <ng-template pTemplate="start">
          <img src="assets/logo.png" height="40" class="mr-2" alt="Radio Station" 
               onerror="this.style.display='none'">
          <span class="text-2xl font-bold text-primary">Radio Station</span>
        </ng-template>
        <ng-template pTemplate="end">
          <div class="flex align-items-center gap-2">
            <i class="pi pi-circle-fill text-sm" 
               [class]="systemStatus.connected ? 'text-green-500' : 'text-red-500'"></i>
            <span class="text-sm">{{ systemStatus.connected ? 'Connected' : 'Disconnected' }}</span>
          </div>
        </ng-template>
      </p-menubar>

      <!-- Main Content -->
      <div class="layout-main">
        <div class="layout-content">
          <router-outlet></router-outlet>
        </div>
      </div>

      <!-- Toast Messages -->
      <p-toast position="top-right" [breakpoints]="{'920px': {width: '100%', right: '0', left: '0'}}"></p-toast>
      
      <!-- Confirmation Dialog -->
      <p-confirmDialog header="Confirmation" icon="pi pi-exclamation-triangle"></p-confirmDialog>
    </div>
  `,
  styles: [`
    .layout-wrapper {
      min-height: 100vh;
      display: flex;
      flex-direction: column;
    }

    .layout-main {
      flex: 1;
      display: flex;
      flex-direction: column;
    }

    .layout-content {
      flex: 1;
      padding: 1rem;
      background: #f8f9fa;
    }

    ::ng-deep .p-menubar {
      border: none !important;
      border-radius: 0 !important;
    }

    ::ng-deep .p-toast {
      z-index: 99999;
    }
  `]
})
export class AppComponent implements OnInit, OnDestroy {
  title = 'Radio Station Admin';
  
  menuItems: MenuItem[] = [];
  
  systemStatus = {
    connected: false,
    lastUpdate: null as Date | null
  };

  constructor(
    private socketService: SocketService,
    private systemService: SystemService,
    private notificationService: NotificationService
  ) {}

  ngOnInit() {
    this.initializeMenuItems();
    this.initializeSocketConnection();
    this.checkSystemStatus();
  }

  ngOnDestroy() {
    this.socketService.disconnect();
  }

  private initializeMenuItems() {
    this.menuItems = [
      {
        label: 'Dashboard',
        icon: 'pi pi-home',
        routerLink: ['/dashboard']
      },
      {
        label: 'Radio',
        icon: 'pi pi-play-circle',
        routerLink: ['/radio']
      },
      {
        label: 'Files',
        icon: 'pi pi-file',
        items: [
          {
            label: 'Upload',
            icon: 'pi pi-upload',
            routerLink: ['/files/upload']
          },
          {
            label: 'Manage',
            icon: 'pi pi-list',
            routerLink: ['/files/list']
          }
        ]
      },
      {
        label: 'System',
        icon: 'pi pi-cog',
        items: [
          {
            label: 'Status',
            icon: 'pi pi-info-circle',
            routerLink: ['/system/status']
          },
          {
            label: 'Logs',
            icon: 'pi pi-file-o',
            routerLink: ['/system/logs']
          }
        ]
      }
    ];
  }

  private initializeSocketConnection() {
    // Connect to socket service
    this.socketService.connect();
    
    // Subscribe to connection status
    this.socketService.getConnectionStatus().subscribe(connected => {
      this.systemStatus.connected = connected;
      this.systemStatus.lastUpdate = new Date();
      
      if (connected) {
        this.notificationService.showSuccess('Connected to server');
        // Subscribe to file updates
        this.socketService.subscribeToFileUpdates();
      } else {
        this.notificationService.showError('Connection to server lost');
      }
    });

    // Handle socket events
    this.socketService.onEvent('encoding-completed').subscribe(data => {
      this.notificationService.showSuccess(`Encoding completed for file: ${data.fileId}`);
    });

    this.socketService.onEvent('encoding-failed').subscribe(data => {
      this.notificationService.showError(`Encoding failed: ${data.error.message}`);
    });

    this.socketService.onEvent('files-uploaded').subscribe(data => {
      this.notificationService.showSuccess(`${data.files.length} files uploaded successfully`);
    });
  }

  private checkSystemStatus() {
    // Periodic system status check
    setInterval(() => {
      this.systemService.getStatus().subscribe({
        next: (status) => {
          // System is healthy
        },
        error: (error) => {
          if (this.systemStatus.connected) {
            this.notificationService.showWarn('System health check failed');
          }
        }
      });
    }, 30000); // Check every 30 seconds
  }
}