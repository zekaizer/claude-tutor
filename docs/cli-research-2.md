# Claude Code CLI Technical Research - Part 2

## Overview

Additional technical investigation covering TTY handling, Node.js streaming, concurrent sessions, and Docker environment considerations.

**Date**: 2026-02-05

---

## 1. TTY Issue Investigation

### Test Method
Direct subprocess spawning via Node.js `child_process.spawn()`.

### Test Code
```javascript
const { spawn } = require('child_process');

const child = spawn('claude', [
  '-p',
  '--output-format', 'stream-json',
  '--verbose',
  '--model', 'haiku'
], {
  stdio: ['pipe', 'pipe', 'pipe']
});

child.stdin.write('1+1은?');
child.stdin.end();
```

### Result
```
Exit code: 0
Output lines: 4
Line 0 - type: system init
Line 1 - type: assistant
Line 2 - type: result success
```

### Conclusion
- ✅ **No TTY issues detected**
- Direct `child_process.spawn()` works without issues
- No need for `script` wrapper or `node-pty`
- stdio configuration: `['pipe', 'pipe', 'pipe']`

---

## 2. Node.js Streaming Characteristics

### Streaming Behavior Analysis

**Test**: Request a longer response and measure chunk timing.

```
[3008ms] Chunk 1 received (init message)
[10919ms] Chunk 2 received (assistant response)
[10936ms] Chunk 3 received (result message)
```

### Key Finding: Not Token-by-Token Streaming

The CLI does **NOT** stream tokens in real-time. Instead:
1. First chunk: `init` message (after initial setup)
2. Second chunk: Complete `assistant` response (all at once)
3. Third chunk: `result` message (immediately after)

**Implication**: The chat UI will show the complete response at once, not word-by-word. Consider adding a typing animation for better UX.

### NDJSON Parsing

Built-in Node.js modules are sufficient:

```javascript
// Parse NDJSON (newline-delimited JSON)
data.split('\n').filter(line => line.trim()).forEach(line => {
  const json = JSON.parse(line);
  // Handle based on json.type
});
```

No external libraries needed for JSON parsing.

### WebSocket Library Recommendation

| Library | Pros | Cons |
|---------|------|------|
| **ws** | Lightweight, fast, most popular | Minimal features |
| socket.io | Feature-rich, fallbacks | Larger bundle |
| express-ws | Express integration | Tied to Express |

**Recommendation**: Use `ws` for simplicity and performance.

---

## 3. Concurrent Session Testing

### Test Method
Run two queries simultaneously:

```javascript
Promise.all([
  runQuery(1, '1+1'),
  runQuery(2, '2+2')
])
```

### Result
```
Query 1 - elapsed: 4104ms, code: 0
Query 2 - elapsed: 4020ms, code: 0

Both queries completed
Total max time: 4104ms
```

### Findings
- ✅ Multiple concurrent CLI sessions are **supported**
- Sessions don't block each other
- Similar completion times (parallel execution confirmed)
- No errors or rate limiting observed

### Recommendation
For this tutor system (single child user), implement a **request queue** anyway:
- Prevents potential race conditions
- Simpler session management
- Easier to implement timeout/retry logic

---

## 4. Timeout and Process Termination

### Test: Normal Completion
```javascript
const timeout = setTimeout(() => {
  child.kill('SIGTERM');
}, 5000);
// Process completed before timeout
```
**Result**: `code: 0, signal: null`

### Test: Forced Kill During Execution
```javascript
setTimeout(() => {
  child.kill('SIGKILL');
}, 2000);
```
**Result**: `code: null, signal: SIGKILL`

### Findings
- ✅ `SIGTERM` for graceful shutdown
- ✅ `SIGKILL` for forced termination
- Process terminates cleanly without partial output issues
- No zombie processes observed

### Recommended Timeout Strategy
```javascript
const TIMEOUT_MS = 60000; // 60 seconds

const timeout = setTimeout(() => {
  child.kill('SIGTERM');

  // Force kill if still running after 5 seconds
  setTimeout(() => {
    if (!child.killed) {
      child.kill('SIGKILL');
    }
  }, 5000);
}, TIMEOUT_MS);
```

---

## 5. Docker Environment Considerations

### Authentication for Docker

The `claude setup-token` command creates a long-lived authentication token for non-interactive environments:

```bash
# On host (one-time setup)
claude setup-token
```

### Required Volume Mounts

```yaml
volumes:
  - ~/.claude:/root/.claude:ro  # Read-only config mount
```

### Environment Variables

Observed environment variables set by Claude:
- `CLAUDECODE=1`
- `CLAUDE_CODE_ENTRYPOINT=...`
- `CLAUDE_AGENT_SDK_VERSION=...`

### Dockerfile Considerations

```dockerfile
# Option 1: Install Claude Code CLI
RUN npm install -g @anthropic-ai/claude-code

# Option 2: Use pre-built image (if available)
FROM anthropic/claude-code:latest
```

### Docker Compose Example
```yaml
services:
  tutor:
    build: .
    volumes:
      - ./history:/app/history
      - ./prompts:/app/prompts
      - ~/.claude:/root/.claude:ro
    environment:
      - NODE_ENV=production
```

---

## 6. Implementation Recommendations

### Claude Bridge Service Pattern

```javascript
// services/claude-bridge.ts

import { spawn } from 'child_process';
import { EventEmitter } from 'events';

class ClaudeBridge extends EventEmitter {
  private queue: Array<QueuedRequest> = [];
  private processing = false;

  async chat(message: string, options: ChatOptions): Promise<ChatResponse> {
    return new Promise((resolve, reject) => {
      this.queue.push({ message, options, resolve, reject });
      this.processQueue();
    });
  }

  private async processQueue() {
    if (this.processing || this.queue.length === 0) return;
    this.processing = true;

    const request = this.queue.shift()!;

    try {
      const response = await this.executeQuery(request);
      request.resolve(response);
    } catch (error) {
      request.reject(error);
    }

    this.processing = false;
    this.processQueue();
  }

  private executeQuery(request: QueuedRequest): Promise<ChatResponse> {
    // Implementation with spawn, timeout, NDJSON parsing
  }
}
```

### Key Implementation Points

1. **Request Queue**: Process one request at a time
2. **Timeout Handling**: 60s timeout with SIGTERM → SIGKILL fallback
3. **NDJSON Parsing**: Split by newline, parse each line as JSON
4. **Session Management**: Track session_id from init message
5. **Error Recovery**: Retry logic for transient failures

---

## 7. Updated Design Document Changes

Based on this research, update `docs/design.md`:

| Section | Change |
|---------|--------|
| 4.1 TTY Issues | Remove `script` wrapper requirement |
| 4.1 Streaming | Note: Response arrives complete, not token-by-token |
| 4.1 Concurrency | Concurrent sessions work, but queue recommended |
| 7. Risks | Lower severity for TTY issues (verified working) |

---

## 8. Summary

### Verified Working ✅
- Child process spawn without TTY wrapper
- NDJSON stream parsing
- Concurrent sessions
- Timeout and kill handling
- `--append-system-prompt` for tutor persona

### Requires Attention ⚠️
- Streaming is response-complete, not token-by-token
- Docker authentication needs `setup-token` pre-configuration
- Consider typing animation for UX

### Ready for Implementation
All critical technical foundations have been verified. Phase 1 MVP implementation can proceed.
