"""
BulletTrain.ai - Enterprise Training Demo Platform
---------------------------------------------------
A Flask demo showcasing interactive avatar-powered training simulations
for franchises and enterprise teams. Powered by LiveAvatar.com.
"""
import os
import json
import time
import uuid
from datetime import datetime

import requests
from flask import (
    Flask,
    render_template,
    request,
    jsonify,
    abort,
    redirect,
    url_for,
    session as flask_session,
)


# ---------------------------------------------------------------------------
# Hard-coded LiveAvatar credentials (demo only).
# ---------------------------------------------------------------------------
LIVEAVATAR_API_KEY = "a999720b-05d8-11f1-a99e-066a7fa2e369"
LIVEAVATAR_AVATAR_ID = "075abc67-2fae-4548-8ca9-b815fcbd34c7"
LIVEAVATAR_API_BASE = "https://api.liveavatar.com"


app = Flask(__name__)
app.secret_key = os.environ.get("FLASK_SECRET_KEY", "bullettrain-demo-secret")


# ---------------------------------------------------------------------------
# Simulation catalog
# ---------------------------------------------------------------------------
SIMULATIONS = [
    {
        "id": "qsr-customer-recovery",
        "industry": "Quick Service Restaurant",
        "title": "Customer Recovery at the Counter",
        "tagline": "De-escalate a frustrated guest and rescue the visit.",
        "duration": "8–12 min",
        "difficulty": "Foundational",
        "color": "#FF6B4A",
        "summary": (
            "A regular customer received the wrong order and is upset at the front "
            "counter during a lunch rush. Your job is to listen, acknowledge, and "
            "resolve the issue while protecting service times for other guests."
        ),
        "objectives": [
            "Greet the guest and acknowledge the issue without becoming defensive",
            "Use a structured recovery: Apologize, Act, Appreciate",
            "Offer a remedy aligned to brand standards",
            "Capture the feedback and close the loop with the guest",
        ],
        "persona": {
            "name": "Dana Whitman",
            "role": "Frustrated regular at lunchtime",
            "voice_tone": "warm but firm",
        },
        "skills": ["Active listening", "Service recovery", "Brand voice"],
    },
    {
        "id": "fitness-membership-objections",
        "industry": "Fitness Franchise",
        "title": "Closing the New Member Tour",
        "tagline": "Convert a tour into a paid membership without pressure.",
        "duration": "10–15 min",
        "difficulty": "Intermediate",
        "color": "#3B82F6",
        "summary": (
            "A prospect just finished a club tour. They're interested but raise "
            "objections about price and time commitment. Practice consultative "
            "selling that aligns the program to their goals."
        ),
        "objectives": [
            "Discover the prospect's underlying motivation",
            "Address pricing objections with value framing",
            "Recommend the right tier and present terms clearly",
            "Ask for the membership and confirm the start date",
        ],
        "persona": {
            "name": "Alex Park",
            "role": "First-time gym shopper, busy professional",
            "voice_tone": "skeptical, time-pressed",
        },
        "skills": ["Discovery", "Objection handling", "Closing"],
    },
    {
        "id": "hospitality-guest-checkin",
        "industry": "Hospitality Franchise",
        "title": "VIP Guest Check-In Recovery",
        "tagline": "Handle a botched reservation for a loyalty member.",
        "duration": "6–10 min",
        "difficulty": "Foundational",
        "color": "#0EA5A4",
        "summary": (
            "A platinum-tier loyalty guest has arrived after a long flight to find "
            "their pre-paid suite oversold. You have 60 seconds of attention before "
            "this becomes a public escalation. Recover the moment."
        ),
        "objectives": [
            "Acknowledge tier status and the inconvenience immediately",
            "Offer concrete alternatives within authority",
            "Document the recovery in line with brand standards",
            "Re-establish trust before the guest leaves the desk",
        ],
        "persona": {
            "name": "Marcus Reyes",
            "role": "Tired platinum-tier business traveler",
            "voice_tone": "exhausted, escalating",
        },
        "skills": ["Empathy", "Authority limits", "Loyalty recovery"],
    },
    {
        "id": "auto-service-advisor",
        "industry": "Automotive Franchise",
        "title": "Service Advisor Up-Sell",
        "tagline": "Recommend additional service without breaking trust.",
        "duration": "10–14 min",
        "difficulty": "Advanced",
        "color": "#8B5CF6",
        "summary": (
            "A customer came in for an oil change. The technician flagged worn "
            "brake pads and a leaking gasket. Communicate findings, prioritize "
            "safety, and close the additional work — ethically."
        ),
        "objectives": [
            "Translate technical findings into customer language",
            "Distinguish safety-critical vs. recommended work",
            "Present pricing with transparent options",
            "Close the work order and schedule any follow-ups",
        ],
        "persona": {
            "name": "Priya Shah",
            "role": "Cost-conscious owner of a 6-year-old SUV",
            "voice_tone": "wary of being up-sold",
        },
        "skills": ["Technical translation", "Trust building", "Ethical sales"],
    },
    {
        "id": "retail-shrink-conversation",
        "industry": "Retail Franchise",
        "title": "Coaching a Shift Lead on Shrink",
        "tagline": "Manager-to-lead coaching conversation about losses.",
        "duration": "12–18 min",
        "difficulty": "Advanced",
        "color": "#F59E0B",
        "summary": (
            "Your store's shrink is up 30% this quarter. You need to coach your "
            "shift lead — without micromanaging — to identify root causes and "
            "agree on a 30-day improvement plan."
        ),
        "objectives": [
            "Open the coaching conversation with shared context",
            "Use open questions to surface the lead's hypotheses",
            "Co-create a 30-day action plan with measurable checkpoints",
            "Confirm commitment and a follow-up cadence",
        ],
        "persona": {
            "name": "Jordan Blake",
            "role": "Defensive shift lead, 2 years tenure",
            "voice_tone": "guarded, occasionally dismissive",
        },
        "skills": ["Coaching", "Performance conversations", "Accountability"],
    },
    {
        "id": "healthcare-intake",
        "industry": "Healthcare Franchise",
        "title": "Compassionate Patient Intake",
        "tagline": "Conduct intake for an anxious first-time patient.",
        "duration": "8–12 min",
        "difficulty": "Intermediate",
        "color": "#EC4899",
        "summary": (
            "A first-time patient is visibly anxious about a new diagnostic visit. "
            "Complete intake while protecting privacy, surfacing concerns, and "
            "preparing them for the clinician."
        ),
        "objectives": [
            "Establish psychological safety in the first 30 seconds",
            "Collect required intake data without sounding scripted",
            "Surface clinically relevant concerns to flag for the provider",
            "Hand off to the clinician with a clean summary",
        ],
        "persona": {
            "name": "Sam Carter",
            "role": "Anxious first-time patient",
            "voice_tone": "nervous, soft-spoken",
        },
        "skills": ["Bedside manner", "HIPAA-aware intake", "Hand-off"],
    },
]

SIMULATION_BY_ID = {s["id"]: s for s in SIMULATIONS}


# ---------------------------------------------------------------------------
# In-memory transcript store (demo only — would be a real DB in production)
# ---------------------------------------------------------------------------
SESSION_STORE = {}


def build_system_prompt(simulation, mode):
    """Construct the persona prompt for the avatar in this simulation."""
    persona = simulation["persona"]
    objectives = "\n".join(f"- {o}" for o in simulation["objectives"])
    mode_text = (
        "This is PRACTICE mode. You may give the trainee gentle hints if they get "
        "stuck for more than ~15 seconds, while still staying in character."
        if mode == "practice"
        else "This is TEST mode. Stay fully in character. Do not break the fourth wall."
    )
    return (
        f"You are {persona['name']}, a {persona['role']}. "
        f"Your tone is {persona['voice_tone']}. "
        f"You are a roleplay character in a workforce training simulation titled "
        f"'{simulation['title']}' for {simulation['industry']}. "
        f"Scenario context: {simulation['summary']} "
        f"The trainee will be evaluated on:\n{objectives}\n"
        f"{mode_text}"
    )


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------
@app.route("/")
def index():
    return render_template(
        "index.html",
        simulations=SIMULATIONS[:3],
        total_simulations=len(SIMULATIONS),
    )


@app.route("/platform")
def platform():
    return render_template("platform.html")


@app.route("/simulations")
def simulations():
    return render_template("simulations.html", simulations=SIMULATIONS)


@app.route("/simulations/<sim_id>")
def simulation_detail(sim_id):
    simulation = SIMULATION_BY_ID.get(sim_id)
    if not simulation:
        abort(404)
    return render_template("simulation_detail.html", simulation=simulation)


@app.route("/simulations/<sim_id>/<mode>")
def simulation_run(sim_id, mode):
    if mode not in ("practice", "test"):
        abort(404)
    simulation = SIMULATION_BY_ID.get(sim_id)
    if not simulation:
        abort(404)
    session_id = uuid.uuid4().hex
    SESSION_STORE[session_id] = {
        "simulation_id": sim_id,
        "mode": mode,
        "started_at": datetime.utcnow().isoformat() + "Z",
        "transcript": [],
        "ended_at": None,
    }
    return render_template(
        "simulation_run.html",
        simulation=simulation,
        mode=mode,
        session_id=session_id,
    )


@app.route("/results/<session_id>")
def results(session_id):
    record = SESSION_STORE.get(session_id)
    if not record:
        abort(404)
    simulation = SIMULATION_BY_ID.get(record["simulation_id"])
    return render_template(
        "results.html",
        record=record,
        simulation=simulation,
        session_id=session_id,
    )


# ---------------------------------------------------------------------------
# JSON API
# ---------------------------------------------------------------------------
@app.post("/api/session-token")
def create_session_token():
    """Exchange the hard-coded API key + avatar ID for a LiveAvatar session token."""
    body = request.get_json(silent=True) or {}
    sim_id = body.get("simulation_id")
    mode = body.get("mode", "practice")
    simulation = SIMULATION_BY_ID.get(sim_id) if sim_id else None

    persona_context = ""
    if simulation:
        persona_context = build_system_prompt(simulation, mode)

    payload = {
        "avatar_id": LIVEAVATAR_AVATAR_ID,
        "mode": "FULL",
    }
    if persona_context:
        payload["avatar_persona"] = {"context": persona_context}

    try:
        resp = requests.post(
            f"{LIVEAVATAR_API_BASE}/v1/sessions/token",
            headers={
                "X-API-KEY": LIVEAVATAR_API_KEY,
                "Content-Type": "application/json",
                "Accept": "application/json",
            },
            json=payload,
            timeout=20,
        )
    except requests.RequestException as exc:
        return jsonify({"error": f"network_error: {exc}"}), 502

    if not resp.ok:
        return (
            jsonify(
                {
                    "error": "liveavatar_error",
                    "status": resp.status_code,
                    "detail": resp.text,
                }
            ),
            resp.status_code,
        )

    data = resp.json()
    payload_data = data.get("data") if isinstance(data, dict) else None
    if not payload_data or "session_token" not in payload_data:
        return jsonify({"error": "unexpected_response", "detail": data}), 502

    return jsonify(
        {
            "session_token": payload_data["session_token"],
            "avatar_id": LIVEAVATAR_AVATAR_ID,
        }
    )


@app.post("/api/transcript/<session_id>")
def append_transcript(session_id):
    record = SESSION_STORE.get(session_id)
    if not record:
        return jsonify({"error": "unknown_session"}), 404
    body = request.get_json(silent=True) or {}
    speaker = body.get("speaker")
    text = body.get("text", "").strip()
    if speaker not in ("user", "avatar") or not text:
        return jsonify({"error": "bad_payload"}), 400
    record["transcript"].append(
        {
            "speaker": speaker,
            "text": text,
            "ts": time.time(),
        }
    )
    return jsonify({"ok": True, "count": len(record["transcript"])})


@app.post("/api/analyze/<session_id>")
def analyze(session_id):
    record = SESSION_STORE.get(session_id)
    if not record:
        return jsonify({"error": "unknown_session"}), 404
    record["ended_at"] = datetime.utcnow().isoformat() + "Z"
    simulation = SIMULATION_BY_ID.get(record["simulation_id"])
    analysis = generate_analysis(record, simulation)
    record["analysis"] = analysis
    return jsonify({"ok": True, "redirect_url": url_for("results", session_id=session_id)})


# ---------------------------------------------------------------------------
# Lightweight rule-based analysis (demo stand-in for an LLM grader).
# ---------------------------------------------------------------------------
def generate_analysis(record, simulation):
    transcript = record["transcript"]
    user_turns = [t for t in transcript if t["speaker"] == "user"]
    avatar_turns = [t for t in transcript if t["speaker"] == "avatar"]
    user_words = sum(len(t["text"].split()) for t in user_turns)
    avatar_words = sum(len(t["text"].split()) for t in avatar_turns)
    duration_s = 0
    if transcript:
        duration_s = int(transcript[-1]["ts"] - transcript[0]["ts"])

    rubric = []
    for objective in simulation["objectives"]:
        keywords = _keywords(objective)
        joined = " ".join(t["text"].lower() for t in user_turns)
        hits = sum(1 for k in keywords if k in joined)
        coverage = min(1.0, hits / max(1, len(keywords)))
        score = int(50 + coverage * 50)
        evidence = _find_evidence(user_turns, keywords)
        rubric.append(
            {
                "objective": objective,
                "score": score,
                "coverage": coverage,
                "evidence": evidence,
                "tip": _coaching_tip(objective, coverage),
            }
        )
    overall = int(sum(r["score"] for r in rubric) / max(1, len(rubric))) if rubric else 0
    talk_ratio = user_words / max(1, user_words + avatar_words)

    summary = _build_summary(simulation, overall, talk_ratio, duration_s)

    return {
        "overall_score": overall,
        "talk_ratio": round(talk_ratio, 2),
        "user_words": user_words,
        "avatar_words": avatar_words,
        "duration_s": duration_s,
        "rubric": rubric,
        "summary": summary,
        "strengths": _strengths(rubric),
        "growth_areas": _growth_areas(rubric),
    }


def _keywords(objective):
    stop = {
        "the", "a", "an", "to", "and", "or", "of", "in", "on", "with", "without",
        "for", "is", "be", "are", "use", "without", "into", "without", "the",
    }
    words = [w.strip(",.;:()").lower() for w in objective.split()]
    return [w for w in words if w and w not in stop and len(w) > 3][:6]


def _find_evidence(user_turns, keywords):
    for turn in user_turns:
        text_l = turn["text"].lower()
        if any(k in text_l for k in keywords):
            return turn["text"][:240]
    return None


def _coaching_tip(objective, coverage):
    if coverage > 0.6:
        return "Strong coverage — keep this in your default playbook."
    if coverage > 0.3:
        return "Partial coverage — name the action explicitly next time."
    return "Missed in this run — open the next attempt by addressing this directly."


def _build_summary(simulation, overall, talk_ratio, duration_s):
    rating = "Exceeds expectations" if overall >= 85 else (
        "On track" if overall >= 70 else (
            "Developing" if overall >= 55 else "Needs reps"
        )
    )
    talk_note = (
        "balanced talk-time" if 0.4 <= talk_ratio <= 0.6 else (
            "you dominated airtime — leave room for the other party" if talk_ratio > 0.6
            else "you spoke less than the avatar — drive the conversation more"
        )
    )
    minutes = duration_s // 60
    seconds = duration_s % 60
    return (
        f"{rating} on '{simulation['title']}'. "
        f"Session ran {minutes}m {seconds:02d}s with {talk_note}."
    )


def _strengths(rubric):
    return [r["objective"] for r in sorted(rubric, key=lambda r: -r["score"])[:2]]


def _growth_areas(rubric):
    return [r["objective"] for r in sorted(rubric, key=lambda r: r["score"])[:2]]


# ---------------------------------------------------------------------------
# Health check & misc
# ---------------------------------------------------------------------------
@app.get("/healthz")
def healthz():
    return jsonify({"status": "ok"})


@app.errorhandler(404)
def not_found(_):
    return render_template("404.html"), 404


if __name__ == "__main__":
    port = int(os.environ.get("PORT", "5000"))
    app.run(host="0.0.0.0", port=port, debug=True)
