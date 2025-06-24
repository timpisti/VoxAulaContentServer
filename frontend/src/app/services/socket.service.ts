// src/app/services/socket.service.ts - ENHANCED with Better Reconnection
import { Injectable } from '@angular/core';
import { Observable, BehaviorSubject, throwError } from 'rxjs';
import { retry, catchError, delay, map } from 'rxjs/operators';
import { io, Socket } from 'socket.io-client';

import { 
  EncodingProgressEvent,
  EncodingCompletedEvent, 
  EncodingFailedEvent,
  FilesUploadedEvent,
  FileDeletedEvent,
  EncodingCancelledEvent
} from '../models/file.model';

interface ConnectionState {
  connected: boolean;
  connecting: boolean;
  lastConnected: Date | null;
  reconnectAttempts: number;
  maxReconnectAttempts: number;
}

@Injectable({
  providedIn: 'root'
})
export class SocketService {
  private socket: Socket | null = null;
  private connectionState = new BehaviorSubject<ConnectionState>({
    connected: false,
    connecting: false,
    lastConnected: null,
    reconnectAttempts: 0,
    maxReconnectAttempts: 10
  });
  
  // Reconnection settings
  private readonly baseDelay = 1000; // 1 second
  private readonly maxDelay = 30000; // 30 seconds
  private reconnectionTimer: any = null;
  private heartbeatTimer: any = null;
  
  // Event cache for reconnection recovery
  private eventHandlers = new Map<string, any[]>();
  
  constructor() {
    console.log('SocketService initialized');
  }

  /**
   * Connect to Socket.IO server with enhanced reconnection logic
   */
  connect(): void {
    if (this.socket?.connected) {
      console.log('Socket already connected');
      return;
    }

    const currentState = this.connectionState.value;
    if (currentState.connecting) {
      console.log('Connection already in progress');
      return;
    }

    this.updateConnectionState({ connecting: true });
    console.log('Initiating socket connection...');

    try {
      this.socket = io(window.location.origin, {
        transports: ['websocket', 'polling'],
        timeout: 10000,
        retries: 3,
        autoConnect: true,
        reconnection: false, // We handle reconnection manually
        forceNew: true
      });

      this.setupSocketHandlers();
      
    } catch (error) {
      console.error('Failed to create socket connection:', error);
      this.handleConnectionError();
    }
  }

  /**
   * Setup socket event handlers
   */
  private setupSocketHandlers(): void {
    if (!this.socket) return;

    this.socket.on('connect', () => {
      console.log('Socket connected successfully:', this.socket?.id);
      
      this.updateConnectionState({ 
        connected: true, 
        connecting: false,
        lastConnected: new Date(),
        reconnectAttempts: 0
      });
      
      // Resubscribe to file updates
      this.subscribeToFileUpdates();
      
      // Restore event handlers
      this.restoreEventHandlers();
      
      // Start heartbeat
      this.startHeartbeat();
      
      // Sync application state after reconnection
      this.syncApplicationState();
    });

    this.socket.on('disconnect', (reason) => {
      console.log('Socket disconnected:', reason);
      
      this.updateConnectionState({ 
        connected: false, 
        connecting: false 
      });
      
      this.stopHeartbeat();
      
      // Handle different disconnect reasons
      if (reason === 'io server disconnect') {
        // Server initiated disconnect - don't auto-reconnect immediately
        console.log('Server initiated disconnect - waiting before reconnect');
        this.scheduleReconnection(5000);
      } else {
        // Client side disconnect or network issue - attempt immediate reconnect
        console.log('Client side disconnect - attempting immediate reconnect');
        this.attemptReconnection();
      }
    });

    this.socket.on('connect_error', (error) => {
      console.error('Socket connection error:', error);
      this.handleConnectionError();
    });

    this.socket.on('reconnect_error', (error) => {
      console.error('Socket reconnection error:', error);
      this.handleConnectionError();
    });

    // Handle custom events
    this.socket.on('server_restart', () => {
      console.log('Server restart detected - preparing for reconnection');
      this.handleServerRestart();
    });

    this.socket.on('pong', (data) => {
      console.debug('Heartbeat pong received:', data);
    });
  }

  /**
   * Handle connection errors with exponential backoff
   */
  private handleConnectionError(): void {
    const currentState = this.connectionState.value;
    
    this.updateConnectionState({ 
      connected: false, 
      connecting: false,
      reconnectAttempts: currentState.reconnectAttempts + 1
    });

    if (currentState.reconnectAttempts < currentState.maxReconnectAttempts) {
      const delay = this.calculateBackoffDelay(currentState.reconnectAttempts);
      console.log(`Scheduling reconnection attempt ${currentState.reconnectAttempts + 1} in ${delay}ms`);
      this.scheduleReconnection(delay);
    } else {
      console.error('Maximum reconnection attempts reached');
      this.updateConnectionState({ connecting: false });
    }
  }

  /**
   * Calculate exponential backoff delay
   */
  private calculateBackoffDelay(attempt: number): number {
    const delay = Math.min(this.baseDelay * Math.pow(2, attempt), this.maxDelay);
    // Add jitter to prevent thundering herd
    const jitter = Math.random() * 1000;
    return delay + jitter;
  }

  /**
   * Schedule reconnection attempt
   */
  private scheduleReconnection(delay: number): void {
    if (this.reconnectionTimer) {
      clearTimeout(this.reconnectionTimer);
    }

    this.reconnectionTimer = setTimeout(() => {
      this.attemptReconnection();
    }, delay);
  }

  /**
   * Attempt to reconnect
   */
  private attemptReconnection(): void {
    const currentState = this.connectionState.value;
    
    if (currentState.connected || currentState.connecting) {
      console.log('Skip reconnection - already connected or connecting');
      return;
    }

    if (currentState.reconnectAttempts >= currentState.maxReconnectAttempts) {
      console.error('Maximum reconnection attempts exceeded');
      return;
    }

    console.log(`Reconnection attempt ${currentState.reconnectAttempts + 1}`);
    
    // Cleanup existing socket
    this.cleanup();
    
    // Attempt new connection
    this.connect();
  }

  /**
   * Handle server restart scenario
   */
  private handleServerRestart(): void {
    console.log('Handling server restart');
    
    // Clear all timers
    if (this.reconnectionTimer) {
      clearTimeout(this.reconnectionTimer);
    }
    this.stopHeartbeat();
    
    // Reset connection state
    this.updateConnectionState({
      connected: false,
      connecting: false,
      reconnectAttempts: 0
    });
    
    // Wait a bit for server to restart then reconnect
    setTimeout(() => {
      this.connect();
    }, 3000);
  }

  /**
   * Start heartbeat to detect connection issues
   */
  private startHeartbeat(): void {
    this.stopHeartbeat();
    
    this.heartbeatTimer = setInterval(() => {
      if (this.socket?.connected) {
        this.socket.emit('ping', { timestamp: Date.now() });
      }
    }, 25000); // Send ping every 25 seconds
  }

  /**
   * Stop heartbeat
   */
  private stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  /**
   * Sync application state after reconnection
   */
  private syncApplicationState(): void {
    console.log('Syncing application state after reconnection');
    
    // Emit event to notify components about reconnection
    this.emit('client_reconnected', {
      timestamp: new Date().toISOString(),
      reconnectAttempts: this.connectionState.value.reconnectAttempts
    });
    
    // Request current encoding status
    this.emit('request_encoding_status');
    
    // Request file list refresh
    this.emit('request_file_list_refresh');
  }

  /**
   * Restore event handlers after reconnection
   */
  private restoreEventHandlers(): void {
    console.log('Restoring event handlers after reconnection');
    
    // Re-setup all event listeners that were registered
    this.eventHandlers.forEach((handlers, eventName) => {
      handlers.forEach(handler => {
        if (this.socket) {
          this.socket.on(eventName, handler);
        }
      });
    });
  }

  /**
   * Update connection state
   */
  private updateConnectionState(updates: Partial<ConnectionState>): void {
    const currentState = this.connectionState.value;
    const newState = { ...currentState, ...updates };
    this.connectionState.next(newState);
    
    console.log('Connection state updated:', newState);
  }

  /**
   * Cleanup socket resources
   */
  private cleanup(): void {
    if (this.socket) {
      this.socket.removeAllListeners();
      this.socket.disconnect();
      this.socket = null;
    }
    
    if (this.reconnectionTimer) {
      clearTimeout(this.reconnectionTimer);
      this.reconnectionTimer = null;
    }
    
    this.stopHeartbeat();
  }

  /**
   * Disconnect from Socket.IO server
   */
  disconnect(): void {
    console.log('Manually disconnecting socket');
    
    this.updateConnectionState({ 
      connected: false, 
      connecting: false 
    });
    
    this.cleanup();
  }

  /**
   * Get connection status observable
   */
  getConnectionStatus(): Observable<boolean> {
    return this.connectionState.asObservable().pipe(
      map(state => state.connected)
    );
  }

  /**
   * Get detailed connection state
   */
  getConnectionState(): Observable<ConnectionState> {
    return this.connectionState.asObservable();
  }

  /**
   * Subscribe to file updates room
   */
  subscribeToFileUpdates(): void {
    if (this.socket?.connected) {
      console.log('Subscribing to file updates');
      this.socket.emit('subscribe-file-updates');
    } else {
      console.warn('Cannot subscribe to file updates - socket not connected');
    }
  }

  /**
   * Subscribe to radio updates room
   */
  subscribeToRadioUpdates(): void {
    if (this.socket?.connected) {
      console.log('Subscribing to radio updates');
      this.socket.emit('subscribe-radio-updates');
    } else {
      console.warn('Cannot subscribe to radio updates - socket not connected');
    }
  }
  /**
   * Enhanced event listener with handler tracking
   */
  onEvent<T = any>(eventName: string): Observable<T> {
    return new Observable<T>(observer => {
      if (!this.socket) {
        console.error('Socket not connected when setting up event listener');
        observer.error('Socket not connected');
        return;
      }

      const handler = (data: T) => {
        console.log(`Received event '${eventName}':`, data);
        observer.next(data);
      };

      // Track handler for restoration after reconnection
      if (!this.eventHandlers.has(eventName)) {
        this.eventHandlers.set(eventName, []);
      }
      this.eventHandlers.get(eventName)!.push(handler);

      this.socket.on(eventName, handler);

      // Cleanup function
      return () => {
        if (this.socket) {
          this.socket.off(eventName, handler);
        }
        
        // Remove from tracked handlers
        const handlers = this.eventHandlers.get(eventName);
        if (handlers) {
          const index = handlers.indexOf(handler);
          if (index > -1) {
            handlers.splice(index, 1);
          }
        }
      };
    }).pipe(
      retry({ count: 3, delay: 1000 }),
      catchError(error => {
        console.error(`Error in event listener for '${eventName}':`, error);
        throw error; // Re-throw instead of returning null
      })
    );
  }

  /**
   * Emit event to server with connection check
   */
  emit(eventName: string, data?: any): void {
    if (this.socket?.connected) {
      console.log(`Emitting event '${eventName}':`, data);
      this.socket.emit(eventName, data);
    } else {
      console.warn(`Cannot emit event '${eventName}' - socket not connected`);
      
      // Queue the event for sending after reconnection
      this.queueEventForReconnection(eventName, data);
    }
  }

  /**
   * Queue events to be sent after reconnection
   */
  private queuedEvents: Array<{eventName: string, data: any}> = [];
  
  private queueEventForReconnection(eventName: string, data: any): void {
    this.queuedEvents.push({ eventName, data });
    
    // Limit queue size
    if (this.queuedEvents.length > 10) {
      this.queuedEvents.shift();
    }
    
    console.log(`Queued event '${eventName}' for sending after reconnection`);
  }

  /**
   * Send queued events after reconnection
   */
  private sendQueuedEvents(): void {
    if (this.queuedEvents.length > 0) {
      console.log(`Sending ${this.queuedEvents.length} queued events`);
      
      this.queuedEvents.forEach(({ eventName, data }) => {
        this.emit(eventName, data);
      });
      
      this.queuedEvents = [];
    }
  }

  /**
   * Specialized event listeners with enhanced error handling
   */
  onEncodingProgress(): Observable<EncodingProgressEvent> {
    return this.onEvent<EncodingProgressEvent>('encoding-progress');
  }

  onEncodingCompleted(): Observable<EncodingCompletedEvent> {
    return this.onEvent<EncodingCompletedEvent>('encoding-completed');
  }

  onEncodingFailed(): Observable<EncodingFailedEvent> {
    return this.onEvent<EncodingFailedEvent>('encoding-failed');
  }

  onEncodingCancelled(): Observable<EncodingCancelledEvent> {
    return this.onEvent<EncodingCancelledEvent>('encoding-cancelled');
  }

  onFilesUploaded(): Observable<FilesUploadedEvent> {
    return this.onEvent<FilesUploadedEvent>('files-uploaded');
  }

  onFileDeleted(): Observable<FileDeletedEvent> {
    return this.onEvent<FileDeletedEvent>('file-deleted');
  }

  /**
   * NEW: Listen to encoding reset events (for job recovery)
   */
  onEncodingReset(): Observable<{fileId: string, message: string}> {
    return this.onEvent<{fileId: string, message: string}>('encoding-reset');
  }

  /**
   * Check if socket is connected
   */
  isConnected(): boolean {
    return this.socket?.connected || false;
  }

  /**
   * Get socket ID
   */
  getSocketId(): string | undefined {
    return this.socket?.id;
  }

  /**
   * Force reconnection (manual)
   */
  forceReconnect(): void {
    console.log('Forcing reconnection');
    
    this.updateConnectionState({ reconnectAttempts: 0 });
    this.cleanup();
    
    setTimeout(() => {
      this.connect();
    }, 1000);
  }

  /**
   * Get connection statistics
   */
  getConnectionStats(): any {
    const state = this.connectionState.value;
    
    return {
      connected: state.connected,
      connecting: state.connecting,
      lastConnected: state.lastConnected,
      reconnectAttempts: state.reconnectAttempts,
      maxReconnectAttempts: state.maxReconnectAttempts,
      socketId: this.socket?.id,
      transport: this.socket?.io?.engine?.transport?.name,
      queuedEvents: this.queuedEvents.length,
      trackedEvents: this.eventHandlers.size
    };
  }
}