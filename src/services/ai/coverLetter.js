import { callAI, parseJSON } from "../../lib/llm/client.js";

const HUMAN_STYLE = `Writing style rules (apply to ALL prose output):
- Write like a confident human professional, not an AI.
- Vary sentence length — mix short punchy sentences with longer ones.
- No em-dashes (—). Use commas, periods, or restructure instead.
- No citations, footnotes, or reference markers like [1] or [4].
- Banned words/phrases: "delve", "leverage", "spearhead", "passionate", "dynamic", "synergy", "utilize", "robust", "seamlessly", "cutting-edge", "innovative", "transformative", "it's worth noting", "in conclusion".
- No filler openers like "I am excited to...", "I am writing to...".
- Ground every claim in the candidate's actual experience — no invented details.`;

export async function generateCoverLetter(analysis, profile, tailoredCV) {
  const pInfo    = profile.personalInfo ?? profile;
  const company  = analysis.company   ?? "the company";
  const role     = analysis.jobTitle  ?? tailoredCV.headline ?? "this role";
  const name     = pInfo.name         ?? "Candidate";
  const location = pInfo.location     ?? "";
  const years    = pInfo.yearsOfExperience ?? profile.yearsOfExperience ?? "";
  const topSkills = (
    profile.skills?.categories?.flatMap(c => c.items) ?? profile.stack ?? []
  ).slice(0, 8).join(", ");
  const bullets  = (tailoredCV.injectedBullets ?? [])
    .map(b => b.tailored).filter(Boolean).slice(0, 3).join("; ");

  const raw = await callAI(
    `You are a professional cover letter writer. Return ONLY a valid JSON object matching this schema:
{
  "coverLetter": {
    "personalInfo": { "name": "...", "email": "...", "phone": "...", "location": "...", "linkedin": "...", "website": "..." },
    "jobInfo": { "company": "...", "role": "...", "jobUrl": "...", "date": "..." },
    "content": { "opening": "...", "body": ["...", "...", "..."], "closing": "..." },
    "metadata": { "tone": "professional", "version": "1.0", "lastUpdated": "..." }
  }
}

Rules:
- opening: 2-3 sentences.
- body: exactly 3 paragraphs as strings in the array.
- closing: 2 sentences.
- NO markdown, NO explanation outside JSON.
${HUMAN_STYLE}`,
    `Candidate: ${name} | ${location}
Role: ${role} at ${company}
Years of experience: ${years}
Top skills: ${topSkills}
Summary: ${tailoredCV.summary ?? ""}
Bullet points: ${bullets}`,
    1500
  );

  const parsed = parseJSON(raw);
  if (parsed.coverLetter) {
    // Always overwrite personalInfo with real profile data — never trust AI to fill these
    parsed.coverLetter.personalInfo = {
      name:     pInfo.name     ?? "",
      email:    pInfo.email    ?? "",
      phone:    pInfo.phone    ?? "",
      location: pInfo.location ?? "",
      linkedin: pInfo.linkedin ?? "",
      website:  pInfo.website  ?? "",
    };
    parsed.coverLetter.jobInfo = {
      company,
      role,
      jobUrl: analysis.url ?? "",
      date: new Date().toISOString().split("T")[0]
    };
  }
  return parsed;
}
