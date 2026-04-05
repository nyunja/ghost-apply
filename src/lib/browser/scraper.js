// ─────────────────────────────────────────────
//  scraper-agnostic.js — Platform-Agnostic JD Scraper
//  Uses intelligent content detection instead of hardcoded selectors.
//  Works with hybrid approach: generic scraping → AI discovery → rule cache
// ─────────────────────────────────────────────

import { chromium } from "playwright-extra";
import StealthPlugin from "puppeteer-extra-plugin-stealth";

chromium.use(StealthPlugin());

// Minimal generic selectors as final fallbacks only
const FALLBACK_SELECTORS = [
  "[class*='job-description']",
  "[class*='jobDescription']",
  "[id*='job-description']",
  "[id*='jobDescription']",
  "[class*='posting']",
  "article",
  "main",
  "[role='main']",
];

/**
 * Intelligently waits for page content to load by monitoring DOM changes.
 * Works for any platform without hardcoded rules.
 * 
 * @param {Page} page - Playwright page object
 * @param {number} timeout - Max wait time in ms
 * @param {boolean} debug - Enable debug logging
 * @returns {Promise<boolean>} - true if content loaded, false on timeout
 */
export async function waitForContentToLoad(page, timeout = 10000, debug = false) {
  const startTime = Date.now();
  const checkInterval = 300; // Check every 300ms for efficiency
  const minContentLength = 300; // Minimum meaningful content threshold
  
  let lastContentLength = 0;
  let stableChecks = 0; // Count of consecutive checks with no content change
  const stabilityThreshold = 3; // 3 checks = ~900ms of stable content = loaded
  
  if (debug) console.error("[scraper] waiting for content to load...");

  while (Date.now() - startTime < timeout) {
    const { contentLength, frameCount } = await page.evaluate(() => {
      let totalLength = document.body.innerText.trim().length;
      return {
        contentLength: totalLength,
        frameCount: window.frames.length
      };
    });

    // Check if we have meaningful content
    if (contentLength >= minContentLength) {
      // Content exists, check if it's stable (not still loading)
      if (contentLength === lastContentLength) {
        stableChecks++;
        if (debug) console.error(`[scraper] content stable (${stableChecks}/${stabilityThreshold}): ${contentLength} chars`);
        
        if (stableChecks >= stabilityThreshold) {
          if (debug) console.error(`[scraper] ✓ content loaded (${contentLength} chars)`);
          return true;
        }
      } else {
        stableChecks = 0; // Reset if content changed
        if (debug) console.error(`[scraper] content growing: ${contentLength} chars`);
      }
      lastContentLength = contentLength;
    } else {
      if (debug && contentLength > 0) {
        console.error(`[scraper] minimal content: ${contentLength} chars (waiting for more...)`);
      }
      stableChecks = 0;
      lastContentLength = 0;
    }

    await page.waitForTimeout(checkInterval);
  }

  if (debug) console.error(`[scraper] timeout waiting for content (got ${lastContentLength} chars)`);
  return false;
}

/**
 * Attempts to extract content from various contexts (main page, iframes, shadow DOM)
 * without relying on platform-specific selectors.
 */
export async function extractJDFromPage(page, opts = {}) {
  const { debug = false, useFallbackSelectors = true } = opts;

  let extracted = "";

  // Strategy 1: Try to find largest text block on main page
  if (debug) console.error("[scraper] strategy 1: checking main page content...");
  
  extracted = await page.evaluate(() => {
    // Get the largest continuous text block
    const body = document.body;
    if (!body) return "";
    
    const text = body.innerText.trim();
    return text.length > 200 ? text : "";
  });

  if (extracted && extracted.length > 200) {
    if (debug) console.error(`[scraper] ✓ found on main page: ${extracted.length} chars`);
    return cleanText(extracted);
  }

  // Strategy 2: Check iframes
  if (debug) console.error("[scraper] strategy 2: scanning iframes...");
  
  const frames = page.frames();
  for (let i = 0; i < frames.length; i++) {
    const frame = frames[i];
    if (frame === page.mainFrame()) continue;

    try {
      const frameText = await frame.evaluate(() => {
        const text = document.body?.innerText?.trim() || "";
        return text.length > 200 ? text : "";
      });

      if (frameText && frameText.length > 200) {
        if (debug) console.error(`[scraper] ✓ found in iframe ${i}: ${frameText.length} chars`);
        extracted = frameText;
        break;
      }
    } catch (e) {
      // Frame might be cross-origin or not accessible
      if (debug) console.error(`[scraper] iframe ${i} not accessible`);
    }
  }

  if (extracted && extracted.length > 200) {
    return cleanText(extracted);
  }

  // Strategy 3: Try shadow DOM inspection
  if (debug) console.error("[scraper] strategy 3: checking shadow DOM...");
  
  extracted = await page.evaluate(() => {
    function walkShadowDOM(node, depth = 0, maxDepth = 5) {
      if (depth > maxDepth) return "";
      let content = node.textContent || "";
      
      if (node.shadowRoot) {
        for (const child of node.shadowRoot.children) {
          content += " " + walkShadowDOM(child, depth + 1, maxDepth);
        }
      }
      
      if (node.children) {
        for (const child of node.children) {
          content += " " + walkShadowDOM(child, depth + 1, maxDepth);
        }
      }
      
      return content;
    }

    const root = document.querySelector("main") || 
                 document.querySelector("article") || 
                 document.body;
    
    const text = walkShadowDOM(root).trim();
    return text.length > 200 ? text : "";
  });

  if (extracted && extracted.length > 200) {
    if (debug) console.error(`[scraper] ✓ found in shadow DOM: ${extracted.length} chars`);
    return cleanText(extracted);
  }

  // Strategy 4: Use fallback selectors (minimal set)
  if (useFallbackSelectors) {
    if (debug) console.error("[scraper] strategy 4: trying fallback selectors...");
    
    for (const selector of FALLBACK_SELECTORS) {
      try {
        const el = page.locator(selector).first();
        const visible = await el.isVisible({ timeout: 500 }).catch(() => false);
        
        if (visible) {
          const text = await el.innerText({ timeout: 1000 }).catch(() => "");
          if (text && text.trim().length > 200) {
            if (debug) console.error(`[scraper] ✓ matched fallback selector: ${selector}`);
            extracted = text;
            break;
          }
        }
      } catch (e) {
        // Try next selector
      }
    }

    if (extracted && extracted.length > 200) {
      return cleanText(extracted);
    }
  }

  // Fallback: Return whatever content exists
  if (debug) console.error("[scraper] all strategies exhausted, returning available content");
  
  extracted = await page.evaluate(() => {
    return document.body?.innerText?.trim() || "";
  });

  return cleanText(extracted);
}

/**
 * Main scraping function - platform agnostic.
 * Uses intelligent waiting instead of hardcoded waits.
 * 
 * @param {string} url
 * @param {{ timeout?: number, debug?: boolean, maxWait?: number }} [opts]
 * @returns {Promise<string>}
 */
export async function scrapeJD(url, opts = {}) {
  const { 
    timeout = 30_000,      // Total timeout for page.goto
    debug = false,
    maxWait = 15_000       // Max time to wait for content to load
  } = opts;

  const browser = await chromium.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });

  try {
    const context = await browser.newContext({
      viewport: { width: 1280, height: 800 },
      userAgent:
        "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 " +
        "(KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36",
      extraHTTPHeaders: { "Accept-Language": "en-US,en;q=0.9" },
    });

    // Block resource types that slow down loading
    await context.route("**/*", (route) => {
      const rt = route.request().resourceType();
      if (["image", "font", "media", "stylesheet"].includes(rt)) {
        return route.abort();
      }
      return route.continue();
    });

    const page = await context.newPage();
    
    if (debug) console.error(`[scraper] navigating to: ${url}`);
    
    await page.goto(url, { 
      waitUntil: "domcontentloaded", 
      timeout 
    });

    // Intelligent wait for content (instead of fixed timeout)
    const contentReady = await waitForContentToLoad(page, maxWait, debug);
    
    if (!contentReady && debug) {
      console.error("[scraper] ⚠ content wait timed out, attempting extraction anyway");
    }

    const extracted = await extractJDFromPage(page, { debug });

    await browser.close();
    return extracted;
  } catch (err) {
    await browser.close().catch(() => {});
    throw err;
  }
}

/**
 * Collapse runs of blank lines and trim each line.
 */
function cleanText(raw) {
  return raw
    .split("\n")
    .map((l) => l.trim())
    .filter((l, i, arr) => l || (arr[i - 1] !== ""))
    .join("\n")
    .trim();
}