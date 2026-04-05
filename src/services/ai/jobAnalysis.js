import { callAI, parseJSON } from "../../lib/llm/client.js";

export async function analyzeJD(jdText, profile) {
  console.log(`  Analyzing JD (${jdText.length} chars) + profile...`);
  if (!jdText || jdText.trim().length === 0) {
    console.log(`  ⚠ JD text is empty or whitespace only`);
    throw new Error("Job description is empty");
  }
  
  try {
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
    console.log(`  AI raw response (first 200 chars): "${raw.substring(0, 200)}"`);
    const result = parseJSON(raw);
    console.log(`  AI parsed result:`, result);
    return result;
  } catch (err) {
    console.error(`  AI analysis failed: ${err.message}`);
    throw err;
  }
}
