import { runPipeline } from "../parser/pipeline.js";
import { parseJSON } from "../../lib/llm/client.js";

/**
 * Extracts a structured profile from a raw resume string using the 
 * production-grade multi-stage hybrid pipeline.
 */
export async function extractProfileFromText(resumeText, onProgress) {
  // Use the new pipeline
  return await runPipeline(resumeText, onProgress);
}
