// src/app/services/radio.service.ts - FIXED: Complete Janus Integration
import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';

import { AudioFile } from '../models/file.model';

export interface RadioStatus {
  isRunning: boolean;
  isStopping: boolean;
  currentTrack: AudioFile | null;
  currentIndex: number;
  playlistSize: number;
  skipCount: number;
  target: string;
  processId: number | null;
  uptime?: number;
  lastTrackStart: number | null;
}

export interface RadioConfig {
  // Janus AudioBridge Configuration
  janusIP: string;
  janusPort: string;
  janusRoomId: string;
  janusParticipantName: string;
  janusRoomSecret: string;
  janusRoomPin: string;
  maxConsecutiveSkips: number;
  autoRestart: boolean;
}

export interface RadioResponse<T = any> {
  success: boolean;
  message?: string;
  error?: string;
  data?: T;
}

export interface RadioPlaylistRefreshResponse {
  success: boolean;
  message?: string;
  error?: string;
  playlist: AudioFile[];
  count: number;
}

export interface RadioPlaylistUpdateResponse {
  success: boolean;
  message?: string;
  error?: string;
  playlist: AudioFile[];
  count: number;
}

export interface RadioStatusResponse extends RadioResponse {
  status: RadioStatus;
}

export interface RadioConfigResponse extends RadioResponse {
  config: RadioConfig;
}

export interface RadioPlaylistResponse extends RadioResponse {
  playlist: AudioFile[];
  currentIndex: number;
  currentTrack: AudioFile | null;
  total: number;
}

export interface RadioHealthResponse extends RadioResponse {
  health: {
    healthy: boolean;
    service: string;
    status: string;
    uptime: number;
    playlist: {
      size: number;
      currentIndex: number;
    };
    process: {
      pid: number | null;
      skipCount: number;
    };
    target: string;
    timestamp: string;
    error?: string;
  };
}

@Injectable({
  providedIn: 'root'
})
export class RadioService {
  private readonly apiUrl = '/api/radio';

  constructor(private http: HttpClient) {}

  /**
   * Get current radio status
   */
  getStatus(): Observable<RadioStatusResponse> {
    return this.http.get<RadioStatusResponse>(`${this.apiUrl}/status`).pipe(
      tap(response => {
        if (!response.success) {
          console.error('Radio status error:', response.message);
        }
      })
    );
  }

  /**
   * Start radio streaming with Janus configuration
   */
  start(config?: Partial<RadioConfig>): Observable<RadioResponse> {
    const requestBody = config ? { config } : {};
    
    return this.http.post<RadioResponse>(`${this.apiUrl}/start`, requestBody).pipe(
      tap(response => {
        console.log('Radio start response:', response);
      })
    );
  }

  /**
   * Stop radio streaming
   */
  stop(): Observable<RadioResponse> {
    return this.http.post<RadioResponse>(`${this.apiUrl}/stop`, {}).pipe(
      tap(response => {
        console.log('Radio stop response:', response);
      })
    );
  }

  /**
   * Skip current track
   */
  skip(): Observable<RadioResponse> {
    return this.http.post<RadioResponse>(`${this.apiUrl}/skip`, {}).pipe(
      tap(response => {
        console.log('Radio skip response:', response);
      })
    );
  }

  /**
   * Get current playlist
   */
  getPlaylist(): Observable<RadioPlaylistResponse> {
    return this.http.get<RadioPlaylistResponse>(`${this.apiUrl}/playlist`);
  }

  /**
   * Refresh playlist from database
   */
  refreshPlaylist(shuffle: boolean = true): Observable<RadioPlaylistRefreshResponse> {
    return this.http.post<RadioPlaylistRefreshResponse>(
      `${this.apiUrl}/playlist/refresh`, 
      { shuffle }
    ).pipe(
      tap(response => {
        console.log('Playlist refresh response:', response);
      })
    );
  }

  /**
   * Update playlist order
   */
  updatePlaylist(playlist: Array<{ id: string; originalName: string }>): Observable<RadioPlaylistUpdateResponse> {
    return this.http.post<RadioPlaylistUpdateResponse>(
      `${this.apiUrl}/playlist/update`,
      { playlist }
    ).pipe(
      tap(response => {
        console.log('Playlist update response:', response);
      })
    );
  }

  /**
   * Get radio configuration
   */
  getConfig(): Observable<RadioConfigResponse> {
    return this.http.get<RadioConfigResponse>(`${this.apiUrl}/config`);
  }

  /**
   * Update radio configuration
   */
  updateConfig(config: Partial<RadioConfig>): Observable<RadioResponse<{ config: RadioConfig }>> {
    return this.http.post<RadioResponse<{ config: RadioConfig }>>(
      `${this.apiUrl}/config`,
      config
    ).pipe(
      tap(response => {
        console.log('Config update response:', response);
      })
    );
  }

  /**
   * Get radio service health
   */
  getHealth(): Observable<RadioHealthResponse> {
    return this.http.get<RadioHealthResponse>(`${this.apiUrl}/health`);
  }

  /**
   * Test Janus connectivity
   */
  testJanusConnectivity(janusIP: string, janusPort: string): Observable<RadioResponse<any>> {
    return this.http.post<RadioResponse<any>>(`${this.apiUrl}/test`, {
      janusIP,
      janusPort
    }).pipe(
      tap(response => {
        console.log('Janus connectivity test response:', response);
      })
    );
  }

  /**
   * Format radio uptime for display
   */
  formatUptime(uptimeMs: number): string {
    const seconds = Math.floor(uptimeMs / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);

    if (days > 0) {
      return `${days}d ${hours % 24}h ${minutes % 60}m`;
    } else if (hours > 0) {
      return `${hours}h ${minutes % 60}m`;
    } else if (minutes > 0) {
      return `${minutes}m ${seconds % 60}s`;
    } else {
      return `${seconds}s`;
    }
  }

  /**
   * Get radio status severity for PrimeNG components
   */
  getRadioStatusSeverity(status: RadioStatus | null): 'success' | 'info' | 'warning' | 'danger' {
    if (!status) return 'warning';
    if (status.isRunning) return 'success';
    if (status.isStopping) return 'warning';
    return 'danger';
  }

  /**
   * Get radio status icon
   */
  getRadioStatusIcon(status: RadioStatus | null): string {
    if (!status) return 'pi pi-question-circle';
    if (status.isRunning) return 'pi pi-play-circle';
    if (status.isStopping) return 'pi pi-spin pi-spinner';
    return 'pi pi-stop-circle';
  }

  /**
   * Check if radio service is healthy
   */
  async isHealthy(): Promise<boolean> {
    try {
      const response = await this.getHealth().toPromise();
      return !!(response?.success && response?.health?.healthy);
    } catch (error) {
      console.error('Health check failed:', error);
      return false;
    }
  }
}