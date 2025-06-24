// src/app/services/system.service.ts - System management service
import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';

import { 
  SystemStatus,
  SystemStats,
  SystemConfig,
  LogsResponse,
  BackupResponse,
  CleanupResponse
} from '../models/system.model';

@Injectable({
  providedIn: 'root'
})
export class SystemService {
  private readonly apiUrl = '/api/system';  // Direct URL

  constructor(private http: HttpClient) {}

  /**
   * Get system health status
   */
  getStatus(): Observable<SystemStatus> {
    return this.http.get<SystemStatus>(`${this.apiUrl}/status`);
  }

  /**
   * Get system statistics
   */
  getStats(): Observable<{ success: boolean; stats: SystemStats }> {
    return this.http.get<{ success: boolean; stats: SystemStats }>(`${this.apiUrl}/stats`);
  }

  /**
   * Get system configuration
   */
  getConfig(): Observable<{ success: boolean; config: SystemConfig }> {
    return this.http.get<{ success: boolean; config: SystemConfig }>(`${this.apiUrl}/config`);
  }

  /**
   * Get system logs
   */
  getLogs(level: string = 'info', limit: number = 100): Observable<LogsResponse> {
    const params = { level, limit: limit.toString() };
    return this.http.get<LogsResponse>(`${this.apiUrl}/logs`, { params });
  }

  /**
   * Create system backup
   */
  createBackup(): Observable<BackupResponse> {
    return this.http.post<BackupResponse>(`${this.apiUrl}/backup`, {});
  }

  /**
   * Clean up old files
   */
  cleanup(days: number = 30): Observable<CleanupResponse> {
    return this.http.post<CleanupResponse>(`${this.apiUrl}/cleanup`, { days });
  }

  /**
   * Format uptime for display
   */
  formatUptime(seconds: number): string {
    const days = Math.floor(seconds / 86400);
    const hours = Math.floor((seconds % 86400) / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    
    if (days > 0) {
      return `${days}d ${hours}h ${minutes}m`;
    } else if (hours > 0) {
      return `${hours}h ${minutes}m`;
    } else {
      return `${minutes}m`;
    }
  }

  /**
   * Format memory size for display
   */
  formatMemory(bytes: number): string {
    const mb = bytes / (1024 * 1024);
    return `${Math.round(mb * 100) / 100} MB`;
  }

  /**
   * Get log level severity for display
   */
  getLogLevelSeverity(level: string): 'success' | 'info' | 'warning' | 'danger' {
    switch (level.toLowerCase()) {
      case 'debug': return 'info';
      case 'info': return 'success';
      case 'warn': return 'warning';
      case 'error': return 'danger';
      default: return 'info';
    }
  }

  /**
   * Get log level icon
   */
  getLogLevelIcon(level: string): string {
    switch (level.toLowerCase()) {
      case 'debug': return 'pi pi-info-circle';
      case 'info': return 'pi pi-check-circle';
      case 'warn': return 'pi pi-exclamation-triangle';
      case 'error': return 'pi pi-times-circle';
      default: return 'pi pi-circle';
    }
  }

  /**
   * Get directory status severity
   */
  getDirectoryStatusSeverity(status: any): 'success' | 'danger' {
    return status.exists && status.writable ? 'success' : 'danger';
  }

  /**
   * Calculate percentage from memory usage
   */
  getMemoryUsagePercentage(used: number, total: number): number {
    return Math.round((used / total) * 100);
  }
}