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
} from '../types/index.js';

const TIMEOUT_MS = 60000; // 60 seconds
const KILL_GRACE_MS = 5000; // 5 seconds for SIGKILL
const MAX_RETRIES = 2;
const RETRY_DELAY_MS = 1000;

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
  private subjectPrompts: Map<Subject, string> = new Map();

  async initialize(): Promise<void> {
    this.basePrompt = await readFile(
      join(process.cwd(), 'src/prompts/base-tutor.md'),
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
    return `${this.basePrompt}\n\n${subjectPrompt}`;
  }

  async chat(message: string, sessionId?: string, subject?: Subject): Promise<ChatResponse> {
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
        return await this.executeQuery(request);
      } catch (error) {
        lastError = error as Error;

        if (attempt < MAX_RETRIES && this.isRetryableError(lastError)) {
          console.log(
            `[ClaudeBridge] Retry ${attempt + 1}/${MAX_RETRIES} after error: ${lastError.message}`
          );
          await this.delay(RETRY_DELAY_MS);
          continue;
        }

        throw lastError;
      }
    }

    throw lastError;
  }

  private executeQuery(request: QueuedRequest): Promise<ChatResponse> {
    return new Promise((resolve, reject) => {
      const isNewSession = !request.sessionId && !this.currentSessionId;
      const subject = request.subject || 'math';

      // If starting new session with different subject, reset
      if (isNewSession || (request.subject && request.subject !== this.currentSubject)) {
        this.currentSubject = subject;
        this.currentSessionId = null;
      }

      const args = this.buildArgs(!this.currentSessionId, subject);

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
        const { text, parsedSessionId } = this.parseOutput(stdout);

        if (parsedSessionId) {
          this.currentSessionId = parsedSessionId;
        }

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
      child.stdin.write(request.message);
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
      'sonnet',
    ];

    if (isNewSession) {
      // New session - include system prompt and tool restrictions
      const systemPrompt = this.getSystemPrompt(subject);
      args.push('--append-system-prompt', systemPrompt);
      args.push('--disallowedTools', DISALLOWED_TOOLS);
    } else {
      // Continue existing session
      args.push('--continue');
    }

    return args;
  }

  private parseOutput(stdout: string): {
    text: string;
    parsedSessionId: string | null;
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

    return { text, parsedSessionId };
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
}
