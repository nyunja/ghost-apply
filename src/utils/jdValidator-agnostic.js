// ─────────────────────────────────────────────
//  jdValidator-agnostic.js — Validation for Agnostic Scraper
//  Works with platform-agnostic scraping + hybrid discovery approach
// ─────────────────────────────────────────────

/**
 * Validates extracted job description
 * @param {string} jd - Raw extracted job description text
 * @param {string} url - Source URL (for error context)
 * @returns {{ valid: boolean, text: string, error?: string }}
 */
export function validateJD(jd, url) {
  // Check if empty or just whitespace
  if (!jd || typeof jd !== 'string') {
    return {
      valid: false,
      text: "",
      error: "Job description is not a string"
    };
  }

  const trimmed = jd.trim();

  // Check minimum length
  if (trimmed.length === 0) {
    return {
      valid: false,
      text: "",
      error: "Job description is empty (0 characters). Scraper may have failed."
    };
  }

  // For agnostic approach: lower threshold (some jobs are short)
  // But still require some meaningful content
  if (trimmed.length < 100) {
    return {
      valid: false,
      text: "",
      error: `Job description too short (${trimmed.length} chars, minimum 100 expected)`
    };
  }

  // Check for common error page signatures
  const errorIndicators = [
    { pattern: "404", weight: 3 },
    { pattern: "not found", weight: 3 },
    { pattern: "page not found", weight: 3 },
    { pattern: "error occurred", weight: 2 },
    { pattern: "something went wrong", weight: 2 },
    { pattern: "access denied", weight: 2 },
  ];

  const lowerText = trimmed.toLowerCase();
  let errorScore = 0;

  for (const { pattern, weight } of errorIndicators) {
    if (lowerText.includes(pattern)) {
      errorScore += weight;
    }
  }

  // If error score is high AND content is short, probably an error page
  if (errorScore > 2 && trimmed.length < 300) {
    return {
      valid: false,
      text: "",
      error: `Content appears to be an error page (error score: ${errorScore})`
    };
  }

  // Check for common job-related keywords (soft check - not required)
  const jobKeywords = [
    "responsibility", "qualifications", "requirement",
    "skill", "experience", "salary", "apply",
    "position", "role", "team", "about",
    "description", "about us", "mission"
  ];

  const keywordCount = jobKeywords.filter(kw => 
    lowerText.includes(kw)
  ).length;

  if (keywordCount === 0 && trimmed.length < 200) {
    // Only warn, don't fail (some minimal job posts don't have keywords)
    if (trimmed.length < 150) {
      return {
        valid: false,
        text: "",
        error: "Content has no job-related keywords and is very short"
      };
    }
  }

  // If we made it here, it's valid
  return {
    valid: true,
    text: trimmed,
    error: null
  };
}

/**
 * Safe wrapper for agnostic JD extraction
 * @param {Function} scraperFn - The scrapeJD function
 * @param {string} url - URL to scrape
 * @param {object} opts - Options (debug, timeout, maxWait)
 * @returns {{ success: boolean, data: string, error?: string, metadata?: object }}
 */
export async function safeExtractJD(scraperFn, url, opts = {}) {
  const { debug = false } = opts;

  try {
    if (debug) console.error(`[validator] extracting JD from: ${url}`);
    
    const extracted = await scraperFn(url, { ...opts, debug });
    
    if (debug) console.error(`[validator] raw result: ${extracted.length} characters`);

    const validation = validateJD(extracted, url);

    if (!validation.valid) {
      if (debug) console.error(`[validator] ⚠ validation failed: ${validation.error}`);
      return {
        success: false,
        data: "",
        error: validation.error,
        metadata: {
          rawLength: extracted.length,
          url
        }
      };
    }

    if (debug) console.error(`[validator] ✓ JD valid (${validation.text.length} chars)`);

    return {
      success: true,
      data: validation.text,
      error: null,
      metadata: {
        length: validation.text.length,
        url,
        timestamp: new Date().toISOString()
      }
    };
  } catch (err) {
    if (debug) console.error(`[validator] ✗ extraction error: ${err.message}`);
    return {
      success: false,
      data: "",
      error: `Extraction failed: ${err.message}`,
      metadata: {
        url,
        errorType: err.constructor.name
      }
    };
  }
}

/**
 * Lighter validation for cached extractions (you already trust the selector)
 * @param {string} jd - Previously extracted content
 * @returns {{ valid: boolean, reason?: string }}
 */
export function quickValidate(jd) {
  if (!jd || typeof jd !== 'string') return { valid: false, reason: "Not a string" };
  
  const trimmed = jd.trim();
  
  if (trimmed.length < 50) return { valid: false, reason: "Too short" };
  
  return { valid: true };
}
