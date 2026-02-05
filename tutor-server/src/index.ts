import express from 'express';
import { createServer } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { ClaudeBridge } from './services/claude-bridge.js';
import type { WsIncomingMessage, WsOutgoingMessage } from './types/index.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 3000;

function sendMessage(ws: WebSocket, message: WsOutgoingMessage): void {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(message));
  }
}

async function main() {
  const app = express();
  const server = createServer(app);
  const wss = new WebSocketServer({ server });

  // Initialize Claude Bridge
  const claudeBridge = new ClaudeBridge();
  await claudeBridge.initialize();
  console.log('[Server] Claude Bridge initialized');

  // Serve static files
  app.use(express.static(join(__dirname, '../public')));

  // Health check endpoint
  app.get('/api/health', (_req, res) => {
    res.json({ status: 'ok' });
  });

  // Reset session endpoint
  app.post('/api/reset', (_req, res) => {
    claudeBridge.resetSession();
    res.json({ status: 'ok', message: 'Session reset' });
  });

  // WebSocket connection handling
  wss.on('connection', (ws: WebSocket) => {
    console.log('[WS] Client connected');

    ws.on('message', async (data: Buffer) => {
      try {
        const message: WsIncomingMessage = JSON.parse(data.toString());

        if (message.type === 'chat') {
          // Send "thinking" status
          sendMessage(ws, {
            type: 'status',
            payload: { message: 'thinking' },
          });

          console.log('[WS] Processing message:', message.payload.message);

          const response = await claudeBridge.chat(
            message.payload.message,
            message.payload.sessionId
          );

          console.log('[WS] Response received, length:', response.text.length);

          sendMessage(ws, {
            type: 'response',
            payload: response,
          });
        }
      } catch (error) {
        console.error('[WS] Error:', error);
        sendMessage(ws, {
          type: 'error',
          payload: { message: (error as Error).message },
        });
      }
    });

    ws.on('close', () => {
      console.log('[WS] Client disconnected');
    });

    ws.on('error', (error) => {
      console.error('[WS] WebSocket error:', error);
    });
  });

  server.listen(PORT, () => {
    console.log(`[Server] Running on http://localhost:${PORT}`);
  });
}

main().catch(console.error);
