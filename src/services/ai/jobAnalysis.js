import { callAI, parseJSON } from "../../lib/llm/client.js";

export async function analyzeJD(jdText, profile) {
  const raw = await callAI(
    `You are a precise job analysis engine. Return ONLY valid JSON with NO markdown or backticks:
{
  "jobTitle": "string",
  "company": "string or null",
  "matchScore": 0-100,
  "topKeywords": ["kw1","kw2","kw3","kw4","kw5"],
  "missingSkills": ["skill1","skill2"],
  "strengths": ["s1","s2","s3"],
  "summary": "2-sentence honest assessment of fit",
  "recommendApply": true or false
}`,
    `JOB DESCRIPTION:\n${jdText}\n\nCANDIDATE PROFILE:\n${JSON.stringify(profile, null, 2)}`
  );
  return parseJSON(raw);
}
