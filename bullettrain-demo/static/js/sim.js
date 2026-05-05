/**
 * BulletTrain.ai - simulation runner
 *
 * Uses LiveAvatar SDK with voiceChat:true so that:
 *   - session.message(text)  →  avatar speaks the text (TTS)
 *   - USER_TRANSCRIPTION     →  fired when the user speaks
 *   - AVATAR_SPEAK_ENDED     →  fired when avatar finishes speaking
 *
 * Flow:
 *   STREAM_READY → avatar speaks opener → AVATAR_SPEAK_ENDED → mic on
 *   → user speaks → USER_TRANSCRIPTION → backend → session.message → cycle
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
let micOn          = false;
let avatarSpeaking = false;
let streamReady    = false;
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
// Overlay
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
// Transcript
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
async function postTranscript(speaker, text) {
  try {
    await fetch(`/api/transcript/${SESSION_ID}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ speaker, text }),
    });
  } catch (_) {}
}

// ---------------------------------------------------------------------------
// Mic UI (SDK handles actual mic; this just updates the button)
// ---------------------------------------------------------------------------
function setMicOn(on) {
  micOn = on;
  micBtn.innerHTML = on
    ? `<svg width="16" height="16" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.3"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="23"/><line x1="8" y1="23" x2="16" y2="23"/></svg> Mic On`
    : `<svg width="16" height="16" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.3"><line x1="1" y1="1" x2="23" y2="23"/><path d="M9 9v3a3 3 0 0 0 5.12 2.12M15 9.34V4a3 3 0 0 0-5.94-.6"/><path d="M17 16.95A7 7 0 0 1 5 12v-2m14 0v2"/><line x1="12" y1="19" x2="12" y2="23"/><line x1="8" y1="23" x2="16" y2="23"/></svg> Mic Off`;
  micBtn.className = on ? "btn is-on" : "";
}

function sdkStartListening() {
  if (!avatarSession || !window.__sessionLive) return;
  try { avatarSession.startListening(); } catch (_) {}
  setMicOn(true);
}
function sdkStopListening() {
  if (!avatarSession) return;
  try { avatarSession.stopListening(); } catch (_) {}
  setMicOn(false);
}

// ---------------------------------------------------------------------------
// Core: fetch response from backend, speak it through avatar
// ---------------------------------------------------------------------------
async function fetchAndSpeakResponse(userText) {
  if (!avatarSession || !streamReady) return;

  // Set speaking flag BEFORE stopping mic — the flag gates USER_TRANSCRIPTION
  avatarSpeaking = true;
  sdkStopListening();

  let responseText = "";
  try {
    const res = await fetch("/api/respond", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ session_id: SESSION_ID, text: userText }),
    });
    if (!res.ok) throw new Error(`respond ${res.status}`);
    const data = await res.json();
    if (!data.text) throw new Error("empty response");
    responseText = data.text;
  } catch (err) {
    console.error("fetchAndSpeakResponse:", err);
    avatarSpeaking = false;
    sdkStartListening();
    return;
  }

  // Show in transcript
  appendBubble("avatar", responseText);
  postTranscript("avatar", responseText);

  // Small delay to let the audio pipeline settle after stopListening()
  await new Promise(r => setTimeout(r, 300));

  // Have avatar speak it (voiceChat:true makes this pure TTS)
  try {
    avatarSession.message(responseText);
  } catch (err) {
    console.error("avatarSession.message() failed:", err);
  }

  // Fallback: re-enable mic if AVATAR_SPEAK_ENDED never fires
  const words   = responseText.split(/\s+/).length;
  const speakMs = Math.max(words * 600, 4000);
  setTimeout(() => {
    if (avatarSpeaking) {
      avatarSpeaking = false;
      sdkStartListening();
    }
  }, speakMs);
}

// ---------------------------------------------------------------------------
// Start session
// ---------------------------------------------------------------------------
async function startSession() {
  showOverlay("", "", "Connecting to avatar…", true);

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

  try {
    // voiceChat:true → session.message() is TTS, USER_TRANSCRIPTION fires on speech
    avatarSession = new LiveAvatarSession(sessionToken, { voiceChat: true });

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

      // Avatar speaks first — mic stays off until it finishes
      setMicOn(false);
      await fetchAndSpeakResponse(""); // empty = request opener
    });

    // When the user speaks and the SDK transcribes it
    avatarSession.on(AgentEventsEnum.USER_TRANSCRIPTION, async (evt) => {
      // Ignore if we're speaking — prevents echo from avatar audio
      if (avatarSpeaking) return;

      const text = (evt.text || "").trim();
      if (!text) return;

      appendBubble("user", text);
      postTranscript("user", text);
      await fetchAndSpeakResponse(text);
    });

    // Re-enable mic when avatar finishes speaking
    avatarSession.on(AgentEventsEnum.AVATAR_SPEAK_ENDED, () => {
      avatarSpeaking = false;
      sdkStartListening();
    });

    avatarSession.on(AgentEventsEnum.SESSION_STOPPED, () => handleSessionEnd());

    await avatarSession.start();
    // Do NOT call startListening here — avatar speaks opener first.
    // sdkStartListening() is triggered by AVATAR_SPEAK_ENDED.

  } catch (err) {
    showOverlay("⚠️", "Session error", `Failed to start.<br><small>${err.message}</small>`);
    startBtn.style.display = "inline-flex";
    avatarSession = null;
    window.__sessionLive = false;
  }
}

// ---------------------------------------------------------------------------
// Manual mic toggle
// ---------------------------------------------------------------------------
function toggleMic() {
  if (!window.__sessionLive || avatarSpeaking) return;
  if (micOn) {
    sdkStopListening();
  } else {
    sdkStartListening();
  }
}

// ---------------------------------------------------------------------------
// Interrupt
// ---------------------------------------------------------------------------
function interruptAvatar() {
  if (!avatarSession) return;
  try { avatarSession.interrupt(); } catch (_) {}
  avatarSpeaking = false;
  sdkStartListening();
}

// ---------------------------------------------------------------------------
// End session
// ---------------------------------------------------------------------------
async function endSession() {
  if (!avatarSession) return;
  clearInterval(timerInterval);
  window.__sessionLive = false;
  sdkStopListening();
  showOverlay("⏳", "Generating your analysis…", "Hang tight. Scoring your session against the rubric.", true);
  try { await avatarSession.stop(); } catch (_) {}
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
    if (data.redirect_url) window.location.href = data.redirect_url;
  } catch (err) {
    showOverlay("⚠️", "Analysis error", `${err.message}`);
  }
}

// ---------------------------------------------------------------------------
// Event bridge
// ---------------------------------------------------------------------------
window.addEventListener("bt:start",     () => startSession());
window.addEventListener("bt:toggleMic", () => toggleMic());
window.addEventListener("bt:interrupt", () => interruptAvatar());
window.addEventListener("bt:end",       () => {
  if (confirm("End the session and see your results?")) endSession();
});

window.addEventListener("keydown", (e) => {
  if (e.code === "Space" && e.target === document.body && window.__sessionLive) {
    e.preventDefault(); toggleMic();
  }
  if (e.code === "Escape" && window.__sessionLive) interruptAvatar();
});
