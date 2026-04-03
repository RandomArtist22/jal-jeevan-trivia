# Jal Jeevan Trivia

Offline-first KBC-style quiz website for the Jal Jeevan event.

## What is included

- `server.js`
  Single Node server for static pages plus WebSocket state sync.
- `public/`
  Landing page, player portal, quiz-stage operator and screen pages, dedicated Hot Seat pages, shared CSS, and browser logic.
- `data/questions.json`
  Sample question bank for screening, Fastest Finger First, and Hot Seat.

## Run locally

```bash
npm start
```

The default URL is `http://localhost:3000`.

If port `3000` is already in use:

```bash
PORT=3080 npm start
```

## Host setup for the event

1. Connect the host laptop to the private router.
2. Start the server on the host laptop.
3. Find the laptop's local IP on that router, for example `192.168.0.12`.
4. Open these URLs on devices:
   - Player devices for screening and FFF: `http://<local-ip>:<port>/play`
   - Quiz operator laptop page for registration, screening, and FFF: `http://<local-ip>:<port>/host`
   - Quiz projector page for screening and FFF: `http://<local-ip>:<port>/screen`
   - Dedicated Hot Seat operator page: `http://<local-ip>:<port>/hotseat-host`
   - Dedicated Hot Seat projector page: `http://<local-ip>:<port>/hotseat-screen`

## Admin PIN

Default host PIN:

```text
jaljeevan-admin
```

You can override it:

```bash
ADMIN_PIN=my-secret-pin npm start
```

## Event flow implemented

- 5-minute screening round with saved MCQ responses
- Top-8 qualifier marking from screening scores
- Fastest Finger First ordering round
- Local-device timestamp submission for FFF, adjusted against server sync
- Dedicated Hot Seat operator and projector endpoints after FFF
- Operator-only Hot Seat answer control with safe levels at `20` and `1000`
- Lifelines:
  - `50/50`
  - `Audience Poll`
  - `Call a Friend` with 50-second timer
- Automatic timeout handling for screening, FFF, and Hot Seat questions

## Editing questions

Update `data/questions.json`.

- `screening`
  Multiple-choice questions for the 5-minute online round
- `fastestFinger`
  Ordering/sequencing questions
- `hotSeat`
  Main KBC ladder questions with point values

## Notes

- State is stored in memory for speed and simplicity. Restarting the server resets the game.
- Participant devices stop interacting after Fastest Finger First. Hot Seat is run entirely from the dedicated operator and projector pages.
- The app is designed for a closed local network, not for internet deployment.
