const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*' }
});

app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());

// Game State
const gameState = {
  phase: 'lobby', // lobby, fastest-finger, main-quiz, results
  players: new Map(),
  currentQuestion: null,
  questionIndex: 0,
  scores: new Map(),
  fastestFingerResults: [],
  quizQuestions: [],
  timer: null,
  timeLeft: 0,
  hostSocketId: null,
};

// Sample Quiz Questions (KBC Style)
const defaultQuestions = [
  {
    id: 1,
    question: "Which river is considered the holiest in India?",
    options: ["Yamuna", "Ganga", "Godavari", "Saraswati"],
    correct: 1,
    prize: 1000,
    timeLimit: 30
  },
  {
    id: 2,
    question: "What is the national aquatic animal of India?",
    options: ["Blue Whale", "Gangetic Dolphin", "Fish", "Otter"],
    correct: 1,
    prize: 2000,
    timeLimit: 30
  },
  {
    id: 3,
    question: "Which dam is known as the 'Temple of Modern India'?",
    options: ["Bhakra Nangal Dam", "Hirakud Dam", "Tehri Dam", "Sardar Sarovar Dam"],
    correct: 0,
    prize: 3000,
    timeLimit: 30
  },
  {
    id: 4,
    question: "The Jal Jeevan Mission aims to provide tap water connections to every rural household by which year?",
    options: ["2022", "2024", "2026", "2030"],
    correct: 1,
    prize: 5000,
    timeLimit: 30
  },
  {
    id: 5,
    question: "Which is the longest river in India?",
    options: ["Yamuna", "Brahmaputra", "Ganga", "Indus"],
    correct: 2,
    prize: 10000,
    timeLimit: 30
  },
  {
    id: 6,
    question: "What percentage of Earth's water is freshwater?",
    options: ["About 3%", "About 10%", "About 25%", "About 50%"],
    correct: 0,
    prize: 20000,
    timeLimit: 30
  },
  {
    id: 7,
    question: "Which Indian state receives the highest rainfall?",
    options: ["Kerala", "Meghalaya", "West Bengal", "Karnataka"],
    correct: 1,
    prize: 40000,
    timeLimit: 30
  },
  {
    id: 8,
    question: "The 'Atal Bhujal Yojana' is related to what?",
    options: ["River cleaning", "Groundwater management", "Rainwater harvesting", "Flood control"],
    correct: 1,
    prize: 80000,
    timeLimit: 30
  },
  {
    id: 9,
    question: "Which of these is NOT a tributary of the Ganga?",
    options: ["Son", "Damodar", "Kosi", "Narmada"],
    correct: 3,
    prize: 160000,
    timeLimit: 30
  },
  {
    id: 10,
    question: "The Sardar Sarovar Dam is built on which river?",
    options: ["Yamuna", "Chambal", "Narmada", "Tapi"],
    correct: 2,
    prize: 320000,
    timeLimit: 30
  }
];

// Fastest Finger First Questions
const fastestFingerQuestions = [
  {
    id: 'ff1',
    question: "Arrange these rivers from North to South: Ganga, Godavari, Yamuna, Kaveri",
    options: ["Ganga", "Yamuna", "Godavari", "Kaveri"],
    correctOrder: [2, 0, 1, 3], // indices
    timeLimit: 30
  },
  {
    id: 'ff2',
    question: "Arrange these water conservation methods alphabetically",
    options: ["Rainwater Harvesting", "Drip Irrigation", " Watershed Management", "Check Dam"],
    correctOrder: [3, 1, 0, 2],
    timeLimit: 30
  }
];

io.on('connection', (socket) => {
  console.log(`User connected: ${socket.id}`);

  // Player Registration
  socket.on('register-player', ({ name, teamName }) => {
    if (gameState.phase !== 'lobby') {
      socket.emit('error', { message: 'Registration is closed. Game in progress.' });
      return;
    }

    const playerId = socket.id;
    gameState.players.set(playerId, {
      id: playerId,
      name: name || `Player ${gameState.players.size + 1}`,
      teamName: teamName || 'Solo',
      score: 0,
      fastestFingerAnswer: null,
      fastestFingerTime: null,
      answered: false,
      currentPrize: 0,
    });
    gameState.scores.set(playerId, 0);

    socket.emit('registered', { 
      playerId, 
      playerName: gameState.players.get(playerId).name,
      message: 'Successfully registered!' 
    });

    // Broadcast updated player list
    broadcastPlayerList();
  });

  // Host Registration
  socket.on('register-host', () => {
    gameState.hostSocketId = socket.id;
    socket.emit('host-registered', { message: 'You are now the host!' });
  });

  // Start Fastest Finger First
  socket.on('start-fastest-finger', () => {
    if (socket.id !== gameState.hostSocketId) return;
    
    gameState.phase = 'fastest-finger';
    gameState.currentQuestion = fastestFingerQuestions[0];
    gameState.timeLeft = fastestFingerQuestions[0].timeLimit;

    io.emit('phase-change', { phase: 'fastest-finger' });
    io.emit('new-question', {
      question: gameState.currentQuestion,
      timeLimit: gameState.currentQuestion.timeLimit,
      questionType: 'fastest-finger'
    });

    startTimer(() => {
      endFastestFinger();
    }, fastestFingerQuestions[0].timeLimit);
  });

  // Submit Fastest Finger Answer
  socket.on('submit-fastest-finger', ({ answer, clientTimestamp }) => {
    if (gameState.phase !== 'fastest-finger') return;
    
    const player = gameState.players.get(socket.id);
    if (!player || player.fastestFingerAnswer) return;

    const serverTime = Date.now();
    // Use client timestamp if provided, with validation
    const submissionTime = clientTimestamp ? 
      Math.abs(clientTimestamp - serverTime) < 5000 ? clientTimestamp : serverTime : 
      serverTime;

    player.fastestFingerAnswer = answer;
    player.fastestFingerTime = submissionTime;

    socket.emit('answer-received', { time: submissionTime });
  });

  // End Fastest Finger and show results
  socket.on('end-fastest-finger', () => {
    if (socket.id !== gameState.hostSocketId) return;
    endFastestFinger();
  });

  // Start Main Quiz
  socket.on('start-quiz', ({ questions } = {}) => {
    if (socket.id !== gameState.hostSocketId) return;
    
    gameState.phase = 'main-quiz';
    gameState.questionIndex = 0;
    gameState.quizQuestions = questions || defaultQuestions;

    io.emit('phase-change', { phase: 'main-quiz' });
    sendNextQuestion();
  });

  // Submit Answer
  socket.on('submit-answer', ({ answerIndex }) => {
    if (gameState.phase !== 'main-quiz') return;
    
    const player = gameState.players.get(socket.id);
    if (!player) return;

    const question = gameState.quizQuestions[gameState.questionIndex];
    const isCorrect = answerIndex === question.correct;

    if (isCorrect) {
      player.score += question.prize;
      player.currentPrize = question.prize;
      gameState.scores.set(socket.id, player.score);
    } else {
      // KBC style: wrong answer eliminates or reduces prize
      player.score = Math.floor(player.score / 2);
      gameState.scores.set(socket.id, player.score);
    }

    socket.emit('answer-result', { 
      correct: isCorrect, 
      correctIndex: question.correct,
      prize: isCorrect ? question.prize : 0 
    });

    io.emit('player-answered', { 
      playerId: socket.id, 
      playerName: player.name, 
      correct: isCorrect 
    });
  });

  // Use Lifeline (50:50)
  socket.on('use-lifeline', ({ lifeline }) => {
    if (socket.id !== gameState.hostSocketId) return;
    
    const question = gameState.quizQuestions[gameState.questionIndex];
    if (!question) return;

    if (lifeline === 'fifty-fifty') {
      const wrongIndices = question.options
        .map((_, i) => i)
        .filter(i => i !== question.correct);
      
      // Remove 2 wrong options
      const toRemove = wrongIndices.sort(() => Math.random() - 0.5).slice(0, 2);
      
      io.emit('lifeline-used', {
        lifeline: 'fifty-fifty',
        removedIndices: toRemove
      });
    }
  });

  // Next Question
  socket.on('next-question', () => {
    if (socket.id !== gameState.hostSocketId) return;
    sendNextQuestion();
  });

  // End Quiz
  socket.on('end-quiz', () => {
    if (socket.id !== gameState.hostSocketId) return;
    endQuiz();
  });

  // Request Scores
  socket.on('request-scores', () => {
    const scores = Array.from(gameState.players.values())
      .map(p => ({ id: p.id, name: p.name, teamName: p.teamName, score: p.score }))
      .sort((a, b) => b.score - a.score);
    
    socket.emit('scores', { scores });
  });

  // Reset Game
  socket.on('reset-game', () => {
    if (socket.id !== gameState.hostSocketId) return;
    resetGame();
  });

  // Disconnect
  socket.on('disconnect', () => {
    console.log(`User disconnected: ${socket.id}`);
    if (gameState.players.has(socket.id)) {
      gameState.players.delete(socket.id);
      broadcastPlayerList();
    }
    if (socket.id === gameState.hostSocketId) {
      gameState.hostSocketId = null;
    }
  });
});

function startTimer(callback, seconds) {
  gameState.timeLeft = seconds;
  
  const interval = setInterval(() => {
    gameState.timeLeft--;
    io.emit('timer-update', { timeLeft: gameState.timeLeft });
    
    if (gameState.timeLeft <= 0) {
      clearInterval(interval);
      if (callback) callback();
    }
  }, 1000);

  gameState.timer = interval;
}

function endFastestFinger() {
  if (gameState.timer) clearInterval(gameState.timer);

  // Calculate results based on correctness and speed
  const results = Array.from(gameState.players.values())
    .filter(p => p.fastestFingerAnswer)
    .map(p => {
      const isCorrect = checkFastestFingerAnswer(p.fastestFingerAnswer);
      return {
        id: p.id,
        name: p.name,
        teamName: p.teamName,
        correct: isCorrect,
        time: p.fastestFingerTime,
        answer: p.fastestFingerAnswer
      };
    })
    .filter(r => r.correct)
    .sort((a, b) => a.time - b.time);

  gameState.fastestFingerResults = results;

  io.emit('fastest-finger-results', { results });
  
  // Move to lobby or next phase
  gameState.phase = 'lobby';
  io.emit('phase-change', { phase: 'lobby' });
}

function checkFastestFingerAnswer(answer) {
  // Simple validation - in real scenario, would check against correct order
  return Array.isArray(answer) && answer.length > 0;
}

function sendNextQuestion() {
  if (gameState.questionIndex >= gameState.quizQuestions.length) {
    endQuiz();
    return;
  }

  const question = gameState.quizQuestions[gameState.questionIndex];
  gameState.currentQuestion = question;
  gameState.timeLeft = question.timeLimit;

  io.emit('new-question', {
    question,
    timeLimit: question.timeLimit,
    questionIndex: gameState.questionIndex + 1,
    totalQuestions: gameState.quizQuestions.length,
    questionType: 'main-quiz'
  });

  startTimer(() => {
    io.emit('time-up', { questionIndex: gameState.questionIndex });
  }, question.timeLimit);
}

function endQuiz() {
  if (gameState.timer) clearInterval(gameState.timer);
  
  gameState.phase = 'results';
  
  const finalScores = Array.from(gameState.players.values())
    .map(p => ({
      id: p.id,
      name: p.name,
      teamName: p.teamName,
      score: p.score
    }))
    .sort((a, b) => b.score - a.score);

  io.emit('quiz-ended', { scores: finalScores });
  io.emit('phase-change', { phase: 'results' });
}

function resetGame() {
  if (gameState.timer) clearInterval(gameState.timer);
  
  gameState.phase = 'lobby';
  gameState.currentQuestion = null;
  gameState.questionIndex = 0;
  gameState.fastestFingerResults = [];
  gameState.quizQuestions = [];

  gameState.players.forEach((player, id) => {
    player.score = 0;
    player.fastestFingerAnswer = null;
    player.fastestFingerTime = null;
    player.answered = false;
    player.currentPrize = 0;
    gameState.scores.set(id, 0);
  });

  io.emit('game-reset');
  io.emit('phase-change', { phase: 'lobby' });
  broadcastPlayerList();
}

function broadcastPlayerList() {
  const players = Array.from(gameState.players.values()).map(p => ({
    id: p.id,
    name: p.name,
    teamName: p.teamName,
    score: p.score
  }));
  
  io.emit('players-list', { players });
}

// Serve the main page
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/host', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'host.html'));
});

app.get('/participant', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'participant.html'));
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`🌊 Jal Jeevan KBC Quiz Server running on port ${PORT}`);
  console.log(`   Host: http://localhost:${PORT}/host`);
  console.log(`   Participant: http://localhost:${PORT}/participant`);
});
