/**
 * BulletTrain.ai - simulation runner
 *
 * Architecture:
 *   - voiceChat:true  → SDK handles mic → transcription → USER_TRANSCRIPTION events
 *   - Our backend     → generates what the avatar should say
 *   - session.repeat(text) → avatar speaks text verbatim (pure TTS, no AI response)
 *
 * Flow:
 *   STREAM_READY → avatar speaks opener via repeat() → AVATAR_SPEAK_ENDED → mic on
 *   → user speaks → USER_TRANSCRIPTION → backend → session.repeat() → cycle
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
let connectedFired = false;
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
// Mic
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
  setMicOn(true); // update UI immediately so the button feels instant
  try { avatarSession.startListening(); } catch (e) {
    console.warn("startListening:", e);
    setMicOn(false); // revert if SDK rejected it
  }
}
function sdkStopListening() {
  if (!avatarSession) return;
  setMicOn(false); // update UI immediately
  try { avatarSession.stopListening(); } catch (_) {}
}

// ---------------------------------------------------------------------------
// TTS: make the avatar speak text verbatim
// Tries repeat() first (pure TTS), falls back to message() if unavailable.
// ---------------------------------------------------------------------------
function avatarSpeak(text) {
  if (!avatarSession) return;
  // repeat() = pure TTS, no AI response generated
  // message() = routed through avatar's built-in AI (wrong for our use case)
  if (typeof avatarSession.repeat === "function") {
    try {
      avatarSession.repeat(text);
      console.log("[TTS] repeat() called");
      return;
    } catch (e) {
      console.warn("[TTS] repeat() failed:", e);
    }
  }
  // Fallback — try message() in case repeat() is unavailable in this SDK version
  try {
    avatarSession.message(text);
    console.log("[TTS] message() fallback called");
  } catch (e) {
    console.error("[TTS] both speak methods failed:", e);
  }
}

// ---------------------------------------------------------------------------
// Core: fetch response from backend, then have avatar speak it
// ---------------------------------------------------------------------------
async function fetchAndSpeakResponse(userText) {
  if (!avatarSession || !streamReady) return;

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

  appendBubble("avatar", responseText);
  postTranscript("avatar", responseText);

  // Let the audio pipeline settle after stopListening before speaking
  await new Promise(r => setTimeout(r, 400));

  avatarSpeak(responseText);

  // Safety fallback: re-enable mic if AVATAR_SPEAK_ENDED never fires.
  // Use a generous estimate (750ms/word) so we don't cut in while the avatar
  // is still talking on longer responses.
  const words   = responseText.split(/\s+/).length;
  const speakMs = Math.max(words * 750, 6000) + 700; // +700 for the settle delay
  setTimeout(() => {
    if (avatarSpeaking) {
      console.warn("[TTS] AVATAR_SPEAK_ENDED never fired — re-enabling mic via fallback");
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
    // voiceChat:true keeps USER_TRANSCRIPTION events firing so we hear the user.
    // We bypass the avatar's built-in AI by using repeat() instead of message().
    avatarSession = new LiveAvatarSession(sessionToken, { voiceChat: true });

    avatarSession.on(SessionEvent.SESSION_STATE_CHANGED, (state) => {
      console.log("[SDK] SESSION_STATE_CHANGED:", state);
      if (state === SessionState.CONNECTED) {
        hideOverlay();
        controls.style.display = "flex";
        window.__sessionLive = true;
        connectedFired = true;
        startTimer();
      }
      if (state === SessionState.DISCONNECTED || state === SessionState.DISCONNECTING) {
        window.__sessionLive = false;
        handleSessionEnd();
      }
    });

    avatarSession.on(SessionEvent.SESSION_STREAM_READY, async () => {
      console.log("[SDK] SESSION_STREAM_READY");
      avatarSession.attach(videoEl);
      videoEl.play().catch(() => {});
      streamReady = true;

      // Wait for CONNECTED to fire if it hasn't yet (STREAM_READY can precede it)
      let waited = 0;
      while (!connectedFired && waited < 3000) {
        await new Promise(r => setTimeout(r, 100));
        waited += 100;
      }

      // Avatar speaks the opening line — mic stays off until it finishes
      setMicOn(false);
      await fetchAndSpeakResponse(""); // empty string = request opener
    });

    avatarSession.on(AgentEventsEnum.USER_TRANSCRIPTION, async (evt) => {
      if (avatarSpeaking) return; // ignore mic pickup while avatar is speaking

      const text = (evt.text || "").trim();
      if (!text) return;

      console.log("[USER]", text);
      appendBubble("user", text);
      postTranscript("user", text);
      await fetchAndSpeakResponse(text);
    });

    avatarSession.on(AgentEventsEnum.AVATAR_SPEAK_ENDED, () => {
      console.log("[SDK] AVATAR_SPEAK_ENDED");
      avatarSpeaking = false;
      // Delay opening the mic so avatar echo/reverb dissipates first.
      // Also re-check avatarSpeaking in case a new response already started.
      setTimeout(() => {
        if (!avatarSpeaking) sdkStartListening();
      }, 700);
    });

    avatarSession.on(AgentEventsEnum.SESSION_STOPPED, () => handleSessionEnd());

    await avatarSession.start();

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
