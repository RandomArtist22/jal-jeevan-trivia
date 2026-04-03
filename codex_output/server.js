const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const PORT = Number(process.env.PORT || 3000);
const ADMIN_PIN = process.env.ADMIN_PIN || "jaljeevan-admin";
const PUBLIC_DIR = path.join(__dirname, "public");
const QUESTION_BANK = JSON.parse(fs.readFileSync(path.join(__dirname, "data", "questions.json"), "utf8"));
const SAFE_LEVELS = [20, 1000];
const QUALIFIER_LIMIT = 8;
const AUDIENCE_QUALIFIER_LIMIT = 2;

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon"
};

function createInitialState() {
  return {
    eventTitle: "Jal Jeevan Trivia",
    eventSubtitle: "Flow With Unity",
    phase: "lobby",
    notice: "Waiting for teams.",
    phaseHistory: [],
    teams: {},
    teamOrder: [],
    qualifiers: [],
    completedHotSeatTeams: [],
    screening: {
      status: "idle",
      startedAt: null,
      endsAt: null,
      durationMs: QUESTION_BANK.screeningDurationSeconds * 1000,
      responses: {},
      rankings: []
    },
    fff: {
      status: "idle",
      questionIndex: 0,
      startedAt: null,
      endsAt: null,
      durationMs: QUESTION_BANK.fffDurationSeconds * 1000,
      submissions: {},
      ranked: [],
      winnerTeamId: null
    },
    hotSeat: {
      status: "idle",
      teamId: null,
      questionIndex: 0,
      startedAt: null,
      endsAt: null,
      questionDurationMs: 0,
      timerState: "idle",
      timerRemainingMs: 0,
      timerPauseReason: "",
      currentScore: 0,
      guaranteedScore: 0,
      selectedAnswerIndex: null,
      lockedAnswerIndex: null,
      reveal: null,
      revealReason: "",
      lifelinesAvailable: ["50/50", "Audience Poll", "Call a Friend"],
      lifelinesUsed: [],
      reducedOptionIndices: [],
      audiencePoll: null,
      callActiveUntil: null,
      history: []
    }
  };
}

let state = createInitialState();
const clients = new Map();

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function slugify(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 36);
}

function buildTeamId(name) {
  const base = slugify(name) || `team-${String(state.teamOrder.length + 1).padStart(2, "0")}`;
  let attempt = base;
  let index = 2;
  while (state.teams[attempt]) {
    attempt = `${base}-${index}`;
    index += 1;
  }
  return attempt;
}

function getTeam(teamId) {
  return teamId ? state.teams[teamId] : null;
}

function getHotSeatQuestion() {
  return QUESTION_BANK.hotSeat[state.hotSeat.questionIndex] || null;
}

function getFFFQuestion() {
  return QUESTION_BANK.fastestFinger[state.fff.questionIndex] || null;
}

function getScreeningScore(teamId) {
  const responses = state.screening.responses[teamId] || {};
  return QUESTION_BANK.screening.reduce((score, question) => {
    return score + (responses[question.id] === question.answerIndex ? 1 : 0);
  }, 0);
}

function safeLevelForScore(score) {
  return SAFE_LEVELS.reduce((acc, level) => (score >= level ? level : acc), 0);
}

function getEligibleFFFTeams() {
  const completed = new Set(state.completedHotSeatTeams);
  const pool = state.qualifiers.length > 0 ? state.qualifiers : state.teamOrder.slice();
  return pool.filter((teamId) => state.teams[teamId] && !completed.has(teamId));
}

function sanitizeTeam(team, viewer = "public") {
  if (!team) return null;
  const base = {
    id: team.id,
    name: team.name,
    members: team.members,
    isAudience: team.isAudience,
    connected: Boolean(team.socketId && clients.has(team.socketId)),
    score: team.score,
    screeningScore: team.screeningScore,
    qualified: team.qualified,
    hotSeatAppearances: team.hotSeatAppearances
  };

  if (viewer === "host") {
    base.createdAt = team.createdAt;
  }

  return base;
}

function sanitizeQuestion(question, includeAnswer = false) {
  if (!question) return null;
  const copy = clone(question);
  if (!includeAnswer) {
    delete copy.answerIndex;
    delete copy.correctOrder;
  }
  return copy;
}

function buildScoreLadder() {
  return QUESTION_BANK.hotSeat.map((question, index) => ({
    level: index + 1,
    points: question.points,
    isSafe: SAFE_LEVELS.includes(question.points)
  }));
}

function buildStateForClient(client) {
  const team = client.teamId ? getTeam(client.teamId) : null;
  const isHost = client.isHost;
  const isHotSeatScreen = client.role === "hotseat-screen";
  const currentHotSeatQuestion = getHotSeatQuestion();
  const currentFFFQuestion = getFFFQuestion();
  const screeningQuestions = QUESTION_BANK.screening.map((question) => sanitizeQuestion(question, isHost));
  const canSeeHotSeatQuestion = isHost || isHotSeatScreen;
  const canSeeHotSeatSelection = isHost || isHotSeatScreen;

  return {
    now: Date.now(),
    config: {
      eventTitle: state.eventTitle,
      eventSubtitle: state.eventSubtitle,
      screeningDurationMs: state.screening.durationMs,
      fffDurationMs: state.fff.durationMs,
      fffQuestionCount: QUESTION_BANK.fastestFinger.length,
      qualifierLimit: QUALIFIER_LIMIT,
      audienceQualifierLimit: AUDIENCE_QUALIFIER_LIMIT,
      safeLevels: SAFE_LEVELS,
      hotSeatLadder: buildScoreLadder()
    },
    session: {
      role: client.role,
      isHost,
      teamId: team ? team.id : null
    },
    phase: state.phase,
    notice: state.notice,
    teams: state.teamOrder.map((teamId) => sanitizeTeam(state.teams[teamId], isHost ? "host" : "public")),
    qualifiers: state.qualifiers.slice(),
    completedHotSeatTeams: state.completedHotSeatTeams.slice(),
    screening: {
      status: state.screening.status,
      startedAt: state.screening.startedAt,
      endsAt: state.screening.endsAt,
      questions: screeningQuestions,
      responses: team ? clone(state.screening.responses[team.id] || {}) : {},
      rankings: state.screening.rankings.map((entry) => ({
        teamId: entry.teamId,
        score: entry.score
      }))
    },
    fff: {
      status: state.fff.status,
      questionIndex: state.fff.questionIndex,
      startedAt: state.fff.startedAt,
      endsAt: state.fff.endsAt,
      question: sanitizeQuestion(currentFFFQuestion, isHost),
      winnerTeamId: state.fff.winnerTeamId,
      ranked: state.fff.ranked.map((entry) => ({
        teamId: entry.teamId,
        correct: entry.correct,
        submittedAt: entry.submittedAt,
        receivedAt: entry.receivedAt
      })),
      mySubmission: team ? clone(state.fff.submissions[team.id] || null) : null,
      submissionCount: Object.keys(state.fff.submissions).length,
      eligibleTeams: getEligibleFFFTeams()
    },
    hotSeat: {
      status: state.hotSeat.status,
      teamId: state.hotSeat.teamId,
      questionIndex: state.hotSeat.questionIndex,
      startedAt: state.hotSeat.startedAt,
      endsAt: state.hotSeat.endsAt,
      questionDurationMs: state.hotSeat.questionDurationMs,
      timerState: state.hotSeat.timerState,
      timerRemainingMs: state.hotSeat.timerState === "running"
        ? Math.max(0, (state.hotSeat.endsAt || 0) - Date.now())
        : state.hotSeat.timerRemainingMs,
      timerPauseReason: state.hotSeat.timerPauseReason,
      currentScore: state.hotSeat.currentScore,
      guaranteedScore: state.hotSeat.guaranteedScore,
      reveal: state.hotSeat.reveal,
      revealReason: state.hotSeat.revealReason,
      selectedAnswerIndex: canSeeHotSeatSelection ? state.hotSeat.selectedAnswerIndex : null,
      lockedAnswerIndex: canSeeHotSeatSelection ? state.hotSeat.lockedAnswerIndex : null,
      lifelinesAvailable: state.hotSeat.lifelinesAvailable.slice(),
      lifelinesUsed: state.hotSeat.lifelinesUsed.slice(),
      reducedOptionIndices: state.hotSeat.reducedOptionIndices.slice(),
      audiencePoll: state.hotSeat.audiencePoll,
      callActiveUntil: state.hotSeat.callActiveUntil,
      revealedAnswerIndex: state.hotSeat.reveal ? currentHotSeatQuestion?.answerIndex ?? null : null,
      history: clone(state.hotSeat.history),
      question: canSeeHotSeatQuestion ? sanitizeQuestion(currentHotSeatQuestion, isHost) : null,
      activeTeam: sanitizeTeam(getTeam(state.hotSeat.teamId), isHost ? "host" : "public")
    },
    privateTeam: team
      ? {
          id: team.id,
          name: team.name,
          members: team.members,
          score: team.score,
          screeningScore: team.screeningScore,
          qualified: team.qualified,
          isAudience: team.isAudience
        }
      : null
  };
}

function sendFrame(socket, data) {
  const payload = Buffer.from(JSON.stringify(data));
  let header;
  if (payload.length < 126) {
    header = Buffer.alloc(2);
    header[1] = payload.length;
  } else if (payload.length < 65536) {
    header = Buffer.alloc(4);
    header[1] = 126;
    header.writeUInt16BE(payload.length, 2);
  } else {
    header = Buffer.alloc(10);
    header[1] = 127;
    header.writeBigUInt64BE(BigInt(payload.length), 2);
  }

  header[0] = 0x81;
  socket.write(Buffer.concat([header, payload]));
}

function send(client, type, payload = {}) {
  if (!client || !client.socket || client.socket.destroyed) return;
  sendFrame(client.socket, { type, payload });
}

function broadcast() {
  for (const client of clients.values()) {
    send(client, "state", buildStateForClient(client));
  }
}

function parseFrames(buffer) {
  const frames = [];
  let offset = 0;

  while (offset + 2 <= buffer.length) {
    const first = buffer[offset];
    const second = buffer[offset + 1];
    const opcode = first & 0x0f;
    const masked = (second & 0x80) === 0x80;
    let payloadLength = second & 0x7f;
    let headerLength = 2;

    if (payloadLength === 126) {
      if (offset + 4 > buffer.length) break;
      payloadLength = buffer.readUInt16BE(offset + 2);
      headerLength = 4;
    } else if (payloadLength === 127) {
      if (offset + 10 > buffer.length) break;
      payloadLength = Number(buffer.readBigUInt64BE(offset + 2));
      headerLength = 10;
    }

    const maskLength = masked ? 4 : 0;
    if (offset + headerLength + maskLength + payloadLength > buffer.length) break;

    const maskStart = offset + headerLength;
    const payloadStart = maskStart + maskLength;
    const payload = Buffer.from(buffer.subarray(payloadStart, payloadStart + payloadLength));

    if (masked) {
      const mask = buffer.subarray(maskStart, maskStart + 4);
      for (let index = 0; index < payload.length; index += 1) {
        payload[index] ^= mask[index % 4];
      }
    }

    frames.push({ opcode, payload });
    offset = payloadStart + payloadLength;
  }

  return { frames, remaining: buffer.subarray(offset) };
}

function registerTeam(payload, client) {
  const name = String(payload.name || "").trim();
  const members = String(payload.members || "").trim();
  const isAudience = Boolean(payload.isAudience);

  if (!name || !members) {
    send(client, "error", { message: "Team name and members are required." });
    return;
  }

  const teamId = buildTeamId(name);
  const team = {
    id: teamId,
    name,
    members,
    isAudience,
    createdAt: Date.now(),
    socketId: client.id,
    score: 0,
    screeningScore: 0,
    qualified: false,
    hotSeatAppearances: 0
  };

  client.teamId = teamId;
  client.role = "player";
  state.teams[teamId] = team;
  state.teamOrder.push(teamId);
  state.screening.responses[teamId] = {};
  state.notice = `${name} joined.`;
  send(client, "registered", { teamId });
  broadcast();
}

function reconnectTeam(payload, client) {
  const team = getTeam(payload.teamId);
  if (!team) {
    send(client, "error", { message: "Team not found on the host server." });
    return;
  }

  if (team.socketId && clients.has(team.socketId)) {
    const previous = clients.get(team.socketId);
    previous.teamId = null;
  }

  team.socketId = client.id;
  client.teamId = team.id;
  client.role = "player";
  state.notice = `${team.name} rejoined.`;
  broadcast();
}

function markScreeningRankings() {
  state.screening.rankings = state.teamOrder
    .map((teamId) => {
      const team = state.teams[teamId];
      team.screeningScore = getScreeningScore(teamId);
      return { teamId, score: team.screeningScore, createdAt: team.createdAt };
    })
    .sort((left, right) => right.score - left.score || left.createdAt - right.createdAt);
}

function computeQualifiers() {
  markScreeningRankings();
  const rankedTeams = state.screening.rankings.filter((entry) => !state.teams[entry.teamId]?.isAudience);
  const rankedAudience = state.screening.rankings.filter((entry) => state.teams[entry.teamId]?.isAudience);
  state.qualifiers = [
    ...rankedTeams.slice(0, QUALIFIER_LIMIT).map((entry) => entry.teamId),
    ...rankedAudience.slice(0, AUDIENCE_QUALIFIER_LIMIT).map((entry) => entry.teamId)
  ];
  for (const teamId of state.teamOrder) {
    state.teams[teamId].qualified = state.qualifiers.includes(teamId);
  }
}

function startScreening() {
  state.phase = "screening";
  state.notice = "Screening live.";
  state.screening.status = "active";
  state.screening.startedAt = Date.now();
  state.screening.endsAt = state.screening.startedAt + state.screening.durationMs;
  state.screening.rankings = [];
  for (const teamId of state.teamOrder) {
    state.screening.responses[teamId] = {};
  }
}

function endScreening() {
  markScreeningRankings();
  state.screening.status = "ended";
  state.notice = "Screening closed.";
}

function qualifyTeams() {
  computeQualifiers();
  state.notice = "FFF pool locked.";
}

function startFFF(questionIndex = 0) {
  state.phase = "fff";
  state.notice = "FFF live.";
  state.fff.status = "active";
  state.fff.questionIndex = Math.max(0, Math.min(questionIndex, QUESTION_BANK.fastestFinger.length - 1));
  state.fff.startedAt = Date.now();
  state.fff.endsAt = state.fff.startedAt + state.fff.durationMs;
  state.fff.submissions = {};
  state.fff.ranked = [];
  state.fff.winnerTeamId = null;
}

function rankFFF() {
  const question = getFFFQuestion();
  if (!question) return;

  const ranked = getEligibleFFFTeams().map((teamId) => {
    const submission = state.fff.submissions[teamId];
    const correct = Boolean(submission) && JSON.stringify(submission.order) === JSON.stringify(question.correctOrder);
    return {
      teamId,
      correct,
      submittedAt: submission ? submission.submittedAt : Number.MAX_SAFE_INTEGER,
      receivedAt: submission ? submission.receivedAt : Number.MAX_SAFE_INTEGER
    };
  });

  ranked.sort((left, right) => {
    if (left.correct !== right.correct) return Number(right.correct) - Number(left.correct);
    return left.submittedAt - right.submittedAt || left.receivedAt - right.receivedAt;
  });

  state.fff.ranked = ranked;
  state.fff.winnerTeamId = ranked.find((entry) => entry.correct)?.teamId || null;
  state.fff.status = "locked";
  state.notice = state.fff.winnerTeamId
    ? `${state.teams[state.fff.winnerTeamId].name} wins FFF.`
    : "No correct FFF entry.";
}

function resetHotSeatForTeam(teamId) {
  state.hotSeat.status = "question-live";
  state.hotSeat.teamId = teamId;
  state.hotSeat.questionIndex = 0;
  state.hotSeat.currentScore = 0;
  state.hotSeat.guaranteedScore = 0;
  state.hotSeat.selectedAnswerIndex = null;
  state.hotSeat.lockedAnswerIndex = null;
  state.hotSeat.reveal = null;
  state.hotSeat.revealReason = "";
  state.hotSeat.lifelinesAvailable = ["50/50", "Audience Poll", "Call a Friend"];
  state.hotSeat.lifelinesUsed = [];
  state.hotSeat.reducedOptionIndices = [];
  state.hotSeat.audiencePoll = null;
  state.hotSeat.callActiveUntil = null;
  state.hotSeat.history = [];
  startHotSeatTimer();
  state.phase = "hotseat";
  state.notice = `${state.teams[teamId].name} on Hot Seat.`;
}

function getHotSeatAnswerWindowMs() {
  const question = getHotSeatQuestion();
  if (!question) return 60000;
  return question.points <= 100 ? 45000 : 60000;
}

function getHotSeatTimerRemaining(now = Date.now()) {
  if (state.hotSeat.timerState === "running" && state.hotSeat.endsAt) {
    return Math.max(0, state.hotSeat.endsAt - now);
  }
  return Math.max(0, state.hotSeat.timerRemainingMs || 0);
}

function startHotSeatTimer() {
  const durationMs = getHotSeatAnswerWindowMs();
  state.hotSeat.questionDurationMs = durationMs;
  state.hotSeat.startedAt = Date.now();
  state.hotSeat.endsAt = state.hotSeat.startedAt + durationMs;
  state.hotSeat.timerState = "running";
  state.hotSeat.timerRemainingMs = durationMs;
  state.hotSeat.timerPauseReason = "";
}

function pauseHotSeatTimer(reason = "") {
  if (state.hotSeat.timerState !== "running") return;
  state.hotSeat.timerRemainingMs = getHotSeatTimerRemaining();
  state.hotSeat.endsAt = null;
  state.hotSeat.timerState = "paused";
  state.hotSeat.timerPauseReason = reason;
}

function stopHotSeatTimer(reason = "") {
  if (state.hotSeat.timerState === "running") {
    state.hotSeat.timerRemainingMs = getHotSeatTimerRemaining();
  }
  state.hotSeat.endsAt = null;
  state.hotSeat.timerState = "stopped";
  state.hotSeat.timerPauseReason = reason || state.hotSeat.timerPauseReason;
}

function resumeHotSeatTimer() {
  if (state.hotSeat.timerState !== "paused") return;
  const totalMs = state.hotSeat.questionDurationMs || getHotSeatAnswerWindowMs();
  const remainingMs = Math.max(0, state.hotSeat.timerRemainingMs || totalMs);
  const now = Date.now();
  state.hotSeat.startedAt = now - (totalMs - remainingMs);
  state.hotSeat.endsAt = now + remainingMs;
  state.hotSeat.timerState = "running";
  state.hotSeat.timerPauseReason = "";
}

function clearHotSeatTimer() {
  state.hotSeat.startedAt = null;
  state.hotSeat.endsAt = null;
  state.hotSeat.questionDurationMs = 0;
  state.hotSeat.timerState = "idle";
  state.hotSeat.timerRemainingMs = 0;
  state.hotSeat.timerPauseReason = "";
}

function applyHotSeatLifeline(kind) {
  const question = getHotSeatQuestion();
  if (!question) return;
  if (state.hotSeat.lifelinesUsed.includes(kind)) return;
  state.hotSeat.lifelinesUsed.push(kind);

  if (kind === "50/50") {
    const wrong = question.options
      .map((_, index) => index)
      .filter((index) => index !== question.answerIndex)
      .sort(() => Math.random() - 0.5)
      .slice(0, 2);
    state.hotSeat.reducedOptionIndices = wrong;
    state.notice = "50/50 used.";
  }

  if (kind === "Audience Poll") {
    const poll = question.options.map((_, index) => {
      if (index === question.answerIndex) return 45 + Math.floor(Math.random() * 21);
      return 5 + Math.floor(Math.random() * 21);
    });
    const total = poll.reduce((sum, value) => sum + value, 0);
    state.hotSeat.audiencePoll = poll.map((value) => Math.round((value / total) * 100));
    pauseHotSeatTimer("Audience Poll");
    state.notice = "Audience poll ready.";
  }

  if (kind === "Call a Friend") {
    state.hotSeat.callActiveUntil = Date.now() + 50000;
    pauseHotSeatTimer("Call a Friend");
    state.notice = "Call started.";
  }
}

function moveToNextHotSeatQuestion() {
  if (state.hotSeat.questionIndex >= QUESTION_BANK.hotSeat.length - 1) {
    finishHotSeatTurn("completed");
    return;
  }

  state.hotSeat.questionIndex += 1;
  state.hotSeat.status = "question-live";
  state.hotSeat.selectedAnswerIndex = null;
  state.hotSeat.lockedAnswerIndex = null;
  state.hotSeat.reveal = null;
  state.hotSeat.revealReason = "";
  state.hotSeat.reducedOptionIndices = [];
  state.hotSeat.audiencePoll = null;
  state.hotSeat.callActiveUntil = null;
  startHotSeatTimer();
  state.notice = `Hot Seat Q${state.hotSeat.questionIndex + 1}.`;
}

function finishHotSeatTurn(reason) {
  const team = getTeam(state.hotSeat.teamId);
  if (team && !state.completedHotSeatTeams.includes(team.id)) {
    state.completedHotSeatTeams.push(team.id);
    team.hotSeatAppearances += 1;
    team.score = state.hotSeat.currentScore;
  }

  state.hotSeat.status = "ended";
  clearHotSeatTimer();
  state.phase = "intermission";
  state.notice = reason === "completed"
    ? `${team?.name || "Team"} finished Hot Seat.`
    : `${team?.name || "Team"} leaves with ${state.hotSeat.currentScore}.`;
}

function revealHotSeatAnswer(reason = "host") {
  const team = getTeam(state.hotSeat.teamId);
  const question = getHotSeatQuestion();
  if (!team || !question) return;

  const selected = state.hotSeat.lockedAnswerIndex;
  const correct = selected === question.answerIndex;
  state.hotSeat.reveal = correct ? "correct" : "wrong";
  state.hotSeat.revealReason = reason;

  const historyEntry = {
    questionId: question.id,
    points: question.points,
    selectedAnswerIndex: selected,
    correctAnswerIndex: question.answerIndex,
    result: correct ? "correct" : "wrong"
  };

  if (correct) {
    stopHotSeatTimer("Correct");
    state.hotSeat.currentScore = question.points;
    state.hotSeat.guaranteedScore = safeLevelForScore(state.hotSeat.currentScore);
    team.score = state.hotSeat.currentScore;
    state.notice = `${team.name} correct for ${question.points}.`;
    historyEntry.scoreAfter = state.hotSeat.currentScore;
    state.hotSeat.history.push(historyEntry);
    if (state.hotSeat.questionIndex >= QUESTION_BANK.hotSeat.length - 1) {
      finishHotSeatTurn("completed");
      return;
    }
    state.hotSeat.status = "revealed";
    return;
  }

  state.hotSeat.currentScore = state.hotSeat.guaranteedScore;
  team.score = state.hotSeat.currentScore;
  state.notice = `${team.name} drops to ${state.hotSeat.currentScore}.`;
  historyEntry.scoreAfter = state.hotSeat.currentScore;
  state.hotSeat.history.push(historyEntry);
  finishHotSeatTurn("wrong");
}

function resetGame() {
  state = createInitialState();
}

function handleHostAction(action, payload = {}, client) {
  if (!client.isHost) {
    send(client, "error", { message: "Host authentication is required." });
    return;
  }

  switch (action) {
    case "set-notice":
      state.notice = String(payload.notice || "").trim() || state.notice;
      break;
    case "start-screening":
      startScreening();
      break;
    case "end-screening":
      endScreening();
      break;
    case "qualify-teams":
      qualifyTeams();
      break;
    case "start-fff":
      startFFF(Number(payload.questionIndex || 0));
      break;
    case "rank-fff":
      rankFFF();
      break;
    case "send-fff-winner-to-hotseat":
      if (!state.fff.winnerTeamId) {
        send(client, "error", { message: "No Fastest Finger First winner is available." });
        return;
      }
      resetHotSeatForTeam(state.fff.winnerTeamId);
      break;
    case "start-hotseat-for-team":
      if (!payload.teamId || !state.teams[payload.teamId]) {
        send(client, "error", { message: "Choose a valid team for the Hot Seat." });
        return;
      }
      resetHotSeatForTeam(payload.teamId);
      break;
    case "hotseat-resume-timer":
      if (state.phase !== "hotseat" || state.hotSeat.status !== "question-live" || state.hotSeat.timerState !== "paused") {
        send(client, "error", { message: "Hot Seat timer is not paused." });
        return;
      }
      resumeHotSeatTimer();
      state.notice = "Hot Seat timer resumed.";
      break;
    case "hotseat-next":
      moveToNextHotSeatQuestion();
      break;
    case "hotseat-select-answer":
      if (state.phase !== "hotseat" || state.hotSeat.status !== "question-live") {
        send(client, "error", { message: "Hot Seat is not accepting answers right now." });
        return;
      }
      state.hotSeat.selectedAnswerIndex = Number(payload.answerIndex);
      state.notice = `${getTeam(state.hotSeat.teamId)?.name || "Team"} selected.`;
      break;
    case "hotseat-lock-answer":
      if (state.phase !== "hotseat" || state.hotSeat.status !== "question-live") {
        send(client, "error", { message: "Hot Seat is not accepting a lock right now." });
        return;
      }
      if (state.hotSeat.selectedAnswerIndex === null) {
        send(client, "error", { message: "Select an answer before locking it." });
        return;
      }
      state.hotSeat.lockedAnswerIndex = state.hotSeat.selectedAnswerIndex;
      state.hotSeat.status = "locked";
      state.notice = `${getTeam(state.hotSeat.teamId)?.name || "Team"} locked.`;
      break;
    case "hotseat-reveal":
      revealHotSeatAnswer("host");
      break;
    case "hotseat-lifeline":
      applyHotSeatLifeline(String(payload.kind || ""));
      break;
    case "hotseat-end-turn":
      finishHotSeatTurn("host");
      break;
    case "reset-game":
      resetGame();
      break;
    default:
      send(client, "error", { message: "Unknown host action." });
      return;
  }

  broadcast();
}

function handlePlayerMessage(message, client) {
  const team = getTeam(client.teamId);
  if (!team) return;

  if (message.type === "screening-answer") {
    if (state.screening.status !== "active") return;
    const question = QUESTION_BANK.screening.find((entry) => entry.id === message.questionId);
    if (!question) return;
    state.screening.responses[team.id][question.id] = Number(message.answerIndex);
    state.notice = `${team.name} answered.`;
    broadcast();
    return;
  }

  if (message.type === "fff-submit") {
    if (state.fff.status !== "active") return;
    if (!getEligibleFFFTeams().includes(team.id)) return;
    const question = getFFFQuestion();
    if (!question) return;
    const order = Array.isArray(message.order) ? message.order.slice(0, question.options.length) : [];
    if (order.length !== question.options.length) return;
    const receivedAt = Date.now();
    const submittedAt = Number(message.estimatedServerTime || receivedAt);
    state.fff.submissions[team.id] = { order, submittedAt, receivedAt };
    state.notice = `${team.name} submitted FFF.`;
    broadcast();
    return;
  }
}

function handleMessage(raw, client) {
  let message;
  try {
    message = JSON.parse(raw);
  } catch (error) {
    send(client, "error", { message: "Malformed WebSocket payload." });
    return;
  }

  if (message.type === "sync") {
    send(client, "sync", {
      clientTime: Number(message.clientTime),
      serverTime: Date.now()
    });
    return;
  }

  if (message.type === "hello") {
    client.role = message.role || "viewer";
    send(client, "state", buildStateForClient(client));
    return;
  }

  if (message.type === "host-auth") {
    if (String(message.pin || "") === ADMIN_PIN) {
      client.isHost = true;
      client.role = "host";
    state.notice = "Host ready.";
      broadcast();
      return;
    }
    send(client, "error", { message: "Incorrect admin PIN." });
    return;
  }

  if (message.type === "register-team") {
    registerTeam(message, client);
    return;
  }

  if (message.type === "reconnect-team") {
    reconnectTeam(message, client);
    return;
  }

  if (message.type === "host-action") {
    handleHostAction(message.action, message.payload, client);
    return;
  }

  handlePlayerMessage(message, client);
}

function tick() {
  let changed = false;
  const now = Date.now();

  if (state.screening.status === "active" && state.screening.endsAt && now >= state.screening.endsAt) {
    endScreening();
    changed = true;
  }

  if (state.fff.status === "active" && state.fff.endsAt && now >= state.fff.endsAt) {
    rankFFF();
    changed = true;
  }

  if (state.phase === "hotseat" && state.hotSeat.status === "question-live" && state.hotSeat.endsAt && now >= state.hotSeat.endsAt) {
    state.hotSeat.timerRemainingMs = 0;
    state.hotSeat.timerState = "stopped";
    state.hotSeat.timerPauseReason = "Timeout";
    state.hotSeat.lockedAnswerIndex = state.hotSeat.selectedAnswerIndex;
    revealHotSeatAnswer("timeout");
    changed = true;
  }

  if (state.hotSeat.callActiveUntil && now >= state.hotSeat.callActiveUntil) {
    state.hotSeat.callActiveUntil = null;
    if (state.phase === "hotseat" && state.hotSeat.timerState === "paused" && state.hotSeat.timerPauseReason === "Call a Friend") {
      state.notice = "Call ended. Resume timer.";
    }
    changed = true;
  }

  if (changed) {
    broadcast();
  }
}

function serveStatic(request, response) {
  const url = new URL(request.url, `http://${request.headers.host}`);
  const routeMap = {
    "/": "index.html",
    "/play": "play.html",
    "/host": "host.html",
    "/screen": "screen.html",
    "/hotseat-host": "hotseat-host.html",
    "/hotseat-screen": "hotseat-screen.html"
  };

  const requested = routeMap[url.pathname] || url.pathname.slice(1);
  const filePath = path.join(PUBLIC_DIR, requested);

  if (!filePath.startsWith(PUBLIC_DIR)) {
    response.writeHead(403);
    response.end("Forbidden");
    return;
  }

  fs.readFile(filePath, (error, buffer) => {
    if (error) {
      response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      response.end("Not found");
      return;
    }

    response.writeHead(200, {
      "Content-Type": MIME_TYPES[path.extname(filePath)] || "application/octet-stream"
    });
    response.end(buffer);
  });
}

const server = http.createServer(serveStatic);

server.on("upgrade", (request, socket) => {
  const key = request.headers["sec-websocket-key"];
  if (!key) {
    socket.destroy();
    return;
  }

  const acceptKey = crypto
    .createHash("sha1")
    .update(key + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11")
    .digest("base64");

  socket.write(
    [
      "HTTP/1.1 101 Switching Protocols",
      "Upgrade: websocket",
      "Connection: Upgrade",
      `Sec-WebSocket-Accept: ${acceptKey}`,
      "\r\n"
    ].join("\r\n")
  );

  const client = {
    id: crypto.randomUUID(),
    socket,
    role: "viewer",
    isHost: false,
    teamId: null,
    buffer: Buffer.alloc(0)
  };

  clients.set(client.id, client);
  send(client, "state", buildStateForClient(client));

  socket.on("data", (chunk) => {
    client.buffer = Buffer.concat([client.buffer, chunk]);
    const { frames, remaining } = parseFrames(client.buffer);
    client.buffer = remaining;

    for (const frame of frames) {
      if (frame.opcode === 0x8) {
        socket.end();
        return;
      }

      if (frame.opcode === 0x1) {
        handleMessage(frame.payload.toString("utf8"), client);
      }
    }
  });

  socket.on("close", () => {
    if (client.teamId && state.teams[client.teamId]) {
      state.teams[client.teamId].socketId = null;
    }
    clients.delete(client.id);
    broadcast();
  });

  socket.on("error", () => {
    socket.destroy();
  });
});

setInterval(tick, 1000);

server.listen(PORT, "0.0.0.0", () => {
  console.log(`Jal Jeevan Trivia running on http://0.0.0.0:${PORT}`);
  console.log(`Host PIN: ${ADMIN_PIN}`);
});
