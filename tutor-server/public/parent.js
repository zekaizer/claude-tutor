// State
let currentDate = new Date();

// Subject display info
const SUBJECTS = {
  math: { name: '수학', icon: '🔢' },
  science: { name: '과학', icon: '🔬' },
  english: { name: '영어', icon: '🔤' },
  korean: { name: '국어', icon: '📖' },
};

// DOM elements
const currentDateEl = document.getElementById('current-date');
const prevDateBtn = document.getElementById('prev-date');
const nextDateBtn = document.getElementById('next-date');
const usageFill = document.getElementById('usage-fill');
const usageText = document.getElementById('usage-text');
const sessionsList = document.getElementById('sessions-list');
const contentSection = document.getElementById('content-section');
const contentTitle = document.getElementById('content-title');
const contentBody = document.getElementById('content-body');
const closeContentBtn = document.getElementById('close-content');

// Format date as YYYY-MM-DD
function formatDate(date) {
  return date.toISOString().split('T')[0];
}

// Format date for display (Korean)
function formatDisplayDate(date) {
  return date.toLocaleDateString('ko-KR', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
}

// Format time from ISO string
function formatTime(isoString) {
  const date = new Date(isoString);
  return date.toLocaleTimeString('ko-KR', {
    hour: '2-digit',
    minute: '2-digit',
  });
}

// Update date display
function updateDateDisplay() {
  currentDateEl.textContent = formatDisplayDate(currentDate);

  // Disable next button if at today
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const current = new Date(currentDate);
  current.setHours(0, 0, 0, 0);
  nextDateBtn.disabled = current >= today;
}

// Fetch usage info
async function fetchUsage() {
  try {
    const res = await fetch('/api/usage');
    const data = await res.json();

    const percent = Math.min((data.used / data.limit) * 100, 100);
    usageFill.style.width = `${percent}%`;
    usageText.textContent = `${data.used} / ${data.limit} (${data.remaining} 남음)`;

    // Change color if near limit
    if (percent > 80) {
      usageFill.style.background = '#EF4444';
    } else if (percent > 50) {
      usageFill.style.background = '#F59E0B';
    }
  } catch (error) {
    console.error('Failed to fetch usage:', error);
    usageText.textContent = '사용량 정보를 불러올 수 없습니다';
  }
}

// Fetch sessions for current date
async function fetchSessions() {
  const dateStr = formatDate(currentDate);

  try {
    const res = await fetch(`/api/history/${dateStr}`);
    const data = await res.json();

    if (!data.sessions || data.sessions.length === 0) {
      sessionsList.innerHTML = '<p class="empty-message">이 날의 학습 기록이 없습니다</p>';
      return;
    }

    sessionsList.innerHTML = data.sessions
      .map((session) => {
        const subject = SUBJECTS[session.subject] || SUBJECTS.math;
        const time = formatTime(session.createdAt);

        return `
        <div class="session-card" data-session-id="${session.sessionId}" data-date="${dateStr}">
          <div class="session-icon ${session.subject}">${subject.icon}</div>
          <div class="session-info">
            <div class="session-subject ${session.subject}">${subject.name}</div>
            <div class="session-meta">${time} · ${session.messageCount}개 메시지</div>
          </div>
        </div>
      `;
      })
      .join('');

    // Add click handlers
    document.querySelectorAll('.session-card').forEach((card) => {
      card.addEventListener('click', () => {
        const sessionId = card.dataset.sessionId;
        const date = card.dataset.date;
        fetchSessionContent(date, sessionId);
      });
    });
  } catch (error) {
    console.error('Failed to fetch sessions:', error);
    sessionsList.innerHTML = '<p class="empty-message">세션 목록을 불러올 수 없습니다</p>';
  }
}

// Fetch session content
async function fetchSessionContent(date, sessionId) {
  try {
    const res = await fetch(`/api/history/${date}/${sessionId}`);
    if (!res.ok) throw new Error('Not found');

    const markdown = await res.text();
    contentBody.textContent = markdown;
    contentSection.classList.remove('hidden');

    // Scroll to content
    contentSection.scrollIntoView({ behavior: 'smooth' });
  } catch (error) {
    console.error('Failed to fetch content:', error);
    alert('대화 내용을 불러올 수 없습니다');
  }
}

// Close content section
function closeContent() {
  contentSection.classList.add('hidden');
}

// Navigate to previous day
function prevDay() {
  currentDate.setDate(currentDate.getDate() - 1);
  updateDateDisplay();
  fetchSessions();
  closeContent();
}

// Navigate to next day
function nextDay() {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const current = new Date(currentDate);
  current.setHours(0, 0, 0, 0);

  if (current < today) {
    currentDate.setDate(currentDate.getDate() + 1);
    updateDateDisplay();
    fetchSessions();
    closeContent();
  }
}

// Event listeners
prevDateBtn.addEventListener('click', prevDay);
nextDateBtn.addEventListener('click', nextDay);
closeContentBtn.addEventListener('click', closeContent);

// Initialize
updateDateDisplay();
fetchUsage();
fetchSessions();
