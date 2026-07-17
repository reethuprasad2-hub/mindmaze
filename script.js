/* ==========================================================================
   MindMaze — Escape the AI Lab
   Vanilla JS game engine: 5 rooms, countdown timer, scoring, progress bar,
   dark mode, and localStorage persistence (theme, high score, best time,
   and an in-progress session so a refresh doesn't lose the run).
   ========================================================================== */

(() => {
  "use strict";

  /* ------------------------------------------------------------------ */
  /*  Config                                                             */
  /* ------------------------------------------------------------------ */
  const TOTAL_TIME = 5*60;      // seconds on the master countdown
  const ROOM_BASE_SCORE = 100;
  const HINT_PENALTY = 15;
  const WRONG_PENALTY = 5;
  const MIN_ROOM_SCORE = 20;
  const SPEED_BONUS_WINDOW = 45;   // seconds
  const SPEED_BONUS = 20;
  const COMPLETION_BONUS = 50;

  const LS_THEME = "mindmaze_theme";
  const LS_HIGHSCORE = "mindmaze_highscore";
  const LS_BESTTIME = "mindmaze_besttime";
  const LS_STATE = "mindmaze_state";

  /* ------------------------------------------------------------------ */
  /*  Room definitions                                                   */
  /* ------------------------------------------------------------------ */
  const ROOMS = [
    {
      id: "access",
      name: "Access Control",
      lede: "The mainframe gates every door with 4-bit binary codes. Decode each block to decimal and enter the resulting 4-digit passcode.",
      type: "code",
      fragment: 3,
      hint: "Convert each 4-bit block separately — 0110 becomes a single digit, not four.",
      blocks: ["0110", "1001", "0011", "0101"],
      answer: "6935"
    },
    {
      id: "pattern",
      name: "Pattern Lock",
      lede: "The lock cycles through a numeric sequence. Find the next number to disengage it.",
      type: "sequence",
      fragment: 7,
      hint: "Look at the gaps between consecutive numbers — the gap itself grows by a fixed amount each step.",
      sequence: [2, 6, 12, 20, 30],
      answer: "42"
    },
    {
      id: "logic",
      name: "Logic Core",
      lede: "The core will only unlock for those who can name what lives inside it.",
      type: "riddle",
      fragment: 5,
      hint: "Alan Turing designed a famous test to tell this apart from a human.",
      riddle: "\u201cI speak every language, yet understand none the way you do. I was born from data, not from a childhood. Turing wanted to test me. What am I?\u201d",
      answers: ["ai", "a.i.", "artificial intelligence", "an ai", "an artificial intelligence"]
    },
    {
      id: "circuit",
      name: "Circuit Breaker",
      lede: "Toggle the relays until every light on the board is dark. Clicking a relay flips it and its direct neighbors.",
      type: "circuit",
      fragment: 2,
      hint: "Work corner to corner — clicking a corner only affects three cells, which makes it easier to reason about."
    },
    {
      id: "final",
      name: "Final Override",
      lede: "You've extracted four core fragments. Sum their digits and enter the total to override the containment AI.",
      type: "final",
      fragment: null,
      hint: "Add up the four fragment numbers shown below — simple arithmetic, nothing hidden."
    }
  ];

  /* ------------------------------------------------------------------ */
  /*  State                                                              */
  /* ------------------------------------------------------------------ */
  let state = null;
  let timerHandle = null;

  function freshState() {
    return {
      currentRoomIndex: 0,
      score: 0,
      timeLeft: TOTAL_TIME,
      fragments: [],
      rooms: ROOMS.map(() => ({ hintsUsed: 0, wrongAttempts: 0, solved: false, startedAt: null })),
      screen: "intro",
      gameOver: false
    };
  }

  /* ------------------------------------------------------------------ */
  /*  DOM refs                                                           */
  /* ------------------------------------------------------------------ */
  const el = {
    timerValue: document.getElementById("timerValue"),
    timerStat: document.getElementById("stat-timer"),
    scoreValue: document.getElementById("scoreValue"),
    bestValue: document.getElementById("bestValue"),
    themeToggle: document.getElementById("themeToggle"),
    themeIcon: document.getElementById("themeIcon"),
    progressTrack: document.getElementById("progressTrack"),

    screenIntro: document.getElementById("screen-intro"),
    screenRoom: document.getElementById("screen-room"),
    screenClear: document.getElementById("screen-clear"),
    screenWin: document.getElementById("screen-win"),
    screenLose: document.getElementById("screen-lose"),

    btnStart: document.getElementById("btnStart"),
    btnResume: document.getElementById("btnResume"),

    roomEyebrow: document.getElementById("roomEyebrow"),
    roomTitle: document.getElementById("roomTitle"),
    roomLede: document.getElementById("roomLede"),
    roomBody: document.getElementById("roomBody"),
    roomFeedback: document.getElementById("roomFeedback"),
    btnHint: document.getElementById("btnHint"),
    btnSubmit: document.getElementById("btnSubmit"),

    clearTitle: document.getElementById("clearTitle"),
    clearBody: document.getElementById("clearBody"),
    fragmentBadge: document.getElementById("fragmentBadge"),
    btnNextRoom: document.getElementById("btnNextRoom"),

    winSummary: document.getElementById("winSummary"),
    winStats: document.getElementById("winStats"),
    btnPlayAgain: document.getElementById("btnPlayAgain"),

    loseSummary: document.getElementById("loseSummary"),
    btnRetry: document.getElementById("btnRetry"),

    hintToast: document.getElementById("hintToast")
  };

  /* ------------------------------------------------------------------ */
  /*  Theme                                                               */
  /* ------------------------------------------------------------------ */
  function initTheme() {
    const saved = localStorage.getItem(LS_THEME);
    const theme = saved === "light" || saved === "dark" ? saved : "dark";
    applyTheme(theme);
  }

  function applyTheme(theme) {
    document.documentElement.setAttribute("data-theme", theme);
    el.themeIcon.textContent = theme === "dark" ? "\u263E" : "\u2600";
    localStorage.setItem(LS_THEME, theme);
  }

  el.themeToggle.addEventListener("click", () => {
    const current = document.documentElement.getAttribute("data-theme");
    applyTheme(current === "dark" ? "light" : "dark");
  });

  /* ------------------------------------------------------------------ */
  /*  Persistence                                                         */
  /* ------------------------------------------------------------------ */
  function saveState() {
    if (!state) return;
    localStorage.setItem(LS_STATE, JSON.stringify(state));
  }

  function loadSavedState() {
    try {
      const raw = localStorage.getItem(LS_STATE);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (parsed.gameOver || parsed.timeLeft <= 0) return null;
      return parsed;
    } catch (e) {
      return null;
    }
  }

  function clearSavedState() {
    localStorage.removeItem(LS_STATE);
  }

  function getHighScore() {
    return Number(localStorage.getItem(LS_HIGHSCORE) || 0);
  }
  function getBestTime() {
    const v = localStorage.getItem(LS_BESTTIME);
    return v === null ? null : Number(v);
  }

  function refreshHudBest() {
    el.bestValue.textContent = getHighScore();
  }

  /* ------------------------------------------------------------------ */
  /*  Screens                                                             */
  /* ------------------------------------------------------------------ */
  function showScreen(name) {
    [el.screenIntro, el.screenRoom, el.screenClear, el.screenWin, el.screenLose]
      .forEach(s => (s.hidden = true));
    const map = {
      intro: el.screenIntro,
      room: el.screenRoom,
      clear: el.screenClear,
      win: el.screenWin,
      lose: el.screenLose
    };
    map[name].hidden = false;
    if (state) { state.screen = name; saveState(); }
  }

  /* ------------------------------------------------------------------ */
  /*  Timer                                                               */
  /* ------------------------------------------------------------------ */
  function formatTime(sec) {
    const m = Math.floor(sec / 60).toString().padStart(2, "0");
    const s = Math.floor(sec % 60).toString().padStart(2, "0");
    return `${m}:${s}`;
  }

  function startTimer() {
    stopTimer();
    updateTimerDisplay();
    timerHandle = setInterval(() => {
      if (!state || state.gameOver) return stopTimer();
      state.timeLeft -= 1;
      updateTimerDisplay();
      if (state.timeLeft <= 0) {
        state.timeLeft = 0;
        updateTimerDisplay();
        endLose();
      } else if (state.timeLeft % 5 === 0) {
        saveState();
      }
    }, 1000);
  }

  function stopTimer() {
    if (timerHandle) clearInterval(timerHandle);
    timerHandle = null;
  }

  function updateTimerDisplay() {
    el.timerValue.textContent = formatTime(state.timeLeft);
    el.timerStat.classList.toggle("warning", state.timeLeft <= 180 && state.timeLeft > 60);
    el.timerStat.classList.toggle("danger", state.timeLeft <= 60);
  }

  /* ------------------------------------------------------------------ */
  /*  Progress track                                                      */
  /* ------------------------------------------------------------------ */
  function renderProgress() {
    el.progressTrack.innerHTML = "";
    ROOMS.forEach((room, i) => {
      const seg = document.createElement("div");
      seg.className = "progress-seg";
      if (state.rooms[i].solved) seg.classList.add("done");
      if (i === state.currentRoomIndex && !state.gameOver) seg.classList.add("active");
      seg.title = `${i + 1}. ${room.name}`;
      el.progressTrack.appendChild(seg);
    });
  }

  /* ------------------------------------------------------------------ */
  /*  Score / HUD                                                        */
  /* ------------------------------------------------------------------ */
  function refreshScoreHud() {
    el.scoreValue.textContent = state.score;
  }

  /* ------------------------------------------------------------------ */
  /*  Room rendering                                                      */
  /* ------------------------------------------------------------------ */
  let circuitGrid = null; // live array for the current circuit room

  function loadRoom(index) {
    const room = ROOMS[index];
    const rstate = state.rooms[index];
    rstate.startedAt = Date.now();

    el.roomEyebrow.textContent = `Room ${index + 1} / ${ROOMS.length}`;
    el.roomTitle.textContent = room.name;
    el.roomLede.textContent = room.lede;
    el.roomFeedback.textContent = "";
    el.roomFeedback.className = "feedback";
    el.btnSubmit.disabled = false;

    el.roomBody.innerHTML = "";

    if (room.type === "code") {
      el.roomBody.innerHTML = `
        <div class="code-block">${room.blocks.join("&nbsp;&nbsp;&nbsp;")}</div>
        <input type="text" id="answerInput" inputmode="numeric" placeholder="Enter the 4-digit passcode" maxlength="4" autocomplete="off">
      `;
    } else if (room.type === "sequence") {
      const chips = room.sequence.map(n => `<div class="seq-chip">${n}</div>`).join("");
      el.roomBody.innerHTML = `
        <div class="sequence-row">${chips}<div class="seq-chip unknown">?</div></div>
        <input type="text" id="answerInput" inputmode="numeric" placeholder="Enter the next number" autocomplete="off">
      `;
    } else if (room.type === "riddle") {
      el.roomBody.innerHTML = `
        <div class="code-block" style="letter-spacing:normal; font-size:1rem; line-height:1.6;">${room.riddle}</div>
        <input type="text" id="answerInput" placeholder="Your answer" autocomplete="off">
      `;
    } else if (room.type === "circuit") {
      el.roomBody.innerHTML = `
        <div class="circuit-grid" id="circuitGrid"></div>
        <p style="text-align:center;color:var(--text-muted);font-size:.85rem;">Goal: switch every relay off.</p>
      `;
      initCircuit();
    } else if (room.type === "final") {
      const fragHtml = state.fragments.map((f, i) => `<div class="seq-chip">${f}</div>`).join("");
      el.roomBody.innerHTML = `
        <div class="sequence-row">${fragHtml}</div>
        <input type="text" id="answerInput" inputmode="numeric" placeholder="Enter the override code" autocomplete="off">
      `;
    }

    const input = document.getElementById("answerInput");
    if (input) {
      input.addEventListener("keydown", e => {
        if (e.key === "Enter") handleSubmit();
      });
      requestAnimationFrame(() => input.focus());
    }

    renderProgress();
    showScreen("room");
    saveState();
  }

  /* ---------- Circuit Breaker (lights-out) ---------- */
  function initCircuit() {
    // start solved (all off) then scramble with random valid clicks
    circuitGrid = new Array(9).fill(false);
    const scrambleClicks = 5 + Math.floor(Math.random() * 3);
    for (let i = 0; i < scrambleClicks; i++) {
      toggleCircuit(Math.floor(Math.random() * 9), false);
    }
    renderCircuit();
  }

  function neighborsOf(idx) {
    const row = Math.floor(idx / 3), col = idx % 3;
    const list = [idx];
    if (row > 0) list.push(idx - 3);
    if (row < 2) list.push(idx + 3);
    if (col > 0) list.push(idx - 1);
    if (col < 2) list.push(idx + 1);
    return list;
  }

  function toggleCircuit(idx, rerender = true) {
    neighborsOf(idx).forEach(i => { circuitGrid[i] = !circuitGrid[i]; });
    if (rerender) renderCircuit();
  }

  function renderCircuit() {
    const wrap = document.getElementById("circuitGrid");
    if (!wrap) return;
    wrap.innerHTML = "";
    circuitGrid.forEach((on, i) => {
      const cell = document.createElement("div");
      cell.className = "circuit-cell" + (on ? " on" : "");
      cell.setAttribute("role", "button");
      cell.setAttribute("aria-label", `Relay ${i + 1} ${on ? "on" : "off"}`);
      cell.addEventListener("click", () => toggleCircuit(i));
      wrap.appendChild(cell);
    });
  }

  /* ------------------------------------------------------------------ */
  /*  Submission / validation                                            */
  /* ------------------------------------------------------------------ */
  function normalize(str) {
    return str.trim().toLowerCase().replace(/\s+/g, " ");
  }

  function handleSubmit() {
    if (!state || state.gameOver) return;
    const room = ROOMS[state.currentRoomIndex];
    const rstate = state.rooms[state.currentRoomIndex];
    let correct = false;

    if (room.type === "code" || room.type === "sequence") {
      const input = document.getElementById("answerInput");
      correct = input && input.value.trim() === room.answer;
    } else if (room.type === "riddle") {
      const input = document.getElementById("answerInput");
      correct = input && room.answers.includes(normalize(input.value));
    } else if (room.type === "circuit") {
      correct = circuitGrid.every(v => v === false);
    } else if (room.type === "final") {
      const input = document.getElementById("answerInput");
      const total = state.fragments.reduce((a, b) => a + b, 0);
      correct = input && Number(input.value.trim()) === total;
    }

    if (correct) {
      completeRoom(room, rstate);
    } else {

    const wrong = document.getElementById("loseSound");

    if (wrong) {
        wrong.currentTime = 0;
        wrong.play().catch(() => {});
    }

    rstate.wrongAttempts += 1;
      el.roomFeedback.textContent = room.type === "circuit"
        ? "Not quite — some relays are still live. Keep toggling."
        : "That code didn't take. Try again.";
      el.roomFeedback.className = "feedback error";
      saveState();
    }
  }

  function handleHint() {
    if (!state || state.gameOver) return;
    const room = ROOMS[state.currentRoomIndex];
    const rstate = state.rooms[state.currentRoomIndex];
    rstate.hintsUsed += 1;
    el.hintToast.innerHTML = `<strong>Hint:</strong> ${room.hint}`;
    el.hintToast.hidden = false;
    clearTimeout(handleHint._t);
    handleHint._t = setTimeout(() => { el.hintToast.hidden = true; }, 5000);
    saveState();
  }

  function completeRoom(room, rstate) {
    rstate.solved = true;
    const elapsed = (Date.now() - (rstate.startedAt || Date.now())) / 1000;
    let roomScore = ROOM_BASE_SCORE
      - rstate.hintsUsed * HINT_PENALTY
      - rstate.wrongAttempts * WRONG_PENALTY;
    roomScore = Math.max(MIN_ROOM_SCORE, roomScore);
    if (elapsed <= SPEED_BONUS_WINDOW) roomScore += SPEED_BONUS;

    state.score += roomScore;
    if (room.fragment !== null) state.fragments.push(room.fragment);

    refreshScoreHud();
    renderProgress();

    el.clearTitle.textContent = `${room.name} Secured`;
    el.clearBody.textContent = `+${roomScore} points added to your score.`;
    el.fragmentBadge.textContent = room.fragment !== null
      ? `Core Fragment Extracted: ${room.fragment}`
      : `Override Accepted`;
    el.fragmentBadge.style.display = room.fragment !== null ? "inline-block" : "none";

    showScreen("clear");
    saveState();
  }

  function nextRoom() {
    const nextIndex = state.currentRoomIndex + 1;
    if (nextIndex >= ROOMS.length) {
      endWin();
      return;
    }
    state.currentRoomIndex = nextIndex;
    loadRoom(nextIndex);
  }

  /* ------------------------------------------------------------------ */
  /*  End states                                                          */
  /* ------------------------------------------------------------------ */
  function endWin() {
    state.gameOver = true;
    stopTimer();
    const bg = document.getElementById("bgMusic");
if (bg) bg.pause();

const win = document.getElementById("winSound");

if (win) {
    win.currentTime = 0;
    win.play().catch(() => {});
}

    const timeUsed = TOTAL_TIME - state.timeLeft;
    const timeBonus = Math.round(state.timeLeft * 0.5);
    state.score += COMPLETION_BONUS + timeBonus;
    refreshScoreHud();

    const prevHigh = getHighScore();
    const isNewHigh = state.score > prevHigh;
    if (isNewHigh) localStorage.setItem(LS_HIGHSCORE, String(state.score));

    const prevBest = getBestTime();
    const isNewBest = prevBest === null || timeUsed < prevBest;
    if (isNewBest) localStorage.setItem(LS_BESTTIME, String(timeUsed));

    refreshHudBest();

    el.winSummary.textContent = "Every subsystem is offline. The exit seals open behind you.";
    el.winStats.innerHTML = `
      <div class="end-stat"><span>Final Score</span><b>${state.score}${isNewHigh ? " \u2605" : ""}</b></div>
      <div class="end-stat"><span>Time Used</span><b>${formatTime(timeUsed)}${isNewBest ? " \u2605" : ""}</b></div>
      <div class="end-stat"><span>Hints Used</span><b>${state.rooms.reduce((a, r) => a + r.hintsUsed, 0)}</b></div>
      <div class="end-stat"><span>Best Score</span><b>${getHighScore()}</b></div>
    `;

    clearSavedState();
    renderProgress();
    showScreen("win");
    confetti();
  }

  function endLose() {
    state.gameOver = true;
    stopTimer();
    const bg = document.getElementById("bgMusic");
if (bg) bg.pause();

const lose = document.getElementById("loseSound");

if (lose) {
    lose.currentTime = 0;
    lose.play().catch(() => {});
}
    const solvedCount = state.rooms.filter(r => r.solved).length;
    el.loseSummary.textContent = `Containment lockdown triggered. You secured ${solvedCount} of ${ROOMS.length} rooms and scored ${state.score} points.`;
    clearSavedState();
    renderProgress();
    document.body.style.animation="shake .5s";
    showScreen("lose");
  }

  /* ------------------------------------------------------------------ */
  /*  Game start / restart                                               */
  /* ------------------------------------------------------------------ */
  function startFresh() {
    clearSavedState();
    state = freshState();

    refreshScoreHud();
    refreshHudBest();
    updateTimerDisplay();
    renderProgress();

    // Start background music
    const music = document.getElementById("bgMusic");
    if (music) {
        music.pause();
        music.currentTime = 0;
        music.volume = 0.25;
        music.play().catch(() => {});
    }

    startTimer();
    loadRoom(0);
}

  function resumeFromSaved(saved) {
    state = saved;
    refreshScoreHud();
    refreshHudBest();
    updateTimerDisplay();
    renderProgress();
    startTimer();
    if (state.screen === "room" || !state.rooms[state.currentRoomIndex].solved) {
      loadRoom(state.currentRoomIndex);
    } else {
      loadRoom(state.currentRoomIndex);
    }
  }

  /* ------------------------------------------------------------------ */
  /*  Wire up events                                                      */
  /* ------------------------------------------------------------------ */
  el.btnStart.addEventListener("click", startFresh);
  el.btnResume.addEventListener("click", () => {
    const saved = loadSavedState();
    if (saved) resumeFromSaved(saved);
    else startFresh();
  });
  el.btnSubmit.addEventListener("click", handleSubmit);
  el.btnHint.addEventListener("click", handleHint);
  el.btnNextRoom.addEventListener("click", nextRoom);
  el.btnPlayAgain.addEventListener("click", startFresh);
  el.btnRetry.addEventListener("click", startFresh);

  /* ------------------------------------------------------------------ */
  /*  Init                                                               */
  /* ------------------------------------------------------------------ */
  function init() {
    initTheme();
    refreshHudBest();
    const saved = loadSavedState();
    if (saved) {
      el.btnResume.hidden = false;
    }
    // build an idle progress track before a game starts
    state = freshState();
    renderProgress();
    updateTimerDisplay();
  }

  init();
})();
function confetti(){

const colors=[
"#00E5FF",
"#5EEAD4",
"#FFD93D",
"#FF6B6B",
"#A855F7"
];

for(let i=0;i<120;i++){

const piece=document.createElement("div");

piece.className="confetti";

piece.style.left=Math.random()*100+"vw";

piece.style.background=colors[Math.floor(Math.random()*colors.length)];

piece.style.animationDelay=Math.random()*2+"s";

piece.style.transform=`rotate(${Math.random()*360}deg)`;

document.body.appendChild(piece);

setTimeout(()=>piece.remove(),5000);

}

}
