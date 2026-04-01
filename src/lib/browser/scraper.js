// ─────────────────────────────────────────────
//  scraper.js — Stealth JD scraper
//  Uses playwright-extra + stealth plugin to fetch job descriptions
//  from any URL without triggering bot-detection.
// ─────────────────────────────────────────────

import { chromium } from "playwright-extra";
import StealthPlugin from "puppeteer-extra-plugin-stealth";

chromium.use(StealthPlugin());

// Platform-specific selectors ordered by specificity
const PLATFORM_SELECTORS = [
  // LinkedIn
  { host: "linkedin.com",  selectors: [".description__text", ".job-description", ".jobs-description"] },
  // Greenhouse
  { host: "greenhouse.io", selectors: ["#content", ".job-description", ".job__description"] },
  // Lever
  { host: "lever.co",      selectors: [".posting-description", ".section-wrapper .content"] },
  // Indeed
  { host: "indeed.com",    selectors: ["#jobDescriptionText", ".jobsearch-jobDescriptionText"] },
  // Seek
  { host: "seek.com",      selectors: ['[data-automation="jobDescription"]', ".FYwKg"] },
  // Workday
  { host: "myworkdayjobs", selectors: ["[data-automation-id='jobPostingDescription']", ".css-1t0bwq8"] },
  // Workable
  { host: "workable.com",  selectors: [".job-description", "[class*='description']"] },
  // Ashby
  { host: "ashbyhq.com",   selectors: [".ashby-job-posting-brief-description", "[class*='job']"] },
];

// Generic fallbacks tried if no platform match
const GENERIC_SELECTORS = [
  "[class*='job-description']",
  "[class*='jobDescription']",
  "[id*='job-description']",
  "[id*='jobDescription']",
  "[class*='posting-description']",
  "[class*='description']",
  "article",
  "main",
  "[role='main']",
];

/**
 * Stateless JD extractor that works on an already-open page.
 * Tried by the Unified Explorer to avoid redundant browser launches.
 *
 * @param {import("playwright").Page} page
 * @param {{ debug?: boolean }} [opts]
 * @returns {Promise<string>}
 */
export async function extractJDFromPage(page, opts = {}) {
  const { debug = false } = opts;
  const url = page.url();

  // Determine selectors to try first based on hostname
  const hostname = new URL(url).hostname;
  const platform = PLATFORM_SELECTORS.find((p) => hostname.includes(p.host));
  const prioritySelectors = platform ? platform.selectors : [];
  const allSelectors = [...prioritySelectors, ...GENERIC_SELECTORS];

  let extracted = "";

  // Try selectors in order; accept the first one with enough text
  for (const sel of allSelectors) {
    try {
      const el = page.locator(sel).first();
      const visible = await el.isVisible({ timeout: 2000 }).catch(() => false);
      if (!visible) continue;
      const txt = (await el.innerText({ timeout: 3000 })).trim();
      if (txt.length > 200) {
        extracted = txt;
        if (debug) console.error(`[scraper] matched selector: ${sel}`);
        break;
      }
    } catch { /* try next */ }
  }

  // Last-resort: grab full body text
  if (!extracted) {
    if (debug) console.error("[scraper] falling back to body text");
    extracted = (await page.locator("body").innerText({ timeout: 5000 })).trim();
  }

  return cleanText(extracted);
}

/**
 * Scrape a job description from the given URL using a stealth browser.
 * Returns the extracted text, or throws if extraction fails.
 *
 * @param {string} url
 * @param {{ timeout?: number, debug?: boolean }} [opts]
 * @returns {Promise<string>}
 */
export async function scrapeJD(url, opts = {}) {
  const { timeout = 30_000, debug = false } = opts;

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

    await context.route("**/*", (route) => {
      const rt = route.request().resourceType();
      if (["image", "font", "media"].includes(rt)) return route.abort();
      return route.continue();
    });

    const page = await context.newPage();
    await page.goto(url, { waitUntil: "domcontentloaded", timeout });

    // Give JS-rendered content a moment to paint
    await page.waitForTimeout(2500);

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
    .filter((l, i, arr) => l || (arr[i - 1] !== ""))   // collapse consecutive blanks
    .join("\n")
    .trim();
}

