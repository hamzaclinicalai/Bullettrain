# BulletTrain.ai — Enterprise Training Demo

Interactive avatar-powered enterprise training demo platform. Built with Flask
and the [LiveAvatar](https://www.liveavatar.com/) realtime avatar SDK. Each
simulation has a **Practice** and a **Test** mode and ends with an AI analysis
of how the trainee performed against the rubric.

## Quick start

```bash
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
python app.py
# → http://localhost:5000
```

## Deploying to Heroku

```bash
heroku create bullettrain-demo
git push heroku main
heroku open
```

The `Procfile`, `runtime.txt`, and `requirements.txt` are configured for a
zero-config deploy on Heroku's Python buildpack.

## How it works

1. The browser asks `/api/session-token` for a one-shot LiveAvatar session token.
2. The Flask backend POSTs to `https://api.liveavatar.com/v1/sessions/token`
   using the hard-coded API key, scoping the persona to the current simulation.
3. The browser loads the official `@heygen/liveavatar-web-sdk` from a CDN, calls
   `LiveAvatarSession(token).start()`, attaches it to a `<video>` element, and
   streams real-time audio + video.
4. As the trainee and avatar speak, transcript chunks are POSTed to
   `/api/transcript/<session_id>` and stored.
5. When the simulation ends, `/api/analyze/<session_id>` produces a rubric-based
   AI analysis the trainee can review on the results page.

## Project structure

```
bullettrain-demo/
├── app.py                 # Flask app + LiveAvatar token broker + analysis
├── Procfile               # Heroku web entry point
├── requirements.txt
├── runtime.txt
├── static/
│   ├── css/styles.css     # Design system
│   ├── js/sim.js          # Avatar session + transcript wiring
│   └── img/               # Logos / illustrations
└── templates/             # Jinja2 templates
```

## Hard-coded credentials (demo only)

The demo uses the credentials the prospective customer provided so it works
out of the box. Swap them out before any real-world deployment.

```
LIVEAVATAR_API_KEY  = a999720b-05d8-11f1-a99e-066a7fa2e369
LIVEAVATAR_AVATAR_ID = 075abc67-2fae-4548-8ca9-b815fcbd34c7
```
