/**
 * WebSocket Handler for Dashboard
 *
 * Provides real-time updates for:
 * - Agent logs streaming
 * - Agent status changes
 * - Artefact updates
 */
import http from 'http';
import { createHash } from 'crypto';

// WebSocket opcodes
const OPCODE_TEXT = 0x1;
const OPCODE_CLOSE = 0x8;
const OPCODE_PING = 0x9;
const OPCODE_PONG = 0xa;

// Message types
export type WsMessageType =
  | 'connected'
  | 'agent:log'
  | 'agent:status'
  | 'artefact:updated'
  | 'error';

export interface WsMessage {
  type: WsMessageType;
  taskId?: string;
  line?: string;
  status?: string;
  id?: string;
  message?: string;
  timestamp: string;
}

// Store active WebSocket connections
const connections = new Set<WebSocketConnection>();

interface WebSocketConnection {
  socket: import('net').Socket;
  send: (message: WsMessage) => void;
  close: () => void;
}

/**
 * Handle WebSocket upgrade request
 */
export function handleWebSocketUpgrade(
  req: http.IncomingMessage,
  socket: import('net').Socket
): void {
  const key = req.headers['sec-websocket-key'];

  if (!key) {
    socket.end('HTTP/1.1 400 Bad Request\r\n\r\n');
    return;
  }

  // Generate accept key
  const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
  const acceptKey = createHash('sha1')
    .update(key + GUID)
    .digest('base64');

  // Send handshake response
  const response = [
    'HTTP/1.1 101 Switching Protocols',
    'Upgrade: websocket',
    'Connection: Upgrade',
    `Sec-WebSocket-Accept: ${acceptKey}`,
    '',
    '',
  ].join('\r\n');

  socket.write(response);

  // Create connection wrapper
  const connection: WebSocketConnection = {
    socket,
    send: (message: WsMessage) => {
      try {
        const data = JSON.stringify(message);
        const frame = encodeFrame(data);
        socket.write(frame);
      } catch {
        // Ignore send errors (client might have disconnected)
      }
    },
    close: () => {
      const closeFrame = Buffer.from([0x88, 0x00]);
      socket.write(closeFrame);
      socket.end();
    },
  };

  connections.add(connection);

  // Send connected message
  connection.send({
    type: 'connected',
    message: 'WebSocket connected',
    timestamp: new Date().toISOString(),
  });

  // Handle incoming data
  socket.on('data', (buffer: Buffer) => {
    handleFrame(buffer, connection);
  });

  // Handle close
  socket.on('close', () => {
    connections.delete(connection);
  });

  socket.on('error', () => {
    connections.delete(connection);
  });
}

/**
 * Encode a WebSocket frame
 */
function encodeFrame(data: string): Buffer {
  const payload = Buffer.from(data, 'utf8');
  const length = payload.length;

  let frame: Buffer;

  if (length < 126) {
    frame = Buffer.alloc(2 + length);
    frame[0] = 0x81; // FIN + Text
    frame[1] = length;
    payload.copy(frame, 2);
  } else if (length < 65536) {
    frame = Buffer.alloc(4 + length);
    frame[0] = 0x81;
    frame[1] = 126;
    frame.writeUInt16BE(length, 2);
    payload.copy(frame, 4);
  } else {
    frame = Buffer.alloc(10 + length);
    frame[0] = 0x81;
    frame[1] = 127;
    frame.writeBigUInt64BE(BigInt(length), 2);
    payload.copy(frame, 10);
  }

  return frame;
}

/**
 * Handle incoming WebSocket frame
 */
function handleFrame(buffer: Buffer, connection: WebSocketConnection): void {
  if (buffer.length < 2) return;

  const opcode = buffer[0] & 0x0f;
  const masked = (buffer[1] & 0x80) !== 0;
  let payloadLength = buffer[1] & 0x7f;
  let offset = 2;

  if (payloadLength === 126) {
    payloadLength = buffer.readUInt16BE(2);
    offset = 4;
  } else if (payloadLength === 127) {
    payloadLength = Number(buffer.readBigUInt64BE(2));
    offset = 10;
  }

  let maskKey: Buffer | null = null;
  if (masked) {
    maskKey = buffer.subarray(offset, offset + 4);
    offset += 4;
  }

  const payload = buffer.subarray(offset, offset + payloadLength);

  // Unmask if needed
  if (maskKey) {
    for (let i = 0; i < payload.length; i++) {
      payload[i] ^= maskKey[i % 4];
    }
  }

  switch (opcode) {
    case OPCODE_TEXT:
      // We don't expect client messages, but handle gracefully
      break;
    case OPCODE_PING:
      // Respond with pong
      const pongFrame = Buffer.from([0x8a, payload.length, ...payload]);
      connection.socket.write(pongFrame);
      break;
    case OPCODE_CLOSE:
      connection.close();
      break;
  }
}

/**
 * Broadcast message to all connected clients
 */
export function broadcast(message: WsMessage): void {
  const msg = { ...message, timestamp: new Date().toISOString() };
  for (const conn of connections) {
    conn.send(msg);
  }
}

/**
 * Send agent log line
 */
export function sendAgentLog(taskId: string, line: string): void {
  broadcast({
    type: 'agent:log',
    taskId,
    line,
    timestamp: new Date().toISOString(),
  });
}

/**
 * Send agent status update
 */
export function sendAgentStatus(taskId: string, status: string): void {
  broadcast({
    type: 'agent:status',
    taskId,
    status,
    timestamp: new Date().toISOString(),
  });
}

/**
 * Send artefact update notification
 */
export function sendArtefactUpdated(id: string): void {
  broadcast({
    type: 'artefact:updated',
    id,
    timestamp: new Date().toISOString(),
  });
}

/**
 * Get count of active connections
 */
export function getConnectionCount(): number {
  return connections.size;
}

/**
 * Close all connections
 */
export function closeAll(): void {
  for (const conn of connections) {
    conn.close();
  }
  connections.clear();
}
