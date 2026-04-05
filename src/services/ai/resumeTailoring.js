import { callAI, parseJSON } from "../../lib/llm/client.js";

const HUMAN_STYLE = `Writing style rules:
- Write like a confident human professional, not an AI.
- Vary sentence length.
- No em-dashes (—). Use commas or restructure instead.
- No asterix (*) in the output.
- No citations or reference markers like [1] or [4].
- Banned words: "delve", "leverage", "spearhead", "passionate", "dynamic", "synergy", "utilize", "robust", "seamlessly", "cutting-edge", "innovative", "transformative".
- Ground every claim in the candidate's actual experience — no invented details.`;

export async function tailorCV(analysis, profile) {
  const raw = await callAI(
    `You are a professional CV writer. Return ONLY valid JSON with NO markdown or backticks:
{
  "headline": "concise professional title, max 5 words, no keyword stuffing — e.g. 'Staff Engineer, Go & Kubernetes'",
  "summary": "3-sentence tailored professional summary, plain text no markdown",
  "injectedBullets": [
    {
      "original": "original bullet text",
      "tailored": "rewritten bullet with job keywords naturally embedded, plain text no markdown",
      "reason": "why this change helps"
    }
  ],
  "coverLineSuggestion": "1 direct opening sentence grounded in a specific achievement, no filler openers",
  "keywordsInjected": ["kw1","kw2","kw3"]
}
Rules: rewrite exactly 3 bullets. Never fabricate skills — only rephrase real experience.
${HUMAN_STYLE}`,
    `ANALYSIS:\n${JSON.stringify(analysis, null, 2)}\n\nPROFILE:\n${JSON.stringify(profile, null, 2)}`,
    3000
  );
  return parseJSON(raw);
}
