/**
 * WebSocket Handler
 *
 * Manages WebSocket connections for real-time communication.
 * Implements a simple WebSocket protocol (RFC 6455) without external dependencies.
 *
 * Features:
 * - Connection management
 * - Message broadcasting
 * - Channel subscriptions
 * - Ping/pong keepalive
 */
import http from 'http';
import { Socket } from 'net';
import crypto from 'crypto';
import { getConductorManager } from '../managers/conductor-manager.js';
import { normalizeId } from '../lib/normalize.js';

// ============================================================================
// Types
// ============================================================================

export interface WebSocketClient {
  id: string;
  socket: Socket;
  subscriptions: Set<string>;
  isAlive: boolean;
}

export interface WebSocketMessage {
  type: string;
  [key: string]: any;
}

// ============================================================================
// WebSocket Handler
// ============================================================================

export class WebSocketHandler {
  private clients: Map<string, WebSocketClient> = new Map();
  private pingInterval: NodeJS.Timeout | null = null;
  private messageHandlers: Map<string, (client: WebSocketClient, payload: any) => void> = new Map();

  constructor() {
    // Setup ping interval
    this.pingInterval = setInterval(() => {
      this.ping();
    }, 30000);

    // Register message handlers
    this.registerHandlers();
  }

  /**
   * Handle HTTP upgrade to WebSocket
   */
  handleUpgrade(req: http.IncomingMessage, socket: Socket, head: Buffer) {
    const key = req.headers['sec-websocket-key'];
    if (!key) {
      socket.destroy();
      return;
    }

    // Generate accept key
    const acceptKey = crypto
      .createHash('sha1')
      .update(key + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11')
      .digest('base64');

    // Send upgrade response
    const response = [
      'HTTP/1.1 101 Switching Protocols',
      'Upgrade: websocket',
      'Connection: Upgrade',
      `Sec-WebSocket-Accept: ${acceptKey}`,
      '',
      ''
    ].join('\r\n');

    socket.write(response);

    // Create client
    const clientId = crypto.randomUUID();
    const client: WebSocketClient = {
      id: clientId,
      socket,
      subscriptions: new Set(),
      isAlive: true
    };
    this.clients.set(clientId, client);

    // Setup socket handlers
    socket.on('data', (data) => this.handleData(client, data));
    socket.on('close', () => this.handleClose(client));
    socket.on('error', () => this.handleClose(client));

    // Send welcome message
    this.send(client, {
      type: 'connected',
      clientId
    });
  }

  /**
   * Handle incoming data
   */
  private handleData(client: WebSocketClient, data: Buffer) {
    try {
      const frame = this.decodeFrame(data);
      if (!frame) return;

      // Handle opcodes
      switch (frame.opcode) {
        case 0x8: // Close
          this.handleClose(client);
          break;
        case 0x9: // Ping
          this.sendPong(client);
          break;
        case 0xa: // Pong
          client.isAlive = true;
          break;
        case 0x1: // Text
          this.handleMessage(client, frame.payload);
          break;
      }
    } catch (e) {
      // Ignore parse errors
    }
  }

  /**
   * Handle incoming message
   */
  private handleMessage(client: WebSocketClient, payload: string) {
    try {
      const message = JSON.parse(payload) as WebSocketMessage;
      const handler = this.messageHandlers.get(message.type);

      if (handler) {
        handler(client, message);
      } else {
        this.send(client, {
          type: 'error',
          error: `Unknown message type: ${message.type}`
        });
      }
    } catch (e) {
      this.send(client, {
        type: 'error',
        error: 'Invalid JSON'
      });
    }
  }

  /**
   * Register message handlers
   */
  private registerHandlers() {
    const conductor = getConductorManager();

    // Subscribe to channel
    this.messageHandlers.set('subscribe', (client, msg) => {
      const channel = msg.channel as string;
      const filter = msg.filter as string | undefined;

      if (channel) {
        const sub = filter ? `${channel}:${filter}` : channel;
        client.subscriptions.add(sub);
        this.send(client, {
          type: 'subscribed',
          channel,
          filter
        });
      }
    });

    // Unsubscribe from channel
    this.messageHandlers.set('unsubscribe', (client, msg) => {
      const channel = msg.channel as string;
      const filter = msg.filter as string | undefined;

      if (channel) {
        const sub = filter ? `${channel}:${filter}` : channel;
        client.subscriptions.delete(sub);
        this.send(client, {
          type: 'unsubscribed',
          channel,
          filter
        });
      }
    });

    // Spawn agent
    this.messageHandlers.set('spawn', async (client, msg) => {
      const taskId = normalizeId(msg.taskId);
      const result = await conductor.spawn(taskId, msg.options || {});
      this.send(client, {
        type: 'spawn:result',
        taskId,
        ...result
      });
    });

    // Reap agent
    this.messageHandlers.set('reap', async (client, msg) => {
      const taskId = normalizeId(msg.taskId);
      const result = await conductor.reap(taskId, msg.options || {});
      this.send(client, {
        type: 'reap:result',
        taskId,
        ...result
      });
    });

    // Kill agent
    this.messageHandlers.set('kill', async (client, msg) => {
      const taskId = normalizeId(msg.taskId);
      const result = await conductor.kill(taskId);
      this.send(client, {
        type: 'kill:result',
        taskId,
        ...result
      });
    });

    // Get agent status
    this.messageHandlers.set('status', (client, msg) => {
      const taskId = normalizeId(msg.taskId);
      const status = conductor.getStatus(taskId);
      this.send(client, {
        type: 'status:result',
        taskId,
        status
      });
    });

    // Get agent log
    this.messageHandlers.set('log', (client, msg) => {
      const taskId = normalizeId(msg.taskId);
      const lines = conductor.getLog(taskId, { tail: msg.tail || 100 });
      this.send(client, {
        type: 'log:result',
        taskId,
        lines
      });
    });

    // List all agents
    this.messageHandlers.set('list', (client) => {
      const agents = conductor.getAllAgents();
      this.send(client, {
        type: 'list:result',
        agents
      });
    });

    // Ping (client keepalive)
    this.messageHandlers.set('ping', (client) => {
      client.isAlive = true;
      this.send(client, { type: 'pong' });
    });
  }

  /**
   * Handle connection close
   */
  private handleClose(client: WebSocketClient) {
    this.clients.delete(client.id);
    try {
      client.socket.destroy();
    } catch {}
  }

  /**
   * Send message to client
   */
  send(client: WebSocketClient, message: Record<string, any>) {
    if (client.socket.destroyed) return;

    try {
      const payload = JSON.stringify(message);
      const frame = this.encodeFrame(payload);
      client.socket.write(frame);
    } catch (e) {
      // Ignore send errors
    }
  }

  /**
   * Broadcast message to all clients (optionally filtered by subscription)
   */
  broadcast(message: WebSocketMessage) {
    const type = message.type;
    const taskId = message.taskId;

    for (const client of this.clients.values()) {
      // Check if client is subscribed to this type
      const subscribed =
        client.subscriptions.size === 0 || // No subscriptions = receive all
        client.subscriptions.has(type) ||
        client.subscriptions.has('*') ||
        (taskId && client.subscriptions.has(`${type}:${taskId}`)) ||
        (taskId && client.subscriptions.has(`logs:${taskId}`));

      if (subscribed) {
        this.send(client, message);
      }
    }
  }

  /**
   * Send ping to all clients
   */
  private ping() {
    for (const client of this.clients.values()) {
      if (!client.isAlive) {
        this.handleClose(client);
        continue;
      }

      client.isAlive = false;
      try {
        // Send WebSocket ping frame
        const pingFrame = Buffer.from([0x89, 0x00]);
        client.socket.write(pingFrame);
      } catch {
        this.handleClose(client);
      }
    }
  }

  /**
   * Send pong frame
   */
  private sendPong(client: WebSocketClient) {
    try {
      const pongFrame = Buffer.from([0x8a, 0x00]);
      client.socket.write(pongFrame);
    } catch {}
  }

  /**
   * Decode WebSocket frame
   */
  private decodeFrame(data: Buffer): { opcode: number; payload: string } | null {
    if (data.length < 2) return null;

    const firstByte = data[0];
    const secondByte = data[1];

    const opcode = firstByte & 0x0f;
    const masked = (secondByte & 0x80) !== 0;
    let payloadLength = secondByte & 0x7f;

    let offset = 2;

    if (payloadLength === 126) {
      if (data.length < 4) return null;
      payloadLength = data.readUInt16BE(2);
      offset = 4;
    } else if (payloadLength === 127) {
      if (data.length < 10) return null;
      payloadLength = Number(data.readBigUInt64BE(2));
      offset = 10;
    }

    let maskKey: Buffer | null = null;
    if (masked) {
      if (data.length < offset + 4) return null;
      maskKey = data.subarray(offset, offset + 4);
      offset += 4;
    }

    if (data.length < offset + payloadLength) return null;

    let payload = data.subarray(offset, offset + payloadLength);

    // Unmask if needed
    if (maskKey) {
      payload = Buffer.from(payload);
      for (let i = 0; i < payload.length; i++) {
        payload[i] ^= maskKey[i % 4];
      }
    }

    return {
      opcode,
      payload: payload.toString('utf8')
    };
  }

  /**
   * Encode WebSocket frame
   */
  private encodeFrame(payload: string): Buffer {
    const payloadBuffer = Buffer.from(payload, 'utf8');
    const payloadLength = payloadBuffer.length;

    let header: Buffer;

    if (payloadLength <= 125) {
      header = Buffer.from([0x81, payloadLength]);
    } else if (payloadLength <= 65535) {
      header = Buffer.alloc(4);
      header[0] = 0x81;
      header[1] = 126;
      header.writeUInt16BE(payloadLength, 2);
    } else {
      header = Buffer.alloc(10);
      header[0] = 0x81;
      header[1] = 127;
      header.writeBigUInt64BE(BigInt(payloadLength), 2);
    }

    return Buffer.concat([header, payloadBuffer]);
  }

  /**
   * Close all connections
   */
  close() {
    if (this.pingInterval) {
      clearInterval(this.pingInterval);
      this.pingInterval = null;
    }

    for (const client of this.clients.values()) {
      try {
        // Send close frame
        const closeFrame = Buffer.from([0x88, 0x00]);
        client.socket.write(closeFrame);
        client.socket.destroy();
      } catch {}
    }

    this.clients.clear();
  }

  /**
   * Get connected client count
   */
  getClientCount(): number {
    return this.clients.size;
  }
}
