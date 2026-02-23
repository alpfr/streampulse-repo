import express from "express";
import cors from "cors";
import dotenv from "dotenv";
dotenv.config();
import multer from "multer";
import { readFileSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import {
  initDB,
  getWeeklyData,
  getWeeklyByService,
  getSpecialEvents,
  upsertWeeklyBatch,
  replaceAllWeekly,
  upsertSpecialEvent,
  replaceAllEvents,
  logUpload,
  getUploadHistory,
  getStats,
  deleteServiceData,
  saveInsight,
  getLatestInsight,
  getInsightHistory,
  getConfig,
  setConfig,
} from "./db.js";
import { parseCSV } from "./csv-parser.js";
import jwt from "jsonwebtoken";

const __dirname = dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 8000;
const ADMIN_PIN = process.env.ADMIN_PIN || "1234";
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || "";
const JWT_SECRET = process.env.JWT_SECRET || "streampulse_super_secret_key_2025";

app.use(cors());
app.use(express.json());

/* ── Multer for CSV uploads ─────────────────────────────────────────── */
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10 MB
  fileFilter: (_req, file, cb) => {
    if (file.mimetype === "text/csv" || file.originalname.endsWith(".csv")) {
      cb(null, true);
    } else {
      cb(new Error("Only CSV files are allowed"));
    }
  },
});

/* ── Auth middleware ─────────────────────────────────────────────────── */
function requireAdmin(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return res.status(401).json({ error: "Missing or invalid authorization header" });
  }

  const token = authHeader.split(" ")[1];
  try {
    jwt.verify(token, JWT_SECRET);
    next();
  } catch (err) {
    return res.status(401).json({ error: "Invalid or expired token" });
  }
}

/* ═══════════════════════════════════════════════════════════════════════
   API ROUTES
   ═══════════════════════════════════════════════════════════════════════ */

/* ── GET /api/data — All weekly data + special events ───────────────── */
app.get("/api/data", (_req, res) => {
  try {
    const data = getWeeklyData();
    const events = getSpecialEvents();
    const config = getConfig("services") || [];
    res.json({ data, events, config });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/* ── POST /api/data — Manual entry (add/update individual rows) ─────── */
app.post("/api/data", requireAdmin, (req, res) => {
  try {
    const { entries } = req.body;
    if (!entries || !Array.isArray(entries)) {
      return res.status(400).json({ error: "entries array required" });
    }
    const rows = entries.map((e) => ({
      service: e.service,
      date: e.date,
      month: e.month || e.date.slice(0, 7),
      platforms: e.platforms || {},
      total: e.total || 0,
    }));
    const result = upsertWeeklyBatch(rows);
    res.json({ success: true, ...result });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/* ── GET /api/data/:service — Weekly data for one service ───────────── */
app.get("/api/data/:service", (req, res) => {
  try {
    const rows = getWeeklyByService(req.params.service);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/* ── GET /api/special-events — All special events ───────────────────── */
app.get("/api/special-events", (_req, res) => {
  try {
    const events = getSpecialEvents();
    res.json(events);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/* ── GET /api/stats — Summary statistics ────────────────────────────── */
app.get("/api/stats", (_req, res) => {
  try {
    const stats = getStats();
    const history = getUploadHistory();
    res.json({ ...stats, lastUpload: history[0] || null });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/* ── GET /api/uploads — Upload history ──────────────────────────────── */
app.get("/api/uploads", (_req, res) => {
  try {
    res.json(getUploadHistory());
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/* ── POST /api/auth — Verify admin PIN ──────────────────────────────── */
app.post("/api/auth", (req, res) => {
  const { pin } = req.body;
  if (pin === ADMIN_PIN) {
    const token = jwt.sign({ admin: true }, JWT_SECRET, { expiresIn: "30m" });
    res.json({ success: true, token, timeout: 30 * 60 * 1000 });
  } else {
    res.status(401).json({ error: "Invalid PIN" });
  }
});

/* ── POST /api/upload — CSV upload (replace/append) ─────────────────── */
app.post("/api/upload", requireAdmin, upload.single("csv"), (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: "No CSV file provided" });

    const mode = req.body.mode || "append"; // "replace" or "append"
    const csvText = req.file.buffer.toString("utf-8");
    const parsed = parseCSV(csvText);

    if (parsed.totalRows === 0) {
      return res.status(400).json({ error: "No data found in CSV. Check format." });
    }

    // Flatten services into rows
    const allRows = [];
    for (const [svc, entries] of Object.entries(parsed.services)) {
      for (const entry of entries) {
        allRows.push({ ...entry, service: svc });
      }
    }

    let result;
    if (mode === "replace") {
      result = replaceAllWeekly(allRows);
      if (parsed.specialEvents.length > 0) {
        replaceAllEvents(parsed.specialEvents);
      }
    } else {
      // append/merge — upsert (update existing, add new)
      result = upsertWeeklyBatch(allRows);
      for (const ev of parsed.specialEvents) {
        upsertSpecialEvent(ev);
      }
    }

    // Save the dynamic config
    if (parsed.config && parsed.config.length > 0) {
      setConfig("services", parsed.config);
    }

    // Log the upload
    logUpload({
      filename: req.file.originalname,
      mode,
      rows_added: result.added,
      rows_updated: result.updated,
      rows_total: allRows.length,
    });

    res.json({
      success: true,
      mode,
      filename: req.file.originalname,
      ...result,
      rows: allRows.length,
      totalProcessed: allRows.length,
      specialEvents: parsed.specialEvents.length,
      stats: parsed.summary,
      config: parsed.config
    });

    // Auto-generate AI insights in background (non-blocking)
    if (ANTHROPIC_API_KEY) {
      generateInsights("upload").then(() => {
        console.log("  ✨ AI insights generated after upload");
      }).catch(err => {
        console.error("  ⚠️  AI insights generation failed:", err.message);
      });
    }
  } catch (err) {
    console.error("Upload error:", err);
    res.status(500).json({ error: err.message });
  }
});

/* ── GET /api/export — Export current data as CSV ───────────────────── */
app.get("/api/export", (_req, res) => {
  try {
    const data = getWeeklyData();
    const services = Object.keys(data);
    const config = getConfig("services") || [];

    // Find all possible platforms from config to build headers
    const platformCols = new Set();
    for (const svc of config) {
      for (const p of svc.platforms) platformCols.add(p.id);
    }
    const pcArray = Array.from(platformCols);

    // Build CSV
    const headers = [
      "service", "date", "month",
      ...pcArray,
      "total",
    ];

    let csv = headers.join(",") + "\n";
    for (const svc of services) {
      for (const row of data[svc]) {
        const rowData = [row.service, row.date, row.month];
        for (const p of pcArray) {
          rowData.push(row.platforms[p] || 0);
        }
        rowData.push(row.total || 0);
        csv += rowData.join(",") + "\n";
      }
    }

    res.setHeader("Content-Type", "text/csv");
    res.setHeader("Content-Disposition", "attachment; filename=streampulse_export.csv");
    res.send(csv);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/* ── DELETE /api/data/:service — Delete one service's data ──────────── */
app.delete("/api/data/:service", requireAdmin, (req, res) => {
  try {
    deleteServiceData(req.params.service);
    res.json({ success: true, deleted: req.params.service });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/* ═══════════════════════════════════════════════════════════════════════
   AI INSIGHTS — Claude API Integration
   ═══════════════════════════════════════════════════════════════════════ */

function buildInsightsPrompt(data, events, config) {
  const serviceNames = {};
  for (const c of config) {
    serviceNames[c.id] = c.name;
  }

  const services = Object.keys(data);

  let prompt = `You are an analytics assistant. Analyze the following streaming viewer data across multiple services and platforms, and provide insights.\n\n`;

  for (const svc of services) {
    const rows = data[svc] || [];
    if (!rows.length) continue;
    const name = serviceNames[svc] || svc;
    const recent = rows.slice(-8); // Last 8 weeks
    const total = rows.reduce((s, r) => s + r.total, 0);
    const avg = Math.round(total / rows.length);
    const latest = rows[rows.length - 1];
    const prev = rows.length > 1 ? rows[rows.length - 2] : null;
    const change = prev && prev.total > 0 ? ((latest.total - prev.total) / prev.total * 100).toFixed(1) : "N/A";

    prompt += `### ${name} (${rows.length} weeks)\n`;
    prompt += `Total: ${total.toLocaleString()} | Avg: ${avg}/week | Latest: ${latest.total} (${change}% vs prior)\n`;
    prompt += `Last 8 weeks: ${recent.map(r => r.total).join(", ")}\n`;

    // Dynamic platform breakdowns
    let pBreakdown = [];
    for (const [p, val] of Object.entries(latest.platforms || {})) {
      pBreakdown.push(`${p}=${val}`);
    }
    prompt += `Latest breakdown: ${pBreakdown.join(", ")}\n\n`;
  }

  if (events.length > 0) {
    prompt += `### Special Events (${events.length} events)\n`;
    for (const ev of events) {
      const evTotal = ev.data.reduce((s, d) => s + d.total, 0);
      prompt += `- ${ev.name}: ${evTotal.toLocaleString()} viewers (${ev.data.length} sessions) — ${ev.dates}\n`;
    }
    prompt += `\n`;
  }

  prompt += `Please respond in this exact JSON format (no markdown, no backticks):
{
  "summary": "A 2-3 sentence executive summary of the overall state of streaming viewership. Include the most important trend or insight.",
  "highlights": [
    {"icon": "trending_up|trending_down|star|alert|zap", "title": "Short title", "detail": "1-2 sentence explanation", "service": "main_event|category_name|all"}
  ],
  "alerts": [
    {"severity": "info|warning|success", "message": "Short actionable alert"}
  ],
  "platform_insight": "A sentence about which platforms are performing best/worst and any shifts.",
  "recommendation": "One specific, actionable recommendation for the media team."
}

Provide 4-6 highlights and 2-3 alerts. Be specific with numbers. Focus on trends, anomalies, and actionable insights. Be encouraging but honest.`;

  return prompt;
}

async function generateInsights(triggerType = "manual") {
  if (!ANTHROPIC_API_KEY) {
    throw new Error("ANTHROPIC_API_KEY not set. Add it to your environment variables.");
  }

  const data = getWeeklyData();
  const events = getSpecialEvents();

  const config = getConfig("services") || [];
  const prompt = buildInsightsPrompt(data, events, config);

  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-sonnet-4-20250514",
      max_tokens: 1500,
      messages: [{ role: "user", content: prompt }],
    }),
  });

  if (!response.ok) {
    let errMsg = await response.text();
    try {
      const parsedErr = JSON.parse(errMsg);
      if (parsedErr.error && parsedErr.error.message) {
        errMsg = parsedErr.error.message;
      }
    } catch (e) { }

    if (response.status === 401 || response.status === 403) {
      throw new Error("Invalid Anthropic API Key or unauthorized. Please check your configuration.");
    } else if (response.status === 429) {
      throw new Error("Anthropic API rate limit or quota exceeded. Please check your billing dashboard or try again later.");
    } else if (response.status === 529 || response.status === 503) {
      throw new Error("Anthropic API is currently overloaded/unavailable. Please try again later.");
    }

    throw new Error(`Claude API error (${response.status}): ${errMsg}`);
  }

  const result = await response.json();
  const text = result.content
    .filter((b) => b.type === "text")
    .map((b) => b.text)
    .join("");

  // Parse the JSON response
  const cleaned = text.replace(/```json|```/g, "").trim();
  let parsed;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    // If JSON parse fails, wrap raw text as summary
    parsed = { summary: text, highlights: [], alerts: [], platform_insight: "", recommendation: "" };
  }

  // Save to database
  saveInsight({
    trigger_type: triggerType,
    summary: JSON.stringify(parsed),
    highlights: JSON.stringify(parsed.highlights || []),
    alerts: JSON.stringify(parsed.alerts || []),
    prompt_tokens: result.usage?.input_tokens || 0,
    completion_tokens: result.usage?.output_tokens || 0,
  });

  return parsed;
}

/* ── GET /api/insights — Get latest AI insight ─────────────────────── */
app.get("/api/insights", (_req, res) => {
  try {
    const insight = getLatestInsight();
    if (!insight) return res.json({ available: false, configured: !!ANTHROPIC_API_KEY });

    let parsed;
    try { parsed = JSON.parse(insight.summary); } catch { parsed = { summary: insight.summary }; }

    res.json({
      available: true,
      configured: !!ANTHROPIC_API_KEY,
      generated_at: insight.generated_at,
      trigger_type: insight.trigger_type,
      ...parsed,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/* ── GET /api/insights/history — Insight history ───────────────────── */
app.get("/api/insights/history", (_req, res) => {
  try {
    res.json(getInsightHistory());
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/* ── POST /api/insights/generate — Generate new insight ────────────── */
app.post("/api/insights/generate", requireAdmin, async (_req, res) => {
  try {
    const insight = await generateInsights("manual");
    res.json({ success: true, ...insight });
  } catch (err) {
    console.error("AI Insights error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

/* ── GET /api/insights/status — Check if API key is configured ─────── */
app.get("/api/insights/status", (_req, res) => {
  res.json({
    configured: !!ANTHROPIC_API_KEY,
    hasInsights: !!getLatestInsight(),
  });
});

/* ═══════════════════════════════════════════════════════════════════════
   SERVE FRONTEND (production)
   ═══════════════════════════════════════════════════════════════════════ */

const publicDir = join(__dirname, "public");
if (existsSync(join(publicDir, "index.html"))) {
  app.use(express.static(publicDir));
  app.get("*", (_req, res) => {
    res.sendFile(join(publicDir, "index.html"));
  });
}

/* ── Start ──────────────────────────────────────────────────────────── */
async function start() {
  await initDB();
  app.listen(PORT, () => {
    const aiStatus = ANTHROPIC_API_KEY ? "✨ AI Insights: ON" : "💡 AI Insights: OFF (set ANTHROPIC_API_KEY)";
    console.log(`
  ╔══════════════════════════════════════════════╗
  ║   StreamPulse Analytics Dashboard            ║
  ║   Server running on http://localhost:${PORT}     ║
  ║   API:  http://localhost:${PORT}/api/data        ║
  ║   ${aiStatus.padEnd(43)}║
  ╚══════════════════════════════════════════════╝
    `);
  });
}

start().catch(console.error);
