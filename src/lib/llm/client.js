// ─────────────────────────────────────────────
//  AI Intelligence Layer — Claude + Gemini + OpenRouter + Perplexity
//  Provider is read from ~/.jobtailor/config.json
//  or overridden by AI_PROVIDER / AI_MODEL env vars.
// ─────────────────────────────────────────────

import { getConfig } from "../../services/tracker.js";

const CLAUDE_URL      = "https://api.anthropic.com/v1/messages";
const GEMINI_BASE     = "https://generativelanguage.googleapis.com/v1beta/models";
const OPENROUTER_URL  = "https://openrouter.ai/api/v1/chat/completions";
const PERPLEXITY_URL  = "https://api.perplexity.ai/chat/completions";

// ── Provider / model resolution ───────────────

export function getProvider() {
  return process.env.AI_PROVIDER ?? getConfig().provider ?? "claude";
}

export function getModel() {
  return process.env.AI_MODEL ?? getConfig().model ?? "claude-opus-4-5";
}

// ── Claude call ───────────────────────────────

async function callClaude(system, user, maxTokens = 1500) {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) throw new Error("ANTHROPIC_API_KEY is not set.");

  const res = await fetch(CLAUDE_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": key,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model:      getModel(),
      max_tokens: maxTokens,
      system,
      messages: [{ role: "user", content: user }],
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Claude API error ${res.status}: ${err}`);
  }

  const data = await res.json();
  return data.content?.[0]?.text ?? "";
}

// ── Gemini call ───────────────────────────────

const GEMINI_MAX_RETRIES = 3;

async function callGemini(system, user, maxTokens = 1500, attempt = 1) {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error("GEMINI_API_KEY is not set.");

  const model = getModel();
  const url   = `${GEMINI_BASE}/${model}:generateContent?key=${key}`;

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: system }] },
      contents: [{ role: "user", parts: [{ text: user }] }],
      generationConfig: { maxOutputTokens: maxTokens },
    }),
  });

  if (!res.ok) {
    const body = await res.json().catch(() => null);

    if (res.status === 429 && body) {
      const details       = body.error?.details ?? [];
      const retryInfo     = details.find(d => d["@type"]?.includes("RetryInfo"));
      const quotaFailure  = details.find(d => d["@type"]?.includes("QuotaFailure"));
      const violations    = quotaFailure?.violations ?? [];

      const dailyExhausted = violations.some(v => v.quotaId?.includes("PerDay"));
      if (dailyExhausted) {
        throw new Error(
          `Gemini free-tier daily quota exhausted for ${model}.\n` +
          `  Resets at midnight Pacific time.\n` +
          `  → Switch to Claude now:  node index.js config`
        );
      }

      if (attempt <= GEMINI_MAX_RETRIES && retryInfo?.retryDelay) {
        const delaySec = (parseInt(retryInfo.retryDelay, 10) || 60) + 2; 
        process.stderr.write(
          `  ⏳ Gemini rate limited (attempt ${attempt}/${GEMINI_MAX_RETRIES}) — ` +
          `retrying in ${delaySec}s...\n`
        );
        await new Promise(r => setTimeout(r, delaySec * 1000));
        return callGemini(system, user, maxTokens, attempt + 1);
      }

      const msg = body.error?.message ?? JSON.stringify(body);
      throw new Error(`Gemini rate limit: ${msg}`);
    }

    const msg = body?.error?.message ?? (await res.text().catch(() => `HTTP ${res.status}`));
    throw new Error(`Gemini API error ${res.status}: ${msg}`);
  }

  const data = await res.json();
  return data.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
}

// ── OpenRouter call ───────────────────────────

async function callOpenRouter(system, user, maxTokens = 1500) {
  const key = process.env.OPENROUTER_API_KEY;
  if (!key) throw new Error("OPENROUTER_API_KEY is not set.");

  const res = await fetch(OPENROUTER_URL, {
    method: "POST",
    headers: {
      "Content-Type":  "application/json",
      "Authorization": `Bearer ${key}`,
      "HTTP-Referer":  "https://github.com/jobtailor-cli",
      "X-Title":       "JobTailor CLI",
    },
    body: JSON.stringify({
      model:      getModel(),
      messages: [
        { role: "system", content: system },
        { role: "user",   content: user   },
      ],
      max_tokens: maxTokens,
    }),
  });

  if (!res.ok) {
    const body = await res.json().catch(() => null);
    const msg  = body?.error?.message ?? `HTTP ${res.status}`;
    const detail = body?.error?.metadata?.raw
      ? `\n  Upstream: ${body.error.metadata.raw}` : "";
    throw new Error(`OpenRouter error ${res.status}: ${msg}${detail}`);
  }

  const data = await res.json();
  const choice = data.choices?.[0];
  if (choice?.finish_reason === "length" && !choice?.message?.content) {
    throw new Error(
      `OpenRouter: model hit output token limit (finish_reason=length, content=null).\n` +
      `  Try a model with higher output limits or reduce input size.`
    );
  }
  return choice?.message?.content ?? "";
}

// ── Perplexity call ───────────────────────────
// Perplexity uses an OpenAI-compatible endpoint.
// Models: sonar, sonar-pro, sonar-reasoning, sonar-deep-research

async function callPerplexity(system, user, maxTokens = 1500) {
  const key = process.env.PERPLEXITY_API_KEY;
  if (!key) throw new Error("PERPLEXITY_API_KEY is not set.");

  const res = await fetch(PERPLEXITY_URL, {
    method: "POST",
    headers: {
      "Content-Type":  "application/json",
      "Authorization": `Bearer ${key}`,
    },
    body: JSON.stringify({
      model:      getModel(),
      messages: [
        { role: "system", content: system },
        { role: "user",   content: user   },
      ],
      max_tokens: maxTokens,
    }),
  });

  if (!res.ok) {
    const body = await res.json().catch(() => null);
    const msg  = body?.error?.message ?? `HTTP ${res.status}`;
    throw new Error(`Perplexity error ${res.status}: ${msg}`);
  }

  const data = await res.json();
  const choice = data.choices?.[0];
  if (choice?.finish_reason === "length" && !choice?.message?.content) {
    throw new Error("Perplexity: model hit output token limit. Try reducing input size.");
  }
  return choice?.message?.content ?? "";
}

// ── Router ────────────────────────────────────

export async function callAI(system, user, maxTokens = 1500) {
  const provider = getProvider();
  if (provider === "gemini")      return callGemini(system, user, maxTokens);
  if (provider === "openrouter")  return callOpenRouter(system, user, maxTokens);
  if (provider === "perplexity")  return callPerplexity(system, user, maxTokens);
  return callClaude(system, user, maxTokens);
}

export function parseJSON(raw) {
  let cleaned = raw.replace(/```json\n?|```/g, "").trim();

  const start = cleaned.indexOf("{");
  const end   = cleaned.lastIndexOf("}");
  if (start !== -1 && end !== -1 && end > start) {
    cleaned = cleaned.slice(start, end + 1);
  }

  try {
    return JSON.parse(cleaned);
  } catch (firstErr) {
    for (let i = cleaned.length - 1; i > start; i--) {
      if (cleaned[i] !== "}") continue;
      try {
        const candidate = cleaned.slice(start, i + 1);
        return JSON.parse(candidate);
      } catch { /* keep walking */ }
    }

    const answerPattern = /\{\s*"index"\s*:\s*(\d+)\s*,\s*"answer"\s*:\s*"((?:[^"\\]|\\.)*)"\s*\}/g;
    const rescued = [];
    let m;
    while ((m = answerPattern.exec(cleaned)) !== null) {
      rescued.push({ index: Number(m[1]), answer: m[2] });
    }
    if (rescued.length) {
      return { answers: rescued };
    }

    const expPattern = /\{\s*"role"\s*:\s*"([^"]*)"\s*,\s*"company"\s*:\s*"([^"]*)"[^}]*\}/g;
    const expRescued = [];
    while ((m = expPattern.exec(cleaned)) !== null) {
      expRescued.push({ role: m[1], company: m[2], duration: "", bullets: [] });
    }
    if (expRescued.length) {
      return {
        name: "", title: "", email: "", phone: "", location: "",
        linkedin: "", github: "", _label: "Extracted Profile", _category: "Other",
        stack: [], experience: expRescued, education: "", softSkills: [], impactHighlights: []
      };
    }

    throw new Error(
      `JSON parse failed: ${firstErr.message}\nRaw (first 300 chars): ${cleaned.slice(0, 300)}`
    );
  }
}
