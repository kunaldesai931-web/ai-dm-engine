// server.js
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const express = require('express');
const cors = require('cors');

const app = express();

const PORT = process.env.PORT || 4000;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const MODEL = process.env.MODEL || 'gpt-4.1';

if (!OPENAI_API_KEY) {
  console.error('Missing OPENAI_API_KEY in .env');
  process.exit(1);
}

app.use(express.json());
app.use(
  cors({
    origin: '*', // in prod you can restrict this to your frontend domain
  })
);

const STATE_PATH = path.join(__dirname, 'state.json');
const USAGE_PATH = path.join(__dirname, 'usage.json');

// --------- STATE HELPERS ----------

function loadState() {
  const raw = fs.readFileSync(STATE_PATH, 'utf8');
  return JSON.parse(raw);
}

function saveState(state) {
  fs.writeFileSync(STATE_PATH, JSON.stringify(state, null, 2), 'utf8');
}

function applyDelta(state, delta) {
  if (!delta) return state;

  function merge(target, src) {
    if (typeof src !== 'object' || src === null) return target;

    for (const key of Object.keys(src)) {
      const val = src[key];

      if (Array.isArray(val)) {
        // Replace arrays entirely
        target[key] = val;
      } else if (val !== null && typeof val === 'object') {
        // Deep merge objects
        if (!target[key] || typeof target[key] !== 'object') {
          target[key] = {};
        }
        merge(target[key], val);
      } else {
        // Primitives / null overwrite
        target[key] = val;
      }
    }
    return target;
  }

  return merge(state, delta);
}

// --------- USAGE / BUDGET HELPERS ----------

function loadUsage() {
  try {
    const raw = fs.readFileSync(USAGE_PATH, 'utf8');
    return JSON.parse(raw);
  } catch (err) {
    // If file missing or invalid, start fresh
    return { month: '', total_tokens: 0 };
  }
}

function saveUsage(usage) {
  fs.writeFileSync(USAGE_PATH, JSON.stringify(usage, null, 2), 'utf8');
}

function updateMonthlyUsage(tokenCount) {
  const now = new Date();
  const currentMonth = `${now.getFullYear()}-${now.getMonth() + 1}`; // e.g. "2025-11"
  let usage = loadUsage();

  if (usage.month !== currentMonth) {
    usage = { month: currentMonth, total_tokens: 0 };
  }

  usage.total_tokens += tokenCount;
  saveUsage(usage);

  return usage.total_tokens;
}

// --------- DM PROTOCOL (SYSTEM PROMPT) ----------

const DM_PROTOCOL = `
You are an AI Dungeon Master and simulation engine for a persistent tabletop campaign.
You are NOT a generic chatbot. You run the world, adjudicate rules fairly, and advance the story.

You are given:
1) A JSON "state" object representing the current campaign world.
2) A "player_input" string describing what the player does or asks.

Your job:
- Interpret player_input using the context from state.
- Narrate what happens next (succinct but vivid).
- Decide NPC/enemy reactions, checks, and consequences.
- Update the campaign state via a "delta" object:
  - Only include fields that changed.
  - Use the same structure as "state" so it can be merged.
  - Do NOT output the whole state, only changes.

Very important:
- You MUST respond ONLY in strict JSON with two top-level keys:
  {
    "dm_output": "<your narration and mechanical results as plain text>",
    "delta": { ... only changed fields ... }
  }

- Do not include any backticks, markdown fences, comments, or extra text outside valid JSON.
- dm_output is what the player sees: description + dice results + clear mechanical outcomes.
- delta should be minimal and machine-mergeable.

Examples of delta usage:
- To change party gold:
  "economy": { "party_gold": 150 }

- To change a faction attitude:
  "factions": { "RedKnives": { "attitude": "More Hostile" } }

- To update the log (treat "log" as the full array you want saved):
  "log": [
    "Older entries (optionally trimmed)...",
    "Short summary of what just happened."
  ]
`;

// --------- ROUTES ----------

// Get full state (for debugging / UI side panel)
app.get('/api/state', (req, res) => {
  try {
    const state = loadState();
    res.json(state);
  } catch (err) {
    console.error('Error loading state:', err);
    res.status(500).json({ error: 'Failed to load state' });
  }
});

// One DM turn
app.post('/api/turn', async (req, res) => {
  const { playerInput } = req.body;

  if (!playerInput || typeof playerInput !== 'string') {
    return res.status(400).json({ error: 'playerInput (string) is required' });
  }

  let state;
  try {
    state = loadState();
  } catch (err) {
    console.error('Error loading state:', err);
    return res.status(500).json({ error: 'Failed to load state' });
  }

  // Check monthly budget BEFORE making a new call if you want hard cap
  const existingUsage = loadUsage();
  const limit = parseInt(process.env.MONTHLY_TOKEN_LIMIT || '200000', 10);
  if (existingUsage.total_tokens >= limit && existingUsage.month) {
    return res.status(429).json({
      dmOutput:
        '⚠️ Monthly usage limit reached before this request. Please increase your budget or wait until next month.',
      delta: {},
      stateSummary: {
        party: state.party,
        economy: state.economy,
      },
    });
  }

  try {
    const messages = [
      { role: 'system', content: DM_PROTOCOL },
      {
        role: 'user',
        content: JSON.stringify({
          state,
          player_input: playerInput,
        }),
      },
    ];

    const openaiRes = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${OPENAI_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: MODEL,
        messages,
        temperature: 0.7,
      }),
    });

    if (!openaiRes.ok) {
      const text = await openaiRes.text();
      console.error('OpenAI error:', text);
      return res.status(500).json({ error: 'OpenAI API error', detail: text });
    }

    const data = await openaiRes.json();
    const content = data.choices?.[0]?.message?.content;

    // ---- Usage tracking ----
    const tokenCount = data.usage?.total_tokens || 0;
    const monthlyTokens = updateMonthlyUsage(tokenCount);

    const warnThreshold = parseFloat(process.env.WARNING_THRESHOLD || '0.9');
    let budgetWarning = '';

    if (monthlyTokens >= limit) {
      // We've just exceeded the monthly budget with this call
      budgetWarning =
        '⚠️ Monthly usage limit has now been reached. Future requests may be blocked until next month.\n\n';
    } else if (monthlyTokens >= limit * warnThreshold) {
      budgetWarning =
        '⚠️ Warning: You have used more than ' +
        Math.round(warnThreshold * 100) +
        '% of your monthly token budget.\n\n';
    }

    let parsed;
    try {
      parsed = JSON.parse(content);
    } catch (err) {
      console.error('Failed to parse model JSON:', content);
      return res.status(500).json({ error: 'Model returned invalid JSON' });
    }

    const dmOutput = parsed.dm_output || '';
    const delta = parsed.delta || {};

    const newState = applyDelta(state, delta);
    saveState(newState);

    const stateSummary = {
      party: newState.party,
      economy: newState.economy,
    };

    res.json({
      dmOutput: budgetWarning + dmOutput,
      delta,
      stateSummary,
      usage: {
        month: loadUsage().month,
        total_tokens: loadUsage().total_tokens,
        limit,
      },
    });
  } catch (err) {
    console.error('Error in /api/turn:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

app.listen(PORT, () => {
  console.log(`AI DM backend listening on port ${PORT}`);
});
