// ─────────────────────────────────────────────
//  discovery.js — AI Browser Discovery
//  Identifies the correct UI trigger from a list of candidates.
// ─────────────────────────────────────────────

import { callAI } from "../../lib/llm/client.js";

/**
 * Identify the best selector for a specific action (apply, next) 
 * from a list of candidate elements.
 *
 * @param {string} action - 'apply' or 'next'
 * @param {Array<{ html: string, index: number }>} candidates
 * @returns {Promise<number|null>} - The index of the best candidate
 */
export async function identifyTrigger(action, candidates) {
  if (!candidates || !candidates.length) return null;

  const systemPrompt = `You are a browser automation expert. 
Your task is to identify the most likely "${action}" button from a list of HTML snippets.
Return ONLY a JSON object with the "index" of the best match. 
If no match is found, return {"index": null}.

Example: {"index": 2}`;

  const userPrompt = `CANDIDATES:\n${candidates.map(c => `[${c.index}] ${c.html}`).join("\n")}`;

  try {
    const raw = await callAI(systemPrompt, userPrompt, 200);
    const result = JSON.parse(raw.replace(/```json\n?|```/g, "").trim());
    return result.index;
  } catch (err) {
    console.error(`  ⚠ AI discovery failed: ${err.message}`);
    return null;
  }
}
