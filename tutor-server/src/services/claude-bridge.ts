import { spawn } from 'child_process';
import { EventEmitter } from 'events';
import { readFile } from 'fs/promises';
import { join } from 'path';
import type {
  ChatResponse,
  QueuedRequest,
  StreamMessage,
  InitMessage,
  AssistantMessage,
  ResultMessage,
  Subject,
  MemoryUpdate,
} from '../types/index.js';
import { memoryManager } from './memory-manager.js';

const TIMEOUT_MS = 60000; // 60 seconds
const KILL_GRACE_MS = 5000; // 5 seconds for SIGKILL
const MAX_RETRIES = 2;
const RETRY_DELAY_MS = 1000;

// Circuit Breaker configuration
const CIRCUIT_FAILURE_THRESHOLD = 3;
const CIRCUIT_RESET_TIMEOUT_MS = 30000; // 30 seconds

type CircuitState = 'CLOSED' | 'OPEN' | 'HALF_OPEN';

class CircuitBreaker {
  private state: CircuitState = 'CLOSED';
  private failureCount = 0;
  private lastFailureTime = 0;

  canExecute(): boolean {
    if (this.state === 'CLOSED') return true;

    if (this.state === 'OPEN') {
      if (Date.now() - this.lastFailureTime >= CIRCUIT_RESET_TIMEOUT_MS) {
        this.state = 'HALF_OPEN';
        console.log('[CircuitBreaker] State changed: OPEN -> HALF_OPEN');
        return true;
      }
      return false;
    }

    // HALF_OPEN: allow one test request
    return true;
  }

  recordSuccess(): void {
    if (this.state !== 'CLOSED') {
      console.log(`[CircuitBreaker] State changed: ${this.state} -> CLOSED`);
    }
    this.failureCount = 0;
    this.state = 'CLOSED';
  }

  recordFailure(): void {
    this.failureCount++;
    this.lastFailureTime = Date.now();

    if (this.failureCount >= CIRCUIT_FAILURE_THRESHOLD || this.state === 'HALF_OPEN') {
      const prevState = this.state;
      this.state = 'OPEN';
      console.log(`[CircuitBreaker] State changed: ${prevState} -> OPEN (failures: ${this.failureCount})`);
    }
  }

  getState(): CircuitState {
    return this.state;
  }
}

const DISALLOWED_TOOLS = [
  'Bash',
  'Edit',
  'Write',
  'Read',
  'Glob',
  'Grep',
  'Task',
  'WebFetch',
  'WebSearch',
  'LS',
  'MultiEdit',
  'NotebookEdit',
  'TodoWrite',
].join(',');

const SUBJECT_PROMPT_FILES: Record<Subject, string> = {
  math: 'math-tutor.md',
  science: 'science-tutor.md',
  english: 'english-tutor.md',
  korean: 'korean-tutor.md',
};

export class ClaudeBridge extends EventEmitter {
  private queue: QueuedRequest[] = [];
  private processing = false;
  private currentSessionId: string | null = null;
  private currentSubject: Subject = 'math';
  private basePrompt: string = '';
  private memoryInstructionsPrompt: string = '';
  private subjectPrompts: Map<Subject, string> = new Map();
  private circuitBreaker = new CircuitBreaker();

  async initialize(): Promise<void> {
    this.basePrompt = await readFile(
      join(process.cwd(), 'src/prompts/base-tutor.md'),
      'utf-8'
    );

    // Load memory instructions prompt
    this.memoryInstructionsPrompt = await readFile(
      join(process.cwd(), 'src/prompts/memory-instructions.md'),
      'utf-8'
    );

    // Load all subject prompts
    for (const [subject, filename] of Object.entries(SUBJECT_PROMPT_FILES)) {
      const prompt = await readFile(
        join(process.cwd(), 'src/prompts', filename),
        'utf-8'
      );
      this.subjectPrompts.set(subject as Subject, prompt);
    }

    console.log('[ClaudeBridge] System prompts loaded for all subjects');
  }

  private getSystemPrompt(subject: Subject): string {
    const subjectPrompt = this.subjectPrompts.get(subject) || '';
    const memoryContext = memoryManager.getMemoryPromptSection();

    return `${this.basePrompt}

## 현재 기억된 학생 정보
${memoryContext}

${this.memoryInstructionsPrompt}

${subjectPrompt}`;
  }

  async chat(message: string, sessionId?: string, subject?: Subject): Promise<ChatResponse> {
    // Circuit breaker check - reject immediately if circuit is open
    if (!this.circuitBreaker.canExecute()) {
      console.log('[ClaudeBridge] Circuit breaker OPEN, rejecting request');
      return {
        text: '잠시 문제가 생겼어요. 조금 후에 다시 해볼까? 🙏',
        sessionId: sessionId || this.currentSessionId || '',
        isError: true,
      };
    }

    return new Promise((resolve, reject) => {
      // Default to math if no subject specified
      const effectiveSubject = subject || this.currentSubject;
      this.queue.push({ message, sessionId, subject: effectiveSubject, resolve, reject });
      this.processQueue();
    });
  }

  private async processQueue(): Promise<void> {
    if (this.processing || this.queue.length === 0) return;
    this.processing = true;

    const request = this.queue.shift()!;

    try {
      const response = await this.executeWithRetry(request);
      request.resolve(response);
    } catch (error) {
      request.reject(error as Error);
    }

    this.processing = false;
    this.processQueue();
  }

  private isRetryableError(error: Error): boolean {
    const message = error.message.toLowerCase();
    return (
      message.includes('timeout') ||
      message.includes('econnreset') ||
      message.includes('spawn') ||
      message.includes('enoent')
    );
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  private async executeWithRetry(request: QueuedRequest): Promise<ChatResponse> {
    let lastError: Error = new Error('Unknown error');

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      try {
        const result = await this.executeQuery(request);
        this.circuitBreaker.recordSuccess();
        return result;
      } catch (error) {
        lastError = error as Error;

        if (attempt < MAX_RETRIES && this.isRetryableError(lastError)) {
          console.log(
            `[ClaudeBridge] Retry ${attempt + 1}/${MAX_RETRIES} after error: ${lastError.message}`
          );
          await this.delay(RETRY_DELAY_MS);
          continue;
        }

        // Record failure after all retries exhausted
        this.circuitBreaker.recordFailure();
        throw lastError;
      }
    }

    this.circuitBreaker.recordFailure();
    throw lastError;
  }

  private executeQuery(request: QueuedRequest): Promise<ChatResponse> {
    return new Promise((resolve, reject) => {
      const subject = request.subject || 'math';

      // Client sends no sessionId = wants new session
      // OR different subject = reset session
      const clientWantsNewSession = !request.sessionId;
      const subjectChanged = request.subject && request.subject !== this.currentSubject;

      if (clientWantsNewSession || subjectChanged) {
        this.currentSubject = subject;
        this.currentSessionId = null;
      }

      const isNewSession = !this.currentSessionId;
      const args = this.buildArgs(isNewSession, subject);

      console.log('[ClaudeBridge] Spawning claude with args:', args.join(' '));

      const child = spawn('claude', args, {
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      let stdout = '';
      let stderr = '';
      let killed = false;

      // Timeout handling (SIGTERM -> SIGKILL pattern)
      const timeout = setTimeout(() => {
        killed = true;
        console.log('[ClaudeBridge] Timeout, sending SIGTERM');
        child.kill('SIGTERM');

        setTimeout(() => {
          if (!child.killed) {
            console.log('[ClaudeBridge] Grace period expired, sending SIGKILL');
            child.kill('SIGKILL');
          }
        }, KILL_GRACE_MS);
      }, TIMEOUT_MS);

      child.stdout.on('data', (data: Buffer) => {
        stdout += data.toString();
      });

      child.stderr.on('data', (data: Buffer) => {
        stderr += data.toString();
      });

      child.on('close', (code) => {
        clearTimeout(timeout);

        if (killed) {
          reject(new Error('Request timed out'));
          return;
        }

        if (code !== 0) {
          console.error('[ClaudeBridge] CLI error:', stderr);
          reject(new Error(`CLI exited with code ${code}: ${stderr}`));
          return;
        }

        // Parse NDJSON output
        const { text, parsedSessionId, memoryUpdates } = this.parseOutput(stdout);

        if (parsedSessionId) {
          this.currentSessionId = parsedSessionId;
        }

        // Apply memory updates (async but don't wait)
        if (memoryUpdates.length > 0) {
          memoryManager.applyMemoryUpdates(memoryUpdates).catch((err) => {
            console.error('[ClaudeBridge] Failed to apply memory updates:', err);
          });
        }

        // Check for compaction in response (async but don't wait)
        memoryManager.extractAndApplyCompaction(text).catch((err) => {
          console.error('[ClaudeBridge] Failed to apply compaction:', err);
        });

        resolve({
          text,
          sessionId: this.currentSessionId || '',
          isError: false,
        });
      });

      child.on('error', (error) => {
        clearTimeout(timeout);
        reject(error);
      });

      // Send message via stdin
      // Add hints for resumed sessions (system prompt not re-sent)
      const messageToSend = isNewSession
        ? request.message
        : `${request.message}\n\n(힌트: 학생 정보를 어떻게 아는지 물으면 "원래 알고 있었지~" 처럼 자연스럽게. 새 정보가 있으면 [MEMORY:key=value] 형식으로 응답 끝에 기록)`;
      child.stdin.write(messageToSend);
      child.stdin.end();
    });
  }

  private buildArgs(isNewSession: boolean, subject: Subject): string[] {
    const args = [
      '-p',
      '--output-format',
      'stream-json',
      '--verbose', // REQUIRED with stream-json
      '--model',
      'haiku',
    ];

    if (isNewSession) {
      // New session - include system prompt and tool restrictions
      const systemPrompt = this.getSystemPrompt(subject);
      args.push('--append-system-prompt', systemPrompt);
      args.push('--disallowedTools', DISALLOWED_TOOLS);
    } else {
      // Resume existing session with specific session ID
      args.push('--resume', this.currentSessionId!);
    }

    return args;
  }

  private parseOutput(stdout: string): {
    text: string;
    parsedSessionId: string | null;
    memoryUpdates: MemoryUpdate[];
  } {
    const lines = stdout.split('\n').filter((line) => line.trim());
    let text = '';
    let parsedSessionId: string | null = null;

    for (const line of lines) {
      try {
        const json: StreamMessage = JSON.parse(line);

        if (json.type === 'system' && (json as InitMessage).subtype === 'init') {
          parsedSessionId = json.session_id;
          console.log('[ClaudeBridge] Session ID:', parsedSessionId);
        } else if (json.type === 'assistant') {
          const assistantMsg = json as AssistantMessage;
          const content = assistantMsg.message.content;
          if (content && content.length > 0) {
            text = content
              .filter((c) => c.type === 'text')
              .map((c) => c.text)
              .join('\n');
          }
        } else if (json.type === 'result') {
          const resultMsg = json as ResultMessage;
          // Use result text as fallback if assistant text is empty
          if (!text && resultMsg.result) {
            text = resultMsg.result;
          }
          if (resultMsg.is_error) {
            console.error('[ClaudeBridge] Result error:', resultMsg.result);
          }
        }
      } catch {
        // Skip non-JSON lines (e.g., empty lines, debug output)
      }
    }

    // Debug: log raw response text
    console.log('[ClaudeBridge] Raw response:', text.substring(0, 200));

    // Extract memory markers and clean text
    const memoryUpdates = memoryManager.extractMemoryFromResponse(text);
    if (memoryUpdates.length > 0) {
      console.log('[ClaudeBridge] Found memory markers:', memoryUpdates);
    } else {
      console.log('[ClaudeBridge] No memory markers found in response');
    }
    const cleanText = memoryManager.stripMemoryMarkers(text);

    return { text: cleanText, parsedSessionId, memoryUpdates };
  }

  // Reset session (for starting a new conversation)
  resetSession(): void {
    this.currentSessionId = null;
    console.log('[ClaudeBridge] Session reset');
  }

  // Get current session ID
  getSessionId(): string | null {
    return this.currentSessionId;
  }

  // Get current subject
  getCurrentSubject(): Subject {
    return this.currentSubject;
  }

  // Get circuit breaker state
  getCircuitState(): CircuitState {
    return this.circuitBreaker.getState();
  }

  /**
   * Run memory compaction if needed (called periodically or on-demand)
   */
  async runCompactionIfNeeded(): Promise<boolean> {
    if (!memoryManager.needsCompaction()) {
      return false;
    }

    console.log('[ClaudeBridge] Starting memory compaction...');

    try {
      const prompt = memoryManager.buildCompactionPrompt();
      const result = await this.executeCompactionQuery(prompt);

      if (result) {
        const success = await memoryManager.applyCompactedMemory(result);
        if (success) {
          console.log('[ClaudeBridge] Memory compaction completed');
          return true;
        }
      }

      console.log('[ClaudeBridge] Memory compaction failed');
      return false;
    } catch (error) {
      console.error('[ClaudeBridge] Compaction error:', error);
      return false;
    }
  }

  /**
   * Execute compaction query (separate from chat, no session)
   */
  private executeCompactionQuery(prompt: string): Promise<string | null> {
    return new Promise((resolve) => {
      const args = [
        '-p',
        '--output-format',
        'stream-json',
        '--verbose',
        '--model',
        'haiku',
      ];

      console.log('[ClaudeBridge] Running compaction query');

      const child = spawn('claude', args, {
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      let stdout = '';
      let killed = false;

      const timeout = setTimeout(() => {
        killed = true;
        child.kill('SIGTERM');
      }, 30000); // 30s timeout for compaction

      child.stdout.on('data', (data: Buffer) => {
        stdout += data.toString();
      });

      child.on('close', (code) => {
        clearTimeout(timeout);

        if (killed || code !== 0) {
          resolve(null);
          return;
        }

        // Extract text from response
        const lines = stdout.split('\n').filter((line) => line.trim());
        let text = '';

        for (const line of lines) {
          try {
            const json = JSON.parse(line);
            if (json.type === 'assistant') {
              const content = json.message?.content;
              if (content && content.length > 0) {
                text = content
                  .filter((c: { type: string }) => c.type === 'text')
                  .map((c: { text: string }) => c.text)
                  .join('\n');
              }
            } else if (json.type === 'result' && !text) {
              text = json.result || '';
            }
          } catch {
            // Skip non-JSON
          }
        }

        resolve(text || null);
      });

      child.on('error', () => {
        clearTimeout(timeout);
        resolve(null);
      });

      child.stdin.write(prompt);
      child.stdin.end();
    });
  }
}
