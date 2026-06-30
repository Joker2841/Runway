# Runway

**The Last-Minute Life Saver.** An AI agent that does the hard first step of your commitments, so you start them instead of just remembering them.

> Built solo for the Vibe2Ship Hackathon (Coding Ninjas x Google for Developers).
> Problem Statement 1: The Last-Minute Life Saver.

### Links

- **Live app:** https://first-domino-341818417558.asia-southeast1.run.app
- **Demo videos:** linked in the project description doc (the live Google actions, shown working on real data)
- **Project description:** [ paste your Google Doc link here ]

---

## The problem

Most productivity tools are built on a wrong guess. They assume people miss deadlines because they forget, so they add more reminders, alarms, and red badges. But a reminder only tells you about a task you already knew about. It does nothing to make the task easier to begin.

The real wall is the first step. Writing the first line of a cover letter. Wording an email you are nervous about. Opening the blank document for a report. That first step is where commitments quietly die. Once you are past it, the rest is usually fine.

So Runway does the first step for you.

## What it does

You give Runway a commitment and a deadline. It reads what kind of task it is, does the actual first piece of work, and hands you a draft you can use right away. Then it plans backward from your deadline to find the latest moment you can safely start, shows a live countdown to that moment, and can push the work into your real Google tools when you choose to act.

The difference from a normal reminder app is simple. A reminder says: this is due Friday. Runway says: this is due Friday, here is the draft, here is the latest you can start, and here is the button to act on it.

## Key features

- **The First Domino engine.** Sorts every commitment into one of four types and does the matching first piece of real work (see Architecture below).
- **Honest drafting.** When a fact is missing, Runway searches everywhere it reasonably can before leaving a clear marker like `[INSERT PROJECT NAME HERE]` for you to fill. It will not invent a detail to sound finished.
- **The Radar.** Scans a real Gmail inbox, catches the emails that actually need an action, ignores the noise, and drafts the first reply for each.
- **Time Defense.** Real deadline math, not guesswork. Live countdowns and an honest status on every card: On Track, Cutting It Close, Critical, or Landed.
- **Pre-flight Briefing.** A short, plain-language read on where you stand across all your commitments right now.
- **Open by default, powerful on demand.** The core app works with no sign-in at all. Google permissions are requested only at the moment you choose an action that needs them.

---

## Architecture

### Task routing: the four archetypes

Gemini classifies each commitment into one archetype, and each archetype produces a different shape of real output:

| Archetype | First piece of work |
|---|---|
| Inbound Inquiry | A ready-to-send email reply, with subject line and greeting |
| Job Application | A tailored cover letter mapping your real background to the role |
| Long-form Writing | An outline plus the opening paragraph |
| Actionable Task | A checklist where step one is already done, ready to copy and run |

### Deterministic time engine

A deliberate design decision: **all date and time logic is computed in TypeScript, not by the model.** The model is great at judgment (estimating effort, writing a draft), but language models are inconsistent with dates. So:

- `resolveDeadline(text, now)` converts a phrase like "Friday" into an exact ISO timestamp, anchored to the real current time. A bare date with no clock time defaults to 23:59 local, and a weekday always resolves to the next upcoming occurrence, so a past date can never be produced.
- Start-by is then pure math: `deadline - estimatedEffort - buffer`.

This keeps every countdown and status correct and repeatable, every time. The model estimates effort; the code does the arithmetic.

### Anonymous-default storage router

`src/storage.ts` exposes one set of commitment operations (`list`, `get`, `create`, `update`, `delete`) and decides where data lives on every single call, based on `auth.currentUser`:

- **Signed out (default):** each visitor gets a stable client-generated UUID and their commitments are stored privately in the browser. No Firebase or Google calls are made. The full core experience works with zero setup.
- **Signed in:** the same operations delegate to Cloud Firestore, protected by strict security rules that tie every record to its owner and validate every field.

Google Sign-In is never a wall. It is an opt-in upgrade, triggered only when a user reaches for an action that writes to their real accounts. This follows the principle of least privilege: the app never holds permission to your Gmail or Calendar until you have a specific reason to grant it.

### The Radar

Scans the inbox (real Gmail, or a built-in demo inbox), flags only the emails that need an action, de-duplicates by stable message ID so the same email is never caught twice, and drafts the first reply for each catch.

### Live Google actions

Each of these writes to a real Google surface and is gated behind opt-in sign-in:

- Draft and send a reply through **Gmail**
- Create a real event on **Google Calendar** to protect the time
- Sync a checklist into **Google Tasks**
- Turn a long-form draft into a real **Google Doc**

---

## Tech stack

- **Frontend:** React, Tailwind CSS, Vite, Framer Motion
- **Backend:** Node and Express (TypeScript), bundled with esbuild
- **Identity and data:** Firebase Authentication, Cloud Firestore (with strict per-user security rules)
- **Offline-friendly storage:** browser localStorage for signed-out users
- **Deployment:** Google Cloud Run, deployed via Google AI Studio
- **AI:** Google Gemini

## Google technologies used

- **Google AI Studio** - built and deployed the entire app
- **Google Gemini** - classifies tasks, estimates effort, writes every draft
- **Google Cloud Run** - hosts the live public app
- **Firebase Authentication** - Google Sign-In and per-user identity
- **Cloud Firestore** - stores commitments with owner-scoped rules
- **Gmail API** - the Radar's inbox scan and reply dispatch
- **Google Calendar API** - real event creation
- **Google Tasks API** - checklist sync
- **Google Docs API** - document creation

---

## Project structure

```
.
├── src/
│   ├── App.tsx                  # Main app: UI, flows, commitment handlers
│   ├── storage.ts               # Anonymous/Firestore storage router
│   ├── firebase.ts              # Firebase init + error handling
│   ├── constants.ts             # System prompts and static content
│   ├── main.tsx                 # Entry point, identity bootstrap
│   └── index.css
├── server.ts                    # Express server (Gemini calls, static serving)
├── firestore.rules              # Per-user Firestore security rules
├── firebase-applet-config.json  # Firebase client config
├── firebase-blueprint.json      # Commitment data model
├── index.html
├── package.json
├── tsconfig.json
└── vite.config.ts
```

## Running locally

**Prerequisites:** Node.js 18+ and a Google Gemini API key.

```bash
# 1. Install
npm install

# 2. Configure environment (see .env.example)
#    Set GEMINI_API_KEY and your Firebase client config.

# 3. Run in development
npm run dev

# 4. Build and run a production bundle
npm run build
npm start
```

The dev server runs the TypeScript backend directly. The production build compiles the frontend with Vite and bundles the server with esbuild to `dist/server.cjs`, which is what Cloud Run runs.

---

## Design decisions worth calling out

- **Open by default, powerful on demand.** Forcing a Gmail consent screen before a user can even see the app is backwards. The core value is usable in the first ten seconds with no sign-in. Sensitive scopes are requested per-action, never as the price of admission. Friendlier and safer at the same time.
- **Deterministic dates over model parsing.** Deadlines, start-by times, and countdowns are arithmetic, so they are handled by code, not by the model. The model does the work it is good at; the math stays exact.
- **Honest gaps over confident hallucination.** A draft with a clearly marked blank is more useful than a draft that invents a company name. The agent grounds in real context first and only marks a gap when the fact genuinely is not available.

---

## Built by
Anga Sai Girish
Built for the Vibe2Ship Hackathon, 2026.
