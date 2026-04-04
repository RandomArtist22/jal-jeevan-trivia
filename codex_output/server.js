const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

loadEnvFile(path.join(__dirname, ".env"));

const PORT = Number(process.env.PORT || 3000);
const ADMIN_PIN = process.env.ADMIN_PIN || "jaljeevan-admin";
const PLAYER_PIN = process.env.PLAYER_PIN || "jaljeevan-player";
const PUBLIC_BASE_URL = String(process.env.PUBLIC_BASE_URL || "").trim().replace(/\/+$/, "");
const RUNTIME_PUBLIC_BASE_URL_FILE = path.join(__dirname, ".runtime-public-base-url");
const PUBLIC_DIR = path.join(__dirname, "public");
const AUDIO_DIR = path.join(PUBLIC_DIR, "audio");
const QUESTION_BANK = JSON.parse(fs.readFileSync(path.join(__dirname, "data", "questions.json"), "utf8"));
const HOT_SEAT_BANKS = {
  "set-1": {
    key: "set-1",
    label: "Hot Seat Set 1",
    questions: JSON.parse(fs.readFileSync(path.join(__dirname, "data", "hotseat-questions-set-1.json"), "utf8"))
  },
  "set-2": {
    key: "set-2",
    label: "Hot Seat Set 2",
    questions: JSON.parse(fs.readFileSync(path.join(__dirname, "data", "hotseat-questions-set-2.json"), "utf8"))
  },
  "set-3": {
    key: "set-3",
    label: "Hot Seat Set 3",
    questions: JSON.parse(fs.readFileSync(path.join(__dirname, "data", "hotseat-questions-set-3.json"), "utf8"))
  }
};
const DEFAULT_HOT_SEAT_SET = "set-1";
const SAFE_LEVELS = [50, 1000];
const QUALIFIER_LIMIT = 8;
const AUDIENCE_QUALIFIER_LIMIT = 2;
const AUDIO_LABELS = {
  opening_audio: "Opening",
  fastest_fingers_first_audio: "Fastest Fingers First",
  question_audio: "Question Bed",
  call_a_friend_audio: "Call A Friend",
  lock_question: "Lock Answer",
  correct_question: "Correct Answer"
};
const AUDIO_ORDER = [
  "opening_audio",
  "fastest_fingers_first_audio",
  "question_audio",
  "lock_question",
  "correct_question",
  "call_a_friend_audio"
];

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".mp3": "audio/mpeg",
  ".mpeg": "audio/mpeg",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon"
};

function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return;
  const source = fs.readFileSync(filePath, "utf8");
  for (const rawLine of source.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const separatorIndex = line.indexOf("=");
    if (separatorIndex <= 0) continue;
    const key = line.slice(0, separatorIndex).trim();
    if (!key || process.env[key] !== undefined) continue;
    let value = line.slice(separatorIndex + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    process.env[key] = value;
  }
}

function getPublicBaseUrl() {
  if (PUBLIC_BASE_URL) return PUBLIC_BASE_URL;
  if (!fs.existsSync(RUNTIME_PUBLIC_BASE_URL_FILE)) return "";
  try {
    return String(fs.readFileSync(RUNTIME_PUBLIC_BASE_URL_FILE, "utf8")).trim().replace(/\/+$/, "");
  } catch {
    return "";
  }
}

function buildSoundLibrary() {
  if (!fs.existsSync(AUDIO_DIR)) return [];
  const tracks = fs.readdirSync(AUDIO_DIR)
    .filter((fileName) => fs.statSync(path.join(AUDIO_DIR, fileName)).isFile())
    .map((fileName) => {
      const extension = path.extname(fileName);
      const id = path.basename(fileName, extension);
      return {
        id,
        fileName,
        label: AUDIO_LABELS[id] || id.replace(/[_-]+/g, " ").replace(/\b\w/g, (char) => char.toUpperCase()),
        path: `/audio/${fileName}`
      };
    });

  tracks.sort((left, right) => {
    const leftIndex = AUDIO_ORDER.indexOf(left.id);
    const rightIndex = AUDIO_ORDER.indexOf(right.id);
    const normalizedLeft = leftIndex === -1 ? Number.MAX_SAFE_INTEGER : leftIndex;
    const normalizedRight = rightIndex === -1 ? Number.MAX_SAFE_INTEGER : rightIndex;
    return normalizedLeft - normalizedRight || left.label.localeCompare(right.label);
  });

  return tracks;
}

const SOUND_LIBRARY = buildSoundLibrary();

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
    sound: {
      trackId: "",
      status: "stopped",
      startedAt: null,
      stoppedAt: null,
      cueId: 0
    },
    hotSeat: {
      status: "idle",
      questionSetKey: DEFAULT_HOT_SEAT_SET,
      teamId: null,
      questionIndex: 0,
      optionsVisible: false,
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
      callTimer: {
        startedAt: null,
        endsAt: null,
        durationMs: 50000,
        timerState: "idle",
        timerRemainingMs: 0,
        timerPauseReason: ""
      },
      history: []
    }
  };
}

function publicRoute(pathname = "") {
  return `${getPublicBaseUrl()}${pathname}`;
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

function getHotSeatBank(questionSetKey = state.hotSeat.questionSetKey) {
  return HOT_SEAT_BANKS[questionSetKey] || HOT_SEAT_BANKS[DEFAULT_HOT_SEAT_SET];
}

function getHotSeatQuestion() {
  return getHotSeatBank().questions[state.hotSeat.questionIndex] || null;
}

function getSoundTrack(trackId) {
  return SOUND_LIBRARY.find((track) => track.id === trackId) || null;
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
  return getHotSeatBank().questions.map((question, index) => ({
    level: index + 1,
    points: question.points,
    isSafe: SAFE_LEVELS.includes(question.points)
  }));
}

function buildStateForClient(client) {
  const team = client.teamId ? getTeam(client.teamId) : null;
  const isHost = client.isHost;
  const isHotSeatScreen = client.role === "hotseat-screen";
  const isAudiencePoll = client.role === "audience-poll";
  const currentHotSeatQuestion = getHotSeatQuestion();
  const currentFFFQuestion = getFFFQuestion();
  const screeningQuestions = QUESTION_BANK.screening.map((question) => sanitizeQuestion(question, isHost));
  const canSeeHotSeatQuestion = isHost || isHotSeatScreen || isAudiencePoll;
  const canSeeHotSeatSelection = isHost || isHotSeatScreen;
  const audiencePoll = state.hotSeat.audiencePoll
    ? {
        status: state.hotSeat.audiencePoll.status,
        questionId: state.hotSeat.audiencePoll.questionId,
        counts: state.hotSeat.audiencePoll.counts.slice(),
        totalVotes: state.hotSeat.audiencePoll.totalVotes,
        percentages: state.hotSeat.audiencePoll.percentages.slice(),
        pollUrl: publicRoute("/audience-poll")
      }
    : null;

  return {
    now: Date.now(),
    config: {
      eventTitle: state.eventTitle,
      eventSubtitle: state.eventSubtitle,
      publicBaseUrl: getPublicBaseUrl(),
      hasPlayerPassword: Boolean(PLAYER_PIN),
      screeningDurationMs: state.screening.durationMs,
      fffDurationMs: state.fff.durationMs,
      fffQuestionCount: QUESTION_BANK.fastestFinger.length,
      qualifierLimit: QUALIFIER_LIMIT,
      audienceQualifierLimit: AUDIENCE_QUALIFIER_LIMIT,
      safeLevels: SAFE_LEVELS,
      soundLibrary: SOUND_LIBRARY.map((track) => ({
        id: track.id,
        label: track.label,
        path: track.path
      })),
      hotSeatQuestionSets: Object.values(HOT_SEAT_BANKS).map((bank) => ({
        key: bank.key,
        label: bank.label,
        count: bank.questions.length
      })),
      hotSeatLadder: buildScoreLadder()
    },
    session: {
      role: client.role,
      isHost,
      teamId: team ? team.id : null,
      canPlay: client.role === "player" ? Boolean(client.isPlayerAuthorized) : false,
      audienceVoteIndex: isAudiencePoll && audiencePoll && client.voterId
        ? Number(state.hotSeat.audiencePoll?.voters?.[client.voterId] ?? -1)
        : -1
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
    sound: {
      trackId: state.sound.trackId,
      status: state.sound.status,
      startedAt: state.sound.startedAt,
      stoppedAt: state.sound.stoppedAt,
      cueId: state.sound.cueId,
      track: state.sound.trackId ? getSoundTrack(state.sound.trackId) : null
    },
    hotSeat: {
      status: state.hotSeat.status,
      questionSetKey: state.hotSeat.questionSetKey,
      teamId: state.hotSeat.teamId,
      questionIndex: state.hotSeat.questionIndex,
      optionsVisible: state.hotSeat.optionsVisible,
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
      audiencePoll,
      callTimer: {
        startedAt: state.hotSeat.callTimer.startedAt,
        endsAt: state.hotSeat.callTimer.endsAt,
        durationMs: state.hotSeat.callTimer.durationMs,
        timerState: state.hotSeat.callTimer.timerState,
        timerRemainingMs: state.hotSeat.callTimer.timerState === "running"
          ? Math.max(0, (state.hotSeat.callTimer.endsAt || 0) - Date.now())
          : state.hotSeat.callTimer.timerRemainingMs,
        timerPauseReason: state.hotSeat.callTimer.timerPauseReason
      },
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
  if (!client.isPlayerAuthorized) {
    send(client, "error", { message: "Enter the player password before using this endpoint." });
    return;
  }
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
  if (!client.isPlayerAuthorized) {
    send(client, "error", { message: "Enter the player password before restoring a team." });
    return;
  }
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
  state.hotSeat.optionsVisible = false;
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
  clearCallTimer();
  state.hotSeat.history = [];
  clearHotSeatTimer();
  state.phase = "hotseat";
  state.notice = `${state.teams[teamId].name} on Hot Seat. Reveal options to start the timer.`;
}

function getHotSeatAnswerWindowMs() {
  const level = Number(state.hotSeat.questionIndex || 0) + 1;
  if (level <= 3) return 45000;
  if (level <= 6) return 60000;
  return 90000;
}

function getHotSeatTimerRemaining(now = Date.now()) {
  if (state.hotSeat.timerState === "running" && state.hotSeat.endsAt) {
    return Math.max(0, state.hotSeat.endsAt - now);
  }
  return Math.max(0, state.hotSeat.timerRemainingMs || 0);
}

function getCallTimerRemaining(now = Date.now()) {
  if (state.hotSeat.callTimer.timerState === "running" && state.hotSeat.callTimer.endsAt) {
    return Math.max(0, state.hotSeat.callTimer.endsAt - now);
  }
  return Math.max(0, state.hotSeat.callTimer.timerRemainingMs || 0);
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

function startCallTimer(durationMs = 50000) {
  state.hotSeat.callTimer.durationMs = durationMs;
  state.hotSeat.callTimer.startedAt = Date.now();
  state.hotSeat.callTimer.endsAt = state.hotSeat.callTimer.startedAt + durationMs;
  state.hotSeat.callTimer.timerState = "running";
  state.hotSeat.callTimer.timerRemainingMs = durationMs;
  state.hotSeat.callTimer.timerPauseReason = "";
}

function pauseCallTimer(reason = "") {
  if (state.hotSeat.callTimer.timerState !== "running") return;
  state.hotSeat.callTimer.timerRemainingMs = getCallTimerRemaining();
  state.hotSeat.callTimer.endsAt = null;
  state.hotSeat.callTimer.timerState = "paused";
  state.hotSeat.callTimer.timerPauseReason = reason;
}

function resumeCallTimer() {
  if (state.hotSeat.callTimer.timerState !== "paused") return;
  const totalMs = state.hotSeat.callTimer.durationMs || 50000;
  const remainingMs = Math.max(0, state.hotSeat.callTimer.timerRemainingMs || totalMs);
  const now = Date.now();
  state.hotSeat.callTimer.startedAt = now - (totalMs - remainingMs);
  state.hotSeat.callTimer.endsAt = now + remainingMs;
  state.hotSeat.callTimer.timerState = "running";
  state.hotSeat.callTimer.timerPauseReason = "";
}

function stopCallTimer(reason = "") {
  if (state.hotSeat.callTimer.timerState === "running") {
    state.hotSeat.callTimer.timerRemainingMs = getCallTimerRemaining();
  }
  state.hotSeat.callTimer.endsAt = null;
  state.hotSeat.callTimer.timerState = "stopped";
  state.hotSeat.callTimer.timerPauseReason = reason || state.hotSeat.callTimer.timerPauseReason;
}

function clearCallTimer() {
  state.hotSeat.callTimer.startedAt = null;
  state.hotSeat.callTimer.endsAt = null;
  state.hotSeat.callTimer.durationMs = 50000;
  state.hotSeat.callTimer.timerState = "idle";
  state.hotSeat.callTimer.timerRemainingMs = 0;
  state.hotSeat.callTimer.timerPauseReason = "";
}

function recalculateAudiencePoll() {
  const poll = state.hotSeat.audiencePoll;
  if (!poll) return;
  poll.totalVotes = poll.counts.reduce((sum, value) => sum + value, 0);
  if (!poll.totalVotes) {
    poll.percentages = poll.counts.map(() => 0);
    return;
  }
  poll.percentages = poll.counts.map((value) => Math.round((value / poll.totalVotes) * 100));
}

function closeAudiencePoll() {
  if (!state.hotSeat.audiencePoll) return;
  state.hotSeat.audiencePoll.status = "closed";
}

function lockAudiencePoll() {
  if (!state.hotSeat.audiencePoll || state.hotSeat.audiencePoll.status !== "open") return false;
  recalculateAudiencePoll();
  state.hotSeat.audiencePoll.status = "locked";
  state.notice = "Audience poll locked.";
  return true;
}

function setHotSeatQuestionSet(questionSetKey) {
  if (!HOT_SEAT_BANKS[questionSetKey]) return false;
  if (state.phase === "hotseat" && state.hotSeat.status !== "ended") return false;
  state.hotSeat.questionSetKey = questionSetKey;
  state.notice = `${getHotSeatBank(questionSetKey).label} selected.`;
  return true;
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
    state.hotSeat.audiencePoll = {
      status: "open",
      questionId: question.id,
      counts: question.options.map(() => 0),
      totalVotes: 0,
      percentages: question.options.map(() => 0),
      voters: {}
    };
    pauseHotSeatTimer("Audience Poll");
    state.notice = "Audience poll live.";
  }

  if (kind === "Call a Friend") {
    pauseHotSeatTimer("Call a Friend");
    startCallTimer(50000);
    state.notice = "Call started.";
  }
}

function moveToNextHotSeatQuestion() {
  if (state.hotSeat.questionIndex >= getHotSeatBank().questions.length - 1) {
    finishHotSeatTurn("completed");
    return;
  }

  state.hotSeat.questionIndex += 1;
  state.hotSeat.status = "question-live";
  state.hotSeat.optionsVisible = false;
  state.hotSeat.selectedAnswerIndex = null;
  state.hotSeat.lockedAnswerIndex = null;
  state.hotSeat.reveal = null;
  state.hotSeat.revealReason = "";
  state.hotSeat.reducedOptionIndices = [];
  state.hotSeat.audiencePoll = null;
  clearCallTimer();
  clearHotSeatTimer();
  state.notice = `Hot Seat Q${state.hotSeat.questionIndex + 1} ready. Reveal options to start the timer.`;
}

function finishHotSeatTurn(reason) {
  const team = getTeam(state.hotSeat.teamId);
  if (team && !state.completedHotSeatTeams.includes(team.id)) {
    state.completedHotSeatTeams.push(team.id);
    team.hotSeatAppearances += 1;
    team.score = state.hotSeat.currentScore;
  }

  state.hotSeat.status = "ended";
  state.hotSeat.audiencePoll = null;
  clearHotSeatTimer();
  clearCallTimer();
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
  closeAudiencePoll();
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
    if (state.hotSeat.questionIndex >= getHotSeatBank().questions.length - 1) {
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

function playSound(trackId) {
  const track = getSoundTrack(trackId);
  if (!track) return false;
  state.sound.trackId = track.id;
  state.sound.status = "playing";
  state.sound.startedAt = Date.now();
  state.sound.stoppedAt = null;
  state.sound.cueId += 1;
  return true;
}

function stopSound() {
  if (state.sound.status !== "playing" && !state.sound.trackId) return false;
  state.sound.status = "stopped";
  state.sound.stoppedAt = Date.now();
  return true;
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
    case "set-hotseat-question-set":
      if (!setHotSeatQuestionSet(String(payload.questionSetKey || ""))) {
        send(client, "error", { message: "Choose a valid Hot Seat question set before starting." });
        return;
      }
      break;
    case "rank-fff":
      rankFFF();
      break;
    case "sound-play":
      if (!playSound(String(payload.trackId || ""))) {
        send(client, "error", { message: "Choose a valid sound cue." });
        return;
      }
      break;
    case "sound-stop":
      if (!stopSound()) {
        send(client, "error", { message: "No sound is currently playing." });
        return;
      }
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
    case "hotseat-show-options":
      if (state.phase !== "hotseat" || state.hotSeat.status !== "question-live" || !getHotSeatQuestion()) {
        send(client, "error", { message: "No active Hot Seat question is ready." });
        return;
      }
      if (state.hotSeat.optionsVisible) {
        send(client, "error", { message: "Hot Seat options are already visible." });
        return;
      }
      state.hotSeat.optionsVisible = true;
      startHotSeatTimer();
      state.notice = "Options live. Answer timer started.";
      break;
    case "hotseat-resume-timer":
      if (state.phase !== "hotseat" || state.hotSeat.status !== "question-live" || state.hotSeat.timerState !== "paused") {
        send(client, "error", { message: "Hot Seat timer is not paused." });
        return;
      }
      if (state.hotSeat.timerPauseReason === "Audience Poll" && state.hotSeat.audiencePoll?.status === "open") {
        send(client, "error", { message: "Lock the audience poll before resuming the timer." });
        return;
      }
      if (state.hotSeat.timerPauseReason === "Call a Friend" && ["running", "paused"].includes(state.hotSeat.callTimer.timerState)) {
        send(client, "error", { message: "End or stop the call timer before resuming the answer timer." });
        return;
      }
      resumeHotSeatTimer();
      state.notice = "Hot Seat timer resumed.";
      break;
    case "hotseat-pause-timer":
      if (state.phase !== "hotseat" || state.hotSeat.status !== "question-live" || state.hotSeat.timerState !== "running") {
        send(client, "error", { message: "Hot Seat timer is not running." });
        return;
      }
      pauseHotSeatTimer("Manual Pause");
      state.notice = "Hot Seat timer paused.";
      break;
    case "hotseat-reset-timer":
      if (state.phase !== "hotseat" || state.hotSeat.status !== "question-live" || !state.hotSeat.optionsVisible) {
        send(client, "error", { message: "Hot Seat timer cannot be reset right now." });
        return;
      }
      startHotSeatTimer();
      state.notice = "Hot Seat timer reset.";
      break;
    case "hotseat-lock-audience-poll":
      if (state.phase !== "hotseat" || state.hotSeat.status !== "question-live" || state.hotSeat.audiencePoll?.status !== "open") {
        send(client, "error", { message: "Audience poll is not open." });
        return;
      }
      lockAudiencePoll();
      break;
    case "hotseat-pause-call":
      if (state.phase !== "hotseat" || state.hotSeat.callTimer.timerState !== "running") {
        send(client, "error", { message: "Call timer is not running." });
        return;
      }
      pauseCallTimer("Manual Pause");
      state.notice = "Call timer paused.";
      break;
    case "hotseat-resume-call":
      if (state.phase !== "hotseat" || state.hotSeat.callTimer.timerState !== "paused") {
        send(client, "error", { message: "Call timer is not paused." });
        return;
      }
      resumeCallTimer();
      state.notice = "Call timer resumed.";
      break;
    case "hotseat-end-call":
      if (state.phase !== "hotseat" || state.hotSeat.callTimer.timerState === "idle") {
        send(client, "error", { message: "Call timer is not active." });
        return;
      }
      stopCallTimer("Ended");
      state.notice = "Call ended. Resume answer timer.";
      break;
    case "hotseat-next":
      moveToNextHotSeatQuestion();
      break;
    case "hotseat-select-answer":
      if (state.phase !== "hotseat" || state.hotSeat.status !== "question-live" || !state.hotSeat.optionsVisible) {
        send(client, "error", { message: "Hot Seat is not accepting answers right now." });
        return;
      }
      state.hotSeat.selectedAnswerIndex = Number(payload.answerIndex);
      state.notice = `${getTeam(state.hotSeat.teamId)?.name || "Team"} selected.`;
      break;
    case "hotseat-lock-answer":
      if (state.phase !== "hotseat" || state.hotSeat.status !== "question-live" || !state.hotSeat.optionsVisible) {
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
      if (state.phase !== "hotseat" || state.hotSeat.status !== "question-live" || !state.hotSeat.optionsVisible) {
        send(client, "error", { message: "Reveal the options before using a Hot Seat lifeline." });
        return;
      }
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
  if (!client.isPlayerAuthorized) {
    send(client, "error", { message: "Player password is required." });
    return;
  }
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

function handleAudiencePollMessage(message, client) {
  if (message.type !== "audience-vote") return false;
  const poll = state.hotSeat.audiencePoll;
  const question = getHotSeatQuestion();
  if (!poll || poll.status !== "open" || !question) {
    send(client, "error", { message: "Audience voting is not open right now." });
    return true;
  }
  if (!client.voterId) {
    send(client, "error", { message: "Audience vote session is missing." });
    return true;
  }
  if (poll.questionId !== question.id) {
    send(client, "error", { message: "Audience poll has changed. Reload the vote page." });
    return true;
  }

  const answerIndex = Number(message.answerIndex);
  if (!Number.isInteger(answerIndex) || answerIndex < 0 || answerIndex >= question.options.length) {
    send(client, "error", { message: "Choose a valid audience answer." });
    return true;
  }

  const previousVote = poll.voters[client.voterId];
  if (Number.isInteger(previousVote) && previousVote >= 0 && previousVote < poll.counts.length) {
    poll.counts[previousVote] = Math.max(0, poll.counts[previousVote] - 1);
  }
  poll.voters[client.voterId] = answerIndex;
  poll.counts[answerIndex] += 1;
  recalculateAudiencePoll();
  state.notice = `Audience votes: ${poll.totalVotes}`;
  broadcast();
  return true;
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
    client.voterId = message.voterId ? String(message.voterId) : client.voterId || "";
    client.isPlayerAuthorized = client.role === "player" ? String(message.playerPin || "") === PLAYER_PIN : false;
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

  if (message.type === "player-auth") {
    if (String(message.pin || "") === PLAYER_PIN) {
      client.isPlayerAuthorized = true;
      client.role = "player";
      send(client, "player-authenticated", {});
      send(client, "state", buildStateForClient(client));
      return;
    }
    send(client, "error", { message: "Incorrect player password." });
    return;
  }

  if (message.type === "sound-ended") {
    if (
      ["screen", "hotseat-screen"].includes(client.role)
      && state.sound.status === "playing"
      && Number(message.cueId) === Number(state.sound.cueId)
    ) {
      stopSound();
      broadcast();
    }
    return;
  }

  if (client.role === "audience-poll" && handleAudiencePollMessage(message, client)) {
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

  if (state.hotSeat.callTimer.timerState === "running" && state.hotSeat.callTimer.endsAt && now >= state.hotSeat.callTimer.endsAt) {
    state.hotSeat.callTimer.timerRemainingMs = 0;
    stopCallTimer("Timeout");
    if (state.phase === "hotseat" && state.hotSeat.timerState === "paused" && state.hotSeat.timerPauseReason === "Call a Friend") {
      state.notice = "Call ended. Resume answer timer.";
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
    "/audience-poll": "audience-poll.html",
    "/host": "host.html",
    "/soundboard": "soundboard.html",
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
    isPlayerAuthorized: false,
    teamId: null,
    voterId: "",
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
