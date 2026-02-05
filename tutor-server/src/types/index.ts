// Subject types
export type Subject = 'math' | 'science' | 'english' | 'korean';

export const SUBJECT_NAMES: Record<Subject, string> = {
  math: '수학',
  science: '과학',
  english: '영어',
  korean: '국어',
};

// Stream-JSON message types from Claude CLI

export interface InitMessage {
  type: 'system';
  subtype: 'init';
  session_id: string;
  cwd: string;
  tools: string[];
  model: string;
}

export interface AssistantMessage {
  type: 'assistant';
  message: {
    id: string;
    model: string;
    content: Array<{ type: 'text'; text: string }>;
    usage: { input_tokens: number; output_tokens: number };
  };
  session_id: string;
}

export interface ResultMessage {
  type: 'result';
  subtype: 'success' | 'error';
  result: string;
  session_id: string;
  duration_ms: number;
  is_error: boolean;
}

export type StreamMessage = InitMessage | AssistantMessage | ResultMessage;

// Chat request/response types

export interface ChatRequest {
  message: string;
  sessionId?: string;
  subject?: Subject;
}

// History types

export interface HistoryEntry {
  timestamp: string;
  role: 'user' | 'assistant';
  content: string;
}

export interface SessionInfo {
  sessionId: string;
  subject: Subject;
  createdAt: string;
  messageCount: number;
}

// Usage types

export interface UsageData {
  date: string;
  count: number;
}

export interface ChatResponse {
  text: string;
  sessionId: string;
  isError: boolean;
}

// WebSocket message types

export type TimePeriod = 'morning' | 'lunch' | 'afternoon' | 'evening' | 'night';

export interface WelcomeRequest {
  subject: Subject;
  timePeriod: TimePeriod;
}

export interface WsIncomingMessage {
  type: 'chat' | 'welcome';
  payload: ChatRequest | WelcomeRequest;
}

export interface WsOutgoingMessage {
  type: 'response' | 'error' | 'status';
  payload: ChatResponse | { message: string };
}

// Queue types for request management

export interface QueuedRequest {
  message: string;
  sessionId?: string;
  subject?: Subject;
  resolve: (value: ChatResponse) => void;
  reject: (error: Error) => void;
}

// User Memory types

// Simple key-value storage - store whatever Claude outputs
export interface UserMemory {
  createdAt: string;
  updatedAt: string;
  version: number;
  // Flexible key-value pairs: string for single values, string[] for multiple
  data: Record<string, string | string[]>;
}

export interface MemoryUpdate {
  key: string;
  value: string;
}
