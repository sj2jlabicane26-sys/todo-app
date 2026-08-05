// To-Do List Manager — backend server
//
// Serves the frontend (public/) and a small JSON API for tasks.
// Sends real push notifications (via the Web Push protocol) at each
// task's (or subtask's) due time, checked once a minute — this works
// even if the phone's browser/app is fully closed, as long as the
// phone has a network connection and the app was installed/subscribed
// at least once.

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
function normalizeTask(t) {
  return {
    id: t.id,
    text: t.text,
    dueAt: t.dueAt || null,
    completed: !!t.completed,
    notified: !!t.notified,
    deletedAt: t.deletedAt || null,
    subtasks: Array.isArray(t.subtasks) ? t.subtasks.map(normalizeSubtask) : [],
  };
}

function normalizeSubtask(s) {
  return {
    id: s.id,
    text: s.text,
    dueAt: s.dueAt || null,
    completed: !!s.completed,
    notified: !!s.notified,
  };
}

// A recurring reminder is separate from tasks: it isn't part of List/Week/
// Month/Trash, has no "completed" or "deletedAt" state, and never gets
// consumed after it fires. It just keeps looping at whatever interval the
// user set (nextAt + interval, over and over) until the user deletes it
// or replaces it (edits its text/interval/start time).
const REMINDER_UNITS = ['minutes', 'hours', 'days'];
const UNIT_MS = { minutes: 60 * 1000, hours: 60 * 60 * 1000, days: 24 * 60 * 60 * 1000 };

function reminderIntervalMs(value, unit) {
  const v = Math.max(1, Number(value) || 1);
  const u = REMINDER_UNITS.includes(unit) ? unit : 'minutes';
  return v * UNIT_MS[u];
}

function normalizeReminder(r) {
  return {
    id: r.id,
    text: r.text,
    intervalValue: Math.max(1, Number(r.intervalValue) || 1),
    intervalUnit: REMINDER_UNITS.includes(r.intervalUnit) ? r.intervalUnit : 'minutes',
    nextAt: r.nextAt,
    createdAt: r.createdAt || new Date().toISOString(),
  };
}

function loadData() {
  if (!fs.existsSync(DATA_FILE)) {
    return { tasks: [], subscriptions: [], reminders: [] };
  }
  try {
    const raw = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
    return {
      tasks: Array.isArray(raw.tasks) ? raw.tasks.map(normalizeTask) : [],
      subscriptions: Array.isArray(raw.subscriptions) ? raw.subscriptions : [],
      reminders: Array.isArray(raw.reminders) ? raw.reminders.map(normalizeReminder) : [],
    };
  } catch (e) {
    return { tasks: [], subscriptions: [], reminders: [] };
  }
}

function saveData(data) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
}

let data = loadData();

function nextId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

function findTask(id) {
  return data.tasks.find(t => t.id === id);
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
// Only active (non-deleted) tasks show up in the normal list.
app.get('/api/tasks', (req, res) => {
  res.json(data.tasks.filter(t => !t.deletedAt));
});

// Soft-deleted tasks live here until restored or permanently deleted.
app.get('/api/tasks/trash', (req, res) => {
  res.json(data.tasks.filter(t => !!t.deletedAt));
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
    completed: false,
    notified: false,
    deletedAt: null,
    subtasks: [],
  };
  data.tasks.push(task);
  saveData(data);
  res.status(201).json(task);
});

app.put('/api/tasks/:id', (req, res) => {
  const task = findTask(req.params.id);
  if (!task) return res.status(404).json({ error: 'Task not found' });

  const { text, dueAt, completed } = req.body;
  if (typeof text === 'string' && text.trim()) task.text = text.trim();
  if (dueAt !== undefined) {
    if (dueAt !== task.dueAt) task.notified = false; // allow re-notify on reschedule
    task.dueAt = dueAt;
  }
  if (typeof completed === 'boolean') task.completed = completed;
  saveData(data);
  res.json(task);
});

// Soft delete: moves the task to trash instead of erasing it.
app.delete('/api/tasks/:id', (req, res) => {
  const task = findTask(req.params.id);
  if (!task) return res.status(404).json({ error: 'Task not found' });
  task.deletedAt = new Date().toISOString();
  saveData(data);
  res.json(task);
});

// Bring a trashed task back to the active list.
app.post('/api/tasks/:id/restore', (req, res) => {
  const task = findTask(req.params.id);
  if (!task) return res.status(404).json({ error: 'Task not found' });
  task.deletedAt = null;
  saveData(data);
  res.json(task);
});

// Hard delete: permanently erases a trashed task. Requires the caller to
// type the task's exact name as confirmText, so it can't happen by accident.
app.delete('/api/tasks/:id/permanent', (req, res) => {
  const task = findTask(req.params.id);
  if (!task) return res.status(404).json({ error: 'Task not found' });
  const confirmText = (req.body && req.body.confirmText || '').trim();
  if (confirmText !== task.text) {
    return res.status(400).json({ error: 'Task name does not match' });
  }
  data.tasks = data.tasks.filter(t => t.id !== req.params.id);
  saveData(data);
  res.status(204).end();
});

// "Clear all" soft-deletes every active task so it can still be restored
// from the trash afterwards.
app.delete('/api/tasks', (req, res) => {
  const now = new Date().toISOString();
  data.tasks.forEach(t => {
    if (!t.deletedAt) t.deletedAt = now;
  });
  saveData(data);
  res.status(204).end();
});

// ---- API: subtasks ----
app.post('/api/tasks/:id/subtasks', (req, res) => {
  const task = findTask(req.params.id);
  if (!task) return res.status(404).json({ error: 'Task not found' });

  const { text, dueAt } = req.body;
  if (!text || !text.trim()) {
    return res.status(400).json({ error: 'Subtask text is required' });
  }
  const subtask = {
    id: nextId(),
    text: text.trim(),
    dueAt: dueAt || null,
    completed: false,
    notified: false,
  };
  task.subtasks.push(subtask);
  saveData(data);
  res.status(201).json(subtask);
});

app.put('/api/tasks/:id/subtasks/:subId', (req, res) => {
  const task = findTask(req.params.id);
  if (!task) return res.status(404).json({ error: 'Task not found' });
  const subtask = task.subtasks.find(s => s.id === req.params.subId);
  if (!subtask) return res.status(404).json({ error: 'Subtask not found' });

  const { text, dueAt, completed } = req.body;
  if (typeof text === 'string' && text.trim()) subtask.text = text.trim();
  if (dueAt !== undefined) {
    if (dueAt !== subtask.dueAt) subtask.notified = false;
    subtask.dueAt = dueAt;
  }
  if (typeof completed === 'boolean') subtask.completed = completed;
  saveData(data);
  res.json(subtask);
});

app.delete('/api/tasks/:id/subtasks/:subId', (req, res) => {
  const task = findTask(req.params.id);
  if (!task) return res.status(404).json({ error: 'Task not found' });
  task.subtasks = task.subtasks.filter(s => s.id !== req.params.subId);
  saveData(data);
  res.status(204).end();
});

// ---- API: recurring reminders ----
// Independent feature — does not touch List/Week/Month/Trash. Once created,
// a reminder keeps notifying on a loop at its own interval forever; it's
// never auto-removed, only by explicit delete or by being edited
// ("replaced"), which restarts its schedule from the new values.
app.get('/api/reminders', (req, res) => {
  res.json(data.reminders);
});

app.post('/api/reminders', (req, res) => {
  const { text, intervalValue, intervalUnit, startAt } = req.body;
  if (!text || !text.trim()) {
    return res.status(400).json({ error: 'Reminder text is required' });
  }
  const value = Math.max(1, Number(intervalValue) || 0);
  if (!value) {
    return res.status(400).json({ error: 'Interval value is required' });
  }
  const unit = REMINDER_UNITS.includes(intervalUnit) ? intervalUnit : 'minutes';
  const nextAt = startAt
    ? new Date(startAt).toISOString()
    : new Date(Date.now() + reminderIntervalMs(value, unit)).toISOString();

  const reminder = {
    id: nextId(),
    text: text.trim(),
    intervalValue: value,
    intervalUnit: unit,
    nextAt,
    createdAt: new Date().toISOString(),
  };
  data.reminders.push(reminder);  saveData(data);
  res.status(201).json(reminder);
});

// Editing = replacing the reminder: the loop restarts from the new schedule.
app.put('/api/reminders/:id', (req, res) => {
  const reminder = data.reminders.find(r => r.id === req.params.id);
  if (!reminder) return res.status(404).json({ error: 'Reminder not found' });

  const { text, intervalValue, intervalUnit, startAt } = req.body;
  if (typeof text === 'string' && text.trim()) reminder.text = text.trim();
  if (intervalValue !== undefined) reminder.intervalValue = Math.max(1, Number(intervalValue) || 1);
  if (intervalUnit !== undefined && REMINDER_UNITS.includes(intervalUnit)) {
    reminder.intervalUnit = intervalUnit;
  }
  reminder.nextAt = startAt
    ? new Date(startAt).toISOString()
    : new Date(Date.now() + reminderIntervalMs(reminder.intervalValue, reminder.intervalUnit)).toISOString();

  saveData(data);
  res.json(reminder);
});

// Only way a reminder truly disappears — an explicit delete.
app.delete('/api/reminders/:id', (req, res) => {
  const before = data.reminders.length;
  data.reminders = data.reminders.filter(r => r.id !== req.params.id);
  if (data.reminders.length === before) {
    return res.status(404).json({ error: 'Reminder not found' });
  }
  saveData(data);
  res.status(204).end();
});

// ---- Notification sending ----
// Returns true if the push was actually delivered to at least one
// subscription (or if there were no subscriptions to begin with — in
// that case there's nothing to retry). Returns false if every attempt
// failed, so the caller can leave the task/subtask un-notified and
// retry it on the next tick instead of silently losing it forever.
async function sendPushToAll(payload) {
  if (data.subscriptions.length === 0) {
    console.warn(`[push] No subscriptions registered yet — nothing to send "${payload.title}: ${payload.body}" to. Open the app and tap "Enable" on the notification banner first.`);
    return true;
  }

  const stillValid = [];
  let sentCount = 0;
  for (const sub of data.subscriptions) {
    try {
      await webpush.sendNotification(sub, JSON.stringify(payload));
      stillValid.push(sub);
      sentCount++;
    } catch (err) {
      // 410/404 = subscription expired or the user uninstalled/unsubscribed —
      // safe to drop, retrying it would never succeed.
      if (err.statusCode !== 410 && err.statusCode !== 404) {
        stillValid.push(sub);
      }
      console.warn(
        `[push] Failed to deliver "${payload.title}" (status ${err.statusCode || 'n/a'}): ${err.body || err.message}`
      );
    }
  }
  if (stillValid.length !== data.subscriptions.length) {
    data.subscriptions = stillValid;
    saveData(data);
  }
  return sentCount > 0;
}

// Check every minute for tasks (and subtasks) that just became due.
cron.schedule('* * * * *', async () => {
  const now = Date.now();
  let changed = false;
  for (const task of data.tasks) {
    if (task.deletedAt) continue;
    if (!task.completed && task.dueAt && !task.notified && new Date(task.dueAt).getTime() <= now) {
      const delivered = await sendPushToAll({ title: 'Task due now', body: task.text });
      if (delivered) {
        task.notified = true;
        changed = true;
      }
      // if delivery failed for every subscription, leave notified=false so
      // it gets retried on the next minute's tick instead of being lost.
    }
    for (const sub of task.subtasks) {
      if (!sub.completed && sub.dueAt && !sub.notified && new Date(sub.dueAt).getTime() <= now) {
        const delivered = await sendPushToAll({ title: 'Subtask due now', body: `${task.text} — ${sub.text}` });
        if (delivered) {
          sub.notified = true;
          changed = true;
        }
      }
    }
  }

  // Recurring reminders: fire, then push nextAt forward by the interval —
  // never marked "done", so it just loops again on its own. tag+alarm:true
  // tells the phone to vibrate/alert every single loop, not just the first time.
  for (const reminder of data.reminders) {
    const dueTime = new Date(reminder.nextAt).getTime();
    if (dueTime <= now) {
      const delivered = await sendPushToAll({
        title: 'Reminder',
        body: reminder.text,
        tag: 'reminder-' + reminder.id,
        alarm: true,
      });
      if (delivered) {
        const step = reminderIntervalMs(reminder.intervalValue, reminder.intervalUnit);
        let next = dueTime;
        while (next <= now) next += step; // catch up without spamming if the server was down
        reminder.nextAt = new Date(next).toISOString();
        changed = true;
      }
      // if delivery failed, leave nextAt as-is so it's retried next tick
    }
  }

  if (changed) saveData(data);
});

app.listen(PORT, () => {
  console.log(`To-Do app running at http://localhost:${PORT}`);
});
