// Participant Dashboard JavaScript
const socket = io();

// DOM Elements
const registrationScreen = document.getElementById('registrationScreen');
const waitingScreen = document.getElementById('waitingScreen');
const questionScreen = document.getElementById('questionScreen');
const resultsScreen = document.getElementById('resultsScreen');
const registrationForm = document.getElementById('registrationForm');
const playerNameInput = document.getElementById('playerName');
const teamNameInput = document.getElementById('teamName');
const displayName = document.getElementById('displayName');
const displayScore = document.getElementById('displayScore');
const participantQuestionNumber = document.getElementById('participantQuestionNumber');
const participantQuestionText = document.getElementById('participantQuestionText');
const participantOptionsGrid = document.getElementById('participantOptionsGrid');
const participantTimer = document.getElementById('participantTimer');
const questionTypeBadge = document.getElementById('questionTypeBadge');
const answerFeedback = document.getElementById('answerFeedback');
const feedbackIcon = document.getElementById('feedbackIcon');
const feedbackText = document.getElementById('feedbackText');
const finalScore = document.getElementById('finalScore');
const miniLeaderboard = document.getElementById('miniLeaderboard');
const btnPlayAgain = document.getElementById('btnPlayAgain');

let playerId = null;
let currentPhase = 'lobby';
let currentQuestion = null;
let hasAnswered = false;
let playerScore = 0;
let timerInterval = null;

// Registration Form
registrationForm.addEventListener('submit', (e) => {
  e.preventDefault();
  
  const name = playerNameInput.value.trim();
  const teamName = teamNameInput.value.trim();
  
  if (!name) {
    alert('Please enter your name');
    return;
  }

  // Get client timestamp for Fastest Finger First
  const clientTimestamp = Date.now();

  socket.emit('register-player', { name, teamName, clientTimestamp });
});

// Registration Success
socket.on('registered', ({ playerId: id, playerName }) => {
  playerId = id;
  displayName.textContent = playerName;
  
  // Switch to waiting screen
  registrationScreen.style.display = 'none';
  waitingScreen.style.display = 'flex';
});

socket.on('error', ({ message }) => {
  alert(message);
});

// Phase Changes
socket.on('phase-change', ({ phase }) => {
  currentPhase = phase;
  
  switch (phase) {
    case 'lobby':
      showScreen(waitingScreen);
      break;
    case 'fastest-finger':
    case 'main-quiz':
      // Will be handled by new-question event
      break;
    case 'results':
      showScreen(resultsScreen);
      break;
  }
});

// New Question
socket.on('new-question', ({ question, timeLimit, questionIndex, totalQuestions, questionType }) => {
  currentQuestion = question;
  hasAnswered = false;
  
  // Show question screen
  showScreen(questionScreen);
  
  // Update question display
  if (questionType === 'fastest-finger') {
    questionTypeBadge.textContent = '⚡ Fastest Finger First';
    participantQuestionNumber.textContent = 'FF';
  } else {
    questionTypeBadge.textContent = `🎯 Question ${questionIndex}/${totalQuestions}`;
    participantQuestionNumber.textContent = `Q${questionIndex}`;
  }
  
  participantQuestionText.textContent = question.question;
  
  // Clear and populate options
  participantOptionsGrid.innerHTML = '';
  const optionLabels = ['A', 'B', 'C', 'D'];
  
  question.options.forEach((option, i) => {
    const btn = document.createElement('button');
    btn.className = 'option-btn';
    btn.dataset.option = optionLabels[i];
    btn.dataset.index = i;
    btn.textContent = option;
    
    btn.addEventListener('click', () => submitAnswer(i));
    participantOptionsGrid.appendChild(btn);
  });

  // Hide feedback
  answerFeedback.style.display = 'none';
  
  // Start timer
  startTimer(timeLimit);
});

function submitAnswer(answerIndex) {
  if (hasAnswered || !currentQuestion) return;
  
  hasAnswered = true;
  
  // Get client timestamp
  const clientTimestamp = Date.now();
  
  if (currentPhase === 'fastest-finger') {
    // For fastest finger, send the answer with timestamp
    socket.emit('submit-fastest-finger', { 
      answer: [answerIndex], 
      clientTimestamp 
    });
  } else {
    // For main quiz
    socket.emit('submit-answer', { answerIndex });
  }
  
  // Disable all options
  const optionBtns = participantOptionsGrid.querySelectorAll('.option-btn');
  optionBtns.forEach(btn => btn.disabled = true);
}

socket.on('answer-received', ({ time }) => {
  showFeedback(true, 'Answer received! Your time: ' + new Date(time).toLocaleTimeString());
});

socket.on('answer-result', ({ correct, correctIndex, prize }) => {
  if (correct) {
    playerScore += prize;
    displayScore.textContent = playerScore.toLocaleString();
    showFeedback(true, `Correct! +₹${prize.toLocaleString()}`);
    
    // Highlight correct answer
    const correctBtn = participantOptionsGrid.querySelector(`[data-index="${correctIndex}"]`);
    if (correctBtn) correctBtn.classList.add('correct');
  } else {
    showFeedback(false, 'Incorrect! The correct answer is highlighted.');
    
    // Highlight correct and wrong answers
    const optionBtns = participantOptionsGrid.querySelectorAll('.option-btn');
    optionBtns.forEach(btn => {
      const idx = parseInt(btn.dataset.index);
      if (idx === correctIndex) {
        btn.classList.add('correct');
      } else if (btn.classList.contains('selected')) {
        btn.classList.add('wrong');
      }
    });
  }
});

function showFeedback(success, message) {
  answerFeedback.style.display = 'flex';
  answerFeedback.className = `answer-feedback ${success ? 'success' : 'error'}`;
  feedbackIcon.textContent = success ? '✓' : '✗';
  feedbackText.textContent = message;
}

function startTimer(seconds) {
  if (timerInterval) clearInterval(timerInterval);
  
  let timeLeft = seconds;
  participantTimer.textContent = timeLeft;

  timerInterval = setInterval(() => {
    timeLeft--;
    participantTimer.textContent = timeLeft;

    // Change color based on time left
    if (timeLeft <= 5) {
      participantTimer.parentElement.style.borderColor = 'var(--color-danger)';
      participantTimer.parentElement.style.background = 'rgba(239, 68, 68, 0.2)';
    } else if (timeLeft <= 10) {
      participantTimer.parentElement.style.borderColor = 'var(--color-warning)';
      participantTimer.parentElement.style.background = 'rgba(245, 158, 11, 0.2)';
    }

    if (timeLeft <= 0) {
      clearInterval(timerInterval);
      if (!hasAnswered) {
        showFeedback(false, "Time's up!");
        const optionBtns = participantOptionsGrid.querySelectorAll('.option-btn');
        optionBtns.forEach(btn => btn.disabled = true);
      }
    }
  }, 1000);
}

// Quiz Ended
socket.on('quiz-ended', ({ scores }) => {
  finalScore.textContent = playerScore.toLocaleString();
  
  // Show mini leaderboard
  if (scores && scores.length > 0) {
    const topScores = scores.slice(0, 5);
    miniLeaderboard.innerHTML = topScores.map((score, index) => {
      const medals = ['🥇', '🥈', '🥉'];
      const medal = index < 3 ? medals[index] : `${index + 1}.`;
      const isCurrentPlayer = score.id === playerId;
      
      return `
        <div class="player-item ${isCurrentPlayer ? 'current-player' : ''}">
          <span class="rank-text">${medal}</span>
          <div class="player-info-left">
            <span class="player-name">${score.name}</span>
            <span class="player-team">${score.teamName}</span>
          </div>
          <span class="player-score">₹${score.score.toLocaleString()}</span>
        </div>
      `;
    }).join('');
  }
  
  showScreen(resultsScreen);
});

// Lifeline Used
socket.on('lifeline-used', ({ lifeline, removedIndices }) => {
  if (lifeline === 'fifty-fifty') {
    const optionBtns = participantOptionsGrid.querySelectorAll('.option-btn');
    removedIndices.forEach(index => {
      if (optionBtns[index]) {
        optionBtns[index].classList.add('removed');
        optionBtns[index].disabled = true;
      }
    });
  }
});

// Time Up
socket.on('time-up', () => {
  if (!hasAnswered) {
    showFeedback(false, "Time's up!");
    const optionBtns = participantOptionsGrid.querySelectorAll('.option-btn');
    optionBtns.forEach(btn => btn.disabled = true);
  }
});

// Game Reset
socket.on('game-reset', () => {
  playerScore = 0;
  displayScore.textContent = '0';
  currentQuestion = null;
  hasAnswered = false;
  
  registrationScreen.style.display = 'flex';
  waitingScreen.style.display = 'none';
  questionScreen.style.display = 'none';
  resultsScreen.style.display = 'none';
  
  registrationForm.reset();
});

// Play Again
btnPlayAgain.addEventListener('click', () => {
  playerScore = 0;
  displayScore.textContent = '0';
  currentQuestion = null;
  hasAnswered = false;
  
  showScreen(waitingScreen);
});

// Helper Functions
function showScreen(screen) {
  [registrationScreen, waitingScreen, questionScreen, resultsScreen].forEach(s => {
    s.style.display = 'none';
  });
  screen.style.display = 'flex';
}

// Add current player highlight CSS
const style = document.createElement('style');
style.textContent = `
  .player-item.current-player {
    border: 2px solid var(--color-accent);
    background: rgba(6, 182, 212, 0.2);
  }
  
  .rank-text {
    font-size: 1.5rem;
    font-weight: 700;
    min-width: 40px;
    text-align: center;
  }
`;
document.head.appendChild(style);

console.log('Participant Dashboard loaded');
