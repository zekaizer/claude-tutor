import { promises as fs } from 'fs';
import path from 'path';
import os from 'os';
import type { Subject, SessionInfo, HistoryEntry } from '../types/index.js';
import { SUBJECT_NAMES } from '../types/index.js';

const HISTORY_DIR = path.join(os.homedir(), 'tutor-history');
const SESSION_MAP_FILE = path.join(HISTORY_DIR, 'session-map.json');

export class HistoryWriter {
  private sessionMap: Map<string, SessionInfo> = new Map();
  private initialized = false;

  async init(): Promise<void> {
    if (this.initialized) return;

    await fs.mkdir(HISTORY_DIR, { recursive: true });
    await this.loadSessionMap();
    this.initialized = true;
    console.log('[HistoryWriter] Initialized at', HISTORY_DIR);
  }

  private async loadSessionMap(): Promise<void> {
    try {
      const data = await fs.readFile(SESSION_MAP_FILE, 'utf-8');
      const sessions: SessionInfo[] = JSON.parse(data);
      this.sessionMap = new Map(sessions.map((s) => [s.sessionId, s]));
    } catch {
      // File doesn't exist or invalid, start fresh
      this.sessionMap = new Map();
    }
  }

  private async saveSessionMap(): Promise<void> {
    const sessions = Array.from(this.sessionMap.values());
    await fs.writeFile(SESSION_MAP_FILE, JSON.stringify(sessions, null, 2));
  }

  private getDateDir(date: Date = new Date()): string {
    const dateStr = date.toISOString().split('T')[0];
    return path.join(HISTORY_DIR, dateStr);
  }

  private getSessionFilePath(sessionId: string, date: Date = new Date()): string {
    return path.join(this.getDateDir(date), `${sessionId}.md`);
  }

  async startSession(sessionId: string, subject: Subject): Promise<void> {
    const now = new Date();
    const dateDir = this.getDateDir(now);
    await fs.mkdir(dateDir, { recursive: true });

    // Create session info
    const sessionInfo: SessionInfo = {
      sessionId,
      subject,
      createdAt: now.toISOString(),
      messageCount: 0,
    };
    this.sessionMap.set(sessionId, sessionInfo);
    await this.saveSessionMap();

    // Create markdown file with header
    const header = `# ${SUBJECT_NAMES[subject]} 학습 기록

- 세션: ${sessionId}
- 날짜: ${now.toLocaleDateString('ko-KR')} ${now.toLocaleTimeString('ko-KR')}

---

`;
    await fs.writeFile(this.getSessionFilePath(sessionId, now), header);
    console.log('[HistoryWriter] Session started:', sessionId);
  }

  async appendMessage(
    sessionId: string,
    role: 'user' | 'assistant',
    content: string
  ): Promise<void> {
    const sessionInfo = this.sessionMap.get(sessionId);
    if (!sessionInfo) {
      console.warn('[HistoryWriter] Unknown session:', sessionId);
      return;
    }

    // Find the session file (check today and previous days)
    const filePath = await this.findSessionFile(sessionId);
    if (!filePath) {
      console.warn('[HistoryWriter] Session file not found:', sessionId);
      return;
    }

    // Append message
    const timestamp = new Date().toLocaleTimeString('ko-KR');
    const roleLabel = role === 'user' ? '👧 학생' : '🤖 선생님';
    const entry = `**${roleLabel}** (${timestamp})\n\n${content}\n\n---\n\n`;

    await fs.appendFile(filePath, entry);

    // Update message count
    sessionInfo.messageCount++;
    await this.saveSessionMap();
  }

  private async findSessionFile(sessionId: string): Promise<string | null> {
    // Check last 7 days for session file
    for (let i = 0; i < 7; i++) {
      const date = new Date();
      date.setDate(date.getDate() - i);
      const filePath = this.getSessionFilePath(sessionId, date);
      try {
        await fs.access(filePath);
        return filePath;
      } catch {
        // File doesn't exist, try next day
      }
    }
    return null;
  }

  async getHistory(date: string): Promise<SessionInfo[]> {
    const dateDir = path.join(HISTORY_DIR, date);
    try {
      const files = await fs.readdir(dateDir);
      const sessionIds = files
        .filter((f) => f.endsWith('.md'))
        .map((f) => f.replace('.md', ''));

      // Return session info for each session file
      const sessions: SessionInfo[] = [];
      for (const sessionId of sessionIds) {
        const info = this.sessionMap.get(sessionId);
        if (info) {
          sessions.push(info);
        } else {
          // Fallback for sessions not in map (edge case)
          sessions.push({
            sessionId,
            subject: 'math',
            createdAt: date,
            messageCount: 0,
          });
        }
      }

      // Sort by creation time (newest first)
      return sessions.sort(
        (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
      );
    } catch {
      return [];
    }
  }

  async getHistoryContent(date: string, sessionId: string): Promise<string | null> {
    const filePath = path.join(HISTORY_DIR, date, `${sessionId}.md`);
    try {
      return await fs.readFile(filePath, 'utf-8');
    } catch {
      return null;
    }
  }

  getSessionInfo(sessionId: string): SessionInfo | undefined {
    return this.sessionMap.get(sessionId);
  }
}

export const historyWriter = new HistoryWriter();
