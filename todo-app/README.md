# To-Do List Manager (with background push notifications)

A to-do list with add/edit/delete/clear, optional due dates, and real
push notifications that arrive even if the app is fully closed on your
phone — because a small server checks due tasks every minute and sends
the notification, instead of relying on a timer running in the browser.

## How it works

- `server.js` — Node/Express server. Stores tasks in `data.json` (created
  automatically), serves the frontend, and checks every minute for tasks
  that just became due, pushing a notification to every subscribed device.
- `public/` — the frontend (HTML/CSS/JS) plus the service worker (`sw.js`)
  that receives push notifications and shows them.
- Notifications use the **Web Push protocol** (the same standard behind
  most website notifications) — no third-party notification service needed.

## Setup

1. **Install Node.js** if you don't have it: https://nodejs.org (LTS version).

2. **Open this folder in VS Code**, then open a terminal in VS Code
   (`Terminal > New Terminal`) and install dependencies:
   ```
   npm install
   ```

3. **Generate your VAPID keys** (a one-time keypair the push service uses
   to verify notifications come from your server):
   ```
   npx web-push generate-vapid-keys
   ```
   This prints a public and private key.

4. **Create your `.env` file**:
   ```
   cp .env.example .env
   ```
   Open `.env` and paste in the public/private keys from step 3.

5. **Run the server**:
   ```
   npm start
   ```
   You'll see `To-Do app running at http://localhost:3000`.

6. Open `http://localhost:3000` in your browser. Add a task with a due
   time a couple of minutes out, click **Enable** on the notification
   banner, and allow notifications when your browser prompts you.

## Using it on your phone

Push notifications require the site to be served over `https://` (or
`localhost` for local testing), so to actually use this from your phone
you need to put the server online. A few good free/cheap options:

- **Render** (render.com) — free tier, connect a GitHub repo, it runs
  `npm install && npm start` automatically. Add your VAPID keys as
  environment variables in Render's dashboard (instead of `.env`).
- **Railway** (railway.app) — similar, also has a free trial tier.
- **A cheap VPS** (e.g. DigitalOcean) if you want more control.

Steps once it's hosted:
1. Push this project to a GitHub repo (skip `node_modules` and `.env` —
   there's a `.gitignore` for that already).
2. Connect the repo on Render/Railway, set `VAPID_PUBLIC_KEY` and
   `VAPID_PRIVATE_KEY` as environment variables there.
3. Open the resulting `https://...` URL on your phone.
4. Add it to your home screen (Android Chrome: menu → "Add to Home
   screen"; iPhone Safari: Share icon → "Add to Home Screen").
5. Open the app from the home screen icon, tap **Enable**, allow
   notifications.
6. Add a task with a due time — you'll get a notification at that time
   even if you've fully closed the app, as long as your phone has a
   network connection.

## Notes and limits

- `data.json` is a simple single-user store — fine for personal use, not
  built for multiple people sharing the same list.
- iPhones require the app to be installed to the home screen (as a PWA)
  before push notifications work at all — this is an Apple restriction,
  not something this app can work around.
- If you ever move hosts, your existing phone subscriptions become
  invalid and you'll need to tap **Enable** again on the new URL.
