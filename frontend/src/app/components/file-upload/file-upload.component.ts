// src/app/components/file-upload/file-upload.component.ts - FIXED VERSION
import { Component, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { HttpEventType, HttpResponse } from '@angular/common/http';
import { Subscription } from 'rxjs';

// PrimeNG Imports
import { ButtonModule } from 'primeng/button';
import { CardModule } from 'primeng/card';
import { FileUploadModule } from 'primeng/fileupload';
import { ProgressBarModule } from 'primeng/progressbar';
import { BadgeModule } from 'primeng/badge';

import { FileService } from '../../services/file.service';
import { NotificationService } from '../../services/notification.service';
import { SocketService } from '../../services/socket.service';
import { FileUploadResponse } from '../../models/file.model';

interface UploadFile {
  file: File;
  progress: number;
  status: 'pending' | 'uploading' | 'completed' | 'error';
  error?: string;
}

@Component({
  selector: 'app-file-upload',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    ButtonModule,
    CardModule,
    FileUploadModule,
    ProgressBarModule,
    BadgeModule
  ],
  template: `
    <div class="upload-container">
      <p-card header="Upload Audio Files" styleClass="w-full">
        <p class="text-600 mb-4">
          Upload MP3 or MP4 audio files (max 500MB each). Multiple files supported.
        </p>

        <!-- File Upload Area -->
        <div class="upload-area mb-4">
          <p-fileUpload 
            #fileUpload
            mode="advanced"
            [multiple]="true"
            accept="audio/mp3,audio/mpeg,audio/mp4,video/mp4,.mp3,.mp4,.m4a"
            [maxFileSize]="maxFileSize"
            [auto]="false"
            [customUpload]="true"
            (uploadHandler)="onUpload($event)"
            (onSelect)="onFileSelect($event)"
            (onRemove)="onFileRemove($event)"
            (onClear)="onClear()"
            chooseLabel="Select Files"
            uploadLabel="Upload All"
            cancelLabel="Clear All"
            [disabled]="isUploading"
            styleClass="w-full">

            <!-- Custom content for drag & drop area -->
            <ng-template pTemplate="content">
              <div class="upload-content p-4 border-2 border-dashed border-300 border-round text-center" 
                   [class.border-primary]="isDragOver"
                   (dragover)="onDragOver($event)"
                   (dragleave)="onDragLeave($event)"
                   (drop)="onDrop($event)">
                
                <i class="pi pi-cloud-upload text-6xl text-400 mb-3"></i>
                <p class="text-xl mb-2">Drag and drop files here</p>
                <p class="text-600">or click "Select Files" to browse</p>
                
                <!-- Upload Progress List -->
                <div *ngIf="uploadFiles.length > 0" class="mt-4">
                  <div class="text-left">
                    <h5>Selected Files ({{ uploadFiles.length }})</h5>
                    <div *ngFor="let uploadFile of uploadFiles; trackBy: trackByFile" 
                         class="upload-file-item p-2 border-bottom-1 surface-border">
                      
                      <div class="flex align-items-center justify-content-between">
                        <div class="flex-1">
                          <div class="font-medium">{{ uploadFile.file.name }}</div>
                          <div class="text-sm text-600">
                            {{ formatFileSize(uploadFile.file.size) }}
                          </div>
                        </div>
                        
                        <div class="flex align-items-center gap-2">
                          <!-- Status Icon -->
                          <i class="pi" 
                             [class]="getStatusIcon(uploadFile.status)"
                             [style.color]="getStatusColor(uploadFile.status)"></i>
                          
                          <!-- Progress -->
                          <div *ngIf="uploadFile.status === 'uploading'" class="w-8rem">
                            <p-progressBar [value]="uploadFile.progress" 
                                          [showValue]="false" 
                                          styleClass="h-1rem"></p-progressBar>
                            <div class="text-xs text-center mt-1">{{ uploadFile.progress }}%</div>
                          </div>
                          
                          <!-- Remove Button -->
                          <p-button *ngIf="uploadFile.status !== 'uploading'" 
                                   icon="pi pi-times" 
                                   severity="danger" 
                                   size="small"
                                   [text]="true"
                                   (onClick)="removeFile(uploadFile)"></p-button>
                        </div>
                      </div>
                      
                      <!-- Error Message -->
                      <div *ngIf="uploadFile.error" class="text-red-500 text-sm mt-1">
                        {{ uploadFile.error }}
                      </div>
                      
                      <!-- Progress Bar -->
                      <div *ngIf="uploadFile.status === 'uploading'" class="mt-2">
                        <p-progressBar [value]="uploadFile.progress"></p-progressBar>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </ng-template>
          </p-fileUpload>
        </div>

        <!-- Upload Controls -->
        <div class="flex justify-content-between align-items-center">
          <div class="upload-stats text-600">
            <span *ngIf="uploadFiles.length > 0">
              {{ uploadFiles.length }} files selected 
              ({{ getTotalSize() }})
            </span>
          </div>
          
          <div class="flex gap-2">
            <p-button label="Clear All" 
                     icon="pi pi-trash"
                     severity="secondary"
                     [disabled]="uploadFiles.length === 0 || isUploading"
                     (onClick)="clearAll()"></p-button>
                     
            <p-button label="Upload All" 
                     icon="pi pi-upload"
                     [disabled]="uploadFiles.length === 0 || isUploading"
                     [loading]="isUploading"
                     (onClick)="uploadAll()"></p-button>
          </div>
        </div>

        <!-- Upload Summary -->
        <div *ngIf="uploadSummary" class="mt-4 p-3 border-round"
             [class]="uploadSummary.hasErrors ? 'bg-red-50 border-red-200' : 'bg-green-50 border-green-200'">
          <div class="flex align-items-center gap-2">
            <i class="pi" [class]="uploadSummary.hasErrors ? 'pi-exclamation-triangle text-red-500' : 'pi-check-circle text-green-500'"></i>
            <div>
              <div class="font-medium">
                Upload {{ uploadSummary.hasErrors ? 'completed with errors' : 'completed successfully' }}
              </div>
              <div class="text-sm">
                {{ uploadSummary.successful }} successful, {{ uploadSummary.failed }} failed
              </div>
            </div>
          </div>
        </div>
      </p-card>
    </div>
  `,
  styles: [`
    .upload-container {
      max-width: 800px;
      margin: 0 auto;
    }

    .upload-content {
      min-height: 200px;
      transition: border-color 0.3s ease;
    }

    .upload-content.border-primary {
      border-color: var(--primary-color) !important;
      background-color: var(--primary-50);
    }

    .upload-file-item {
      transition: background-color 0.2s ease;
    }

    .upload-file-item:hover {
      background-color: var(--surface-100);
    }

    ::ng-deep .p-fileupload .p-fileupload-content {
      padding: 0;
    }

    ::ng-deep .p-fileupload .p-fileupload-buttonbar {
      background: transparent;
      border: none;
      padding: 1rem 0;
    }
  `]
})
export class FileUploadComponent implements OnInit, OnDestroy {
  uploadFiles: UploadFile[] = [];
  maxFileSize = 500 * 1024 * 1024; // 500MB
  isUploading = false;
  isDragOver = false;
  uploadSummary: { successful: number; failed: number; hasErrors: boolean } | null = null;

  private subscriptions: Subscription[] = [];

  constructor(
    private fileService: FileService,
    private notificationService: NotificationService,
    private socketService: SocketService
  ) {}

  /**
   * Helper function to extract error message from unknown error type
   */
  private getErrorMessage(error: unknown): string {
    if (error instanceof Error) {
      return error.message;
    }
    if (typeof error === 'string') {
      return error;
    }
    if (error && typeof error === 'object' && 'message' in error) {
      return String((error as any).message);
    }
    return 'Unknown error occurred';
  }

  ngOnInit() {
    console.log('FileUploadComponent initialized');
    // Listen to upload completion events
    this.subscriptions.push(
      this.socketService.onFilesUploaded().subscribe(event => {
        console.log('Files uploaded event received:', event);
        this.onUploadCompleted(event.files);
      })
    );
  }

  ngOnDestroy() {
    console.log('FileUploadComponent destroyed');
    this.subscriptions.forEach(sub => sub.unsubscribe());
  }

  onFileSelect(event: any) {
    console.log('File select event:', event);
    
    try {
      // FIXED: Handle both FileList and Array inputs from PrimeNG
      let files: File[] = [];
      
      if (event.files) {
        files = this.convertToArray(event.files);
        console.log('Files from event.files:', files.length);
      } else if (event.currentFiles) {
        files = this.convertToArray(event.currentFiles);
        console.log('Files from event.currentFiles:', files.length);
      } else {
        console.warn('No files found in event:', event);
        return;
      }
      
      this.addFiles(files);
    } catch (error) {
      console.error('Error in onFileSelect:', error);
      this.notificationService.showError('Failed to process selected files', this.getErrorMessage(error));
    }
  }

  onFileRemove(event: any) {
    console.log('File remove event:', event);
    try {
      const file: File = event.file;
      if (file) {
        this.removeFileByName(file.name);
      }
    } catch (error) {
      console.error('Error in onFileRemove:', error);
    }
  }

  onClear() {
    console.log('Clear all files');
    this.uploadFiles = [];
    this.uploadSummary = null;
  }

  onDragOver(event: DragEvent) {
    event.preventDefault();
    this.isDragOver = true;
  }

  onDragLeave(event: DragEvent) {
    event.preventDefault();
    this.isDragOver = false;
  }

  onDrop(event: DragEvent) {
    console.log('Drop event:', event);
    event.preventDefault();
    this.isDragOver = false;
    
    try {
      const files = Array.from(event.dataTransfer?.files || []);
      console.log('Files from drag and drop:', files.length);
      this.addFiles(files);
    } catch (error) {
      console.error('Error in onDrop:', error);
      this.notificationService.showError('Failed to process dropped files', this.getErrorMessage(error));
    }
  }

  onUpload(event: any) {
    console.log('Upload handler called:', event);
    // This is called by p-fileUpload, but we handle uploads manually
    this.uploadAll();
  }

  // FIXED: Robust file array conversion with performance optimization
  private convertToArray(fileCollection: any): File[] {
    try {
      // Handle null/undefined
      if (!fileCollection) {
        console.warn('File collection is null/undefined');
        return [];
      }

      // Already an array
      if (Array.isArray(fileCollection)) {
        console.log('File collection is already an array');
        return fileCollection;
      }

      // FileList or other array-like objects
      if (fileCollection.length !== undefined) {
        console.log('Converting FileList/array-like to array, length:', fileCollection.length);
        
        // Performance optimization: use spread operator for small collections, Array.from for large ones
        if (fileCollection.length <= 10) {
          return [...fileCollection];
        } else {
          return Array.from(fileCollection);
        }
      }

      // Single file object
      if (fileCollection.name && fileCollection.size) {
        console.log('Single file object detected');
        return [fileCollection];
      }

      console.warn('Unknown file collection type:', typeof fileCollection, fileCollection);
      return [];
    } catch (error) {
      console.error('Error converting file collection to array:', error);
      return [];
    }
  }

  // FIXED: Enhanced addFiles with better error handling and logging
  addFiles(files: File[]) {
    console.log('Adding files:', files.length);
    
    try {
      // FIXED: Ensure files is always an array
      const fileArray = this.convertToArray(files);
      
      if (fileArray.length === 0) {
        console.warn('No valid files to add');
        return;
      }

      // Filter and validate files
      const validFiles = fileArray.filter(file => {
        const isValid = this.validateFile(file);
        if (!isValid) {
          console.warn('Invalid file filtered out:', file.name);
        }
        return isValid;
      });
      
      console.log('Valid files after filtering:', validFiles.length);

      // Add valid files that don't already exist
      let addedCount = 0;
      validFiles.forEach(file => {
        if (!this.uploadFiles.some(uf => uf.file.name === file.name && uf.file.size === file.size)) {
          this.uploadFiles.push({
            file,
            progress: 0,
            status: 'pending'
          });
          addedCount++;
          console.log('Added file:', file.name, 'Size:', file.size);
        } else {
          console.log('File already exists, skipping:', file.name);
        }
      });

      console.log('Total files added:', addedCount);
      
      if (addedCount > 0) {
        this.notificationService.showInfo(`${addedCount} files ready for upload`);
      }
    } catch (error) {
      console.error('Error in addFiles:', error);
      this.notificationService.showError('Failed to add files', this.getErrorMessage(error));
    }
  }

  // ENHANCED: Improved file validation with detailed logging
  validateFile(file: File): boolean {
    console.log('Validating file:', file.name, 'Type:', file.type, 'Size:', file.size);
    
    try {
      // Check file size
      if (file.size > this.maxFileSize) {
        console.error('File too large:', file.name, 'Size:', file.size);
        this.notificationService.showError(
          `File too large: ${file.name}`,
          `Maximum size is ${this.formatFileSize(this.maxFileSize)}`
        );
        return false;
      }

      // Check for empty files
      if (file.size === 0) {
        console.error('Empty file:', file.name);
        this.notificationService.showError(
          `Empty file: ${file.name}`,
          'File size cannot be zero'
        );
        return false;
      }

      // Check file type and extension
      const allowedTypes = ['audio/mpeg', 'audio/mp3', 'audio/mp4', 'video/mp4', 'audio/x-m4a'];
      const allowedExtensions = ['.mp3', '.mp4', '.m4a'];
      
      const isValidType = allowedTypes.includes(file.type);
      const fileExt = file.name.toLowerCase().match(/\.[^.]+$/)?.[0] || '';
      const isValidExtension = allowedExtensions.includes(fileExt);

      console.log('File type validation:', {
        type: file.type,
        extension: fileExt,
        validType: isValidType,
        validExtension: isValidExtension
      });

      if (!isValidType && !isValidExtension) {
        console.error('Invalid file type:', file.name, 'Type:', file.type, 'Extension:', fileExt);
        this.notificationService.showError(
          `Invalid file type: ${file.name}`,
          'Only MP3 and MP4 audio files are supported'
        );
        return false;
      }

      console.log('File validation passed:', file.name);
      return true;
    } catch (error) {
      console.error('Error during file validation:', error);
      this.notificationService.showError('File validation failed', this.getErrorMessage(error));
      return false;
    }
  }

  removeFile(uploadFile: UploadFile) {
    console.log('Removing file:', uploadFile.file.name);
    this.uploadFiles = this.uploadFiles.filter(uf => uf !== uploadFile);
  }

  removeFileByName(fileName: string) {
    console.log('Removing file by name:', fileName);
    this.uploadFiles = this.uploadFiles.filter(uf => uf.file.name !== fileName);
  }

  clearAll() {
    console.log('Clearing all files');
    this.uploadFiles = [];
    this.uploadSummary = null;
  }

  // ENHANCED: Better upload process with comprehensive error handling
  async uploadAll() {
    if (this.uploadFiles.length === 0) {
      console.warn('No files to upload');
      return;
    }

    console.log('Starting upload for', this.uploadFiles.length, 'files');
    this.isUploading = true;
    this.uploadSummary = null;

    const pendingFiles = this.uploadFiles.filter(uf => uf.status === 'pending');
    console.log('Pending files to upload:', pendingFiles.length);
    
    // Upload files sequentially to avoid overwhelming the server
    for (let i = 0; i < pendingFiles.length; i++) {
      const uploadFile = pendingFiles[i];
      console.log(`Uploading file ${i + 1}/${pendingFiles.length}:`, uploadFile.file.name);
      
      try {
        await this.uploadSingleFile(uploadFile);
      } catch (error) {
        console.error('Upload failed for file:', uploadFile.file.name, error);
      }
    }

    this.isUploading = false;
    this.generateUploadSummary();
    console.log('Upload process completed');
  }

  // ENHANCED: Improved single file upload with better progress handling
  private uploadSingleFile(uploadFile: UploadFile): Promise<void> {
    return new Promise((resolve) => {
      console.log('Uploading single file:', uploadFile.file.name);
      uploadFile.status = 'uploading';
      uploadFile.progress = 0;

      this.fileService.uploadFiles([uploadFile.file]).subscribe({
        next: (event) => {
          if (event.type === HttpEventType.UploadProgress && event.total) {
            const progress = Math.round(100 * event.loaded / event.total);
            uploadFile.progress = progress;
            console.log('Upload progress for', uploadFile.file.name, ':', progress + '%');
          } else if (event instanceof HttpResponse) {
            const response = event.body as FileUploadResponse;
            console.log('Upload response for', uploadFile.file.name, ':', response);
            
            if (response.success) {
              uploadFile.status = 'completed';
              uploadFile.progress = 100;
              console.log('Upload completed successfully for:', uploadFile.file.name);
            } else {
              uploadFile.status = 'error';
              uploadFile.error = response.message || 'Upload failed';
              console.error('Upload failed for:', uploadFile.file.name, uploadFile.error);
            }
            resolve();
          }
        },
        error: (error) => {
          console.error('Upload error for', uploadFile.file.name, ':', error);
          uploadFile.status = 'error';
          uploadFile.error = this.getErrorMessage(error.error || error);
          resolve();
        }
      });
    });
  }

  private generateUploadSummary() {
    const successful = this.uploadFiles.filter(uf => uf.status === 'completed').length;
    const failed = this.uploadFiles.filter(uf => uf.status === 'error').length;
    
    console.log('Upload summary - Successful:', successful, 'Failed:', failed);
    
    this.uploadSummary = {
      successful,
      failed,
      hasErrors: failed > 0
    };

    // Show notification
    if (failed === 0) {
      this.notificationService.showUploadSuccess(successful, this.getTotalSize());
    } else {
      this.notificationService.showBulkOperationResult('Upload', successful, failed);
    }
  }

  private onUploadCompleted(files: any[]) {
    console.log('Upload completed event received:', files);
    // Refresh file list in parent components
    this.fileService.refreshFiles();
  }

  getTotalSize(): string {
    const totalBytes = this.uploadFiles.reduce((sum, uf) => sum + uf.file.size, 0);
    return this.formatFileSize(totalBytes);
  }

  formatFileSize(bytes: number): string {
    return this.fileService.formatFileSize(bytes);
  }

  getStatusIcon(status: string): string {
    switch (status) {
      case 'pending': return 'pi-clock text-orange-500';
      case 'uploading': return 'pi-spin pi-spinner text-blue-500';
      case 'completed': return 'pi-check-circle text-green-500';
      case 'error': return 'pi-times-circle text-red-500';
      default: return 'pi-circle text-gray-500';
    }
  }

  getStatusColor(status: string): string {
    switch (status) {
      case 'pending': return '#f59e0b';
      case 'uploading': return '#3b82f6';
      case 'completed': return '#10b981';
      case 'error': return '#ef4444';
      default: return '#6b7280';
    }
  }

  trackByFile(index: number, uploadFile: UploadFile): string {
    return uploadFile.file.name + uploadFile.file.size;
  }
}