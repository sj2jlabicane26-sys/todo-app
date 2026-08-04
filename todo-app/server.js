// To-Do List Manager — backend server
//
// Serves the frontend (public/) and a small JSON API for tasks.
// Sends real push notifications (via the Web Push protocol) at each
// task's due time, checked once a minute — this works even if the
// phone's browser/app is fully closed, as long as the phone has a
// network connection and the app was installed/subscribed at least once.

require('dotenv').config();
const express = require('express');
const webpush = require('web-push');
const cron = require('node-cron');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;
const DATA_FILE = path.join(__dirname, 'data.json');

// ---- VAPID setup ----
// Generate your own pair with: npx web-push generate-vapid-keys
// Then put them in a .env file (see .env.example).
const VAPID_PUBLIC_KEY = process.env.VAPID_PUBLIC_KEY;
const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY;

if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY) {
  console.error(
    '\nMissing VAPID keys. Run "npx web-push generate-vapid-keys",\n' +
    'then copy the values into a .env file (see .env.example).\n'
  );
  process.exit(1);
}

webpush.setVapidDetails(
  'mailto:example@example.com',
  VAPID_PUBLIC_KEY,
  VAPID_PRIVATE_KEY
);

// ---- Storage ----
// Simple JSON file, no database needed for a single-user app.
function loadData() {
  if (!fs.existsSync(DATA_FILE)) {
    return { tasks: [], subscriptions: [] };
  }
  try {
    return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
  } catch (e) {
    return { tasks: [], subscriptions: [] };
  }
}

function saveData(data) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
}

let data = loadData();

function nextId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

// ---- Middleware ----
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ---- API: VAPID public key (frontend needs this to subscribe) ----
app.get('/api/vapid-public-key', (req, res) => {
  res.json({ publicKey: VAPID_PUBLIC_KEY });
});

// ---- API: push subscription ----
app.post('/api/subscribe', (req, res) => {
  const subscription = req.body;
  if (!subscription || !subscription.endpoint) {
    return res.status(400).json({ error: 'Invalid subscription' });
  }
  const exists = data.subscriptions.some(s => s.endpoint === subscription.endpoint);
  if (!exists) {
    data.subscriptions.push(subscription);
    saveData(data);
  }
  res.status(201).json({ ok: true });
});

// ---- API: tasks ----
app.get('/api/tasks', (req, res) => {
  res.json(data.tasks);
});

app.post('/api/tasks', (req, res) => {
  const { text, dueAt } = req.body;
  if (!text || !text.trim()) {
    return res.status(400).json({ error: 'Task text is required' });
  }
  const task = {
    id: nextId(),
    text: text.trim(),
    dueAt: dueAt || null,
    notified: false,
  };
  data.tasks.push(task);
  saveData(data);
  res.status(201).json(task);
});

app.put('/api/tasks/:id', (req, res) => {
  const task = data.tasks.find(t => t.id === req.params.id);
  if (!task) return res.status(404).json({ error: 'Task not found' });

  const { text, dueAt } = req.body;
  if (typeof text === 'string' && text.trim()) task.text = text.trim();
  if (dueAt !== undefined) {
    if (dueAt !== task.dueAt) task.notified = false; // allow re-notify on reschedule
    task.dueAt = dueAt;
  }
  saveData(data);
  res.json(task);
});

app.delete('/api/tasks/:id', (req, res) => {
  data.tasks = data.tasks.filter(t => t.id !== req.params.id);
  saveData(data);
  res.status(204).end();
});

app.delete('/api/tasks', (req, res) => {
  data.tasks = [];
  saveData(data);
  res.status(204).end();
});

// ---- Notification sending ----
async function sendPushToAll(payload) {
  const stillValid = [];
  for (const sub of data.subscriptions) {
    try {
      await webpush.sendNotification(sub, JSON.stringify(payload));
      stillValid.push(sub);
    } catch (err) {
      // 410/404 = subscription expired or the user uninstalled/unsubscribed.
      if (err.statusCode !== 410 && err.statusCode !== 404) {
        stillValid.push(sub);
      }
      console.warn('Push failed for a subscription, dropping it:', err.statusCode || err.message);
    }
  }
  if (stillValid.length !== data.subscriptions.length) {
    data.subscriptions = stillValid;
    saveData(data);
  }
}

// Check every minute for tasks that just became due.
cron.schedule('* * * * *', async () => {
  const now = Date.now();
  let changed = false;
  for (const task of data.tasks) {
    if (task.dueAt && !task.notified && new Date(task.dueAt).getTime() <= now) {
      await sendPushToAll({ title: 'Task due now', body: task.text });
      task.notified = true;
      changed = true;
    }
  }
  if (changed) saveData(data);
});

app.listen(PORT, () => {
  console.log(`To-Do app running at http://localhost:${PORT}`);
});
