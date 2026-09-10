# Going live: from this repository to a real app people use

This is written for someone who has never shipped an app before. Each step
says what you are doing, why, and what "done" looks like. Budget: an evening
for steps 1–5; the rest over the following weeks.

---

## 0. What you have

- One program (the *server*) that stores data, matches jobs to units, and
  serves the web app.
- One web app that works on phones and desktops in a browser, and can be
  "installed" to a phone's home screen (it is a PWA, no app store needed).
- A `Dockerfile` that packages both into a container any cloud can run.

You do **not** need to know how any of the code works to go live. You need
three accounts (GitHub, a cloud host, a domain registrar) and a credit card
for a few dollars a month.

---

## 1. Put the code somewhere safe (GitHub)  — 10 minutes

You already have this repository on GitHub. Make sure the branch with the
app is merged into `main`:

1. Open the repo on github.com → **Pull requests** → **New pull request**.
2. Base: `main`, compare: `claude/cctv-dispatch-app-kjnsrk` → **Create** →
   **Merge**.

Done when: `main` on GitHub shows `README.md`, `server/`, `web/`, `Dockerfile`.

---

## 2. Run it on your own computer once  — 20 minutes

So you know what "working" looks like before involving the cloud.

1. Install Node.js 22 LTS from https://nodejs.org (the default download).
2. Install Git from https://git-scm.com if `git --version` in a terminal fails.
3. In a terminal:
   ```bash
   git clone https://github.com/Timothy141/Dispatch-2.git
   cd Dispatch-2
   npm install
   cp .env.example .env
   npm run build
   npm start
   ```
4. Open http://localhost:8080. Sign in as **I need help** and request Security.
   Nothing happens yet because no unit is online. In a second terminal run
   `npm run simulate`; within seconds a unit accepts and drives in.

Done when: you have watched a simulated unit arrive and rated it.

---

## 3. Put it in the cloud  — 30 minutes

Pick **one** host. Both run the same Docker image; both have a free or
near-free tier and need no server administration.

### Option A: Render (simplest, click-through)

1. Create an account at https://render.com and connect your GitHub.
2. **New +** → **Blueprint** → choose the `Dispatch-2` repo. Render reads
   `render.yaml` from the repo and proposes a web service with a 1 GB disk.
3. Before clicking Apply, set **PUBLIC_BASE_URL** to the URL Render will give
   you (it shows it, like `https://dispatch-xxxx.onrender.com`) and set
   **GEOCODER_USER_AGENT** to include your email (address search requires a
   contact, that is OpenStreetMap's policy).
4. Click **Apply**. First build takes 3–5 minutes.
5. In the service's **Environment** tab copy the generated `DISPATCHER_CODE`.
   That is the code agents type to sign in as control room.

> The persistent disk requires Render's Starter plan (~$7/month). Without a
> disk the database resets every deploy.

### Option B: Fly.io (command line, cheap, runs close to South Africa)

1. Install the CLI: https://fly.io/docs/flyctl/install and run `fly auth signup`.
2. In the repo folder:
   ```bash
   fly launch --no-deploy        # accept the existing fly.toml; choose a unique app name
   fly volumes create dispatch_data --size 1 --region jnb
   fly secrets set DISPATCHER_CODE=choose-a-long-code
   fly deploy
   ```
3. Edit `fly.toml`: set `PUBLIC_BASE_URL` to `https://<your-app>.fly.dev` and
   `GEOCODER_USER_AGENT` to include your email, then `fly deploy` again.

Done when: `https://<your-url>/api/health` shows `{"ok":true,...}` and the
app opens on your phone over mobile data.

---

## 4. Give it a real address (domain)  — 20 minutes + DNS wait

1. Buy a domain (e.g. `yourbrand.co.za` or `.app`) from any registrar
   (Cloudflare Registrar, Namecheap, domains.co.za).
2. In Render: service → **Settings** → **Custom domains** → add
   `app.yourbrand.co.za`; it shows a CNAME record to create at the registrar.
   In Fly: `fly certs add app.yourbrand.co.za` and follow the DNS instructions.
3. Update `PUBLIC_BASE_URL` to the new https address and redeploy.

HTTPS certificates are automatic on both hosts. Done when the app opens at
your domain with a padlock.

---

## 5. First real users  — 1 hour

1. **Yourself as agent**: open the app → **Agent / control room** → your
   name, number, and the `DISPATCHER_CODE`.
2. **Your response officers**: send them the link. Each opens it on their
   phone → **I'm a responder** → name and number → set call sign, service,
   vehicle → **allow location** → toggle online. Tell them to "Add to Home
   Screen" from the browser menu so it behaves like an installed app.
3. **Do a live drill**: as agent, click **+ New call-out**, type an address,
   choose an officer, send. Their phone rings the offer; they accept, drive,
   arrive, complete. Watch it on the control-room map.
4. **Clients**: share the same link. They choose **I need help**. Consider a
   short QR-code sticker: it opens the app in one scan.

Done when one real call-out has gone from phone call to "completed" without you
touching the code.

---

## 6. Switch on the safety features  — 1 hour

These are built in; they only need accounts and settings. Set the environment
variables on your host (Render: service → Environment; Fly: `fly secrets set`).

1. **SMS one-time code at sign-in** (so nobody can sign in as someone else's
   number). Create a Twilio account (twilio.com), buy a number, then set:
   ```
   OTP_REQUIRED=true
   SMS_PROVIDER=twilio
   TWILIO_ACCOUNT_SID=AC...   TWILIO_AUTH_TOKEN=...   TWILIO_FROM=+27...
   ```
   Any other SMS gateway with a JSON API works via `SMS_PROVIDER=http`
   (see `.env.example`). Test with `SMS_PROVIDER=log` first: the code appears
   in the server log.
2. **Push notifications** (officers' phones ring an offer even with the
   screen locked). On your computer run `npx web-push generate-vapid-keys`
   once and set `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` and
   `VAPID_SUBJECT=mailto:you@yourbrand.co.za`. Users then get an
   "Enable notifications" button. iPhones need the app added to the home
   screen first (iOS 16.4+).
3. **Backups** already run daily into `/data/backups` (keeps 14). Once a
   month download one from the host's shell, or ask a developer to add an
   upload to object storage. Fly and Render also snapshot the disk.
4. **Monitoring and alerts.** Free tiers of Better Stack / UptimeRobot ping
   `/api/health` every minute and text you if it is down.
5. **Privacy notice.** The app ships a template at `/#/privacy`
   (`web/src/components/Privacy.tsx`). Fill in the [bracketed] items and have
   it reviewed: POPIA applies to the names, numbers and locations you store.

Later, when you have paying customers: coverage rules (which organisations'
units serve which clients), shifts and vehicle types, reporting exports.

---

## 7. Integrate with other cloud apps

Open **Agent / control room → Integrations** in the app.

- **Incoming** (other systems create call-outs): create an API key, hand it
  to the other system. They `POST /api/v1/callouts` with header
  `x-api-key`. Examples: an alarm-receiving platform sends a signal, a CCTV
  analytics tool sends a verified detection, a call-centre CRM logs a call.
  Full reference at `https://<your-url>/api/docs`.
- **Outgoing** (other systems learn what happened): add a webhook URL.
  Every event (`request.created`, `request.updated`, `offer.created`, …) is
  POSTed there, signed. Zapier and Make both have "Catch webhook" triggers,
  which lets you send SMS, emails, Slack/WhatsApp messages or spreadsheet rows
  without writing code.
- **Verify a signature** (for developers on the other side):
  `HMAC-SHA256(raw body, webhook secret)`, hex, compared with the
  `x-dispatch-signature` header after `sha256=`.

---

## 8. Keeping the app alive

- **Deploying changes**: push to `main` on GitHub. Render redeploys
  automatically; on Fly run `fly deploy`. CI (`.github/workflows/ci.yml`)
  runs the tests on every push, so a broken change is flagged before deploy.
- **Reading logs**: Render → **Logs** tab; Fly → `fly logs`.
- **Rotating the dispatcher code**: change the environment variable and
  redeploy; agents sign in again.
- **Costs at small scale**: hosting $5–10/month, domain ~$15/year, SMS
  per-message once you add OTP.

When you have paying customers, the next structural steps are a managed
Postgres database, two app instances behind the host's load balancer (the
matching tick must then run on one instance only), and native app-store
wrappers if customers ask for them.
