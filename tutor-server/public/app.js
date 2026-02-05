// WebSocket connection
let ws = null;
let sessionId = null;
let currentSubject = null;

// Subject display names
const SUBJECT_NAMES = {
  math: '수학',
  science: '과학',
  english: '영어',
  korean: '국어',
};

// Welcome messages per subject
const WELCOME_MESSAGES = {
  math: '안녕! 수학 공부하러 왔구나 🔢\n무엇이든 물어봐!',
  science: '안녕! 과학 공부하러 왔구나 🔬\n신기한 것들 같이 알아보자!',
  english: '안녕! 영어 공부하러 왔구나 🔤\nLet\'s learn together!',
  korean: '안녕! 국어 공부하러 왔구나 📖\n같이 글 읽고 써보자!',
};

// DOM elements
const chatContainer = document.getElementById('chat-container');
const messageInput = document.getElementById('message-input');
const sendBtn = document.getElementById('send-btn');
const status = document.getElementById('status');
const subjectSelect = document.getElementById('subject-select');
const subjectBadge = document.getElementById('subject-badge');
const chatFooter = document.getElementById('chat-footer');
const changeSubjectBtn = document.getElementById('change-subject-btn');
const subjectButtons = document.querySelectorAll('.subject-btn');

// Initialize WebSocket
function connectWebSocket() {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  ws = new WebSocket(`${protocol}//${window.location.host}`);

  ws.onopen = () => {
    console.log('Connected to server');
    if (currentSubject) {
      enableInput();
    }
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
      addMessage(data.payload.message || '앗, 문제가 생겼어요. 다시 한번 해볼까?', 'tutor');
      console.error('Server error:', data.payload.message);
      enableInput();
      break;
  }
}

// Select subject and start chatting
function selectSubject(subject) {
  currentSubject = subject;
  sessionId = null; // Reset session for new subject

  // Update UI
  subjectBadge.textContent = SUBJECT_NAMES[subject];
  subjectBadge.dataset.subject = subject;
  document.body.dataset.subject = subject;

  // Clear chat and show welcome
  chatContainer.innerHTML = '';
  addMessage(WELCOME_MESSAGES[subject], 'tutor');

  // Switch screens
  subjectSelect.classList.add('hidden');
  chatContainer.classList.remove('hidden');
  chatFooter.classList.remove('hidden');

  enableInput();
}

// Go back to subject selection
function changeSubject() {
  currentSubject = null;
  sessionId = null;

  // Switch screens
  subjectSelect.classList.remove('hidden');
  chatContainer.classList.add('hidden');
  chatFooter.classList.add('hidden');
}

// Send message
function sendMessage() {
  const text = messageInput.value.trim();
  if (!text || !ws || ws.readyState !== WebSocket.OPEN || !currentSubject) return;

  // Add user message to chat
  addMessage(text, 'user');

  // Send to server
  ws.send(
    JSON.stringify({
      type: 'chat',
      payload: {
        message: text,
        sessionId: sessionId,
        subject: currentSubject,
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

subjectButtons.forEach((btn) => {
  btn.addEventListener('click', () => {
    selectSubject(btn.dataset.subject);
  });
});

changeSubjectBtn.addEventListener('click', changeSubject);

// Initialize
connectWebSocket();
