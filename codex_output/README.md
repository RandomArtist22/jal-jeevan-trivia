# Jal Jeevan Trivia

Offline-first KBC-style quiz website for the Jal Jeevan event.

## What is included

- `server.js`
  Single Node server for static pages plus WebSocket state sync.
- `public/`
  Landing page, player portal, quiz-stage operator and screen pages, dedicated Hot Seat pages, shared CSS, and browser logic.
- `data/questions.json`
  Question bank for screening and Fastest Finger First.
- `data/hotseat-questions-set-1.json`
  Hot Seat question bank for Set 1.
- `data/hotseat-questions-set-2.json`
  Hot Seat question bank for Set 2.
- `data/hotseat-questions-set-3.json`
  Hot Seat question bank for Set 3.

## Run locally

```bash
npm start
```

The default URL is `http://localhost:3000`.

If port `3000` is already in use:

```bash
PORT=3080 npm start
```

## Run with Cloudflare Tunnel

Use a named Cloudflare tunnel for event use. The `trycloudflare.com` quick tunnel is still supported, but it is only best-effort and can be intermittent.

### Stable mode: named tunnel

Set these values in `.env` or your shell:

```text
CLOUDFLARED_TUNNEL_TOKEN=your-cloudflare-tunnel-token
CLOUDFLARED_PUBLIC_URL=https://quiz.example.com
```

Then start everything with:

```bash
npm run start:cloudflared
```

If you need a different local port:

```bash
PORT=3080 npm run start:cloudflared
```

What this does in named-tunnel mode:

- starts the quiz server on your laptop with `PUBLIC_BASE_URL` already set
- runs `cloudflared tunnel run --token ...`
- keeps the operator UI and route tiles aligned to your stable public hostname

### Fallback mode: quick tunnel

If you do not provide `CLOUDFLARED_TUNNEL_TOKEN`, the launcher falls back to a `trycloudflare.com` quick tunnel:

```bash
npm run start:cloudflared
```

In quick-tunnel mode it:

- starts the quiz server on your laptop
- opens a `cloudflared` quick tunnel to that local port
- captures the temporary public tunnel URL
- writes the tunnel URL to a runtime file so the app can advertise the public links without restarting the local server

The launcher forces:

- `--protocol http2`
- `--edge-ip-version 4`

This avoids the common `failed to dial to edge with quic` timeout on networks that block UDP/QUIC.

Quick tunnels are useful for testing, but if you are seeing a link that sometimes responds and sometimes does not, move to the named-tunnel setup above.

The launcher now avoids restarting the local quiz server after the quick tunnel URL is discovered. That removes one avoidable source of dropouts, but it does not change the underlying best-effort nature of `trycloudflare.com`.

The script prints shareable URLs for:

- `/play`
- `/audience-poll`
- `/host`
- `/screen`
- `/hotseat-host`
- `/hotseat-screen`

You can still keep the operator on the local URL, for example `http://127.0.0.1:3000/host`, while participants use the public Cloudflare link.

If you want to run a quick tunnel manually, use:

```bash
cloudflared tunnel --url http://127.0.0.1:3000 --protocol http2 --edge-ip-version 4 --no-autoupdate
```

## Run with ngrok

The app can stay on your laptop while teams join through an ngrok URL.

1. Start the server locally:

```bash
PORT=3000 npm start
```

2. In another terminal, expose that port with ngrok:

```bash
ngrok http 3000
```

3. Copy the HTTPS forwarding URL from ngrok, then restart the server with that public URL:

```bash
PUBLIC_BASE_URL=https://your-subdomain.ngrok-free.app PORT=3000 npm start
```

With `PUBLIC_BASE_URL` set:

- the operator and router pages show the ngrok links instead of `localhost`
- team devices can join using the ngrok `/play` URL
- projector and Hot Seat routes also use the same ngrok base URL

Example public routes:

- `https://your-subdomain.ngrok-free.app/play`
- `https://your-subdomain.ngrok-free.app/audience-poll`
- `https://your-subdomain.ngrok-free.app/host`
- `https://your-subdomain.ngrok-free.app/screen`
- `https://your-subdomain.ngrok-free.app/hotseat-host`
- `https://your-subdomain.ngrok-free.app/hotseat-screen`

## Host setup for the event

1. Connect the host laptop to the private router.
2. Start the server on the host laptop.
3. Find the laptop's local IP on that router, for example `192.168.0.12`.
4. Open these URLs on devices:
   - Player devices for screening and FFF: `http://<local-ip>:<port>/play`
   - Audience poll devices during Hot Seat: `http://<local-ip>:<port>/audience-poll`
   - Quiz operator laptop page for registration, screening, and FFF: `http://<local-ip>:<port>/host`
   - Quiz projector page for screening and FFF: `http://<local-ip>:<port>/screen`
   - Dedicated Hot Seat operator page: `http://<local-ip>:<port>/hotseat-host`
   - Dedicated Hot Seat projector page: `http://<local-ip>:<port>/hotseat-screen`

## Admin PIN

Default host PIN:

```text
jaljeevan-admin
```

You can override it with a local `.env` file:

```bash
cp .env.example .env
```

Then set:

```text
ADMIN_PIN=my-secret-pin
PLAYER_PIN=my-player-password
```

Or override it directly from the shell:

```bash
ADMIN_PIN=my-secret-pin PLAYER_PIN=my-player-password npm start
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

Update `data/questions.json` for screening and Fastest Finger First.

Update one of these for Hot Seat:

- `data/hotseat-questions-set-1.json`
- `data/hotseat-questions-set-2.json`
- `data/hotseat-questions-set-3.json`

- `screening`
  Multiple-choice questions for the 5-minute online round
- `fastestFinger`
  Ordering/sequencing questions
- `hotSeat`
  Main KBC ladder questions with point values

## Notes

- State is stored in memory for speed and simplicity. Restarting the server resets the game.
- Participant devices stop interacting after Fastest Finger First. Hot Seat is run entirely from the dedicated operator and projector pages.
- For tunnel-based access, use `PUBLIC_BASE_URL` so the UI advertises the public ngrok links correctly.
