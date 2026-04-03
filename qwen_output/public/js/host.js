// Host Dashboard JavaScript
const socket = io();

// DOM Elements
const connectionStatus = document.getElementById('connectionStatus');
const phaseBadge = document.getElementById('phaseBadge');
const btnStartFastestFinger = document.getElementById('btnStartFastestFinger');
const btnEndFastestFinger = document.getElementById('btnEndFastestFinger');
const btnStartQuiz = document.getElementById('btnStartQuiz');
const btnNextQuestion = document.getElementById('btnNextQuestion');
const btnUseLifeline = document.getElementById('btnUseLifeline');
const btnEndQuiz = document.getElementById('btnEndQuiz');
const btnResetGame = document.getElementById('btnResetGame');
const btnViewScores = document.getElementById('btnViewScores');
const timerText = document.getElementById('timerText');
const timerProgress = document.getElementById('timerProgress');
const questionDisplay = document.getElementById('questionDisplay');
const questionNumber = document.getElementById('questionNumber');
const questionPrize = document.getElementById('questionPrize');
const questionText = document.getElementById('questionText');
const optionsGrid = document.getElementById('optionsGrid');
const playersList = document.getElementById('playersList');
const playerCount = document.getElementById('playerCount');
const fastestFingerResults = document.getElementById('fastestFingerResults');
const ffResultsList = document.getElementById('ffResultsList');
const finalScores = document.getElementById('finalScores');
const leaderboard = document.getElementById('leaderboard');

let currentPhase = 'lobby';
let timerInterval = null;
let currentQuestion = null;
let players = [];

// Register as Host
socket.emit('register-host');

// Connection Status
socket.on('connect', () => {
  connectionStatus.classList.add('connected');
  connectionStatus.querySelector('.status-text').textContent = 'Connected';
});

socket.on('disconnect', () => {
  connectionStatus.classList.remove('connected');
  connectionStatus.querySelector('.status-text').textContent = 'Disconnected';
});

// Phase Changes
socket.on('phase-change', ({ phase }) => {
  currentPhase = phase;
  updatePhaseBadge(phase);
  updateButtonStates(phase);
});

function updatePhaseBadge(phase) {
  const icons = {
    'lobby': '🌊',
    'fastest-finger': '⚡',
    'main-quiz': '🎯',
    'results': '🏆'
  };
  
  const labels = {
    'lobby': 'Lobby',
    'fastest-finger': 'Fastest Finger First',
    'main-quiz': 'Quiz in Progress',
    'results': 'Results'
  };

  phaseBadge.querySelector('.phase-icon').textContent = icons[phase] || '🌊';
  phaseBadge.querySelector('.phase-text').textContent = labels[phase] || phase;
}

function updateButtonStates(phase) {
  const isHost = true; // Already registered as host
  
  btnStartFastestFinger.disabled = phase !== 'lobby';
  btnEndFastestFinger.disabled = phase !== 'fastest-finger';
  btnStartQuiz.disabled = phase !== 'lobby';
  btnNextQuestion.disabled = phase !== 'main-quiz';
  btnUseLifeline.disabled = phase !== 'main-quiz';
  btnEndQuiz.disabled = phase !== 'main-quiz';
}

// Timer Updates
socket.on('timer-update', ({ timeLeft }) => {
  timerText.textContent = timeLeft;
  updateTimerCircle(timeLeft);
});

function updateTimerCircle(timeLeft) {
  const maxTime = currentQuestion ? currentQuestion.timeLimit : 30;
  const progress = (timeLeft / maxTime) * 339.292; // circumference
  timerProgress.style.strokeDashoffset = 339.292 - progress;
  
  // Change color based on time left
  if (timeLeft <= 5) {
    timerProgress.style.stroke = 'var(--color-danger)';
  } else if (timeLeft <= 10) {
    timerProgress.style.stroke = 'var(--color-warning)';
  } else {
    timerProgress.style.stroke = 'var(--color-accent)';
  }
}

// New Question
socket.on('new-question', ({ question, timeLimit, questionIndex, totalQuestions, questionType }) => {
  currentQuestion = question;
  displayQuestion(question, questionIndex, totalQuestions);
  startTimer(timeLimit);
});

function displayQuestion(question, index, total) {
  questionDisplay.style.display = 'block';
  questionNumber.textContent = `Question ${index || 1} of ${total || 10}`;
  questionPrize.textContent = question.prize ? `₹${question.prize.toLocaleString()}` : 'Fastest Finger';
  questionText.textContent = question.question;

  // Clear and populate options
  optionsGrid.innerHTML = '';
  const optionLabels = ['A', 'B', 'C', 'D'];
  
  question.options.forEach((option, i) => {
    const btn = document.createElement('button');
    btn.className = 'option-btn';
    btn.dataset.option = optionLabels[i];
    btn.dataset.index = i;
    btn.textContent = option;
    btn.disabled = true; // Host doesn't answer
    optionsGrid.appendChild(btn);
  });
}

function startTimer(seconds) {
  if (timerInterval) clearInterval(timerInterval);
  
  let timeLeft = seconds;
  timerText.textContent = timeLeft;
  updateTimerCircle(timeLeft);

  timerInterval = setInterval(() => {
    timeLeft--;
    timerText.textContent = timeLeft;
    updateTimerCircle(timeLeft);

    if (timeLeft <= 0) {
      clearInterval(timerInterval);
    }
  }, 1000);
}

// Players List
socket.on('players-list', ({ players: playersData }) => {
  players = playersData;
  playerCount.textContent = `(${players.length})`;
  
  if (players.length === 0) {
    playersList.innerHTML = `
      <div class="empty-state">
        <span class="empty-icon">👤</span>
        <p>Waiting for players to join...</p>
      </div>
    `;
    return;
  }

  playersList.innerHTML = players.map(player => `
    <div class="player-item">
      <div class="player-info-left">
        <span class="player-name">${player.name}</span>
        <span class="player-team">${player.teamName}</span>
      </div>
      <span class="player-score">₹${player.score.toLocaleString()}</span>
    </div>
  `).join('');
});

// Fastest Finger Results
socket.on('fastest-finger-results', ({ results }) => {
  fastestFingerResults.style.display = 'block';
  
  if (results.length === 0) {
    ffResultsList.innerHTML = '<p class="text-center">No correct answers</p>';
    return;
  }

  ffResultsList.innerHTML = results.map((result, index) => `
    <div class="result-item">
      <div class="rank-badge rank-${index + 1 > 3 ? 'other' : index + 1}">${index + 1}</div>
      <div class="result-info">
        <div class="result-name">${result.name}</div>
        <div class="result-detail">${result.teamName} • Time: ${new Date(result.time).toLocaleTimeString()}</div>
      </div>
      <div class="result-score">✓ Correct</div>
    </div>
  `).join('');
});

// Quiz Ended
socket.on('quiz-ended', ({ scores }) => {
  finalScores.style.display = 'block';
  
  if (scores.length === 0) {
    leaderboard.innerHTML = '<p class="text-center">No scores to display</p>';
    return;
  }

  leaderboard.innerHTML = scores.map((score, index) => `
    <div class="leaderboard-item">
      <div class="rank-badge rank-${index + 1 > 3 ? 'other' : index + 1}">${index + 1}</div>
      <div class="leaderboard-info">
        <div class="leaderboard-name">${score.name}</div>
        <div class="leaderboard-score">${score.teamName}</div>
      </div>
      <div class="leaderboard-score-value">₹${score.score.toLocaleString()}</div>
    </div>
  `).join('');
});

// Player Answered Notification
socket.on('player-answered', ({ playerId, playerName, correct }) => {
  // Could show a toast notification here
  console.log(`${playerName} answered ${correct ? 'correctly' : 'incorrectly'}`);
});

// Button Event Listeners
btnStartFastestFinger.addEventListener('click', () => {
  socket.emit('start-fastest-finger');
});

btnEndFastestFinger.addEventListener('click', () => {
  socket.emit('end-fastest-finger');
});

btnStartQuiz.addEventListener('click', () => {
  socket.emit('start-quiz');
});

btnNextQuestion.addEventListener('click', () => {
  socket.emit('next-question');
});

btnUseLifeline.addEventListener('click', () => {
  socket.emit('use-lifeline', { lifeline: 'fifty-fifty' });
  
  // Visually remove 2 wrong options
  const optionBtns = optionsGrid.querySelectorAll('.option-btn');
  const correctIndex = currentQuestion.correct;
  const wrongIndices = [];
  
  optionBtns.forEach((btn, i) => {
    if (parseInt(btn.dataset.index) !== correctIndex) {
      wrongIndices.push(i);
    }
  });

  // Remove 2 random wrong options
  const toRemove = wrongIndices.sort(() => Math.random() - 0.5).slice(0, 2);
  toRemove.forEach(index => {
    optionBtns[index].classList.add('removed');
  });
});

btnEndQuiz.addEventListener('click', () => {
  if (confirm('Are you sure you want to end the quiz?')) {
    socket.emit('end-quiz');
  }
});

btnResetGame.addEventListener('click', () => {
  if (confirm('Are you sure you want to reset the game? All progress will be lost.')) {
    socket.emit('reset-game');
    questionDisplay.style.display = 'none';
    fastestFingerResults.style.display = 'none';
    finalScores.style.display = 'none';
    timerText.textContent = '--';
  }
});

btnViewScores.addEventListener('click', () => {
  socket.emit('request-scores');
});

// Game Reset
socket.on('game-reset', () => {
  questionDisplay.style.display = 'none';
  fastestFingerResults.style.display = 'none';
  finalScores.style.display = 'none';
  timerText.textContent = '--';
  currentQuestion = null;
});

// Initialize
updatePhaseBadge('lobby');
updateButtonStates('lobby');

console.log('Host Dashboard loaded');
