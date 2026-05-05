/**
 * BulletTrain.ai - simulation runner
 *
 * Wires the LiveAvatar SDK to the UI:
 *   1. Fetches a session token from the Flask backend.
 *   2. Starts a LiveAvatarSession and attaches it to the <video> element.
 *   3. Listens to transcript events and posts them to /api/transcript/:session_id.
 *   4. On session end, calls /api/analyze/:session_id and redirects to results.
 */

import {
  LiveAvatarSession,
  SessionEvent,
  AgentEventsEnum,
  SessionState,
} from "@heygen/liveavatar-web-sdk";

window.addEventListener("error", (e) => {
  if (e.message && e.message.toLowerCase().includes("import")) {
    showOverlay("⚠️", "SDK failed to load", `Check your internet connection and try refreshing.<br><small>${e.message}</small>`);
  }
});

// ---------------------------------------------------------------------------
// Read runner metadata from the DOM
// ---------------------------------------------------------------------------
const runner     = document.getElementById("runner");
const SESSION_ID = runner.dataset.session;
const SIM_ID     = runner.dataset.sim;
const MODE       = runner.dataset.mode;

// ---------------------------------------------------------------------------
// DOM refs
// ---------------------------------------------------------------------------
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
let micOn          = false;
let avatarSpeaking = false;  // true while avatar is mid-speech; blocks mic re-echo
let timerInterval  = null;
let elapsedSeconds = 0;

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
  overlayIcon.textContent = icon;
  overlayTitle.textContent = title;
  overlayMsg.innerHTML = msg;
  spinner.style.display = showSpinner ? "block" : "none";
  startBtn.style.display = "none";
}

function hideOverlay() {
  overlay.classList.add("hidden");
}

// ---------------------------------------------------------------------------
// Transcript helpers
// ---------------------------------------------------------------------------
function clearTranscriptPlaceholder() {
  const placeholder = transcriptList.querySelector("[style*='text-align:center']");
  if (placeholder) placeholder.remove();
}

function appendBubble(speaker, text) {
  clearTranscriptPlaceholder();
  const div = document.createElement("div");
  div.className = `bubble ${speaker}`;
  div.innerHTML = `<span class="who">${speaker === "user" ? "You" : "Avatar"}</span>${escapeHtml(text)}`;
  transcriptList.appendChild(div);
  transcriptList.scrollTop = transcriptList.scrollHeight;
}

function escapeHtml(s) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// ---------------------------------------------------------------------------
// Post a transcript turn to the backend
// ---------------------------------------------------------------------------
async function postTranscript(speaker, text) {
  try {
    await fetch(`/api/transcript/${SESSION_ID}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ speaker, text }),
    });
  } catch (_) { /* best-effort */ }
}

// ---------------------------------------------------------------------------
// Mute mic, ask backend for a response, speak it through the avatar.
// ---------------------------------------------------------------------------
async function fetchAndSpeakResponse(userText) {
  if (!avatarSession) return;

  // Mute mic before speaking to prevent echo loop
  if (micOn) {
    avatarSession.stopListening();
    setMicOn(false);
  }
  avatarSpeaking = true;

  try {
    const res = await fetch("/api/respond", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ session_id: SESSION_ID, text: userText }),
    });
    if (!res.ok) { avatarSpeaking = false; return; }
    const data = await res.json();
    if (data.text && avatarSession) {
      avatarSession.message(data.text);
      // Optimistically add to transcript; AVATAR_TRANSCRIPTION may also fire
      appendBubble("avatar", data.text);
      postTranscript("avatar", data.text);
    } else {
      avatarSpeaking = false;
    }
  } catch (_) {
    avatarSpeaking = false;
  }
}

// ---------------------------------------------------------------------------
// Start session
// ---------------------------------------------------------------------------
async function startSession() {
  showOverlay("", "", "Connecting to avatar…", true);

  // 1. Get session token from Flask backend
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

  // 2. Create and start the LiveAvatar session
  try {
    avatarSession = new LiveAvatarSession(sessionToken, { voiceChat: true });

    avatarSession.on(SessionEvent.SESSION_STATE_CHANGED, (state) => {
      if (state === SessionState.CONNECTED) {
        hideOverlay();
        controls.style.display = "flex";
        window.__sessionLive = true;
        startTimer();
        // Kick off the conversation: the avatar speaks the opener first.
        // Mic stays OFF until avatar finishes speaking (AVATAR_SPEAK_ENDED).
        fetchAndSpeakResponse("");
      }
      if (state === SessionState.DISCONNECTED || state === SessionState.DISCONNECTING) {
        window.__sessionLive = false;
        handleSessionEnd();
      }
    });

    avatarSession.on(SessionEvent.SESSION_STREAM_READY, () => {
      avatarSession.attach(videoEl);
      videoEl.play().catch(() => {});
    });

    // Track avatar transcript (the SDK may emit these in voiceChat mode)
    // We add the bubble optimistically in fetchAndSpeakResponse, so skip duplicates here.
    avatarSession.on(AgentEventsEnum.AVATAR_TRANSCRIPTION, () => {
      // Already handled in fetchAndSpeakResponse; no-op to avoid duplicates.
    });

    // Re-enable mic only after avatar fully finishes speaking
    avatarSession.on(AgentEventsEnum.AVATAR_SPEAK_ENDED, () => {
      avatarSpeaking = false;
      if (avatarSession && !micOn) {
        avatarSession.startListening();
        setMicOn(true);
      }
    });

    // User speech - only process when avatar is NOT speaking to prevent echo
    let userBuffer = "";

    avatarSession.on(AgentEventsEnum.USER_TRANSCRIPTION_CHUNK, (evt) => {
      if (!avatarSpeaking) userBuffer += evt.text || "";
    });

    avatarSession.on(AgentEventsEnum.USER_TRANSCRIPTION, async (evt) => {
      // Discard if avatar is currently speaking (echo guard)
      if (avatarSpeaking) { userBuffer = ""; return; }

      const text = evt.text || userBuffer;
      userBuffer = "";
      if (!text.trim()) return;

      appendBubble("user", text);
      postTranscript("user", text);
      await fetchAndSpeakResponse(text);
    });

    avatarSession.on(AgentEventsEnum.SESSION_STOPPED, () => {
      handleSessionEnd();
    });

    await avatarSession.start();
    // NOTE: Do NOT call enableMic() here. The avatar speaks first.
    // Mic is enabled by AVATAR_SPEAK_ENDED after the opener finishes.

  } catch (err) {
    showOverlay("⚠️", "Session error", `Failed to start avatar session.<br><small>${err.message}</small>`);
    startBtn.style.display = "inline-flex";
    avatarSession = null;
    window.__sessionLive = false;
  }
}

// ---------------------------------------------------------------------------
// Mic controls
// ---------------------------------------------------------------------------
function setMicOn(on) {
  micOn = on;
  micBtn.innerHTML = on
    ? `<svg width="16" height="16" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.3"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="23"/><line x1="8" y1="23" x2="16" y2="23"/></svg> Mic On`
    : `<svg width="16" height="16" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.3"><line x1="1" y1="1" x2="23" y2="23"/><path d="M9 9v3a3 3 0 0 0 5.12 2.12M15 9.34V4a3 3 0 0 0-5.94-.6"/><path d="M17 16.95A7 7 0 0 1 5 12v-2m14 0v2"/><line x1="12" y1="19" x2="12" y2="23"/><line x1="8" y1="23" x2="16" y2="23"/></svg> Mic Off`;
  micBtn.className = on ? "btn is-on" : "";
}

function toggleMic() {
  if (!avatarSession || avatarSpeaking) return;
  if (micOn) {
    avatarSession.stopListening();
    setMicOn(false);
  } else {
    avatarSession.startListening();
    setMicOn(true);
  }
}

// ---------------------------------------------------------------------------
// Interrupt avatar mid-speech
// ---------------------------------------------------------------------------
function interruptAvatar() {
  if (!avatarSession) return;
  avatarSession.interrupt();
  avatarSpeaking = false;
  if (!micOn) {
    avatarSession.startListening();
    setMicOn(true);
  }
}

// ---------------------------------------------------------------------------
// End session and trigger analysis
// ---------------------------------------------------------------------------
async function endSession() {
  if (!avatarSession) return;
  clearInterval(timerInterval);
  window.__sessionLive = false;

  showOverlay("⏳", "Generating your analysis…", "Hang tight. We're scoring your session against the rubric.", true);

  try {
    await avatarSession.stop();
  } catch (_) { /* session may already be closed */ }
  avatarSession = null;

  await generateAnalysis();
}

async function handleSessionEnd() {
  if (!window.__sessionLive) return;
  clearInterval(timerInterval);
  window.__sessionLive = false;
  showOverlay("⏳", "Session ended", "Generating analysis…", true);
  await generateAnalysis();
}

async function generateAnalysis() {
  try {
    const res = await fetch(`/api/analyze/${SESSION_ID}`, { method: "POST" });
    if (!res.ok) throw new Error(`Analyze failed: ${res.status}`);
    const data = await res.json();
    if (data.redirect_url) {
      window.location.href = data.redirect_url;
      return;
    }
  } catch (err) {
    showOverlay("⚠️", "Analysis error", `Could not generate analysis: ${err.message}`);
  }
}

// ---------------------------------------------------------------------------
// Wire up global events from inline onclick helpers
// ---------------------------------------------------------------------------
window.addEventListener("bt:start",     () => startSession());
window.addEventListener("bt:toggleMic", () => toggleMic());
window.addEventListener("bt:interrupt", () => interruptAvatar());
window.addEventListener("bt:end",       () => {
  if (confirm("End the session now and see your results?")) endSession();
});

// ---------------------------------------------------------------------------
// Keyboard shortcuts
// ---------------------------------------------------------------------------
window.addEventListener("keydown", (e) => {
  if (e.code === "Space" && e.target === document.body && window.__sessionLive) {
    e.preventDefault();
    toggleMic();
  }
  if (e.code === "Escape" && window.__sessionLive) {
    interruptAvatar();
  }
});
