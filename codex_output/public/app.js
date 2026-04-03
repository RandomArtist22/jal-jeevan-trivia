const page = document.body.dataset.page;
const app = document.getElementById("app");
const LETTERS = ["A", "B", "C", "D", "E", "F"];
const numberFormatter = new Intl.NumberFormat("en-IN");

const ui = {
  state: null,
  socket: null,
  clockOffset: 0,
  syncSamples: [],
  flash: "",
  flashType: "idle",
  teamId: localStorage.getItem("jal_jeevan_team_id") || "",
  renderedAt: 0,
  screeningQuestionIndex: 0,
  hostSection: "stage",
  hotSeatSection: "control",
  teamPage: 0,
  fffDraftQuestionKey: "",
  fffDraftOrder: []
};

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function getState() {
  return ui.state || {
    phase: "lobby",
    notice: "",
    teams: [],
    qualifiers: [],
    completedHotSeatTeams: [],
    privateTeam: null,
    session: {},
    config: { safeLevels: [], hotSeatLadder: [] },
    screening: { questions: [], responses: {}, rankings: [] },
    fff: { ranked: [], eligibleTeams: [], mySubmission: null },
    hotSeat: { lifelinesUsed: [], reducedOptionIndices: [], history: [] }
  };
}

function getTeam(teamId) {
  return getState().teams.find((team) => team.id === teamId) || null;
}

function send(message) {
  if (!ui.socket || ui.socket.readyState !== WebSocket.OPEN) return;
  ui.socket.send(JSON.stringify(message));
}

function pushFlash(message, type = "idle") {
  ui.flash = message;
  ui.flashType = type;
  render();
  window.clearTimeout(pushFlash.timeoutId);
  pushFlash.timeoutId = window.setTimeout(() => {
    ui.flash = "";
    render();
  }, 2600);
}

function syncClock() {
  send({ type: "sync", clientTime: Date.now() });
}

function connect() {
  const protocol = window.location.protocol === "https:" ? "wss" : "ws";
  ui.socket = new WebSocket(`${protocol}://${window.location.host}`);

  ui.socket.addEventListener("open", () => {
    send({ type: "hello", role: page });
    if (page === "player" && ui.teamId) {
      send({ type: "reconnect-team", teamId: ui.teamId });
    }
    syncClock();
    window.setTimeout(syncClock, 1200);
  });

  ui.socket.addEventListener("message", (event) => {
    const message = JSON.parse(event.data);
    if (message.type === "state") {
      ui.state = message.payload;
      syncLocalUiFromState(message.payload);
      render();
      return;
    }

    if (message.type === "registered") {
      ui.teamId = message.payload.teamId;
      localStorage.setItem("jal_jeevan_team_id", ui.teamId);
      pushFlash("Team registered on the host server.", "active");
      return;
    }

    if (message.type === "sync") {
      const now = Date.now();
      const midpoint = Number(message.payload.clientTime) + (now - Number(message.payload.clientTime)) / 2;
      const offset = Number(message.payload.serverTime) - midpoint;
      ui.syncSamples = [...ui.syncSamples.slice(-4), offset];
      ui.clockOffset = ui.syncSamples.reduce((sum, value) => sum + value, 0) / ui.syncSamples.length;
      updateDynamicBits();
      return;
    }

    if (message.type === "error") {
      pushFlash(message.payload.message, "danger");
    }
  });

  ui.socket.addEventListener("close", () => {
    pushFlash("Connection lost. Reconnecting to the local quiz server...", "danger");
    window.setTimeout(connect, 1200);
  });
}

function serverNow() {
  return Date.now() + ui.clockOffset;
}

function formatMs(ms) {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

function prettyDate(timestamp) {
  if (!timestamp || !Number.isFinite(timestamp)) return "--";
  return new Date(timestamp).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit"
  });
}

function formatNumber(value) {
  const numeric = Number(value);
  return numberFormatter.format(Number.isFinite(numeric) ? numeric : 0);
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function routeUrl(path = "") {
  return `${window.location.origin}${path}`;
}

function phaseLabel(phase) {
  switch (phase) {
    case "screening":
      return "Screening Round";
    case "fff":
      return "Fastest Finger First";
    case "hotseat":
      return "Hot Seat";
    case "intermission":
      return "Intermission";
    case "lobby":
    default:
      return "Lobby";
  }
}

function qualificationLabel(team, state) {
  if (!team) return "Awaiting Registration";
  if (team.qualified) return "Qualified";
  if (team.isAudience && state.screening.status !== "ended") return "Audience Entry";
  if (state.screening.status === "ended" && !state.qualifiers.length) return "Awaiting Operator Decision";
  if (state.screening.status !== "ended") return "Awaiting Screening Result";
  return "Not In Current Pool";
}

function getPlayerInstruction(state, team) {
  if (!team) {
    return "Register one team on this device, then leave this page open through screening and Fastest Finger First.";
  }

  if (state.phase === "screening") {
    if (state.screening.status === "active") {
      return "Answer every screening question now. Each tap saves immediately on the local server.";
    }
    return "Screening is closed. Wait for the operator to mark the qualified teams.";
  }

  if (state.phase === "fff") {
    if (!state.fff.question) {
      return "Wait for the operator to open a Fastest Finger First question.";
    }
    if (!state.fff.eligibleTeams.includes(team.id)) {
      return "This team is not in the current Fastest Finger First pool. Watch the main screen for the next call.";
    }
    if (state.fff.mySubmission) {
      return "Your order is submitted and locked. Wait for the ranking and team announcement.";
    }
    if (state.fff.status === "active") {
      return "Arrange each option once in the correct order, then submit before the timer ends.";
    }
    return "The ordering window is closed. Wait for the operator to rank the answers.";
  }

  if (state.phase === "hotseat" || state.phase === "intermission" || state.hotSeat.status === "ended") {
    return "Participant devices are inactive during Hot Seat. Watch the dedicated Hot Seat screen while the operator runs that round separately.";
  }

  if (state.screening.status === "ended" && team.qualified) {
    return "This team is qualified. Stay on this page and wait for Fastest Finger First.";
  }

  return "Stay on this page. The operator will run screening and Fastest Finger First from the quiz console.";
}

function getOperatorInstruction(state) {
  if (!state.teams.length) {
    return "Keep this page on the laptop, share /play with teams, and wait for registrations before starting screening.";
  }

  if (state.screening.status === "idle") {
    return "Confirm the projector is on /screen, check the team count, then start the screening round.";
  }

  if (state.screening.status === "active") {
    return "Screening is live. Let teams answer on /play and only stop the round if the venue needs an early close.";
  }

  if (state.screening.status === "ended" && !state.qualifiers.length) {
    return "Screening is finished. Review the ranking and mark the qualified teams before Fastest Finger First.";
  }

  if (state.phase === "fff" && state.fff.status === "active") {
    return "Wait for eligible teams to submit their order, then lock and rank Fastest Finger First.";
  }

  if (state.phase === "fff" && state.fff.status === "locked" && state.fff.winnerTeamId) {
    return "Fastest Finger First is complete. Move to the dedicated Hot Seat operator endpoint for the next round.";
  }

  if (state.phase === "hotseat" && state.hotSeat.status === "question-live") {
    return "Hot Seat is live on the dedicated Hot Seat operator endpoint. This quiz console is no longer used for that round.";
  }

  if (state.phase === "hotseat" && state.hotSeat.status === "locked") {
    return "Hot Seat is being controlled from the dedicated Hot Seat operator endpoint.";
  }

  if (state.phase === "hotseat" && state.hotSeat.status === "revealed") {
    return "Use the dedicated Hot Seat operator endpoint to continue the round or finish the turn.";
  }

  if (state.phase === "intermission") {
    return "The quiz stage is paused while Hot Seat handoff is handled on the dedicated Hot Seat endpoints.";
  }

  return "This endpoint stays with the operator for registration, screening, and Fastest Finger First only.";
}

function getScreenInstruction(state) {
  if (state.phase === "screening") {
    return "Teams are answering on their devices right now. This screen is for the audience only.";
  }

  if (state.phase === "fff") {
    return "Eligible teams are arranging their answer order on /play. The operator controls the result from /host.";
  }

  if (state.phase === "hotseat") {
    return "Hot Seat is no longer shown here. Switch the projector to the dedicated Hot Seat screen endpoint.";
  }

  if (state.phase === "intermission") {
    return "Hot Seat handoff is handled on the dedicated Hot Seat screen endpoint.";
  }

  return "Project this page for screening and Fastest Finger First only. Hot Seat uses its own projector endpoint.";
}

function getHotSeatOperatorInstruction(state) {
  if (state.phase !== "hotseat") {
    if (state.fff.winnerTeamId) {
      return "Fastest Finger First winner is ready. Start the dedicated Hot Seat round from this page when the stage is ready.";
    }
    return "This page is reserved for the Hot Seat round. Return here after Fastest Finger First produces a winner.";
  }

  if (state.hotSeat.status === "question-live") {
    return "Ask the question, select the team’s spoken answer here, then lock it when the team confirms.";
  }

  if (state.hotSeat.status === "locked") {
    return "The answer is locked. Reveal it from this page when the room is ready.";
  }

  if (state.hotSeat.status === "revealed") {
    return "Move to the next Hot Seat question or end the turn from this page.";
  }

  if (state.hotSeat.status === "ended" || state.phase === "intermission") {
    return "This Hot Seat turn is over. Start the next team here when you are ready.";
  }

  return "This page is the only control surface for Hot Seat. Participant devices do not interact during this round.";
}

function getHotSeatScreenInstruction(state) {
  if (state.phase === "hotseat") {
    return "This is the dedicated Hot Seat projector view. The operator controls the round from /hotseat-host.";
  }

  if (state.phase === "intermission" || state.hotSeat.status === "ended") {
    return "A Hot Seat turn just ended. Keep this page projected while the operator prepares the next team.";
  }

  return "Keep this page ready for the Hot Seat round. It is separate from the screening and Fastest Finger First projector view.";
}

function renderHtmlList(items, { ordered = false, className = "checklist" } = {}) {
  const tag = ordered ? "ol" : "ul";
  return `<${tag} class="${className}">${items.map((item) => `<li>${item}</li>`).join("")}</${tag}>`;
}

function renderStatusCallout(title, copy, tone = "active") {
  return `
    <div class="status-callout ${escapeHtml(tone)}" role="status" aria-live="polite">
      <strong>${escapeHtml(title)}</strong>
      <p>${escapeHtml(copy)}</p>
    </div>
  `;
}

function getScreeningQuestionIndex(total) {
  return clamp(ui.screeningQuestionIndex || 0, 0, Math.max(0, total - 1));
}

function renderCompactShell(header, body, className = "") {
  return `
    <section class="compact-shell ${className}">
      <header class="glass-card compact-hero">
        ${header}
      </header>
      <div class="compact-body">
        ${body}
      </div>
    </section>
  `;
}

function renderCompactStat(label, value) {
  return `
    <div class="compact-stat">
      <span class="kicker">${escapeHtml(label)}</span>
      <strong>${escapeHtml(value)}</strong>
    </div>
  `;
}

function renderCompactHeader({ eyebrow, title, right = "", chips = [] }) {
  return `
    <div class="panel-title-row">
      <span class="eyebrow">${escapeHtml(eyebrow)}</span>
      ${right}
    </div>
    <div class="compact-title-row">
      <h1 class="compact-title">${escapeHtml(title)}</h1>
    </div>
    ${
      chips.length
        ? `
          <div class="compact-chip-row">
            ${chips.map((chip) => `<span class="meta-chip ${chip.className || ""}">${chip.html ? chip.value : escapeHtml(chip.value)}</span>`).join("")}
          </div>
        `
        : ""
    }
  `;
}

function renderSegmentedControl(action, active, options) {
  return `
    <div class="segmented-control" role="tablist">
      ${options
        .map(
          (option) => `
            <button
              class="segmented-item ${active === option.value ? "is-active" : ""}"
              type="button"
              role="tab"
              aria-selected="${active === option.value ? "true" : "false"}"
              data-ui-action="${escapeHtml(action)}"
              data-value="${escapeHtml(option.value)}"
            >
              ${escapeHtml(option.label)}
            </button>
          `
        )
        .join("")}
    </div>
  `;
}

function renderCompactPager(action, currentIndex, total) {
  return `
    <div class="compact-pager">
      <button class="ghost-button compact-button" type="button" data-ui-action="${escapeHtml(action)}" data-direction="-1" ${currentIndex <= 0 ? "disabled" : ""}>Prev</button>
      <span class="pill idle">${formatNumber(currentIndex + 1)} / ${formatNumber(total)}</span>
      <button class="ghost-button compact-button" type="button" data-ui-action="${escapeHtml(action)}" data-direction="1" ${currentIndex >= total - 1 ? "disabled" : ""}>Next</button>
    </div>
  `;
}

function renderMiniRanking(rankings, title = "Ranking", limit = 6) {
  return `
    <article class="glass-card compact-card">
      <div class="panel-title-row">
        <h3>${escapeHtml(title)}</h3>
      </div>
      ${renderHostRanking(rankings.slice(0, limit))}
    </article>
  `;
}

function renderCompactTeamPage(teams, pageSize = 6) {
  const totalPages = Math.max(1, Math.ceil(teams.length / pageSize));
  const pageIndex = clamp(ui.teamPage || 0, 0, totalPages - 1);
  ui.teamPage = pageIndex;
  const pageTeams = teams.slice(pageIndex * pageSize, pageIndex * pageSize + pageSize);

  return `
    <div class="compact-stack">
      <div class="team-grid compact-team-grid">
        ${pageTeams
          .map(
            (team) => `
              <article class="team-card compact-card">
                <div class="panel-title-row">
                  <h4>${escapeHtml(team.name)}</h4>
                  <span class="pill ${team.connected ? "active" : "idle"}">${team.connected ? "online" : "offline"}</span>
                </div>
                <ul class="team-meta">
                  <li>${escapeHtml(team.members)}</li>
                  <li>${formatNumber(team.screeningScore)} screening</li>
                  <li>${formatNumber(team.score)} pts</li>
                </ul>
              </article>
            `
          )
          .join("")}
      </div>
      <div class="compact-pager">
        <button class="ghost-button compact-button" type="button" data-ui-action="team-page" data-direction="-1" ${pageIndex <= 0 ? "disabled" : ""}>Prev</button>
        <span class="pill idle">${formatNumber(pageIndex + 1)} / ${formatNumber(totalPages)}</span>
        <button class="ghost-button compact-button" type="button" data-ui-action="team-page" data-direction="1" ${pageIndex >= totalPages - 1 ? "disabled" : ""}>Next</button>
      </div>
    </div>
  `;
}

function renderMiniTimer(label, endAt, startAt = null, options = {}) {
  const paused = Boolean(options.paused);
  const stopped = Boolean(options.stopped);
  const totalMs = Number(options.totalMs || (startAt && endAt ? endAt - startAt : 0));
  const remaining = paused || stopped
    ? Math.max(0, Number(options.remainingMs || 0))
    : endAt
      ? Math.max(0, endAt - serverNow())
      : 0;
  const progress = totalMs > 0 ? clamp(((totalMs - remaining) / totalMs) * 100, 0, 100) : 0;
  const stateChip = paused
    ? `<span class="pill pending mini-timer-state">${escapeHtml(options.reason || "Paused")}</span>`
    : stopped
      ? `<span class="pill idle mini-timer-state">${escapeHtml(options.reason || "Stopped")}</span>`
      : "";
  return `
    <div class="mini-timer ${paused ? "is-paused" : ""} ${stopped ? "is-stopped" : ""}">
      <div class="panel-title-row">
        <span class="kicker">${escapeHtml(label)}</span>
        ${stateChip}
      </div>
      <strong class="mini-timer-value" ${paused || stopped || !endAt ? "" : `data-countdown="${endAt || 0}"`}>${formatMs(remaining)}</strong>
      <div class="mini-progress">
        <div class="mini-progress-fill" ${paused || stopped || !endAt ? "" : `data-progress="${endAt || 0}" data-start="${startAt || 0}"`} style="width:${progress}%"></div>
      </div>
    </div>
  `;
}

function countdownMarkup(label, endAt, startAt = null) {
  const remaining = endAt ? Math.max(0, endAt - serverNow()) : 0;
  let progress = 0;
  if (startAt && endAt && endAt > startAt) {
    progress = ((serverNow() - startAt) / (endAt - startAt)) * 100;
  }
  progress = Math.min(100, Math.max(0, progress));
  return `
    <div class="countdown-strip">
      <div>
        <span class="kicker">${escapeHtml(label)}</span>
        <div class="countdown" data-countdown="${endAt || 0}">${formatMs(remaining)}</div>
      </div>
      <div class="progress-track">
        <div class="progress-fill" data-progress="${endAt || 0}" data-start="${startAt || 0}" style="width:${progress}%"></div>
      </div>
    </div>
  `;
}

function flashMarkup() {
  if (!ui.flash) return "";
  return `<div class="pill ${escapeHtml(ui.flashType)}" role="status" aria-live="polite">${escapeHtml(ui.flash)}</div>`;
}

function routeCard({ title, href, copy, badge, device, owner, nextStep, ctaLabel = "Open" }) {
  return `
    <a class="glass-card stack role-card" href="${href}">
      <div class="panel-title-row">
        <span class="role-badge">${escapeHtml(badge)}</span>
        <span class="kicker">Open ${escapeHtml(title)}</span>
      </div>
      <h3>${escapeHtml(title)}</h3>
      <p class="helper-copy strong-copy">${escapeHtml(copy)}</p>
      <div class="role-facts">
        <div class="role-fact">
          <span class="kicker">Use On</span>
          <p>${escapeHtml(device)}</p>
        </div>
        <div class="role-fact">
          <span class="kicker">Controlled By</span>
          <p>${escapeHtml(owner)}</p>
        </div>
        <div class="role-fact">
          <span class="kicker">Do Next</span>
          <p>${escapeHtml(nextStep)}</p>
        </div>
      </div>
      <span class="button route-cta">${escapeHtml(ctaLabel)}</span>
    </a>
  `;
}

function renderRouteTile({ title, href, badge, path }) {
  return `
    <a class="glass-card compact-card route-tile" href="${href}">
      <div class="panel-title-row">
        <span class="role-badge">${escapeHtml(badge)}</span>
      </div>
      <h3>${escapeHtml(title)}</h3>
      <div class="url-banner mono">${escapeHtml(path)}</div>
    </a>
  `;
}

function getFFFQuestionKey(question) {
  if (!question) return "";
  return `${question.prompt}|${question.options.map((option) => option.id).join(",")}`;
}

function syncLocalUiFromState(state) {
  ui.screeningQuestionIndex = clamp(ui.screeningQuestionIndex || 0, 0, Math.max(0, state.screening.questions.length - 1));
  ui.teamPage = clamp(ui.teamPage || 0, 0, Math.max(0, Math.ceil(Math.max(1, state.teams.length) / 6) - 1));

  const questionKey = getFFFQuestionKey(state.fff.question);
  if (!questionKey) {
    ui.fffDraftQuestionKey = "";
    ui.fffDraftOrder = [];
    return;
  }

  if (ui.fffDraftQuestionKey !== questionKey) {
    ui.fffDraftQuestionKey = questionKey;
    ui.fffDraftOrder = state.fff.mySubmission?.order ? [...state.fff.mySubmission.order] : [];
    return;
  }

  if (state.fff.mySubmission) {
    ui.fffDraftOrder = [...state.fff.mySubmission.order];
  }
}

function renderCompactRows(rows, emptyLabel = "Nothing yet.") {
  if (!rows.length) {
    return `<div class="empty-state compact-empty">${escapeHtml(emptyLabel)}</div>`;
  }

  return `
    <div class="compact-list">
      ${rows
        .map(
          (row) => `
            <div class="compact-list-item ${row.className || ""}">
              ${row.html}
            </div>
          `
        )
        .join("")}
    </div>
  `;
}

function renderFFFSequence(question, order, interactive) {
  return `
    <div class="fff-sequence">
      ${Array.from({ length: question.options.length }, (_, index) => {
        const optionId = order[index];
        const optionIndex = question.options.findIndex((option) => option.id === optionId);
        const option = optionIndex >= 0 ? question.options[optionIndex] : null;
        return `
          <div class="fff-sequence-slot ${option ? "is-filled" : ""}">
            <span class="kicker">Step ${index + 1}</span>
            <strong class="fff-slot-value">${option ? escapeHtml(option.text) : "Open"}</strong>
            ${
              interactive && option
                ? `<button class="ghost-button compact-button" type="button" data-ui-action="fff-remove" data-option-id="${escapeHtml(option.id)}">Remove</button>`
                : `<span class="compact-note">${option ? `Choice ${LETTERS[optionIndex]}` : "Open"}</span>`
            }
          </div>
        `;
      }).join("")}
    </div>
  `;
}

function renderHome() {
  const state = getState();
  const origin = routeUrl();
  return renderCompactShell(
    renderCompactHeader({
      eyebrow: state.config?.eventTitle || "Jal Jeevan Trivia",
      title: "Quiz Router",
      right: `<span class="pill active">${escapeHtml(phaseLabel(state.phase))}</span>`,
      chips: [
        { value: state.notice || "Standby" },
        { value: `${formatNumber(state.teams.length)} teams` },
        { value: origin }
      ]
    }),
    `
      <div class="compact-route-grid">
        ${renderRouteTile({ title: "Play", href: "/play", badge: "Teams", path: `${origin}/play` })}
        ${renderRouteTile({ title: "Quiz Host", href: "/host", badge: "Operator", path: `${origin}/host` })}
        ${renderRouteTile({ title: "Quiz Screen", href: "/screen", badge: "Projector", path: `${origin}/screen` })}
        ${renderRouteTile({ title: "Hot Seat Host", href: "/hotseat-host", badge: "Operator", path: `${origin}/hotseat-host` })}
        ${renderRouteTile({ title: "Hot Seat Screen", href: "/hotseat-screen", badge: "Projector", path: `${origin}/hotseat-screen` })}
      </div>
      ${flashMarkup()}
    `,
    "home-compact"
  );
}

function renderTeamList(teams) {
  if (!teams.length) {
    return `<div class="empty-state">No teams have joined yet.</div>`;
  }

  return `
    <div class="team-grid">
      ${teams
        .map(
          (team) => `
            <article class="team-card">
              <h4>${escapeHtml(team.name)}</h4>
              <ul class="team-meta">
                <li>Members: ${escapeHtml(team.members)}</li>
                <li>Score: ${formatNumber(team.score)}</li>
                <li>Screening: ${formatNumber(team.screeningScore)}</li>
                <li>Connected: ${team.connected ? "Yes" : "No"}</li>
                <li>Qualified: ${team.qualified ? "Yes" : "No"}</li>
                <li>Audience Entry: ${team.isAudience ? "Yes" : "No"}</li>
              </ul>
            </article>
          `
        )
        .join("")}
    </div>
  `;
}

function screeningQuestionMarkup(question, responses, interactive) {
  const chosen = responses?.[question.id];
  return `
    <article class="question-shell">
      <div class="question-meta">
        <span class="meta-chip">${escapeHtml(question.topic)}</span>
        <span class="meta-chip">${escapeHtml(question.id.toUpperCase())}</span>
      </div>
      <p class="question-text">${escapeHtml(question.question)}</p>
      <div class="options-grid">
        ${question.options
          .map((option, index) => {
            const selected = chosen === index ? "is-selected" : "";
            const disabled = interactive ? "" : "disabled";
            return `
              <button class="option-card ${selected}" ${disabled} data-action="screening-answer" data-question-id="${escapeHtml(question.id)}" data-answer-index="${index}">
                <span class="option-key">${LETTERS[index]}</span>
                <span class="option-copy">${escapeHtml(option)}</span>
              </button>
            `;
          })
          .join("")}
      </div>
    </article>
  `;
}

function renderPlayerRegistration() {
  return renderCompactShell(
    renderCompactHeader({
      eyebrow: "Player Portal",
      title: "Register Team",
      chips: [{ value: routeUrl("/play") }]
    }),
    `
      <div class="compact-grid compact-grid-2">
        <form class="glass-card compact-card compact-stack" data-form="register-team">
          <div class="form-grid">
            <div class="field">
              <label for="team-name">Team Name</label>
              <input id="team-name" name="name" required autocomplete="off" placeholder="Blue Current" />
            </div>
            <div class="field">
              <label for="team-members">Team Members</label>
              <input id="team-members" name="members" required autocomplete="off" placeholder="Asha & Rohan" />
            </div>
            <div class="field field-full">
              <label for="team-audience">Entry Type</label>
              <select id="team-audience" name="isAudience" autocomplete="off">
                <option value="false">Registered Team</option>
                <option value="true">Audience Entry</option>
              </select>
            </div>
          </div>
          <button class="button" type="submit">Register</button>
          ${flashMarkup()}
        </form>
        <div class="glass-card compact-card compact-center">
          <div class="compact-identity">
            <span class="kicker">Stage</span>
            <strong>Screening + FFF</strong>
          </div>
          <div class="compact-identity">
            <span class="kicker">Hot Seat</span>
            <strong>Operator Only</strong>
          </div>
        </div>
      </div>
    `,
    "player-compact"
  );
}

function renderScreeningPlayer(state, team) {
  const interactive = state.screening.status === "active";
  const total = state.screening.questions.length;
  const currentIndex = getScreeningQuestionIndex(total);
  const currentQuestion = state.screening.questions[currentIndex];
  const answered = Object.keys(state.screening.responses || {}).length;

  if (!currentQuestion) {
    return `<div class="empty-state">No screening questions</div>`;
  }

  return `
    <div class="compact-stack">
      <div class="compact-grid compact-grid-3">
        ${renderCompactStat("Phase", "Screening")}
        ${renderCompactStat("Saved", `${formatNumber(answered)} / ${formatNumber(total)}`)}
        ${renderCompactStat("Score", state.screening.status === "active" ? "--" : formatNumber(team.screeningScore))}
      </div>
      ${renderMiniTimer("Timer", state.screening.endsAt, state.screening.startedAt)}
      ${screeningQuestionMarkup(currentQuestion, state.screening.responses, interactive)}
      ${renderCompactPager("screening-page", currentIndex, total)}
    </div>
  `;
}

function renderFFFPlayer(state, team) {
  const question = state.fff.question;
  if (!question) {
    return `<div class="empty-state">The host has not opened a Fastest Finger First question yet.</div>`;
  }

  const submission = state.fff.mySubmission;
  const eligible = state.fff.eligibleTeams.includes(team.id);
  const draftOrder = submission?.order ? [...submission.order] : ui.fffDraftOrder;
  const disabled = !eligible || state.fff.status !== "active" || Boolean(submission);
  const readyToSubmit = draftOrder.length === question.options.length;
  return `
    <div class="compact-stack">
      <div class="compact-grid compact-grid-3">
        ${renderCompactStat("Phase", "FFF")}
        ${renderCompactStat("Status", state.fff.status)}
        ${renderCompactStat("Picked", `${formatNumber(draftOrder.length)} / ${formatNumber(question.options.length)}`)}
      </div>
      ${renderMiniTimer("Timer", state.fff.endsAt, state.fff.startedAt)}
      <section class="question-shell compact-question-shell">
        <div class="panel-title-row">
          <h2 class="section-title">Fastest Finger First</h2>
          <span class="pill ${state.fff.status === "active" ? "active" : "pending"}">${escapeHtml(state.fff.status)}</span>
        </div>
        <p class="question-text">${escapeHtml(question.prompt)}</p>
        ${eligible ? renderFFFSequence(question, draftOrder, !disabled) : `<div class="glass-card compact-card compact-center"><strong>Not In Pool</strong></div>`}
        ${
          eligible
            ? `
              <div class="fff-pick-grid">
                ${question.options
                  .map((option, index) => {
                    const usedIndex = draftOrder.indexOf(option.id);
                    return `
                      <button
                        class="fff-pick-card ${usedIndex >= 0 ? "is-used" : ""}"
                        type="button"
                        data-ui-action="fff-pick"
                        data-option-id="${escapeHtml(option.id)}"
                        ${disabled || usedIndex >= 0 || draftOrder.length >= question.options.length ? "disabled" : ""}
                      >
                        <span class="option-key">${LETTERS[index]}</span>
                        <span class="option-copy">${escapeHtml(option.text)}</span>
                        <span class="sequence-badge">${usedIndex >= 0 ? `#${usedIndex + 1}` : "Tap"}</span>
                      </button>
                    `;
                  })
                  .join("")}
              </div>
              <form class="compact-stack" data-form="fff-submit">
                <div class="inline-actions tight">
                  <button class="ghost-button compact-button" type="button" data-ui-action="fff-reset" ${disabled || !draftOrder.length ? "disabled" : ""}>Reset</button>
                  <button class="button" type="submit" ${disabled || !readyToSubmit ? "disabled" : ""}>Submit Order</button>
                </div>
              </form>
            `
            : ""
        }
      </section>
    </div>
  `;
}

function optionStateClass(index, question, hotSeat) {
  const classes = [];
  if (hotSeat.selectedAnswerIndex === index) classes.push("is-selected");
  const revealedIndex = question.answerIndex ?? hotSeat.revealedAnswerIndex;
  if (hotSeat.reveal === "correct" && revealedIndex === index) classes.push("is-correct");
  if (hotSeat.reveal === "wrong" && hotSeat.lockedAnswerIndex === index) classes.push("is-wrong");
  if (hotSeat.reducedOptionIndices.includes(index)) classes.push("is-hidden");
  return classes.join(" ");
}

function renderAudiencePoll(hotSeat, question) {
  if (!hotSeat.audiencePoll || !question) return "";
  return `
    <div class="glass-card stack">
      <h3>Audience Poll</h3>
      <div class="score-ladder">
        ${question.options
          .map(
            (option, index) => `
              <div class="score-step">
                <span class="option-key">${LETTERS[index]}</span>
                <span>${escapeHtml(option)}</span>
                <strong>${hotSeat.audiencePoll[index] || 0}%</strong>
              </div>
            `
          )
          .join("")}
      </div>
    </div>
  `;
}

function renderPlayerHotSeatStandby(state) {
  return `
    <div class="compact-grid compact-grid-2">
      <div class="glass-card compact-card compact-center">
        <span class="kicker">Hot Seat Host</span>
        <strong class="mono">${escapeHtml(routeUrl("/hotseat-host"))}</strong>
      </div>
      <div class="glass-card compact-card compact-center">
        <span class="kicker">Hot Seat Screen</span>
        <strong class="mono">${escapeHtml(routeUrl("/hotseat-screen"))}</strong>
      </div>
    </div>
  `;
}

function renderPlayer() {
  const state = getState();
  const team = state.privateTeam;

  if (!team) {
    return renderPlayerRegistration();
  }

  let phaseContent = `
    <div class="glass-card compact-card compact-center"><strong>Standby</strong></div>
  `;

  if (state.phase === "fff") {
    phaseContent = renderFFFPlayer(state, team);
  } else if (state.phase === "hotseat" || state.phase === "intermission" || state.hotSeat.status === "ended") {
    phaseContent = renderPlayerHotSeatStandby(state);
  } else if (state.phase === "screening" || state.screening.status === "ended") {
    phaseContent = renderScreeningPlayer(state, team);
  }

  return renderCompactShell(
    renderCompactHeader({
      eyebrow: `Player · ${team.name}`,
      title: "Team Dashboard",
      right: `<div class="inline-actions"><button class="ghost-button compact-button" data-action="reset-player-session">Reset</button><a class="ghost-button compact-button" href="/">Home</a></div>`,
      chips: [
        { value: phaseLabel(state.phase) },
        { value: qualificationLabel(team, state) },
        { value: `${formatNumber(team.score)} pts` },
        { value: state.notice }
      ]
    }),
    `
      <div class="compact-grid compact-grid-3">
        ${renderCompactStat("Members", team.members)}
        ${renderCompactStat("Screening", formatNumber(team.screeningScore))}
        ${renderCompactStat("Clock", prettyDate(serverNow()))}
      </div>
      ${phaseContent}
      ${flashMarkup()}
    `,
    "player-compact"
  );
}

function renderHostRanking(rankings) {
  if (!rankings.length) return `<div class="empty-state">No ranking data yet.</div>`;
  return `
    <div class="score-ladder">
      ${rankings
        .map((entry, index) => {
          const team = getTeam(entry.teamId);
          return `
            <div class="score-step ${index === 0 ? "active" : ""}">
              <strong>#${index + 1}</strong>
              <span>${escapeHtml(team?.name || entry.teamId)}</span>
              <span>${entry.correct === undefined ? formatNumber(entry.score) : entry.correct ? "Correct" : "Incorrect"}</span>
            </div>
          `;
        })
        .join("")}
    </div>
  `;
}

function renderHost() {
  const state = getState();
  const qualifiersCount = state.qualifiers?.length || 0;
  const completedHotSeatCount = state.completedHotSeatTeams?.length || 0;
  const connectedCount = state.teams.filter((team) => team.connected).length;
  const audienceCount = state.teams.filter((team) => team.isAudience).length;
  const canStartScreening = state.teams.length > 0 && state.screening.status !== "active";
  const canEndScreening = state.screening.status === "active";
  const canQualifyTeams = state.screening.status === "ended" && state.teams.length > 0;
  const canStartFFF = state.teams.length > 0 && state.screening.status !== "active";
  const canRankFFF = state.fff.status === "active";
  const hotSeatWinner = getTeam(state.fff.winnerTeamId);
  const screeningRows = state.screening.rankings.slice(0, 4).map((entry, index) => ({
    html: `
      <strong>#${index + 1}</strong>
      <span>${escapeHtml(getTeam(entry.teamId)?.name || entry.teamId)}</span>
      <span>${formatNumber(entry.score)}</span>
    `
  }));
  const fffRows = state.fff.ranked.slice(0, 4).map((entry, index) => ({
    html: `
      <strong>#${index + 1}</strong>
      <span>${escapeHtml(getTeam(entry.teamId)?.name || entry.teamId)}</span>
      <span>${entry.correct === undefined ? formatNumber(entry.score) : entry.correct ? "Correct" : "Wrong"}</span>
    `
  }));
  const teamSummary = renderCompactTeamPage(state.teams);
  const routeTiles = `
    <div class="compact-route-grid compact-route-grid-host">
      ${renderRouteTile({ title: "Play", href: "/play", badge: "Teams", path: routeUrl("/play") })}
      ${renderRouteTile({ title: "Quiz Host", href: "/host", badge: "Operator", path: routeUrl("/host") })}
      ${renderRouteTile({ title: "Quiz Screen", href: "/screen", badge: "Projector", path: routeUrl("/screen") })}
      ${renderRouteTile({ title: "Hot Seat Host", href: "/hotseat-host", badge: "Operator", path: routeUrl("/hotseat-host") })}
      ${renderRouteTile({ title: "Hot Seat Screen", href: "/hotseat-screen", badge: "Projector", path: routeUrl("/hotseat-screen") })}
    </div>
  `;

  if (!state.session.isHost) {
    return renderCompactShell(
      renderCompactHeader({
        eyebrow: "Operator Console",
        title: "Unlock Quiz Host",
        chips: [{ value: routeUrl("/host") }]
      }),
      `
        <div class="compact-grid compact-grid-main">
          <form class="glass-card compact-card compact-stack" data-form="host-auth">
            <div class="field">
              <label for="host-pin">PIN</label>
              <input id="host-pin" name="pin" type="password" required autocomplete="current-password" placeholder="jaljeevan-admin" />
            </div>
            <button class="button" type="submit">Unlock</button>
            ${flashMarkup()}
          </form>
          ${routeTiles}
        </div>
      `,
      "operator-compact"
    );
  }

  const stageView = `
    <div class="compact-split">
      <article class="glass-card compact-card compact-stack">
        <div class="panel-title-row">
          <h3>Screening</h3>
          <span class="pill ${state.screening.status === "active" ? "active" : state.screening.status === "ended" ? "pending" : "idle"}">${escapeHtml(state.screening.status)}</span>
        </div>
        <div class="inline-actions tight">
          <button class="button compact-button" type="button" data-host-action="start-screening" ${canStartScreening ? "" : "disabled"}>Start</button>
          <button class="ghost-button compact-button" type="button" data-host-action="end-screening" ${canEndScreening ? "" : "disabled"}>Stop</button>
          <button class="ghost-button compact-button" type="button" data-host-action="qualify-teams" ${canQualifyTeams ? "" : "disabled"}>Qualify</button>
        </div>
        ${state.screening.startedAt ? renderMiniTimer("Screening", state.screening.endsAt, state.screening.startedAt) : ""}
        ${renderCompactRows(screeningRows, "No screening rank yet.")}
      </article>
      <article class="glass-card compact-card compact-stack">
        <div class="panel-title-row">
          <h3>Fastest Finger</h3>
          <span class="pill ${state.fff.status === "active" ? "active" : state.fff.status === "locked" ? "pending" : "idle"}">${escapeHtml(state.fff.status)}</span>
        </div>
        <form class="compact-form-row" data-form="host-fff">
          <div class="field">
            <label for="fff-question-index">Question</label>
            <select class="compact-select" id="fff-question-index" name="questionIndex" autocomplete="off">
              ${Array.from({ length: state.config.fffQuestionCount || 0 }, (_, index) => index)
                .map((index) => `<option value="${index}" ${state.fff.questionIndex === index ? "selected" : ""}>FFF ${index + 1}</option>`)
                .join("")}
            </select>
          </div>
          <button class="button compact-button" type="button" data-host-action="start-fff" ${canStartFFF ? "" : "disabled"}>Start</button>
        </form>
        <div class="inline-actions tight">
          <button class="ghost-button compact-button" type="button" data-host-action="rank-fff" ${canRankFFF ? "" : "disabled"}>Rank</button>
          <a class="ghost-button compact-button" href="/hotseat-host">Hot Seat</a>
        </div>
        ${state.fff.startedAt ? renderMiniTimer("FFF", state.fff.endsAt, state.fff.startedAt) : ""}
        ${renderCompactRows(fffRows, "No FFF rank yet.")}
      </article>
    </div>
  `;

  const teamsView = `
    <div class="compact-stack">
      <div class="compact-grid compact-grid-3">
        ${renderCompactStat("Audience", formatNumber(audienceCount))}
        ${renderCompactStat("Winner", hotSeatWinner?.name || "--")}
        ${renderCompactStat("Hot Seat", state.hotSeat.activeTeam?.name || "--")}
      </div>
      ${teamSummary}
    </div>
  `;

  const routesView = routeTiles;

  return renderCompactShell(
    renderCompactHeader({
      eyebrow: "Operator Console",
      title: "Screening + FFF",
      right: `<div class="inline-actions tight"><a class="ghost-button compact-button" href="/hotseat-host">Hot Seat</a><a class="ghost-button compact-button" href="/">Home</a></div>`,
      chips: [
        { value: phaseLabel(state.phase) },
        { value: `${formatNumber(state.teams.length)} teams` },
        { value: `${formatNumber(qualifiersCount)} qualified` },
        { value: `${formatNumber(connectedCount)} online` }
      ]
    }),
    `
      <div class="compact-grid compact-grid-main">
        <section class="glass-card compact-card compact-stack">
          <div class="panel-title-row">
            <h2 class="compact-section-title">Console</h2>
            ${renderSegmentedControl("host-section", ui.hostSection, [
              { value: "stage", label: "Stage" },
              { value: "teams", label: "Teams" },
              { value: "routes", label: "Switch" }
            ])}
          </div>
          ${ui.hostSection === "teams" ? teamsView : ui.hostSection === "routes" ? routesView : stageView}
          ${flashMarkup()}
        </section>
        <aside class="compact-sidebar">
          <article class="glass-card compact-card compact-stack">
            <div class="compact-grid compact-grid-2">
              ${renderCompactStat("Audience", formatNumber(audienceCount))}
              ${renderCompactStat("Completed", formatNumber(completedHotSeatCount))}
              ${renderCompactStat("FFF Winner", hotSeatWinner?.name || "--")}
              ${renderCompactStat("Notice", state.notice || "--")}
            </div>
          </article>
          <article class="glass-card compact-card compact-stack">
            <form class="compact-stack" data-form="host-notice">
              <div class="field">
                <label for="host-notice">Notice</label>
                <textarea id="host-notice" name="notice" autocomplete="off">${escapeHtml(state.notice)}</textarea>
              </div>
              <div class="inline-actions tight">
                <button class="button compact-button" type="submit">Update</button>
                <button class="ghost-button compact-button" type="button" data-host-action="reset-game">Reset</button>
              </div>
            </form>
          </article>
        </aside>
      </div>
    `,
    "operator-compact"
  );
}

function renderScoreLadder(state, limit = 6) {
  const currentPoints = state.phase === "hotseat" ? state.hotSeat.question?.points || 0 : 0;
  const ladder = state.config.hotSeatLadder.slice().reverse();
  const activeIndex = ladder.findIndex((step) => step.points === currentPoints);
  const startIndex = activeIndex >= 0 ? clamp(activeIndex - Math.floor(limit / 2), 0, Math.max(0, ladder.length - limit)) : 0;
  const visibleSteps = ladder.slice(startIndex, startIndex + limit);
  return `
    <div class="score-ladder ladder-compact">
      ${visibleSteps
        .map(
          (step) => `
            <div class="score-step ${step.points === currentPoints ? "active" : ""} ${step.isSafe ? "safe" : ""}">
              <strong>Q${step.level}</strong>
              <span>${step.isSafe ? "Safe Level" : "Question"}</span>
              <span>${formatNumber(step.points)}</span>
            </div>
          `
        )
        .join("")}
    </div>
  `;
}

function renderScreen() {
  const state = getState();
  const fff = state.fff;
  const screeningRows = state.screening.rankings.slice(0, 6).map((entry, index) => ({
    html: `
      <strong>#${index + 1}</strong>
      <span>${escapeHtml(getTeam(entry.teamId)?.name || entry.teamId)}</span>
      <span>${formatNumber(entry.score)}</span>
    `
  }));
  const scoreRows = state.teams
    .slice()
    .sort((left, right) => right.score - left.score || right.screeningScore - left.screeningScore)
    .slice(0, 6)
    .map((team, index) => ({
      html: `
        <strong>#${index + 1}</strong>
        <span>${escapeHtml(team.name)}</span>
        <span>${formatNumber(team.score)}</span>
      `
    }));

  let mainPanel = `
    <div class="glass-card compact-card compact-center compact-screen-card">
      <span class="kicker">Ready</span>
      <strong class="screen-title">Quiz Screen</strong>
      <div class="compact-endpoints">
        <div class="compact-endpoint">
          <span class="kicker">Play</span>
          <strong class="mono">${escapeHtml(routeUrl("/play"))}</strong>
        </div>
        <div class="compact-endpoint">
          <span class="kicker">Host</span>
          <strong class="mono">${escapeHtml(routeUrl("/host"))}</strong>
        </div>
      </div>
    </div>
  `;

  if (state.phase === "screening") {
    mainPanel = `
      <div class="glass-card compact-card compact-screen-card compact-stack">
        <div class="panel-title-row">
          <h2 class="section-title">Screening</h2>
          <span class="pill active">Live</span>
        </div>
        ${renderMiniTimer("Round", state.screening.endsAt, state.screening.startedAt)}
        <div class="compact-grid compact-grid-3">
          ${renderCompactStat("Teams", formatNumber(state.teams.length))}
          ${renderCompactStat("Answered", formatNumber(Object.keys(state.screening.responses || {}).length))}
          ${renderCompactStat("Notice", state.notice || "--")}
        </div>
      </div>
    `;
  } else if (state.phase === "fff" && fff.question) {
    mainPanel = `
      <section class="question-shell compact-question-shell compact-screen-card">
        <div class="panel-title-row">
          <h2 class="section-title">Fastest Finger</h2>
          <span class="pill ${fff.status === "active" ? "active" : "pending"}">${escapeHtml(fff.status)}</span>
        </div>
        <p class="question-text">${escapeHtml(fff.question.prompt)}</p>
        ${renderMiniTimer("Ordering", fff.endsAt, fff.startedAt)}
        <div class="options-grid">
          ${fff.question.options
            .map(
              (option, index) => `
                <div class="option-card">
                  <span class="option-key">${index + 1}</span>
                  <span class="option-copy">${escapeHtml(option.text)}</span>
                </div>
              `
            )
            .join("")}
        </div>
      </section>
    `;
  } else if (state.phase === "hotseat" || state.phase === "intermission") {
    mainPanel = `
      <div class="glass-card compact-card compact-center compact-screen-card">
        <span class="kicker">Switch</span>
        <strong class="screen-title">Hot Seat Screen</strong>
        <strong class="mono">${escapeHtml(routeUrl("/hotseat-screen"))}</strong>
      </div>
    `;
  }

  return renderCompactShell(
    renderCompactHeader({
      eyebrow: "Quiz Screen",
      title: "Screening + FFF",
      right: `<a class="ghost-button compact-button" href="/">Home</a>`,
      chips: [
        { value: phaseLabel(state.phase) },
        { value: `${formatNumber(state.teams.length)} teams` },
        { value: state.notice || "Standby" }
      ]
    }),
    `
      <div class="compact-grid compact-grid-main">
        ${mainPanel}
        <aside class="compact-sidebar">
          <article class="glass-card compact-card compact-stack">
            <h3>${state.phase === "screening" ? "Screening Rank" : "Leaderboard"}</h3>
            ${renderCompactRows(state.phase === "screening" ? screeningRows : scoreRows, "No ranking yet.")}
          </article>
          <article class="glass-card compact-card compact-stack">
            <h3>Hot Seat</h3>
            <div class="compact-kv">
              <div class="compact-kv-row"><span class="kicker">Host</span><strong class="mono">${escapeHtml(routeUrl("/hotseat-host"))}</strong></div>
              <div class="compact-kv-row"><span class="kicker">Screen</span><strong class="mono">${escapeHtml(routeUrl("/hotseat-screen"))}</strong></div>
            </div>
          </article>
        </aside>
      </div>
    `,
    "screen-compact"
  );
}

function renderHotSeatHost() {
  const state = getState();
  const hotSeat = state.hotSeat;
  const hotSeatWinner = getTeam(state.fff.winnerTeamId);
  const canStartWinner = Boolean(state.fff.winnerTeamId);
  const canStartManual = state.teams.length > 0;
  const canSelectAnswer = state.phase === "hotseat" && hotSeat.status === "question-live" && hotSeat.question;
  const canLockAnswer = canSelectAnswer && hotSeat.selectedAnswerIndex !== null;
  const canRevealAnswer = hotSeat.status === "locked";
  const canNextQuestion = hotSeat.status === "revealed";
  const canEndTurn = state.phase === "hotseat";
  const canResumeTimer = state.phase === "hotseat" && hotSeat.status === "question-live" && hotSeat.timerState === "paused";
  const hotSeatTimerMarkup = renderMiniTimer("Answer", hotSeat.endsAt, hotSeat.startedAt, {
    paused: hotSeat.timerState === "paused",
    stopped: hotSeat.timerState === "stopped",
    remainingMs: hotSeat.timerRemainingMs,
    totalMs: hotSeat.questionDurationMs,
    reason: hotSeat.timerPauseReason
  });
  const historyRows = hotSeat.history
    .slice(-6)
    .reverse()
    .map((entry, index) => ({
      html: `
        <strong>Q${hotSeat.history.length - index}</strong>
        <span>${entry.result === "correct" ? "Correct" : "Wrong"}</span>
        <span>${formatNumber(entry.scoreAfter || 0)}</span>
      `
    }));
  const routeTiles = `
    <div class="compact-route-grid compact-route-grid-host">
      ${renderRouteTile({ title: "Hot Seat Host", href: "/hotseat-host", badge: "Operator", path: routeUrl("/hotseat-host") })}
      ${renderRouteTile({ title: "Hot Seat Screen", href: "/hotseat-screen", badge: "Projector", path: routeUrl("/hotseat-screen") })}
      ${renderRouteTile({ title: "Quiz Host", href: "/host", badge: "Operator", path: routeUrl("/host") })}
      ${renderRouteTile({ title: "Play", href: "/play", badge: "Teams", path: routeUrl("/play") })}
    </div>
  `;

  if (!state.session.isHost) {
    return renderCompactShell(
      renderCompactHeader({
        eyebrow: "Hot Seat Operator",
        title: "Unlock Hot Seat",
        chips: [{ value: routeUrl("/hotseat-host") }]
      }),
      `
        <div class="compact-grid compact-grid-main">
          <form class="glass-card compact-card compact-stack" data-form="host-auth">
            <div class="field">
              <label for="hotseat-pin">PIN</label>
              <input id="hotseat-pin" name="pin" type="password" required autocomplete="current-password" placeholder="jaljeevan-admin" />
            </div>
            <button class="button" type="submit">Unlock</button>
            ${flashMarkup()}
          </form>
          ${routeTiles}
        </div>
      `,
      "operator-compact"
    );
  }

  const controlView = `
    <div class="compact-split">
      <article class="glass-card compact-card compact-stack">
        <div class="panel-title-row">
          <h3>Launch</h3>
          <span class="pill ${state.phase === "hotseat" ? "active" : hotSeatWinner ? "pending" : "idle"}">${escapeHtml(state.phase === "hotseat" ? hotSeat.status : hotSeatWinner ? "ready" : "standby")}</span>
        </div>
        <div class="compact-kv">
          <div class="compact-kv-row"><span class="kicker">FFF Winner</span><strong>${escapeHtml(hotSeatWinner?.name || "--")}</strong></div>
          <div class="compact-kv-row"><span class="kicker">Current Team</span><strong>${escapeHtml(hotSeat.activeTeam?.name || "--")}</strong></div>
          <div class="compact-kv-row"><span class="kicker">Completed</span><strong>${formatNumber(state.completedHotSeatTeams?.length || 0)}</strong></div>
        </div>
        <div class="inline-actions tight">
          <button class="button compact-button" type="button" data-host-action="send-fff-winner-to-hotseat" ${canStartWinner ? "" : "disabled"}>Start Winner</button>
          <a class="ghost-button compact-button" href="/hotseat-screen">Projector</a>
        </div>
        <form class="compact-form-row" data-form="host-hotseat">
          <div class="field">
            <label for="hotseat-team-id">Manual Team</label>
            <select class="compact-select" id="hotseat-team-id" name="teamId" autocomplete="off">
              ${
                state.teams.length
                  ? state.teams
                      .map(
                        (team) => `
                          <option value="${escapeHtml(team.id)}" ${state.hotSeat.teamId === team.id ? "selected" : ""}>${escapeHtml(team.name)}</option>
                        `
                      )
                      .join("")
                  : `<option value="">No teams available</option>`
              }
            </select>
          </div>
          <button class="ghost-button compact-button" type="button" data-host-action="start-hotseat-for-team" ${canStartManual ? "" : "disabled"}>Start</button>
        </form>
      </article>
      <article class="glass-card compact-card compact-stack">
        ${
          state.phase === "hotseat" && hotSeat.question
            ? `
              <section class="question-shell compact-question-shell">
                <div class="panel-title-row">
                  <h3>${escapeHtml(hotSeat.question.topic)}</h3>
                  <span class="pill ${hotSeat.status === "question-live" ? "active" : hotSeat.status === "locked" ? "pending" : hotSeat.reveal === "wrong" ? "danger" : "idle"}">${escapeHtml(hotSeat.status)}</span>
                </div>
                <div class="compact-chip-row">
                  <span class="meta-chip">${formatNumber(hotSeat.question.points)} pts</span>
                  <span class="meta-chip">Safe ${formatNumber(hotSeat.guaranteedScore)}</span>
                  <span class="meta-chip">Q${formatNumber((hotSeat.questionIndex || 0) + 1)}</span>
                </div>
                <p class="question-text">${escapeHtml(hotSeat.question.question)}</p>
                ${hotSeatTimerMarkup}
                <div class="options-grid">
                  ${hotSeat.question.options
                    .map(
                      (option, index) => `
                        <button class="option-card ${optionStateClass(index, hotSeat.question, hotSeat)}" type="button" data-host-action="hotseat-select-answer" data-answer-index="${index}" ${canSelectAnswer ? "" : "disabled"}>
                          <span class="option-key">${LETTERS[index]}</span>
                          <span class="option-copy">${escapeHtml(option)}</span>
                        </button>
                      `
                    )
                    .join("")}
                </div>
                <div class="inline-actions tight">
                  ${["50/50", "Audience Poll", "Call a Friend"]
                    .map(
                      (kind) => `
                        <button class="ghost-button compact-button" type="button" data-host-action="hotseat-lifeline" data-kind="${escapeHtml(kind)}" ${
                          canSelectAnswer && !hotSeat.lifelinesUsed.includes(kind) ? "" : "disabled"
                        }>${escapeHtml(kind)}</button>
                      `
                    )
                    .join("")}
                  <button class="ghost-button compact-button" type="button" data-host-action="hotseat-resume-timer" ${canResumeTimer ? "" : "disabled"}>Resume Timer</button>
                  <button class="button compact-button" type="button" data-host-action="hotseat-lock-answer" ${canLockAnswer ? "" : "disabled"}>Lock</button>
                  <button class="ghost-button compact-button" type="button" data-host-action="hotseat-reveal" ${canRevealAnswer ? "" : "disabled"}>Reveal</button>
                  <button class="ghost-button compact-button" type="button" data-host-action="hotseat-next" ${canNextQuestion ? "" : "disabled"}>Next</button>
                  <button class="ghost-button compact-button" type="button" data-host-action="hotseat-end-turn" ${canEndTurn ? "" : "disabled"}>End</button>
                </div>
              </section>
            `
            : `<div class="empty-state compact-empty">Standby</div>`
        }
      </article>
    </div>
  `;

  const summaryView = `
    <div class="compact-split">
      <article class="glass-card compact-card compact-stack">
        <h3>History</h3>
        ${renderCompactRows(historyRows, "No completed questions.")}
      </article>
      <article class="glass-card compact-card compact-stack">
        <h3>Ladder</h3>
        ${renderScoreLadder(state)}
        ${
          hotSeat.audiencePoll && hotSeat.question
            ? renderAudiencePoll(hotSeat, hotSeat.question)
            : `
              <div class="lifeline-list">
                ${["50/50", "Audience Poll", "Call a Friend"]
                  .map((item) => `<span class="pill ${hotSeat.lifelinesUsed.includes(item) ? "pending" : "idle"}">${escapeHtml(item)}</span>`)
                  .join("")}
              </div>
            `
        }
      </article>
    </div>
  `;

  return renderCompactShell(
    renderCompactHeader({
      eyebrow: "Hot Seat Operator",
      title: "Hot Seat",
      right: `<div class="inline-actions tight"><a class="ghost-button compact-button" href="/host">Quiz Host</a><a class="ghost-button compact-button" href="/hotseat-screen">Projector</a></div>`,
      chips: [
        { value: phaseLabel(state.phase) },
        { value: hotSeat.activeTeam?.name || "--" },
        { value: `${formatNumber(hotSeat.currentScore || 0)} pts` },
        { value: hotSeat.status || "standby" }
      ]
    }),
    `
      <div class="compact-grid compact-grid-main">
        <section class="glass-card compact-card compact-stack">
          <div class="panel-title-row">
            <h2 class="compact-section-title">Console</h2>
            ${renderSegmentedControl("hotseat-section", ui.hotSeatSection, [
              { value: "control", label: "Control" },
              { value: "summary", label: "Summary" },
              { value: "routes", label: "Switch" }
            ])}
          </div>
          ${ui.hotSeatSection === "summary" ? summaryView : ui.hotSeatSection === "routes" ? routeTiles : controlView}
          ${flashMarkup()}
        </section>
        <aside class="compact-sidebar">
          <article class="glass-card compact-card compact-stack">
            <div class="compact-grid compact-grid-2">
              ${renderCompactStat("Question", state.phase === "hotseat" ? formatNumber((hotSeat.questionIndex || 0) + 1) : "--")}
              ${renderCompactStat("Guaranteed", formatNumber(hotSeat.guaranteedScore || 0))}
              ${renderCompactStat("Used", formatNumber(hotSeat.lifelinesUsed?.length || 0))}
              ${renderCompactStat("Timer", hotSeat.timerState || "--")}
            </div>
          </article>
          <article class="glass-card compact-card compact-stack">
            <div class="compact-kv">
              <div class="compact-kv-row"><span class="kicker">Notice</span><strong>${escapeHtml(state.notice || "--")}</strong></div>
              <div class="compact-kv-row"><span class="kicker">Winner</span><strong>${escapeHtml(hotSeatWinner?.name || "--")}</strong></div>
              <div class="compact-kv-row"><span class="kicker">Screen</span><strong class="mono">${escapeHtml(routeUrl("/hotseat-screen"))}</strong></div>
            </div>
          </article>
        </aside>
      </div>
    `,
    "operator-compact"
  );
}

function renderHotSeatScreen() {
  const state = getState();
  const hotSeat = state.hotSeat;
  const question = hotSeat.question;
  const hotSeatTimerMarkup = renderMiniTimer("Answer", hotSeat.endsAt, hotSeat.startedAt, {
    paused: hotSeat.timerState === "paused",
    stopped: hotSeat.timerState === "stopped",
    remainingMs: hotSeat.timerRemainingMs,
    totalMs: hotSeat.questionDurationMs,
    reason: hotSeat.timerPauseReason
  });
  const historyRows = hotSeat.history
    .slice(-4)
    .reverse()
    .map((entry, index) => ({
      html: `
        <strong>Q${hotSeat.history.length - index}</strong>
        <span>${entry.result === "correct" ? "Correct" : "Wrong"}</span>
        <span>${formatNumber(entry.scoreAfter || 0)}</span>
      `
    }));

  let mainPanel = `
    <div class="glass-card compact-card compact-center compact-screen-card">
      <span class="kicker">Ready</span>
      <strong class="screen-title">Hot Seat Screen</strong>
      <strong class="mono">${escapeHtml(routeUrl("/hotseat-host"))}</strong>
    </div>
  `;

  if (state.phase === "hotseat" && question) {
    mainPanel = `
      <section class="question-shell compact-question-shell compact-screen-card">
        <div class="panel-title-row">
          <h2 class="section-title">${escapeHtml(hotSeat.activeTeam?.name || "Hot Seat")}</h2>
          <span class="pill ${hotSeat.status === "question-live" ? "active" : hotSeat.reveal === "correct" ? "active" : hotSeat.reveal === "wrong" ? "danger" : "pending"}">${escapeHtml(hotSeat.status)}</span>
        </div>
        <div class="compact-chip-row">
          <span class="meta-chip">${escapeHtml(question.topic)}</span>
          <span class="meta-chip">${formatNumber(question.points)} pts</span>
          <span class="meta-chip">Safe ${formatNumber(hotSeat.guaranteedScore)}</span>
        </div>
        <p class="question-text">${escapeHtml(question.question)}</p>
        ${hotSeatTimerMarkup}
        ${hotSeat.reveal === "correct" ? `<div class="projector-popup" role="status" aria-live="polite">Correct Answer</div>` : ""}
        <div class="options-grid">
          ${question.options
            .map(
              (option, index) => `
                <div class="option-card ${optionStateClass(index, question, hotSeat)}">
                  <span class="option-key">${LETTERS[index]}</span>
                  <span class="option-copy">${escapeHtml(option)}</span>
                </div>
              `
            )
            .join("")}
        </div>
      </section>
    `;
  } else if (state.phase === "intermission" || hotSeat.status === "ended") {
    mainPanel = `
      <div class="glass-card compact-card compact-center compact-screen-card">
        <span class="kicker">Turn Complete</span>
        <strong class="screen-title">${escapeHtml(hotSeat.activeTeam?.name || "Hot Seat")}</strong>
        <strong>${formatNumber(hotSeat.currentScore || 0)} pts</strong>
      </div>
    `;
  }

  return renderCompactShell(
    renderCompactHeader({
      eyebrow: "Hot Seat Screen",
      title: "Projector",
      right: `<a class="ghost-button compact-button" href="/">Home</a>`,
      chips: [
        { value: hotSeat.activeTeam?.name || "--" },
        { value: `${formatNumber(hotSeat.currentScore || 0)} pts` },
        { value: hotSeat.status || "standby" }
      ]
    }),
    `
      <div class="compact-grid compact-grid-main">
        ${mainPanel}
        <aside class="compact-sidebar">
          <article class="glass-card compact-card compact-stack">
            <h3>Ladder</h3>
            ${renderScoreLadder(state)}
          </article>
          ${
            hotSeat.audiencePoll && question
              ? renderAudiencePoll(hotSeat, question)
              : `
                <article class="glass-card compact-card compact-stack">
                  <h3>Lifelines</h3>
                  <div class="lifeline-list">
                    ${["50/50", "Audience Poll", "Call a Friend"]
                      .map((item) => `<span class="pill ${hotSeat.lifelinesUsed.includes(item) ? "pending" : "idle"}">${escapeHtml(item)}</span>`)
                      .join("")}
                  </div>
                  ${renderCompactRows(historyRows, "No completed questions.")}
                </article>
              `
          }
        </aside>
      </div>
    `,
    "screen-compact"
  );
}

function render() {
  ui.renderedAt = Date.now();

  if (page === "home") {
    app.innerHTML = renderHome();
  } else if (page === "player") {
    app.innerHTML = renderPlayer();
  } else if (page === "host") {
    app.innerHTML = renderHost();
  } else if (page === "hotseat-host") {
    app.innerHTML = renderHotSeatHost();
  } else if (page === "screen") {
    app.innerHTML = renderScreen();
  } else if (page === "hotseat-screen") {
    app.innerHTML = renderHotSeatScreen();
  }

  bindEvents();
  updateDynamicBits();
}

function bindEvents() {
  app.querySelectorAll("[data-form='register-team']").forEach((form) => {
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      const formData = new FormData(form);
      send({
        type: "register-team",
        name: formData.get("name"),
        members: formData.get("members"),
        isAudience: formData.get("isAudience") === "true"
      });
    });
  });

  app.querySelectorAll("[data-form='host-auth']").forEach((form) => {
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      const formData = new FormData(form);
      send({ type: "host-auth", pin: formData.get("pin") });
    });
  });

  app.querySelectorAll("[data-form='host-notice']").forEach((form) => {
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      const formData = new FormData(form);
      send({
        type: "host-action",
        action: "set-notice",
        payload: { notice: formData.get("notice") }
      });
    });
  });

  app.querySelectorAll("[data-form='fff-submit']").forEach((form) => {
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      const question = getState().fff.question;
      const order = [...ui.fffDraftOrder];

      if (!question || order.length !== question.options.length || new Set(order).size !== order.length) {
        pushFlash("Choose each option once before submitting the order.", "danger");
        return;
      }

      send({
        type: "fff-submit",
        order,
        estimatedServerTime: serverNow()
      });
    });
  });

  app.querySelectorAll("[data-ui-action]").forEach((button) => {
    button.addEventListener("click", () => {
      const action = button.dataset.uiAction;
      if (action === "screening-page") {
        ui.screeningQuestionIndex = clamp(
          ui.screeningQuestionIndex + Number(button.dataset.direction || 0),
          0,
          Math.max(0, getState().screening.questions.length - 1)
        );
      } else if (action === "host-section") {
        ui.hostSection = button.dataset.value || "stage";
      } else if (action === "hotseat-section") {
        ui.hotSeatSection = button.dataset.value || "control";
      } else if (action === "team-page") {
        ui.teamPage = clamp(
          ui.teamPage + Number(button.dataset.direction || 0),
          0,
          Math.max(0, Math.ceil(Math.max(1, getState().teams.length) / 6) - 1)
        );
      } else if (action === "fff-pick") {
        const optionId = button.dataset.optionId;
        if (optionId && !ui.fffDraftOrder.includes(optionId)) {
          ui.fffDraftOrder = [...ui.fffDraftOrder, optionId];
        }
      } else if (action === "fff-remove") {
        const optionId = button.dataset.optionId;
        ui.fffDraftOrder = ui.fffDraftOrder.filter((value) => value !== optionId);
      } else if (action === "fff-reset") {
        ui.fffDraftOrder = [];
      }

      render();
    });
  });

  app.querySelectorAll("[data-action='screening-answer']").forEach((button) => {
    button.addEventListener("click", () => {
      send({
        type: "screening-answer",
        questionId: button.dataset.questionId,
        answerIndex: Number(button.dataset.answerIndex)
      });
    });
  });

  app.querySelectorAll("[data-host-action]").forEach((button) => {
    button.addEventListener("click", () => {
      const payload = {};
      const action = button.dataset.hostAction;
      const form = button.closest("form");
      if (button.dataset.kind) payload.kind = button.dataset.kind;
      if (button.dataset.answerIndex !== undefined) payload.answerIndex = Number(button.dataset.answerIndex);
      if (action === "start-fff" && form) {
        payload.questionIndex = Number(new FormData(form).get("questionIndex"));
      }
      if (action === "start-hotseat-for-team" && form) {
        payload.teamId = String(new FormData(form).get("teamId") || "");
      }
      send({
        type: "host-action",
        action,
        payload
      });
    });
  });

  app.querySelectorAll("[data-action='reset-player-session']").forEach((button) => {
    button.addEventListener("click", () => {
      localStorage.removeItem("jal_jeevan_team_id");
      ui.teamId = "";
      window.location.reload();
    });
  });
}

function updateDynamicBits() {
  const now = serverNow();
  document.querySelectorAll("[data-countdown]").forEach((element) => {
    const endAt = Number(element.dataset.countdown);
    element.textContent = formatMs(endAt - now);
  });

  document.querySelectorAll("[data-progress]").forEach((element) => {
    const endAt = Number(element.dataset.progress);
    const startAt = Number(element.dataset.start);
    if (!startAt || !endAt || endAt <= startAt) {
      element.style.width = "0%";
      return;
    }
    const progress = ((now - startAt) / (endAt - startAt)) * 100;
    element.style.width = `${Math.max(0, Math.min(100, progress))}%`;
  });
}

window.setInterval(updateDynamicBits, 300);
window.setInterval(syncClock, 10000);

connect();
