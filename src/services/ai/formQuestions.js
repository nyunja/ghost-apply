import { callAI, parseJSON } from "../../lib/llm/client.js";

const TOKENS_PER_QUESTION = 60;

// Normalize both flat (profile.js) and nested (profiles/) profile shapes
function normalizeProfile(profile) {
  const p = profile.personalInfo ?? profile;
  return {
    name:     p.name,
    email:    p.email,
    phone:    p.phone,
    location: p.location,
    city:     p.city    || p.location?.split(",")[0]?.trim(),
    country:  p.country || p.location?.split(",").pop()?.trim(),
    linkedin: p.linkedin,
    github:   p.github,
    website:  p.website,
    stack:    profile.skills?.categories?.flatMap(c => c.items) ?? profile.stack ?? [],
  };
}

// Label keywords → profile field direct mapping (no AI needed)
const DIRECT_MAP = [
  { keys: ["linkedin"],                       field: "linkedin" },
  { keys: ["github"],                         field: "github" },
  { keys: ["website", "portfolio"],           field: "website" },
  { keys: ["phone", "mobile", "telephone"],   field: "phone" },
  { keys: ["country", "nationality"],         field: "country" },
  { keys: ["city", "location"],               field: "city" },
  { keys: ["preferred", "first name"],        field: "name",    transform: v => v?.split(" ")[0] },
  { keys: ["full name"],                      field: "name" },
  { keys: ["email"],                          field: "email" },
];

function directAnswer(label, p) {
  const l = label.toLowerCase();
  for (const { keys, field, transform } of DIRECT_MAP) {
    if (keys.some(k => l.includes(k))) {
      const val = p[field];
      return val ? (transform ? transform(val) : val) : null;
    }
  }
  return null;
}

export async function answerFormQuestions(questions, profile, tailoredCV) {
  if (!questions.length) return { questionResponses: { mappedAnswers: [] } };

  const p = normalizeProfile(profile);

  // Pre-fill anything we can answer directly from the profile
  const directAnswers = [];
  const needsAI = [];

  for (const q of questions) {
    const answer = directAnswer(q.label, p);
    if (answer) {
      directAnswers.push({ question: q, answer });
    } else {
      needsAI.push(q);
    }
  }

  let aiAnswers = [];
  if (needsAI.length) {
    const BATCH = 25;
    if (needsAI.length > BATCH) {
      for (let i = 0; i < needsAI.length; i += BATCH) {
        const partial = await _callAIForQuestions(needsAI.slice(i, i + BATCH), p, tailoredCV);
        aiAnswers.push(...partial);
      }
    } else {
      aiAnswers = await _callAIForQuestions(needsAI, p, tailoredCV);
    }
  }

  const mappedAnswers = [...directAnswers, ...aiAnswers];
  return {
    questionResponses: {
      personalInfo: { name: p.name, email: p.email, phone: p.phone },
      jobInfo: {
        company: "",
        role: tailoredCV.headline ?? "",
        jobUrl: "",
        date: new Date().toISOString().split("T")[0]
      },
      responses: mappedAnswers.map((a, i) => ({
        index: i + 1, question: a.question.label, answer: a.answer, type: a.question.type
      })),
      metadata: { version: "1.0", lastUpdated: new Date().toISOString(), source: "application-form" },
      mappedAnswers,
    }
  };
}

async function _callAIForQuestions(questions, p, tailoredCV) {
  const maxTokens = Math.min(200 + questions.length * TOKENS_PER_QUESTION, 4000);

  const qList = questions.map((q, i) => {
    let line = `${i + 1}. [${q.type.toUpperCase()}] ${q.label}`;
    if (q.options?.length) line += `\n   Options: ${q.options.map(o => o.label || o.value).join(" | ")}`;
    return line;
  }).join("\n");

  const raw = await callAI(
    `You are completing a job application form. Answer every question based ONLY on the candidate profile provided.
Return ONLY valid JSON: { "responses": [ { "index": 1, "answer": "..." } ] }
Rules:
- YES/NO → exactly "Yes" or "No".
- Radio/dropdown → one option label verbatim.
- Text/textarea → max 2 sentences, professional, grounded in the profile.
- No em-dashes, no citations like [1], no AI filler phrases.
- If genuinely unknown, use an empty string — never invent or guess.`,
    `Candidate: ${p.name} | ${p.location}
Email: ${p.email} | Phone: ${p.phone}
LinkedIn: ${p.linkedin || "N/A"} | GitHub: ${p.github || "N/A"} | Website: ${p.website || "N/A"}
Role applying for: ${tailoredCV.headline ?? "the position"}
Skills: ${p.stack.slice(0, 20).join(", ")}

Questions:
${qList}`,
    maxTokens
  );

  const parsed = parseJSON(raw);
  return (parsed.responses ?? [])
    .map(r => ({ question: questions[r.index - 1], answer: String(r.answer ?? "") }))
    .filter(a => a.question && a.answer);
}
