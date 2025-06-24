// src/app/services/file.service.ts - File management service
import { Injectable } from '@angular/core';
import { HttpClient, HttpEvent, HttpRequest, HttpResponse } from '@angular/common/http';
import { Observable, BehaviorSubject } from 'rxjs';
import { map, tap } from 'rxjs/operators';

import { 
  AudioFile, 
  FileUploadResponse, 
  FileListResponse, 
  FileActionResponse,
  FileFilter,
  LogEntry 
} from '../models/file.model';

@Injectable({
  providedIn: 'root'
})
export class FileService {
  private readonly apiUrl = '/api/files';  // Direct URL
  
  // State management
  private filesSubject = new BehaviorSubject<AudioFile[]>([]);
  private loadingSubject = new BehaviorSubject<boolean>(false);
  
  public files$ = this.filesSubject.asObservable();
  public loading$ = this.loadingSubject.asObservable();

  constructor(private http: HttpClient) {}

  /**
   * Upload multiple files with progress tracking
   */
  uploadFiles(files: File[]): Observable<HttpEvent<FileUploadResponse>> {
    const formData = new FormData();
    
    files.forEach(file => {
      formData.append('files', file, file.name);
    });

    const request = new HttpRequest('POST', `${this.apiUrl}/upload`, formData, {
      reportProgress: true
    });

    return this.http.request<FileUploadResponse>(request).pipe(
      tap(event => {
        if (event instanceof HttpResponse && event.body?.success) {
          // Refresh file list after successful upload
          this.refreshFiles();
        }
      })
    );
  }

  /**
   * Get all files with optional filtering
   */
  getFiles(filter: FileFilter = {}): Observable<FileListResponse> {
    this.loadingSubject.next(true);
    
    const params: any = {};
    if (filter.status) params.status = filter.status;
    if (filter.search) params.search = filter.search;
    if (filter.limit) params.limit = filter.limit.toString();
    if (filter.offset) params.offset = filter.offset.toString();

    return this.http.get<FileListResponse>(this.apiUrl, { params }).pipe(
      tap(response => {
        if (response.success) {
          this.filesSubject.next(response.files);
        }
        this.loadingSubject.next(false);
      })
    );
  }

  /**
   * Get specific file details
   */
  getFile(id: string): Observable<{ success: boolean; file: AudioFile }> {
    return this.http.get<{ success: boolean; file: AudioFile }>(`${this.apiUrl}/${id}`);
  }

  /**
   * Trigger manual encoding for a file
   */
  encodeFile(id: string): Observable<FileActionResponse> {
    return this.http.post<FileActionResponse>(`${this.apiUrl}/${id}/encode`, {}).pipe(
      tap(response => {
        if (response.success) {
          this.updateFileInList(id, { status: 'encoding', progress: 0 });
        }
      })
    );
  }

  /**
   * Retry failed encoding
   */
  retryEncoding(id: string): Observable<FileActionResponse> {
    return this.http.post<FileActionResponse>(`${this.apiUrl}/${id}/retry`, {}).pipe(
      tap(response => {
        if (response.success) {
          this.updateFileInList(id, { status: 'encoding', progress: 0, error: undefined });
        }
      })
    );
  }

  /**
   * Cancel active encoding
   */
  cancelEncoding(id: string): Observable<FileActionResponse> {
    return this.http.post<FileActionResponse>(`${this.apiUrl}/${id}/cancel`, {});
  }

  /**
   * Delete a file
   */
  deleteFile(id: string): Observable<FileActionResponse> {
    return this.http.delete<FileActionResponse>(`${this.apiUrl}/${id}`).pipe(
      tap(response => {
        if (response.success) {
          this.removeFileFromList(id);
        }
      })
    );
  }

  /**
   * Download encoded file
   */
  downloadFile(id: string): Observable<Blob> {
    return this.http.get(`${this.apiUrl}/${id}/download`, {
      responseType: 'blob'
    });
  }

  /**
   * Get file processing logs
   */
  getFileLogs(id: string): Observable<{ success: boolean; logs: LogEntry[] }> {
    return this.http.get<{ success: boolean; logs: LogEntry[] }>(`${this.apiUrl}/${id}/logs`);
  }

  /**
   * NEW: Manual import files from directory
   */
  importFiles(): Observable<{ success: boolean; message: string; results: any }> {
    return this.http.post<{ success: boolean; message: string; results: any }>(`${this.apiUrl}/import`, {}).pipe(
      tap(response => {
        if (response.success) {
          this.refreshFiles();
        }
      })
    );
  }

  /**
   * NEW: Get import configuration
   */
  getImportConfig(): Observable<{ success: boolean; config: any }> {
    return this.http.get<{ success: boolean; config: any }>(`${this.apiUrl}/import/config`);
  }

  /**
   * NEW: Update import configuration
   */
  updateImportConfig(config: any): Observable<{ success: boolean; message: string; config: any }> {
    return this.http.post<{ success: boolean; message: string; config: any }>(`${this.apiUrl}/import/config`, config);
  }

  /**
   * NEW: Trigger batch encoding
   */
  triggerBatchEncoding(): Observable<{ success: boolean; message: string; results: any }> {
    return this.http.post<{ success: boolean; message: string; results: any }>(`${this.apiUrl}/batch-encode`, {});
  }

  /**
   * NEW: Get import service status
   */
  getImportStatus(): Observable<{ success: boolean; status: any }> {
    return this.http.get<{ success: boolean; status: any }>(`${this.apiUrl}/import/status`);
  }

  /**
   * Refresh the current file list
   */
  refreshFiles(): void {
    this.getFiles().subscribe();
  }

  /**
   * Update file status in the local list (for real-time updates)
   */
  updateFileInList(id: string, updates: Partial<AudioFile>): void {
    const currentFiles = this.filesSubject.value;
    const fileIndex = currentFiles.findIndex(f => f.id === id);
    
    if (fileIndex !== -1) {
      const updatedFiles = [...currentFiles];
      updatedFiles[fileIndex] = { ...updatedFiles[fileIndex], ...updates };
      this.filesSubject.next(updatedFiles);
    }
  }

  /**
   * Remove file from local list
   */
  removeFileFromList(id: string): void {
    const currentFiles = this.filesSubject.value;
    const filteredFiles = currentFiles.filter(f => f.id !== id);
    this.filesSubject.next(filteredFiles);
  }

  /**
   * Add new files to local list
   */
  addFilesToList(files: AudioFile[]): void {
    const currentFiles = this.filesSubject.value;
    const updatedFiles = [...files, ...currentFiles];
    this.filesSubject.next(updatedFiles);
  }

  /**
   * Get file status statistics
   */
  getFileStats(): Observable<any> {
    const files = this.filesSubject.value;
    
    const stats = {
      total: files.length,
      byStatus: {
        uploaded: files.filter(f => f.status === 'uploaded').length,
        encoding: files.filter(f => f.status === 'encoding').length,
        completed: files.filter(f => f.status === 'completed').length,
        failed: files.filter(f => f.status === 'failed').length
      },
      totalSize: files.reduce((sum, f) => sum + f.size, 0),
      averageSize: files.length ? files.reduce((sum, f) => sum + f.size, 0) / files.length : 0
    };

    return new Observable(observer => {
      observer.next(stats);
      observer.complete();
    });
  }

  /**
   * Format file size for display
   */
  formatFileSize(bytes: number): string {
    if (bytes === 0) return '0 Bytes';
    
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  }

  /**
   * Format duration for display
   */
  formatDuration(seconds: number): string {
    if (!seconds) return '--:--';
    
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = Math.floor(seconds % 60);
    
    if (hours > 0) {
      return `${hours}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
    }
    return `${minutes}:${secs.toString().padStart(2, '0')}`;
  }

  /**
   * Get status severity for PrimeNG components
   */
  getStatusSeverity(status: string): 'success' | 'info' | 'warning' | 'danger' {
    switch (status) {
      case 'completed': return 'success';
      case 'encoding': return 'info';
      case 'uploaded': return 'warning';
      case 'failed': return 'danger';
      default: return 'info';
    }
  }

  /**
   * Get status icon
   */
  getStatusIcon(status: string): string {
    switch (status) {
      case 'completed': return 'pi pi-check-circle';
      case 'encoding': return 'pi pi-spin pi-spinner';
      case 'uploaded': return 'pi pi-clock';
      case 'failed': return 'pi pi-times-circle';
      default: return 'pi pi-question-circle';
    }
  }
}