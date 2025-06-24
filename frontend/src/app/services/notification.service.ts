// src/app/services/notification.service.ts - User notification service
import { Injectable } from '@angular/core';
import { MessageService } from 'primeng/api';

@Injectable({
  providedIn: 'root'
})
export class NotificationService {

  constructor(private messageService: MessageService) {}

  /**
   * Show success message
   */
  showSuccess(message: string, detail?: string, life: number = 5000): void {
    this.messageService.add({
      severity: 'success',
      summary: 'Success',
      detail: message,
      life
    });
  }

  /**
   * Show error message
   */
  showError(message: string, detail?: string, life: number = 8000): void {
    this.messageService.add({
      severity: 'error',
      summary: 'Error',
      detail: message,
      life
    });
  }

  /**
   * Show warning message
   */
  showWarn(message: string, detail?: string, life: number = 6000): void {
    this.messageService.add({
      severity: 'warn',
      summary: 'Warning',
      detail: message,
      life
    });
  }

  /**
   * Show info message
   */
  showInfo(message: string, detail?: string, life: number = 5000): void {
    this.messageService.add({
      severity: 'info',
      summary: 'Information',
      detail: message,
      life
    });
  }

  /**
   * Show custom message with custom summary
   */
  showCustom(severity: string, summary: string, detail: string, life: number = 5000): void {
    this.messageService.add({
      severity,
      summary,
      detail,
      life
    });
  }

  /**
   * Clear all messages
   */
  clear(): void {
    this.messageService.clear();
  }

  /**
   * Clear specific message by key
   */
  clearByKey(key: string): void {
    this.messageService.clear(key);
  }

  /**
   * Show upload progress notification
   */
  showUploadProgress(fileName: string, progress: number): void {
    this.messageService.add({
      key: `upload-${fileName}`,
      severity: 'info',
      summary: 'Uploading',
      detail: `${fileName} - ${progress}%`,
      sticky: true
    });
  }

  /**
   * Clear upload progress notification
   */
  clearUploadProgress(fileName: string): void {
    this.clearByKey(`upload-${fileName}`);
  }

  /**
   * Show encoding progress notification
   */
  showEncodingProgress(fileId: string, fileName: string, progress: number): void {
    this.messageService.add({
      key: `encoding-${fileId}`,
      severity: 'info',
      summary: 'Encoding',
      detail: `${fileName} - ${progress}%`,
      sticky: true
    });
  }

  /**
   * Clear encoding progress notification
   */
  clearEncodingProgress(fileId: string): void {
    this.clearByKey(`encoding-${fileId}`);
  }

  /**
   * Show file upload success with details
   */
  showUploadSuccess(fileCount: number, totalSize: string): void {
    const message = fileCount === 1 
      ? `File uploaded successfully (${totalSize})`
      : `${fileCount} files uploaded successfully (${totalSize})`;
      
    this.showSuccess(message);
  }

  /**
   * Show encoding completion notification
   */
  showEncodingComplete(fileName: string): void {
    this.showSuccess(`Encoding completed: ${fileName}`);
  }

  /**
   * Show encoding failure notification with user-friendly message
   */
  showEncodingError(fileName: string, userFriendlyMessage: string, technicalMessage?: string): void {
    let detail = `${fileName}: ${userFriendlyMessage}`;
    if (technicalMessage && technicalMessage !== userFriendlyMessage) {
      detail += `\n\nTechnical details: ${technicalMessage}`;
    }
    
    this.showError('Encoding failed', detail);
  }

  /**
   * Show file deletion confirmation
   */
  showDeleteSuccess(fileName: string): void {
    this.showSuccess(`File deleted: ${fileName}`);
  }

  /**
   * Show system status notifications
   */
  showSystemStatusChange(connected: boolean): void {
    if (connected) {
      this.showSuccess('Connected to server');
    } else {
      this.showError('Disconnected from server', 'Please check your connection');
    }
  }

  /**
   * Show bulk operation results
   */
  showBulkOperationResult(operation: string, successCount: number, failCount: number): void {
    if (failCount === 0) {
      this.showSuccess(`${operation} completed successfully`, `${successCount} items processed`);
    } else if (successCount === 0) {
      this.showError(`${operation} failed`, `${failCount} items failed`);
    } else {
      this.showWarn(`${operation} partially completed`, 
        `${successCount} successful, ${failCount} failed`);
    }
  }

  /**
   * Show validation errors
   */
  showValidationErrors(errors: string[]): void {
    const detail = errors.join('\n');
    this.showError('Validation failed', detail);
  }

  /**
   * Show network error
   */
  showNetworkError(operation: string = 'Operation'): void {
    this.showError(`${operation} failed`, 'Please check your network connection and try again');
  }

  /**
   * Show maintenance notification
   */
  showMaintenanceNotification(message: string): void {
    this.showInfo('System Maintenance', message, 10000);
  }
}