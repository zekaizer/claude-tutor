// WebSocket connection
let ws = null;
let sessionId = null;

// DOM elements
const chatContainer = document.getElementById('chat-container');
const messageInput = document.getElementById('message-input');
const sendBtn = document.getElementById('send-btn');
const status = document.getElementById('status');

// Initialize WebSocket
function connectWebSocket() {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  ws = new WebSocket(`${protocol}//${window.location.host}`);

  ws.onopen = () => {
    console.log('Connected to server');
    enableInput();
  };

  ws.onmessage = (event) => {
    const data = JSON.parse(event.data);
    handleServerMessage(data);
  };

  ws.onclose = () => {
    console.log('Disconnected, reconnecting in 2s...');
    disableInput();
    setTimeout(connectWebSocket, 2000);
  };

  ws.onerror = (error) => {
    console.error('WebSocket error:', error);
  };
}

// Handle server messages
function handleServerMessage(data) {
  switch (data.type) {
    case 'status':
      if (data.payload.message === 'thinking') {
        showStatus(true);
      }
      break;

    case 'response':
      showStatus(false);
      sessionId = data.payload.sessionId;
      addMessage(data.payload.text, 'tutor');
      enableInput();
      break;

    case 'error':
      showStatus(false);
      addMessage('앗, 문제가 생겼어요. 다시 한번 해볼까?', 'tutor');
      console.error('Server error:', data.payload.message);
      enableInput();
      break;
  }
}

// Send message
function sendMessage() {
  const text = messageInput.value.trim();
  if (!text || !ws || ws.readyState !== WebSocket.OPEN) return;

  // Add user message to chat
  addMessage(text, 'user');

  // Send to server
  ws.send(
    JSON.stringify({
      type: 'chat',
      payload: {
        message: text,
        sessionId: sessionId,
      },
    })
  );

  // Clear input and disable
  messageInput.value = '';
  disableInput();
}

// Add message to chat
function addMessage(text, sender) {
  const messageDiv = document.createElement('div');
  messageDiv.className = `message ${sender}`;

  const avatar = document.createElement('div');
  avatar.className = 'avatar';
  avatar.textContent = sender === 'tutor' ? 'AI' : 'Me';

  const bubble = document.createElement('div');
  bubble.className = 'bubble';
  bubble.textContent = text;

  messageDiv.appendChild(avatar);
  messageDiv.appendChild(bubble);
  chatContainer.appendChild(messageDiv);

  // Scroll to bottom
  chatContainer.scrollTop = chatContainer.scrollHeight;
}

// UI helpers
function showStatus(show) {
  status.classList.toggle('hidden', !show);
}

function disableInput() {
  messageInput.disabled = true;
  sendBtn.disabled = true;
}

function enableInput() {
  messageInput.disabled = false;
  sendBtn.disabled = false;
  messageInput.focus();
}

// Event listeners
sendBtn.addEventListener('click', sendMessage);

messageInput.addEventListener('keypress', (e) => {
  if (e.key === 'Enter') {
    sendMessage();
  }
});

// Initialize
connectWebSocket();
