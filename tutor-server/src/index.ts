import express from 'express';
import { createServer } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { ClaudeBridge } from './services/claude-bridge.js';
import { historyWriter } from './services/history-writer.js';
import { usageLimiter } from './services/usage-limiter.js';
import type { WsIncomingMessage, WsOutgoingMessage, Subject } from './types/index.js';

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

  // Initialize services
  const claudeBridge = new ClaudeBridge();
  await claudeBridge.initialize();
  await historyWriter.init();
  await usageLimiter.init();
  console.log('[Server] All services initialized');

  // Serve static files
  app.use(express.static(join(__dirname, '../public')));

  // Health check endpoint
  app.get('/api/health', (_req, res) => {
    res.json({ status: 'ok' });
  });

  // Usage info endpoint
  app.get('/api/usage', (_req, res) => {
    res.json(usageLimiter.getUsageInfo());
  });

  // Reset session endpoint
  app.post('/api/reset', (_req, res) => {
    claudeBridge.resetSession();
    res.json({ status: 'ok', message: 'Session reset' });
  });

  // History endpoints
  app.get('/api/history/:date', async (req, res) => {
    const files = await historyWriter.getHistory(req.params.date);
    res.json({ files });
  });

  app.get('/api/history/:date/:sessionId', async (req, res) => {
    const content = await historyWriter.getHistoryContent(
      req.params.date,
      req.params.sessionId
    );
    if (content) {
      res.type('text/markdown').send(content);
    } else {
      res.status(404).json({ error: 'Not found' });
    }
  });

  // WebSocket connection handling
  wss.on('connection', (ws: WebSocket) => {
    console.log('[WS] Client connected');

    ws.on('message', async (data: Buffer) => {
      try {
        const message: WsIncomingMessage = JSON.parse(data.toString());

        if (message.type === 'chat') {
          // Check usage limit
          const canProceed = await usageLimiter.canMakeRequest();
          if (!canProceed) {
            sendMessage(ws, {
              type: 'error',
              payload: { message: '오늘 공부 많이 했어! 내일 또 만나자 😊' },
            });
            return;
          }

          // Send "thinking" status
          sendMessage(ws, {
            type: 'status',
            payload: { message: 'thinking' },
          });

          const subject: Subject = message.payload.subject || 'math';
          const isNewSession = !message.payload.sessionId;

          console.log('[WS] Processing message:', message.payload.message, 'subject:', subject);

          const response = await claudeBridge.chat(
            message.payload.message,
            message.payload.sessionId,
            subject
          );

          // Record usage
          await usageLimiter.recordRequest();

          // Start history session if new
          if (isNewSession && response.sessionId) {
            await historyWriter.startSession(response.sessionId, subject);
          }

          // Record messages to history
          if (response.sessionId) {
            await historyWriter.appendMessage(
              response.sessionId,
              'user',
              message.payload.message
            );
            await historyWriter.appendMessage(
              response.sessionId,
              'assistant',
              response.text
            );
          }

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
