"""
BulletTrain.ai - Enterprise Training Demo Platform
---------------------------------------------------
A Flask demo showcasing interactive avatar-powered training simulations
for franchises and enterprise teams. Powered by LiveAvatar.com.
"""
import os
import json
import re
import time
import uuid
from datetime import datetime, timezone

from dotenv import load_dotenv
load_dotenv()

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
# Hard-coded credentials (demo only).
# ---------------------------------------------------------------------------
LIVEAVATAR_API_KEY = "a999720b-05d8-11f1-a99e-066a7fa2e369"
LIVEAVATAR_AVATAR_ID = "075abc67-2fae-4548-8ca9-b815fcbd34c7"
LIVEAVATAR_API_BASE = "https://api.liveavatar.com"

GEMINI_API_KEY = os.environ.get("GEMINI_API_KEY", "")
GEMINI_MODEL   = "gemini-2.5-flash"

# Passcode that unlocks the simulation library / runs.
# Change via the SIMULATION_PASSCODE environment variable.
SIMULATION_PASSCODE = os.environ.get("SIMULATION_PASSCODE", "BULLETTRAIN2026")
DISCOVERY_CALL_URL  = "https://calendar.app.google/k1hf9GhZnoPq4A1DA"


app = Flask(__name__)
app.secret_key = os.environ.get("FLASK_SECRET_KEY", "bullettrain-demo-secret")


@app.context_processor
def inject_globals():
    logo_png_path = os.path.join(app.static_folder, "img", "logo-icon.png")
    return {
        "current_year": datetime.utcnow().year,
        "has_logo_png": os.path.isfile(logo_png_path),
    }


# ---------------------------------------------------------------------------
# Simulation catalog
# ---------------------------------------------------------------------------
SIMULATIONS = [
    {
        "id": "qsr-customer-recovery",
        "avatar_id": "5dd4d830-957a-419f-9334-0dc4399ada5d",
        "industry": "Fast Food Franchise",
        "title": "Customer Recovery at the Counter",
        "tagline": "De-escalate a frustrated guest and rescue the visit.",
        "duration": "8-12 min",
        "difficulty": "Foundational",
        "color": "#FF6B4A",
        "summary": (
            "A regular customer received the wrong order and is upset at the front "
            "counter during a lunch rush. Your job is to listen, acknowledge, and "
            "resolve the issue while protecting service times for other guests."
        ),
        "avatar_context": (
            "You are Dana Whitman. You came in for a quick lunch and ordered a grilled "
            "chicken wrap, but they gave you a burger. Again. This is the third time "
            "this month. You only have 20 minutes left on your break and you are "
            "genuinely frustrated. You already know exactly what the problem is - you "
            "do NOT need anyone to explain it to you. You want the right food and some "
            "acknowledgment that this keeps happening. React to whatever the staff member "
            "says to you."
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
        "avatar_id": "55eec60c-d665-4972-a529-bbdcaf665ab8",
        "industry": "Fitness Franchise",
        "title": "Closing the New Member Tour",
        "tagline": "Convert a tour into a paid membership without pressure.",
        "duration": "10-15 min",
        "difficulty": "Intermediate",
        "color": "#3B82F6",
        "summary": (
            "A prospect just finished a club tour. They're interested but raise "
            "objections about price and time commitment. Practice consultative "
            "selling that aligns the program to their goals."
        ),
        "avatar_context": (
            "You are Alex Park. You just finished a tour of this gym and it looks "
            "decent, but you are a busy professional and you are skeptical about "
            "committing to a monthly fee this size. You have real doubts about whether "
            "you'll actually use it enough to justify the cost. You are not rude, but "
            "you are not easily sold. React to what the membership advisor says to you."
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
        "avatar_id": "7b888024-f8c9-4205-95e1-78ce01497bda",
        "industry": "Hospitality Franchise",
        "title": "VIP Guest Check-In Recovery",
        "tagline": "Handle a botched reservation for a loyalty member.",
        "duration": "6-10 min",
        "difficulty": "Foundational",
        "color": "#0EA5A4",
        "summary": (
            "A platinum-tier loyalty guest has arrived after a long flight to find "
            "their pre-paid suite oversold. You have 60 seconds of attention before "
            "this becomes a public escalation. Recover the moment."
        ),
        "avatar_context": (
            "You are Marcus Reyes, a Platinum loyalty member. You just got off a "
            "six-hour flight and you booked a suite three weeks ago, pre-paid. Now the "
            "front desk is telling you it is not available. You are exhausted and your "
            "patience is gone. You already know your booking details - you do NOT need "
            "anyone to ask you to explain the problem. You want them to fix it, now. "
            "React to what the front desk person says."
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
        "avatar_id": "8175dfc2-7858-49d6-b5fa-0c135d1c4bad",
        "industry": "Automotive Franchise",
        "title": "Service Advisor Up-Sell",
        "tagline": "Recommend additional service without breaking trust.",
        "duration": "10-14 min",
        "difficulty": "Advanced",
        "color": "#8B5CF6",
        "summary": (
            "A customer came in for an oil change. The technician flagged worn "
            "brake pads and a leaking gasket. Communicate findings, prioritize "
            "safety, and close the additional work - ethically."
        ),
        "avatar_context": (
            "You are Priya Shah. You brought your 6-year-old SUV in for a routine oil "
            "change, nothing more. Now the service advisor is telling you there are "
            "additional issues and additional costs. You are immediately skeptical - "
            "you've heard this upsell before. You want clear, honest answers about "
            "what is actually necessary vs. what is optional. React to what the advisor "
            "says to you."
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
        "avatar_id": "dc2935cf-5863-4f08-943b-c7478aea59fb",
        "industry": "Retail Franchise",
        "title": "Coaching a Struggling Team Member",
        "tagline": "Manager-to-lead coaching conversation on performance and accountability.",
        "duration": "12-18 min",
        "difficulty": "Advanced",
        "color": "#F59E0B",
        "summary": (
            "Your store's performance metrics are slipping this quarter. You need to "
            "coach your shift lead - without micromanaging - to identify root causes "
            "and agree on a 30-day improvement plan."
        ),
        "avatar_context": (
            "You are Jordan Blake, a shift lead with two years at this store. Your "
            "manager just pulled you aside to talk about declining performance numbers. "
            "You feel defensive - your section runs fine and you don't think this is "
            "your fault. You are not going to roll over and accept blame without "
            "pushback. React to what your manager says to you."
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
        "id": "tech-enterprise-renewal",
        "avatar_id": "7a517e8e-b41f-49e7-b6b3-2cdfb4bbff1e",
        "industry": "Technology",
        "title": "Enterprise Account Renewal",
        "tagline": "Save a churning enterprise SaaS account before renewal.",
        "duration": "10-15 min",
        "difficulty": "Advanced",
        "color": "#EC4899",
        "summary": (
            "A senior engineering leader at a Fortune 500 company is unhappy with "
            "platform reliability and is threatening to switch vendors at renewal. "
            "Your job is to de-escalate, uncover root concerns, and build a path "
            "to contract extension."
        ),
        "avatar_context": (
            "You are Jordan Kim, VP of Engineering at a large enterprise company. "
            "Your team has been dealing with repeated outages on the SaaS platform "
            "you pay a lot of money for. Your renewal is coming up in 30 days and "
            "you are seriously considering switching to a competitor. The account rep "
            "has asked for a call and you agreed, but you are skeptical and not in "
            "the mood for a sales pitch. You want accountability and a real plan, "
            "not just apologies. React to what the account rep says."
        ),
        "objectives": [
            "Acknowledge the outages directly without making excuses",
            "Ask discovery questions to understand the full business impact",
            "Present a credible remediation timeline with named owners",
            "Earn a commitment to stay through the renewal period",
        ],
        "persona": {
            "name": "Jordan Kim",
            "role": "VP of Engineering, enterprise customer",
            "voice_tone": "direct, skeptical, time-pressured",
        },
        "skills": ["Executive presence", "Churn recovery", "Technical credibility"],
    },
]

SIMULATION_BY_ID = {s["id"]: s for s in SIMULATIONS}


# ---------------------------------------------------------------------------
# In-memory transcript store (demo only - would be a real DB in production)
# ---------------------------------------------------------------------------
SESSION_STORE = {}


def build_system_prompt(simulation, mode):
    """Construct the persona prompt for the avatar in this simulation."""
    persona = simulation["persona"]
    avatar_context = simulation.get("avatar_context", simulation["summary"])
    silence_note = (
        " If the other person goes silent or seems stuck, stay in character and nudge them naturally."
        if mode == "practice"
        else ""
    )
    return (
        f"{avatar_context} "
        f"Your name is {persona['name']}. Your tone is {persona['voice_tone']}. "
        f"YOU are the one with the problem or the situation. The person you are talking to is trying to help you or sell to you. "
        f"React naturally to exactly what they say to you - do not repeat your opening complaint, just respond to their last message. "
        f"Speak the way a real person would in this situation: casual, direct, emotionally authentic. "
        f"Keep every reply to 1-2 sentences maximum. "
        f"Do NOT use bullet points, lists, headers, or any structured formatting. "
        f"Output ONLY the words you are speaking. Do NOT include any stage directions, "
        f"physical descriptions, or action notes such as '*nods*', '(sighs)', '[crosses arms]', "
        f"'avatar nodding in approval', or any similar descriptions of movement or expression. "
        f"Never break character. Never give training advice or coaching feedback."
        f"{silence_note}"
    )


def _strip_action_text(text):
    """Remove stage directions and physical action descriptions from avatar responses."""
    # Strip *action*, (action), [action] patterns
    text = re.sub(r'\*[^*]+\*', '', text)
    text = re.sub(r'\([^)]*(?:nod|sigh|shrug|cross|lean|look|glare|smile|frown|pause|wave|roll|raise|lower|turn|walk|step|gesture|expression|breath)[^)]*\)', '', text, flags=re.IGNORECASE)
    text = re.sub(r'\[[^\]]+\]', '', text)
    # Strip lines that are purely an action description
    lines = [l for l in text.splitlines() if not re.match(r'^\s*(?:avatar|she|he|they)\s+\w+ing\b', l, re.IGNORECASE)]
    return ' '.join(' '.join(lines).split()).strip()


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


@app.route("/about")
def about():
    return render_template("about.html")


UNLOCK_SESSION_KEY = "sim_unlock_v3"


def _simulations_unlocked():
    return bool(flask_session.get(UNLOCK_SESSION_KEY))


def _gate_redirect(next_path):
    """Return a redirect to the unlock page if the user hasn't entered the passcode."""
    if _simulations_unlocked():
        return None
    return redirect(url_for("unlock", next=next_path))


@app.route("/unlock", methods=["GET", "POST"])
def unlock():
    next_url = (
        (request.form.get("next") if request.method == "POST" else request.args.get("next"))
        or url_for("catalog")
    )
    # Only allow internal redirects (must start with /).
    if not next_url.startswith("/"):
        next_url = url_for("catalog")

    error = None
    if request.method == "POST":
        code = (request.form.get("passcode") or "").strip()
        if code.upper() == SIMULATION_PASSCODE.upper():
            flask_session[UNLOCK_SESSION_KEY] = True
            return redirect(next_url)
        error = "Incorrect passcode. Try again or schedule a discovery call to receive one."

    return render_template(
        "gate.html",
        next_url=next_url,
        error=error,
        discovery_url=DISCOVERY_CALL_URL,
    )


@app.route("/lock")
def lock():
    """Clear the unlock flag so the gate reappears. Useful for demos and testing."""
    flask_session.pop(UNLOCK_SESSION_KEY, None)
    return redirect(url_for("catalog"))


@app.route("/catalog")
def catalog():
    return render_template(
        "catalog.html",
        simulations=SIMULATIONS,
        simulations_unlocked=_simulations_unlocked(),
    )


@app.route("/onboarding")
def onboarding():
    return render_template("onboarding.html")


@app.route("/workflow")
def workflow():
    return render_template("simulations.html", simulations=SIMULATIONS)


@app.route("/simulations/<sim_id>")
def simulation_detail(sim_id):
    simulation = SIMULATION_BY_ID.get(sim_id)
    if not simulation:
        abort(404)
    return render_template(
        "simulation_detail.html",
        simulation=simulation,
        simulations_unlocked=_simulations_unlocked(),
    )


@app.route("/simulations/<sim_id>/<mode>")
def simulation_run(sim_id, mode):
    gate = _gate_redirect(url_for("simulation_run", sim_id=sim_id, mode=mode))
    if gate:
        return gate
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

    avatar_id = (simulation.get("avatar_id") if simulation else None) or LIVEAVATAR_AVATAR_ID
    payload = {
        "avatar_id": avatar_id,
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
            "avatar_id": avatar_id,
        }
    )


@app.post("/api/respond")
def respond():
    """
    Generate an in-character avatar response to the trainee's last utterance.
    Uses Claude (claude-haiku-4-5-20251001) if ANTHROPIC_API_KEY is set,
    otherwise falls back to contextual scripted responses so the demo always works.
    """
    body = request.get_json(silent=True) or {}
    session_id = body.get("session_id", "")
    user_text = body.get("text", "").strip()

    record = SESSION_STORE.get(session_id)
    if not record:
        return jsonify({"error": "unknown_session"}), 404

    # Empty text = opener request (avatar speaks first to start the scenario)
    if not user_text:
        simulation = SIMULATION_BY_ID.get(record["simulation_id"])
        if not simulation:
            return jsonify({"error": "unknown_simulation"}), 404
        opener = _OPENERS.get(simulation["id"], f"Hi. I have a situation I need help with.")
        return jsonify({"text": opener})

    simulation = SIMULATION_BY_ID.get(record["simulation_id"])
    if not simulation:
        return jsonify({"error": "unknown_simulation"}), 404

    transcript = record.get("transcript", [])
    mode = record.get("mode", "practice")

    try:
        response_text = _generate_avatar_response(simulation, transcript, user_text, mode)
    except Exception as exc:
        app.logger.error("respond fatal: %s", exc, exc_info=True)
        return jsonify({"error": str(exc)}), 500

    return jsonify({"text": response_text})


def _generate_avatar_response(simulation, transcript, user_text, mode):
    # Always try Gemini first.
    if GEMINI_API_KEY:
        try:
            return _gemini_response(simulation, transcript, user_text, mode, GEMINI_API_KEY)
        except Exception as exc:
            app.logger.error("gemini_response failed: %s", exc)

    # Claude fallback if Gemini is unavailable.
    anthropic_key = os.environ.get("ANTHROPIC_API_KEY", "")
    if anthropic_key:
        try:
            return _claude_response(simulation, transcript, user_text, mode, anthropic_key)
        except Exception as exc:
            app.logger.error("claude_response failed: %s", exc)

    raise RuntimeError("all AI backends failed")


def _gemini_response(simulation, transcript, user_text, mode, api_key):
    system_prompt = build_system_prompt(simulation, mode)

    # Build Gemini-format conversation history (must alternate user/model)
    contents = []
    for turn in transcript:
        role = "user" if turn["speaker"] == "user" else "model"
        if contents and contents[-1]["role"] == role:
            contents[-1]["parts"][0]["text"] += " " + turn["text"]
        else:
            contents.append({"role": role, "parts": [{"text": turn["text"]}]})

    # Gemini requires the list to start with a user turn
    if not contents or contents[0]["role"] != "user":
        contents.insert(0, {"role": "user", "parts": [{"text": "(conversation begins)"}]})

    # Append the new user message if the last turn isn't already user
    if contents[-1]["role"] != "user":
        contents.append({"role": "user", "parts": [{"text": user_text}]})

    url = (
        f"https://generativelanguage.googleapis.com/v1beta/models/"
        f"{GEMINI_MODEL}:generateContent?key={api_key}"
    )
    payload = {
        "system_instruction": {"parts": [{"text": system_prompt}]},
        "contents": contents,
        "generationConfig": {
            "maxOutputTokens": 500,
            "temperature": 0.85,
            "thinkingConfig": {"thinkingBudget": 0},
        },
    }
    resp = requests.post(url, json=payload, timeout=15)
    if not resp.ok:
        app.logger.error("gemini http %s: %s", resp.status_code, resp.text[:300])
        resp.raise_for_status()
    data = resp.json()
    raw = data["candidates"][0]["content"]["parts"][0]["text"].strip()
    return _strip_action_text(raw)


def _claude_response(simulation, transcript, user_text, mode, api_key):
    import anthropic as _anthropic

    system_prompt = build_system_prompt(simulation, mode)

    # Build alternating user/assistant history from the stored transcript.
    # Merge consecutive same-role turns to satisfy Claude's alternation requirement.
    messages = []
    for turn in transcript:
        role = "user" if turn["speaker"] == "user" else "assistant"
        if messages and messages[-1]["role"] == role:
            messages[-1]["content"] += " " + turn["text"]
        else:
            messages.append({"role": role, "content": turn["text"]})

    # Append the new user turn if not already present at the end.
    if not messages or messages[-1]["role"] != "user":
        messages.append({"role": "user", "content": user_text})

    # Must start with a user message.
    if messages[0]["role"] != "user":
        messages.insert(0, {"role": "user", "content": "(conversation begins)"})

    client = _anthropic.Anthropic(api_key=api_key)
    resp = client.messages.create(
        model="claude-haiku-4-5-20251001",
        max_tokens=200,
        system=system_prompt,
        messages=messages,
    )
    return resp.content[0].text.strip()


# Per-simulation scripted openers so the first avatar line is always vivid.
_OPENERS = {
    "qsr-customer-recovery": (
        "Hi, I ordered the grilled chicken wrap but got a burger. "
        "Again. This is the third time this month and I've only got 20 minutes left on my break."
    ),
    "fitness-membership-objections": (
        "Thanks for the tour. It's a nice facility. "
        "I'm just not sure I can commit to this financially right now. The monthly fee is pretty steep."
    ),
    "hospitality-guest-checkin": (
        "I'm a Platinum member and I booked a suite three weeks ago. "
        "You're telling me it is not available? I just got off a six-hour flight."
    ),
    "auto-service-advisor": (
        "You said this was just going to be an oil change. "
        "Now there are extra issues? How do I know this is not just an upsell?"
    ),
    "retail-shrink-conversation": (
        "Look, I've been a shift lead here for two years. "
        "My section runs fine. I'm not sure why the numbers are suddenly my problem."
    ),
    "tech-enterprise-renewal": (
        "Look, I agreed to this call but I want to be direct. "
        "We have had three major outages in the past two months and my engineers are losing confidence in your platform. "
        "Our renewal is in 30 days and I need a real reason to stay."
    ),
}




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
# Analysis engine - Claude LLM path + strict rule-based fallback
# ---------------------------------------------------------------------------

def generate_analysis(record, simulation):
    transcript = record["transcript"]
    user_turns  = [t for t in transcript if t["speaker"] == "user"]
    avatar_turns = [t for t in transcript if t["speaker"] == "avatar"]
    user_words   = sum(len(t["text"].split()) for t in user_turns)
    avatar_words = sum(len(t["text"].split()) for t in avatar_turns)
    duration_s   = int(transcript[-1]["ts"] - transcript[0]["ts"]) if transcript else 0
    turn_count   = len(user_turns)
    avg_resp_len = round(user_words / max(1, turn_count), 1)
    talk_ratio   = round(user_words / max(1, user_words + avatar_words), 2)

    api_key = os.environ.get("ANTHROPIC_API_KEY", "")
    if api_key and user_turns:
        try:
            return _claude_analysis(
                simulation, record, user_turns, avatar_turns,
                user_words, avatar_words, duration_s,
                turn_count, avg_resp_len, talk_ratio, api_key,
            )
        except Exception as exc:
            app.logger.error("claude analysis failed: %s", exc)

    return _rule_based_analysis(
        simulation, user_turns, avatar_turns,
        user_words, avatar_words, duration_s,
        turn_count, avg_resp_len, talk_ratio,
    )


def _grade(score):
    if score >= 90: return "A"
    if score >= 80: return "B"
    if score >= 70: return "C"
    if score >= 60: return "D"
    return "F"


def _rating(score):
    if score >= 85: return "Exceptional"
    if score >= 75: return "Proficient"
    if score >= 60: return "Developing"
    if score >= 45: return "Emerging"
    return "Needs significant work"


# ---------------------------------------------------------------------------
# Claude LLM analysis
# ---------------------------------------------------------------------------

def _claude_analysis(simulation, record, user_turns, avatar_turns,
                     user_words, avatar_words, duration_s,
                     turn_count, avg_resp_len, talk_ratio, api_key):
    import anthropic as _anthropic

    transcript_str = "\n".join(
        f"{'TRAINEE' if t['speaker'] == 'user' else 'CUSTOMER'}: {t['text']}"
        for t in record["transcript"]
    )
    objectives_str = "\n".join(f"{i+1}. {o}" for i, o in enumerate(simulation["objectives"]))

    system = (
        "You are a strict, senior performance coach evaluating enterprise training simulations. "
        "Score honestly - do not inflate. Most trainees score 40–70. "
        "Reserve 85+ for genuinely exceptional execution. "
        "Base scores only on what was actually said, not intent."
    )

    prompt = f"""Evaluate the following training simulation and return a JSON object only.

SIMULATION: {simulation['title']}
PERSONA: {simulation['persona']['name']} - {simulation['persona']['role']} (tone: {simulation['persona']['voice_tone']})
SCENARIO: {simulation['summary']}

LEARNING OBJECTIVES:
{objectives_str}

TRANSCRIPT:
{transcript_str}

SESSION STATS:
- Trainee turns: {turn_count}
- Trainee words: {user_words}
- Avg words per response: {avg_resp_len}
- Talk-time share: {int(talk_ratio * 100)}%

SCORING SCALE (use strictly):
0–29   Not addressed - no meaningful attempt
30–49  Attempted but largely failed - vague, incomplete, or missed the point
50–64  Partial execution - some elements present, key parts missing
65–79  Adequate - objective met but could be sharper
80–89  Strong - skillful execution with clear impact
90–100 Exceptional - model response, nothing materially missing

Also score these four behavioral dimensions on the same 0–100 scale:
- empathy: Did the trainee validate feelings, name emotions, or make the other person feel heard?
- specificity: Did they use the person's name, give real timelines, numbers, or concrete next steps?
- listening: Did they reference what was said, ask follow-up questions, or track the conversation?
- resolution: Did they commit to a clear, specific, actionable outcome?

Return ONLY valid JSON - no markdown, no commentary:
{{
  "rubric": [
    {{"objective": "<exact text>", "score": <int>, "evidence": "<direct quote or null>", "tip": "<one specific coaching sentence>"}}
  ],
  "dimensions": {{"empathy": <int>, "specificity": <int>, "listening": <int>, "resolution": <int>}},
  "strengths": ["<specific behavioral observation>", "<specific behavioral observation>"],
  "growth_areas": ["<specific gap + actionable advice>", "<specific gap + actionable advice>"],
  "critical_moment": "<one sentence: the single moment that most defined this session>",
  "summary": "<2–3 sentences of honest, specific assessment>"
}}"""

    client = _anthropic.Anthropic(api_key=api_key)
    resp = client.messages.create(
        model="claude-haiku-4-5-20251001",
        max_tokens=1400,
        system=system,
        messages=[{"role": "user", "content": prompt}],
    )

    raw = resp.content[0].text.strip()
    if raw.startswith("```"):
        raw = re.sub(r"^```[a-z]*\n?", "", raw).rstrip("`").strip()
    data = json.loads(raw)

    rubric  = data["rubric"]
    overall = int(sum(r["score"] for r in rubric) / max(1, len(rubric)))

    return {
        "overall_score":      overall,
        "grade":              _grade(overall),
        "rating":             _rating(overall),
        "user_words":         user_words,
        "avatar_words":       avatar_words,
        "talk_ratio":         talk_ratio,
        "turn_count":         turn_count,
        "avg_response_length": avg_resp_len,
        "duration_s":         duration_s,
        "rubric":             rubric,
        "dimensions":         data["dimensions"],
        "strengths":          data["strengths"],
        "growth_areas":       data["growth_areas"],
        "critical_moment":    data.get("critical_moment", ""),
        "summary":            data["summary"],
    }


# ---------------------------------------------------------------------------
# Rule-based analysis (fallback when no API key)
# ---------------------------------------------------------------------------

def _behavior_signals(user_turns, persona_name):
    """Extract behavioral signals from trainee turns."""
    joined     = " ".join(t["text"].lower() for t in user_turns)
    first_name = persona_name.lower().split()[0]

    has_timeline = bool(
        re.search(r'\b\d+\s*(minute|min|second|sec|hour|day|week)', joined)
        or any(p in joined for p in ["right now", "immediately", "right away", "asap", "today"])
    )
    question_turns = [t for t in user_turns if "?" in t["text"]]

    return {
        "apologized":     any(p in joined for p in ["sorry", "apologize", "apolog", "my mistake", "our fault", "we dropped the ball"]),
        "acknowledged":   any(p in joined for p in ["i understand", "i see that", "i hear you", "absolutely", "you're right", "that's frustrating", "must be", "can imagine"]),
        "used_name":      first_name in joined,
        "offered_fix":    any(p in joined for p in ["replace", "refund", "comp", "complimentary", "free", "fix", "make it right", "take care", "new order", "swap", "redo", "credit"]),
        "gave_timeline":  has_timeline,
        "asked_question": len(question_turns) >= 1,
        "asked_multiple": len(question_turns) >= 2,
        "follow_through": any(p in joined for p in ["follow up", "follow-up", "check back", "ensure", "prevent", "won't happen again", "make sure", "flag this"]),
        "named_action":   any(p in joined for p in ["i will", "i'm going to", "let me", "allow me", "i can"]),
        "closed_loop":    any(p in joined for p in ["anything else", "is there anything", "does that work", "does that help", "how does that sound"]),
        "defensive":      any(p in joined for p in ["policy says", "but it's", "well actually", "not our fault", "not my fault", "rules say", "procedure is", "nothing i can do"]),
        "vague_count":    sum(1 for p in ["maybe", "possibly", "try to", "hopefully", "i'll see what", "not sure", "don't know if"] if p in joined),
        "short_responses": sum(1 for t in user_turns if len(t["text"].split()) < 8),
    }


def _score_objective(objective, idx, signals, user_turns, persona_name):
    """Score a single objective 0–100 based on behavioral signals."""
    obj_lower = objective.lower()
    joined    = " ".join(t["text"].lower() for t in user_turns)

    # Build a signal-weighted score from 0
    score = 0

    # Objective-keyword match (up to 30 pts)
    stop = {"the","a","an","to","and","or","of","in","on","with","for","is","be","are","use","into"}
    keywords = [w.strip(",.;:()") for w in obj_lower.split() if w.strip(",.;:()") not in stop and len(w) > 3][:6]
    hits = sum(1 for k in keywords if k in joined)
    kw_coverage = hits / max(1, len(keywords))
    score += int(kw_coverage * 30)

    # Shared behavioral bonuses
    if signals["acknowledged"]:   score += 12
    if signals["apologized"]:     score += 8
    if signals["used_name"]:      score += 8
    if signals["named_action"]:   score += 8
    if signals["offered_fix"]:    score += 10
    if signals["gave_timeline"]:  score += 10
    if signals["asked_question"]: score += 6
    if signals["follow_through"]: score += 8

    # Objective-specific bonuses
    if "greet" in obj_lower or "acknowledge" in obj_lower:
        if signals["acknowledged"] and signals["apologized"]: score += 10
        if signals["used_name"]: score += 8
    if "remedy" in obj_lower or "offer" in obj_lower or "resolv" in obj_lower or "fix" in obj_lower:
        if signals["offered_fix"] and signals["gave_timeline"]: score += 15
        elif signals["offered_fix"]: score += 8
    if "feedback" in obj_lower or "close" in obj_lower or "loop" in obj_lower:
        if signals["closed_loop"]: score += 12
        if signals["follow_through"]: score += 10
    if "question" in obj_lower or "discover" in obj_lower or "surface" in obj_lower:
        if signals["asked_multiple"]: score += 12
        elif signals["asked_question"]: score += 6
    if "commit" in obj_lower or "confirm" in obj_lower or "timeline" in obj_lower:
        if signals["gave_timeline"] and signals["named_action"]: score += 15

    # Deductions
    if signals["defensive"]:    score = max(0, score - 18)
    score = max(0, score - signals["vague_count"] * 6)
    if signals["short_responses"] >= 3: score = max(0, score - 10)

    score = min(100, score)

    # Evidence
    evidence = None
    for turn in user_turns:
        if any(k in turn["text"].lower() for k in keywords):
            evidence = turn["text"][:220]
            break

    # Tip
    if score >= 80:
        tip = "Solid execution - maintain this consistency under pressure."
    elif score >= 65:
        tip = f"Adequate, but missing {'a specific timeline' if not signals['gave_timeline'] else 'stronger acknowledgment'}. Name the action explicitly."
    elif score >= 45:
        tip = f"Partial attempt. {'Add a concrete fix and timeline.' if not signals['offered_fix'] else 'Strengthen follow-through and close the loop.'}"
    else:
        tip = "Not demonstrated. In your next rep, address this objective in the opening exchange."

    return {"objective": objective, "score": score, "evidence": evidence, "tip": tip}


def _dimension_scores(signals, user_turns, avg_resp_len):
    """Score the four behavioral dimensions 0–100."""
    joined = " ".join(t["text"].lower() for t in user_turns)

    # Empathy (0-100)
    empathy = 0
    if signals["acknowledged"]:  empathy += 35
    if signals["apologized"]:    empathy += 25
    if signals["used_name"]:     empathy += 20
    if any(p in joined for p in ["i can imagine", "that must", "completely understand", "totally get it"]): empathy += 20
    empathy = min(100, empathy)

    # Specificity (0-100)
    specificity = 0
    if signals["used_name"]:    specificity += 30
    if signals["gave_timeline"]: specificity += 35
    if signals["offered_fix"]:   specificity += 25
    if re.search(r'\b\d+\b', joined): specificity += 10  # any number used
    specificity = min(100, specificity)

    # Listening (0-100)
    listening = 0
    if signals["asked_question"]:  listening += 30
    if signals["asked_multiple"]:  listening += 20
    if signals["acknowledged"]:    listening += 25
    if signals["closed_loop"]:     listening += 25
    listening = min(100, listening)

    # Resolution (0-100)
    resolution = 0
    if signals["offered_fix"]:     resolution += 35
    if signals["gave_timeline"]:   resolution += 30
    if signals["named_action"]:    resolution += 20
    if signals["follow_through"]:  resolution += 15
    if signals["defensive"]:       resolution = max(0, resolution - 25)
    resolution = min(100, resolution)

    return {"empathy": empathy, "specificity": specificity, "listening": listening, "resolution": resolution}


def _rule_based_analysis(simulation, user_turns, avatar_turns,
                         user_words, avatar_words, duration_s,
                         turn_count, avg_resp_len, talk_ratio):
    persona_name = simulation["persona"]["name"]
    signals      = _behavior_signals(user_turns, persona_name)

    rubric = [
        _score_objective(obj, idx, signals, user_turns, persona_name)
        for idx, obj in enumerate(simulation["objectives"])
    ]
    overall    = int(sum(r["score"] for r in rubric) / max(1, len(rubric))) if rubric else 0
    dimensions = _dimension_scores(signals, user_turns, avg_resp_len)

    # Strengths: top-performing rubric items phrased as observations
    sorted_rubric = sorted(rubric, key=lambda r: -r["score"])
    strengths = []
    for r in sorted_rubric[:2]:
        if r["score"] >= 55:
            strengths.append(f"Addressed '{r['objective'][:60]}' (score {r['score']})")
    if signals["used_name"]:
        strengths.insert(0, f"Used the customer's name - personalizes the interaction")
    if signals["gave_timeline"]:
        strengths.append("Gave a specific timeline - builds confidence in resolution")
    strengths = strengths[:3]

    # Growth areas: lowest-scoring objectives with specific guidance
    growth_rubric = sorted(rubric, key=lambda r: r["score"])
    growth_areas = []
    for r in growth_rubric[:2]:
        if r["score"] < 75:
            growth_areas.append(f"'{r['objective'][:55]}' scored {r['score']} - {r['tip']}")
    if signals["defensive"]:
        growth_areas.insert(0, "Defensive language detected - replace with ownership phrases like 'I've got this.'")
    if signals["vague_count"] >= 2:
        growth_areas.append("Vague commitments undermine trust - replace 'I'll try' with 'I will.'")
    growth_areas = growth_areas[:3]

    # Critical moment
    if signals["offered_fix"] and signals["gave_timeline"]:
        critical_moment = "The moment a specific remedy with a timeline was offered - this is where the customer's tension shifted."
    elif signals["apologized"] and not signals["offered_fix"]:
        critical_moment = "Apology was given but no concrete fix followed - the customer was left without a resolution."
    elif not signals["acknowledged"]:
        critical_moment = "The issue was never explicitly acknowledged - the customer may have felt unheard throughout."
    else:
        critical_moment = "Engagement was present but the resolution lacked the specificity needed to fully close the loop."

    # Summary
    talk_note = (
        "Talk time was balanced." if 0.35 <= talk_ratio <= 0.65
        else ("You dominated the conversation - let the other party speak more." if talk_ratio > 0.65
              else "You under-spoke - drive the conversation more confidently.")
    )
    minutes, seconds = divmod(duration_s, 60)
    summary = (
        f"{_rating(overall)} performance on '{simulation['title']}'. "
        f"Session ran {minutes}m {seconds:02d}s across {turn_count} exchanges. "
        f"{talk_note}"
    )

    return {
        "overall_score":       overall,
        "grade":               _grade(overall),
        "rating":              _rating(overall),
        "user_words":          user_words,
        "avatar_words":        avatar_words,
        "talk_ratio":          talk_ratio,
        "turn_count":          turn_count,
        "avg_response_length": avg_resp_len,
        "duration_s":          duration_s,
        "rubric":              rubric,
        "dimensions":          dimensions,
        "strengths":           strengths,
        "growth_areas":        growth_areas,
        "critical_moment":     critical_moment,
        "summary":             summary,
    }


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
