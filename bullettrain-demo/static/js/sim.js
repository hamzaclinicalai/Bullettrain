/**
 * BulletTrain.ai - simulation runner
 *
 * LiveAvatar SDK handles video streaming only.
 * Web Speech API handles mic input (no SDK voiceChat dependency).
 * Backend /api/respond generates avatar replies; session.message() speaks them.
 */

import {
  LiveAvatarSession,
  SessionEvent,
  AgentEventsEnum,
  SessionState,
} from "@heygen/liveavatar-web-sdk";

// ---------------------------------------------------------------------------
// DOM refs
// ---------------------------------------------------------------------------
const runner     = document.getElementById("runner");
const SESSION_ID = runner.dataset.session;
const SIM_ID     = runner.dataset.sim;
const MODE       = runner.dataset.mode;

const videoEl        = document.getElementById("avatar-video");
const overlay        = document.getElementById("stage-overlay");
const overlayIcon    = document.getElementById("overlay-icon");
const overlayTitle   = document.getElementById("overlay-title");
const overlayMsg     = document.getElementById("overlay-msg");
const spinner        = document.getElementById("spinner");
const startBtn       = document.getElementById("start-btn");
const controls       = document.getElementById("controls");
const micBtn         = document.getElementById("mic-btn");
const transcriptList = document.getElementById("transcript-list");
const timerEl        = document.getElementById("timer");

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------
let avatarSession  = null;
let recognition    = null;   // Web Speech API instance
let micOn          = false;
let avatarSpeaking = false;  // true while session.message() is in progress
let timerInterval  = null;
let elapsedSeconds = 0;
let streamReady    = false;

window.__sessionLive = false;

// ---------------------------------------------------------------------------
// Timer
// ---------------------------------------------------------------------------
function startTimer() {
  timerInterval = setInterval(() => {
    elapsedSeconds++;
    const m = String(Math.floor(elapsedSeconds / 60)).padStart(2, "0");
    const s = String(elapsedSeconds % 60).padStart(2, "0");
    timerEl.textContent = `${m}:${s}`;
  }, 1000);
}

// ---------------------------------------------------------------------------
// Overlay helpers
// ---------------------------------------------------------------------------
function showOverlay(icon, title, msg, showSpinner = false) {
  overlay.classList.remove("hidden");
  overlayIcon.style.display = showSpinner ? "none" : "block";
  overlayIcon.textContent   = icon;
  overlayTitle.textContent  = title;
  overlayMsg.innerHTML      = msg;
  spinner.style.display     = showSpinner ? "block" : "none";
  startBtn.style.display    = "none";
}
function hideOverlay() { overlay.classList.add("hidden"); }

// ---------------------------------------------------------------------------
// Transcript helpers
// ---------------------------------------------------------------------------
function clearPlaceholder() {
  transcriptList.querySelector("[data-placeholder]")?.remove();
}
function appendBubble(speaker, text) {
  clearPlaceholder();
  const div = document.createElement("div");
  div.className = `bubble ${speaker}`;
  div.innerHTML = `<span class="who">${speaker === "user" ? "You" : "Avatar"}</span>${escapeHtml(text)}`;
  transcriptList.appendChild(div);
  transcriptList.scrollTop = transcriptList.scrollHeight;
}
function escapeHtml(s) {
  return s.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");
}

// ---------------------------------------------------------------------------
// Backend calls
// ---------------------------------------------------------------------------
async function postTranscript(speaker, text) {
  try {
    await fetch(`/api/transcript/${SESSION_ID}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ speaker, text }),
    });
  } catch (_) {}
}

async function fetchAndSpeakResponse(userText) {
  if (!avatarSession || !streamReady) return;

  pauseListening();
  avatarSpeaking = true;

  try {
    const res = await fetch("/api/respond", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ session_id: SESSION_ID, text: userText }),
    });
    if (!res.ok) throw new Error(`respond ${res.status}`);
    const data = await res.json();
    if (!data.text) throw new Error("empty response");

    // Speak through avatar
    try {
      await avatarSession.message(data.text);
    } catch (_) {
      // message() may not return a promise in all SDK versions — fire and continue
      avatarSession.message(data.text);
    }

    // Show in transcript immediately (SDK AVATAR_TRANSCRIPTION may not fire)
    appendBubble("avatar", data.text);
    postTranscript("avatar", data.text);

    // Wait for avatar to finish speaking before re-enabling mic.
    // AVATAR_SPEAK_ENDED handles it, but add a time-based fallback.
    const wordCount  = data.text.split(/\s+/).length;
    const speakMs    = Math.max(wordCount * 450, 2000); // ~450ms per word
    setTimeout(() => {
      if (avatarSpeaking) {
        avatarSpeaking = false;
        if (micOn) resumeListening();
      }
    }, speakMs);

  } catch (err) {
    console.error("fetchAndSpeakResponse:", err);
    avatarSpeaking = false;
    if (micOn) resumeListening();
  }
}

// ---------------------------------------------------------------------------
// Web Speech API  (Chrome / Edge; graceful degradation on others)
// ---------------------------------------------------------------------------
function initSpeechRecognition() {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) {
    // Browser doesn't support it — show a warning but keep the video going
    appendBubble("avatar", "[Your browser doesn't support speech recognition. Try Chrome or Edge.]");
    return;
  }

  recognition = new SR();
  recognition.continuous      = false;  // one utterance at a time
  recognition.interimResults  = false;
  recognition.lang            = "en-US";
  recognition.maxAlternatives = 1;

  recognition.onresult = async (evt) => {
    const text = evt.results[0][0].transcript.trim();
    if (!text || avatarSpeaking) return;
    appendBubble("user", text);
    postTranscript("user", text);
    await fetchAndSpeakResponse(text);
  };

  recognition.onend = () => {
    // Auto-restart after each utterance while mic is "on"
    if (micOn && !avatarSpeaking && window.__sessionLive) {
      try { recognition.start(); } catch (_) {}
    }
  };

  recognition.onerror = (evt) => {
    if (evt.error === "no-speech" || evt.error === "aborted") {
      // Normal — restart
      if (micOn && !avatarSpeaking && window.__sessionLive) {
        try { recognition.start(); } catch (_) {}
      }
    } else {
      console.warn("Speech recognition error:", evt.error);
    }
  };
}

function resumeListening() {
  if (!recognition || !window.__sessionLive) return;
  try { recognition.start(); } catch (_) {}
  setMicOn(true);
}
function pauseListening() {
  if (!recognition) return;
  try { recognition.stop(); recognition.abort(); } catch (_) {}
}
function setMicOn(on) {
  micOn = on;
  micBtn.innerHTML = on
    ? `<svg width="16" height="16" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.3"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="23"/><line x1="8" y1="23" x2="16" y2="23"/></svg> Mic On`
    : `<svg width="16" height="16" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.3"><line x1="1" y1="1" x2="23" y2="23"/><path d="M9 9v3a3 3 0 0 0 5.12 2.12M15 9.34V4a3 3 0 0 0-5.94-.6"/><path d="M17 16.95A7 7 0 0 1 5 12v-2m14 0v2"/><line x1="12" y1="19" x2="12" y2="23"/><line x1="8" y1="23" x2="16" y2="23"/></svg> Mic Off`;
  micBtn.className = on ? "btn is-on" : "";
}

// ---------------------------------------------------------------------------
// Avatar SPEAK_ENDED — clean way to re-enable mic
// ---------------------------------------------------------------------------
function onAvatarSpeakEnded() {
  avatarSpeaking = false;
  if (micOn && !avatarSpeaking) resumeListening();
}

// ---------------------------------------------------------------------------
// Start session
// ---------------------------------------------------------------------------
async function startSession() {
  showOverlay("", "", "Connecting to avatar…", true);

  // 1. Get session token
  let sessionToken;
  try {
    const res = await fetch("/api/session-token", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ simulation_id: SIM_ID, mode: MODE }),
    });
    if (!res.ok) throw new Error(`Token request failed: ${res.status}`);
    const data = await res.json();
    if (data.error) throw new Error(data.error);
    sessionToken = data.session_token;
  } catch (err) {
    showOverlay("⚠️", "Connection failed", `Could not get a session token.<br><small>${err.message}</small>`);
    startBtn.style.display = "inline-flex";
    startBtn.textContent = "Try again";
    return;
  }

  // 2. Initialize speech recognition before starting session
  initSpeechRecognition();

  // 3. Create avatar session — streaming video only (no voiceChat)
  try {
    avatarSession = new LiveAvatarSession(sessionToken);

    avatarSession.on(SessionEvent.SESSION_STATE_CHANGED, (state) => {
      if (state === SessionState.CONNECTED) {
        hideOverlay();
        controls.style.display = "flex";
        window.__sessionLive = true;
        startTimer();
      }
      if (state === SessionState.DISCONNECTED || state === SessionState.DISCONNECTING) {
        window.__sessionLive = false;
        handleSessionEnd();
      }
    });

    avatarSession.on(SessionEvent.SESSION_STREAM_READY, async () => {
      avatarSession.attach(videoEl);
      videoEl.play().catch(() => {});
      streamReady = true;

      // Stream is ready — now safe to call message().
      // Avatar speaks the opener first; mic enables after avatar finishes.
      setMicOn(true); // show mic button as "on" so user knows it will activate
      await fetchAndSpeakResponse(""); // empty = opener
    });

    // SDK may still emit AVATAR_SPEAK_ENDED even without voiceChat
    avatarSession.on(AgentEventsEnum.AVATAR_SPEAK_ENDED, onAvatarSpeakEnded);
    avatarSession.on(AgentEventsEnum.SESSION_STOPPED, () => handleSessionEnd());

    await avatarSession.start();

  } catch (err) {
    showOverlay("⚠️", "Session error", `Failed to start avatar session.<br><small>${err.message}</small>`);
    startBtn.style.display = "inline-flex";
    avatarSession = null;
    window.__sessionLive = false;
  }
}

// ---------------------------------------------------------------------------
// Mic toggle (manual button)
// ---------------------------------------------------------------------------
function toggleMic() {
  if (!window.__sessionLive) return;
  if (micOn) {
    pauseListening();
    setMicOn(false);
  } else {
    resumeListening();
  }
}

// ---------------------------------------------------------------------------
// Interrupt avatar mid-speech
// ---------------------------------------------------------------------------
function interruptAvatar() {
  if (!avatarSession) return;
  try { avatarSession.interrupt(); } catch (_) {}
  avatarSpeaking = false;
  resumeListening();
}

// ---------------------------------------------------------------------------
// End session
// ---------------------------------------------------------------------------
async function endSession() {
  if (!avatarSession) return;
  clearInterval(timerInterval);
  window.__sessionLive = false;
  pauseListening();

  showOverlay("⏳", "Generating your analysis…", "Hang tight. We're scoring your session against the rubric.", true);

  try { await avatarSession.stop(); } catch (_) {}
  avatarSession = null;

  await generateAnalysis();
}

async function handleSessionEnd() {
  if (!window.__sessionLive) return;
  clearInterval(timerInterval);
  window.__sessionLive = false;
  pauseListening();
  showOverlay("⏳", "Session ended", "Generating analysis…", true);
  await generateAnalysis();
}

async function generateAnalysis() {
  try {
    const res = await fetch(`/api/analyze/${SESSION_ID}`, { method: "POST" });
    if (!res.ok) throw new Error(`Analyze failed: ${res.status}`);
    const data = await res.json();
    if (data.redirect_url) { window.location.href = data.redirect_url; }
  } catch (err) {
    showOverlay("⚠️", "Analysis error", `Could not generate analysis: ${err.message}`);
  }
}

// ---------------------------------------------------------------------------
// Global event bridge (inline onclick helpers in HTML)
// ---------------------------------------------------------------------------
window.addEventListener("bt:start",     () => startSession());
window.addEventListener("bt:toggleMic", () => toggleMic());
window.addEventListener("bt:interrupt", () => interruptAvatar());
window.addEventListener("bt:end",       () => {
  if (confirm("End the session now and see your results?")) endSession();
});

// Keyboard shortcuts
window.addEventListener("keydown", (e) => {
  if (e.code === "Space" && e.target === document.body && window.__sessionLive) {
    e.preventDefault(); toggleMic();
  }
  if (e.code === "Escape" && window.__sessionLive) interruptAvatar();
});
