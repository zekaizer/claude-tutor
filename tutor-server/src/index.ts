import express from 'express';
import { createServer } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { ClaudeBridge } from './services/claude-bridge.js';
import { historyWriter } from './services/history-writer.js';
import { usageLimiter } from './services/usage-limiter.js';
import { memoryManager } from './services/memory-manager.js';
import type { WsIncomingMessage, WsOutgoingMessage, Subject, WelcomeRequest, ChatRequest } from './types/index.js';
import { SUBJECT_NAMES } from './types/index.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 3000;

// Time period labels in Korean
const TIME_LABELS: Record<string, string> = {
  morning: '아침',
  lunch: '점심시간',
  afternoon: '오후',
  evening: '저녁',
  night: '밤늦은 시간',
};

// Build welcome prompt for Claude
function buildWelcomePrompt(subject: Subject, timePeriod: string): string {
  const subjectName = SUBJECT_NAMES[subject];
  const timeLabel = TIME_LABELS[timePeriod] || '오늘';

  if (subject === 'play') {
    return `지금은 ${timeLabel}이고, 초등학생이 놀러 왔어.
친근하고 재미있게 한두 문장으로 인사하고 뭐 하고 놀지 물어봐. 이모지 포함해도 좋아.`;
  }

  return `지금은 ${timeLabel}이고, 초등학생이 ${subjectName} 공부를 시작하려고 해.
친근하고 따뜻하게 한두 문장으로 인사해줘. 이모지 하나 포함해도 좋아.
시간대에 맞는 인사와 과목에 대한 기대감을 담아줘.`;
}

// Fallback welcome messages
function getFallbackWelcome(subject: Subject, timePeriod: string): string {
  const greetings: Record<string, string[]> = {
    morning: ['좋은 아침!', '일찍 일어났네!'],
    lunch: ['안녕!', '점심 먹었어?'],
    afternoon: ['안녕!', '오후도 화이팅!'],
    evening: ['좋은 저녁!', '저녁시간이네!'],
    night: ['늦은 시간인데 열심히 하네!', '조금만 하고 푹 쉬어!'],
  };

  const subjectPhrases: Record<Subject, string> = {
    math: '수학 공부하러 왔구나 🔢',
    science: '과학 공부하러 왔구나 🔬',
    english: '영어 공부하러 왔구나 🔤',
    korean: '국어 공부하러 왔구나 📖',
    play: '놀러 왔구나 🎮',
  };

  const timeGreetings = greetings[timePeriod] || greetings.afternoon;
  const greeting = timeGreetings[Math.floor(Math.random() * timeGreetings.length)];

  return `${greeting} ${subjectPhrases[subject]}\n무엇이든 물어봐!`;
}

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
  await memoryManager.init();
  console.log('[Server] All services initialized');

  // Serve static files
  app.use(express.static(join(__dirname, '../public')));

  // Health check endpoint
  app.get('/api/health', (_req, res) => {
    res.json({
      status: 'ok',
      circuitBreaker: claudeBridge.getCircuitState(),
    });
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
    const sessions = await historyWriter.getHistory(req.params.date);
    res.json({ sessions });
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

  // Memory endpoints (parental controls)
  app.get('/api/memory', (_req, res) => {
    res.json(memoryManager.getMemorySummary());
  });

  app.delete('/api/memory', async (_req, res) => {
    await memoryManager.clearMemory();
    res.json({ status: 'ok', message: 'Memory cleared' });
  });

  app.patch('/api/memory', express.json(), async (req, res) => {
    try {
      await memoryManager.updateMemory(req.body);
      res.json({ status: 'ok', message: 'Memory updated' });
    } catch (error) {
      res.status(400).json({ error: (error as Error).message });
    }
  });

  // Memory compaction endpoint
  app.post('/api/memory/compact', async (_req, res) => {
    const stats = memoryManager.getStats();
    const compacted = await claudeBridge.runCompactionIfNeeded();
    const newStats = memoryManager.getStats();

    res.json({
      status: compacted ? 'compacted' : 'skipped',
      before: stats,
      after: newStats,
    });
  });

  // WebSocket connection handling
  wss.on('connection', (ws: WebSocket) => {
    console.log('[WS] Client connected');

    ws.on('message', async (data: Buffer) => {
      try {
        const message: WsIncomingMessage = JSON.parse(data.toString());

        // Handle welcome message request
        if (message.type === 'welcome') {
          const payload = message.payload as WelcomeRequest;
          sendMessage(ws, { type: 'status', payload: { message: 'thinking' } });

          try {
            const welcomePrompt = buildWelcomePrompt(payload.subject, payload.timePeriod);
            const response = await claudeBridge.chat(welcomePrompt, undefined, payload.subject);

            sendMessage(ws, {
              type: 'response',
              payload: { text: response.text, sessionId: response.sessionId, isError: false },
            });
          } catch (error) {
            // Fallback to static message
            console.error('[WS] Welcome generation failed, using fallback:', error);
            const fallback = getFallbackWelcome(payload.subject, payload.timePeriod);
            sendMessage(ws, {
              type: 'response',
              payload: { text: fallback, sessionId: '', isError: false },
            });
          }
          return;
        }

        if (message.type === 'chat') {
          const chatPayload = message.payload as ChatRequest;
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

          const subject: Subject = chatPayload.subject || 'math';

          console.log('[WS] Processing message:', chatPayload.message, 'subject:', subject);

          const response = await claudeBridge.chat(
            chatPayload.message,
            chatPayload.sessionId,
            subject
          );

          // Record usage
          await usageLimiter.recordRequest();

          // Start history session if new (response has different/new sessionId)
          const isNewSession = response.sessionId && response.sessionId !== chatPayload.sessionId;
          const sessionNotTracked = response.sessionId && !historyWriter.getSessionInfo(response.sessionId);
          if ((isNewSession || sessionNotTracked) && response.sessionId) {
            await historyWriter.startSession(response.sessionId, subject);
          }

          // Record messages to history
          if (response.sessionId) {
            await historyWriter.appendMessage(
              response.sessionId,
              'user',
              chatPayload.message
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

  // Handle server errors
  server.on('error', (error: NodeJS.ErrnoException) => {
    if (error.code === 'EADDRINUSE') {
      console.error(`[Server] Port ${PORT} is already in use. Kill the existing process or use a different port.`);
      process.exit(1);
    }
    throw error;
  });

  // Graceful shutdown
  const shutdown = () => {
    console.log('\n[Server] Shutting down...');
    wss.clients.forEach((client) => client.close());
    server.close(() => {
      console.log('[Server] Closed');
      process.exit(0);
    });
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  server.listen(PORT, () => {
    console.log(`[Server] Running on http://localhost:${PORT}`);
  });
}

main().catch(console.error);
