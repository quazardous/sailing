/**
 * API Client for Dashboard
 *
 * Provides HTTP and WebSocket communication with the backend.
 */

import type {
  TreeResponse,
  ArtefactResponse,
  AgentsResponse,
  WsMessage,
} from './types';

// Base URL - in dev mode, Vite proxy handles this
const API_BASE = '/api';
const WS_BASE = `ws://${window.location.host}/ws`;

/**
 * HTTP client for REST API calls
 */
class ApiClient {
  private async fetch<T>(endpoint: string, options?: RequestInit): Promise<T> {
    const url = `${API_BASE}${endpoint}`;
    const response = await fetch(url, {
      headers: {
        'Content-Type': 'application/json',
        ...options?.headers,
      },
      ...options,
    });

    if (!response.ok) {
      throw new Error(`API error: ${response.status} ${response.statusText}`);
    }

    return response.json();
  }

  /**
   * Get artefact tree (PRDs with nested epics and tasks)
   */
  async getTree(): Promise<TreeResponse> {
    return this.fetch<TreeResponse>('/v2/tree');
  }

  /**
   * Get artefact details by ID
   */
  async getArtefact(id: string): Promise<ArtefactResponse> {
    return this.fetch<ArtefactResponse>(`/v2/artefact/${encodeURIComponent(id)}`);
  }

  /**
   * Get all agents status
   */
  async getAgents(): Promise<AgentsResponse> {
    return this.fetch<AgentsResponse>('/v2/agents');
  }

  /**
   * Refresh cache
   */
  async refresh(): Promise<{ status: string }> {
    return this.fetch('/refresh');
  }

  /**
   * Get raw data export
   */
  async getData(): Promise<unknown> {
    return this.fetch('/data');
  }
}

/**
 * WebSocket client for real-time updates
 */
class WsClient {
  private ws: WebSocket | null = null;
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 5;
  private reconnectDelay = 1000;
  private listeners: Map<string, Set<(msg: WsMessage) => void>> = new Map();

  /**
   * Connect to WebSocket server
   */
  connect(): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      return;
    }

    try {
      this.ws = new WebSocket(WS_BASE);

      this.ws.onopen = () => {
        console.log('[WS] Connected');
        this.reconnectAttempts = 0;
        this.emit({ type: 'connected' });
      };

      this.ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data) as WsMessage;
          this.emit(msg);
        } catch (e) {
          console.error('[WS] Failed to parse message:', e);
        }
      };

      this.ws.onclose = () => {
        console.log('[WS] Disconnected');
        this.scheduleReconnect();
      };

      this.ws.onerror = (error) => {
        console.error('[WS] Error:', error);
      };
    } catch (error) {
      console.error('[WS] Connection failed:', error);
      this.scheduleReconnect();
    }
  }

  /**
   * Disconnect from WebSocket server
   */
  disconnect(): void {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }

  /**
   * Subscribe to a message type
   */
  on(type: string, callback: (msg: WsMessage) => void): () => void {
    if (!this.listeners.has(type)) {
      this.listeners.set(type, new Set());
    }
    this.listeners.get(type)!.add(callback);

    // Return unsubscribe function
    return () => {
      this.listeners.get(type)?.delete(callback);
    };
  }

  /**
   * Subscribe to all messages
   */
  onAny(callback: (msg: WsMessage) => void): () => void {
    return this.on('*', callback);
  }

  private emit(msg: WsMessage): void {
    // Emit to specific type listeners
    this.listeners.get(msg.type)?.forEach((cb) => cb(msg));
    // Emit to wildcard listeners
    this.listeners.get('*')?.forEach((cb) => cb(msg));
  }

  private scheduleReconnect(): void {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      console.log('[WS] Max reconnect attempts reached');
      return;
    }

    this.reconnectAttempts++;
    const delay = this.reconnectDelay * Math.pow(2, this.reconnectAttempts - 1);
    console.log(`[WS] Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts})`);

    setTimeout(() => {
      this.connect();
    }, delay);
  }
}

// Export singleton instances
export const api = new ApiClient();
export const ws = new WsClient();
