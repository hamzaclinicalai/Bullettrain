/**
 * BulletTrain.ai - simulation runner
 *
 * Architecture:
 *   - SDK (no voiceChat): pure avatar renderer + TTS via session.repeat()
 *   - Web Speech API: user mic — we start/stop it ourselves, so the mic
 *     is ONLY active when it's the user's turn to speak
 *
 * Flow:
 *   STREAM_READY → avatar speaks opener → fallback timer → mic on
 *   → user speaks → onresult → backend → repeat() → cycle
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
let avatarSpeaking = false;
let streamReady    = false;
let connectedFired = false;
let micOn          = false;
let timerInterval  = null;
let elapsedSeconds = 0;

window.__sessionLive = false;

// ---------------------------------------------------------------------------
// Web Speech API — we own the mic completely
// ---------------------------------------------------------------------------
const SpeechRecognitionAPI = window.SpeechRecognition || window.webkitSpeechRecognition;
let recognition = null;
let recognizing = false;

function initRecognition() {
  if (!SpeechRecognitionAPI) {
    console.warn("[mic] Web Speech API not available in this browser/context");
    return;
  }
  recognition = new SpeechRecognitionAPI();
  recognition.continuous     = false; // fires onresult then stops; we restart manually
  recognition.interimResults = false;
  recognition.lang           = "en-US";

  recognition.onresult = async (event) => {
    if (avatarSpeaking) return;
    const text = (event.results[0]?.[0]?.transcript || "").trim();
    if (!text) return;
    recognizing = false;
    console.log("[USER]", text);
    appendBubble("user", text);
    postTranscript("user", text);
    await fetchAndSpeakResponse(text);
  };

  recognition.onend = () => {
    recognizing = false;
    // Auto-restart so the user doesn't have to re-tap after each sentence
    if (micOn && !avatarSpeaking && window.__sessionLive) {
      _restartRecognition();
    }
  };

  recognition.onerror = (e) => {
    recognizing = false;
    if (e.error !== "no-speech") console.warn("[mic] recognition error:", e.error);
    if (micOn && !avatarSpeaking && window.__sessionLive) {
      setTimeout(_restartRecognition, 300);
    }
  };
}

function _restartRecognition() {
  if (!recognition || recognizing || avatarSpeaking || !window.__sessionLive) return;
  try { recognition.start(); recognizing = true; } catch (_) {}
}

function openMic() {
  if (!window.__sessionLive || avatarSpeaking) return;
  setMicOn(true);
  _restartRecognition();
}

function closeMic() {
  setMicOn(false);
  if (!recognition || !recognizing) return;
  try { recognition.stop(); } catch (_) {}
  recognizing = false;
}

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
// Mic button UI
// ---------------------------------------------------------------------------
function setMicOn(on) {
  micOn = on;
  micBtn.innerHTML = on
    ? `<svg width="16" height="16" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.3"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="23"/><line x1="8" y1="23" x2="16" y2="23"/></svg> Mic On`
    : `<svg width="16" height="16" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.3"><line x1="1" y1="1" x2="23" y2="23"/><path d="M9 9v3a3 3 0 0 0 5.12 2.12M15 9.34V4a3 3 0 0 0-5.94-.6"/><path d="M17 16.95A7 7 0 0 1 5 12v-2m14 0v2"/><line x1="12" y1="19" x2="12" y2="23"/><line x1="8" y1="23" x2="16" y2="23"/></svg> Mic Off`;
  micBtn.className = on ? "btn is-on" : "";
}

// ---------------------------------------------------------------------------
// TTS — repeat() speaks verbatim, message() is AI-response path (avoid)
// ---------------------------------------------------------------------------
function avatarSpeak(text) {
  if (!avatarSession) return;
  if (typeof avatarSession.repeat === "function") {
    try { avatarSession.repeat(text); console.log("[TTS] repeat()"); return; }
    catch (e) { console.warn("[TTS] repeat() failed:", e); }
  }
  try { avatarSession.message(text); console.log("[TTS] message() fallback"); }
  catch (e) { console.error("[TTS] all speak methods failed:", e); }
}

// ---------------------------------------------------------------------------
// Core: fetch response, close mic, speak, reopen mic when done
// ---------------------------------------------------------------------------
async function fetchAndSpeakResponse(userText) {
  if (!avatarSession || !streamReady) return;

  avatarSpeaking = true;
  closeMic(); // hard-stop mic immediately

  let responseText = "";
  try {
    const res = await fetch("/api/respond", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ session_id: SESSION_ID, text: userText }),
    });
    if (!res.ok) {
      const errData = await res.json().catch(() => ({}));
      const msg = errData.error || `Server error (${res.status})`;
      if (msg.includes("AI backends failed") || res.status === 500) {
        showOverlay("⚠️", "AI not configured", "No Gemini API key found. Add GEMINI_API_KEY to your .env file and restart the server.");
        return;
      }
      throw new Error(msg);
    }
    const data = await res.json();
    if (!data.text) throw new Error("empty response");
    responseText = data.text;
  } catch (err) {
    console.error("fetchAndSpeakResponse:", err);
    avatarSpeaking = false;
    openMic();
    return;
  }

  appendBubble("avatar", responseText);
  postTranscript("avatar", responseText);

  await new Promise(r => setTimeout(r, 400));
  avatarSpeak(responseText);

  // Re-open mic after estimated TTS duration + settle buffer.
  // AVATAR_SPEAK_ENDED (if it fires) will also trigger openMic below.
  const words   = responseText.split(/\s+/).length;
  const speakMs = Math.max(words * 750, 5000) + 1000;
  setTimeout(() => {
    if (avatarSpeaking) {
      console.log("[TTS] timer: opening mic");
      avatarSpeaking = false;
      openMic();
    }
  }, speakMs);
}

// ---------------------------------------------------------------------------
// Start session
// ---------------------------------------------------------------------------
async function startSession() {
  initRecognition();
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
    // No voiceChat: SDK is a pure avatar renderer.
    // We own the mic via Web Speech API.
    avatarSession = new LiveAvatarSession(sessionToken);

    avatarSession.on(SessionEvent.SESSION_STATE_CHANGED, (state) => {
      console.log("[SDK] state:", state);
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
      console.log("[SDK] STREAM_READY");
      avatarSession.attach(videoEl);
      videoEl.play().catch(() => {});
      streamReady = true;

      // Wait for CONNECTED if it hasn't fired yet
      let waited = 0;
      while (!connectedFired && waited < 3000) {
        await new Promise(r => setTimeout(r, 100));
        waited += 100;
      }

      closeMic();
      await fetchAndSpeakResponse(""); // request opener
    });

    // AVATAR_SPEAK_ENDED fires when TTS completes — use it to open mic early
    // if the timer hasn't already done so.
    avatarSession.on(AgentEventsEnum.AVATAR_SPEAK_ENDED, () => {
      console.log("[SDK] AVATAR_SPEAK_ENDED");
      if (!avatarSpeaking) return; // timer already handled it
      avatarSpeaking = false;
      // Brief pause so the last audio frame clears before mic opens
      setTimeout(() => { if (!avatarSpeaking) openMic(); }, 800);
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
  if (micOn) { closeMic(); } else { openMic(); }
}

// ---------------------------------------------------------------------------
// Interrupt
// ---------------------------------------------------------------------------
function interruptAvatar() {
  if (!avatarSession) return;
  try { avatarSession.interrupt(); } catch (_) {}
  avatarSpeaking = false;
  openMic();
}

// ---------------------------------------------------------------------------
// End session
// ---------------------------------------------------------------------------
async function endSession() {
  if (!avatarSession) return;
  clearInterval(timerInterval);
  window.__sessionLive = false;
  closeMic();
  showOverlay("⏳", "Generating your analysis…", "Hang tight. Scoring your session against the rubric.", true);
  try { await avatarSession.stop(); } catch (_) {}
  avatarSession = null;
  await generateAnalysis();
}

async function handleSessionEnd() {
  if (!window.__sessionLive) return;
  clearInterval(timerInterval);
  window.__sessionLive = false;
  closeMic();
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
