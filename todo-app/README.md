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
`localhost` for local testing), and the server needs to stay running
24/7 for the once-a-minute due-task check to actually fire — so to get
notifications reliably on your phone, you need to put the server
online instead of running it on your own laptop.

### Deploying to Railway

1. Push this project to a GitHub repo (skip `node_modules` and `.env` —
   there's a `.gitignore` for that already). Make sure `server.js` and
   `package.json` sit at the **root** of the repo, not inside a
   subfolder — otherwise Railway won't find them without you manually
   setting a custom "Root Directory" in its settings.
2. On [railway.app](https://railway.app), sign in with GitHub, click
   **New Project → Deploy from GitHub repo**, and pick this repo.
3. In the project's **Variables** tab, add `VAPID_PUBLIC_KEY` and
   `VAPID_PRIVATE_KEY` (copy the values from your local `.env` file —
   don't upload the `.env` file itself). You don't need to set `PORT`;
   Railway provides its own.
4. Wait for the deploy to finish (check the **Deployments** tab). You'll
   get a public URL like `https://your-app.up.railway.app`.
5. Open that URL on your phone's browser, add it to your home screen
   (Android Chrome: menu → "Add to Home screen"; iPhone Safari: Share
   icon → "Add to Home Screen").
6. Open the app from the home screen icon, tap **Enable**, and allow
   notifications when prompted.
7. Add a task with a due time a couple of minutes out, then lock your
   phone — you should get a notification even with the app fully
   closed, as long as your phone has a network connection.

**Important:** a push subscription is tied to the exact URL you enabled
notifications on. If you ever redeploy to a different URL (new Railway
project, custom domain, switching hosts, etc.), you must open the app
on the new URL and tap **Enable** again — old subscriptions from a
previous URL won't carry over.

You can check `Deployments → Logs` in Railway at any time to see
`[push]` log lines confirming whether a notification was actually
delivered, or why it failed.

## Notes and limits

- `data.json` is a simple single-user store — fine for personal use, not
  built for multiple people sharing the same list.
- iPhones require the app to be installed to the home screen (as a PWA)
  before push notifications work at all — this is an Apple restriction,
  not something this app can work around.
- If you ever move hosts, your existing phone subscriptions become
  invalid and you'll need to tap **Enable** again on the new URL.
