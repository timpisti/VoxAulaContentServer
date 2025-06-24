// src/app/app.routes.ts - Standalone routing configuration
import { Routes } from '@angular/router';

export const routes: Routes = [
  // Default route
  { path: '', redirectTo: '/dashboard', pathMatch: 'full' },
  
  // Dashboard
  { 
    path: 'dashboard', 
    loadComponent: () => import('./components/system-dashboard/system-dashboard.component').then(m => m.SystemDashboardComponent)
  },
  
  // NEW: Radio Dashboard
  { 
    path: 'radio', 
    loadComponent: () => import('./components/radio-dashboard/radio-dashboard.component').then(m => m.RadioDashboardComponent)
  },
  
  // File management routes
  { 
    path: 'files',
    children: [
      { path: '', redirectTo: 'list', pathMatch: 'full' },
      { 
        path: 'upload', 
        loadComponent: () => import('./components/file-upload/file-upload.component').then(m => m.FileUploadComponent)
      },
      { 
        path: 'list', 
        loadComponent: () => import('./components/file-list/file-list.component').then(m => m.FileListComponent)
      }
    ]
  },
  
  // System routes  
  {
    path: 'system',
    children: [
      { path: '', redirectTo: 'status', pathMatch: 'full' },
      { 
        path: 'status', 
        loadComponent: () => import('./components/system-dashboard/system-dashboard.component').then(m => m.SystemDashboardComponent)
      },
      { 
        path: 'logs', 
        loadComponent: () => import('./components/system-dashboard/system-dashboard.component').then(m => m.SystemDashboardComponent)
      }
    ]
  },
  
  // Catch-all route
  { path: '**', redirectTo: '/dashboard' }
];