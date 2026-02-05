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
}

export interface ChatResponse {
  text: string;
  sessionId: string;
  isError: boolean;
}

// WebSocket message types

export interface WsIncomingMessage {
  type: 'chat';
  payload: ChatRequest;
}

export interface WsOutgoingMessage {
  type: 'response' | 'error' | 'status';
  payload: ChatResponse | { message: string };
}

// Queue types for request management

export interface QueuedRequest {
  message: string;
  sessionId?: string;
  resolve: (value: ChatResponse) => void;
  reject: (error: Error) => void;
}
