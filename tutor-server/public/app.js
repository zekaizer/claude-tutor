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

// Get time period for greeting context
function getTimePeriod() {
  const hour = new Date().getHours();
  if (hour >= 6 && hour < 11) return 'morning';
  if (hour >= 11 && hour < 14) return 'lunch';
  if (hour >= 14 && hour < 17) return 'afternoon';
  if (hour >= 17 && hour < 21) return 'evening';
  return 'night';
}

// DOM elements
const chatContainer = document.getElementById('chat-container');
const messageInput = document.getElementById('message-input');
const sendBtn = document.getElementById('send-btn');
const subjectSelect = document.getElementById('subject-select');
const subjectBadge = document.getElementById('subject-badge');
const chatFooter = document.getElementById('chat-footer');
const changeSubjectBtn = document.getElementById('change-subject-btn');
const subjectButtons = document.querySelectorAll('.subject-btn');

// Placeholder messages
const DEFAULT_PLACEHOLDER = '여기에 질문을 써봐!';
const THINKING_PLACEHOLDER = '선생님이 생각하고 있어요...';

// Auto-scroll when chat container content changes
let userIsScrolling = false;
let scrollTimeout = null;

chatContainer.addEventListener('scroll', () => {
  userIsScrolling = true;
  clearTimeout(scrollTimeout);
  scrollTimeout = setTimeout(() => {
    userIsScrolling = false;
  }, 150);
});

const mutationObserver = new MutationObserver(() => {
  if (!userIsScrolling) {
    chatContainer.scrollTop = chatContainer.scrollHeight;
  }
});
mutationObserver.observe(chatContainer, {
  childList: true,
  subtree: true,
  characterData: true
});

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
      addMessage(data.payload.text, 'tutor', true);
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
  subjectBadge.classList.remove('hidden');
  changeSubjectBtn.classList.remove('hidden');
  document.body.dataset.subject = subject;

  // Clear chat and switch screens
  chatContainer.innerHTML = '';
  subjectSelect.classList.add('hidden');
  chatContainer.classList.remove('hidden');
  chatFooter.classList.remove('hidden');

  // Request welcome message from Claude
  disableInput();
  showStatus(true);
  ws.send(
    JSON.stringify({
      type: 'welcome',
      payload: {
        subject: subject,
        timePeriod: getTimePeriod(),
      },
    })
  );
}

// Go back to subject selection
function changeSubject() {
  currentSubject = null;
  sessionId = null;

  // Hide header elements
  subjectBadge.classList.add('hidden');
  changeSubjectBtn.classList.add('hidden');

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

// Typing animation for tutor messages
async function typeMessage(bubble, text, speed = 15) {
  for (const char of text) {
    bubble.textContent += char;
    await new Promise((r) => setTimeout(r, speed));
  }
}

// Add message to chat
function addMessage(text, sender, animate = false) {
  const messageDiv = document.createElement('div');
  messageDiv.className = `message ${sender}`;

  const avatar = document.createElement('div');
  avatar.className = 'avatar';
  avatar.textContent = sender === 'tutor' ? 'AI' : 'Me';

  const bubble = document.createElement('div');
  bubble.className = 'bubble';

  if (animate && sender === 'tutor') {
    bubble.textContent = '';
    messageDiv.appendChild(avatar);
    messageDiv.appendChild(bubble);
    chatContainer.appendChild(messageDiv);
    typeMessage(bubble, text);
  } else {
    bubble.textContent = text;
    messageDiv.appendChild(avatar);
    messageDiv.appendChild(bubble);
    chatContainer.appendChild(messageDiv);
  }
}

// UI helpers
function showStatus(show) {
  messageInput.placeholder = show ? THINKING_PLACEHOLDER : DEFAULT_PLACEHOLDER;
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
