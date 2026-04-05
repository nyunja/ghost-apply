// ──────────────────────────────────────────────────────────────
//  AgnosticFormExplorer.js — No hardcoded texts, learns every site
//  Works with any ATS: new tabs, SPAs, conditional fields.
// ──────────────────────────────────────────────────────────────

import { chromium } from "playwright-extra";
import StealthPlugin from "puppeteer-extra-plugin-stealth";
import fs from "fs";
import path from "path";
import os from "os";
import { extractJDFromPage, waitForContentToLoad } from "./scraper.js";
import { scanFields, isStandardField, findClickableCandidates } from "../../utils/browserUtils.js";
import { getSelector, setSelector } from "../../services/selectors.js";
import { identifyTrigger } from "../../services/ai/discovery.js";

chromium.use(StealthPlugin());

const OUTPUT_DIR = path.join(os.homedir(), ".jobtailor", "outputs");
fs.mkdirSync(OUTPUT_DIR, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ── Intent ranking (no hardcoded strings) ─────────────────────
// Each intent has a list of keywords (lowercased) and a weight.
// We'll score each clickable element based on how many keywords appear in its text/aria/class.
const INTENT_KEYWORDS = {
  apply: [
    "apply",
    "submit application",
    "send application",
    "i'm interested",
    "start application",
    "apply now",
    "job apply",
    "application",
  ],
  next: [
    "next",
    "continue",
    "proceed",
    "next step",
    "continue to next",
    "save and continue",
    "next page",
  ],
  submit: [
    "submit",
    "submit application",
    "send application",
    "finish",
    "complete application",
    "done",
  ],
};

// Additional boost for elements that are buttons (vs links) and positioned bottom‑right with AI discovery fallback.
async function rankElementsByIntent(page, intent, log) {
  const keywords = INTENT_KEYWORDS[intent] || [];
  
  // Step 1: Heuristic scoring (fast, no AI)
  const candidates = await page.evaluate((kwList) => {
    const elements = document.querySelectorAll('button, a, [role="button"], [class*="btn"], [class*="button"], input[type="submit"]');
    const results = [];
    for (const el of elements) {
      const rect = el.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) continue;
      const text = (el.innerText || el.value || "").toLowerCase();
      const aria = (el.getAttribute("aria-label") || "").toLowerCase();
      const classes = (el.className || "").toLowerCase();
      const combined = `${text} ${aria} ${classes}`;
      let score = 0;
      for (const kw of kwList) {
        if (combined.includes(kw)) score += 1;
      }
      if (el.tagName === "BUTTON" || el.getAttribute("role") === "button") score += 0.5;
      if (rect.right > window.innerWidth * 0.7 && rect.bottom > window.innerHeight * 0.8) score += 0.3;
      if (score > 0) {
          let selectorStr = null;
          if (el.id) {
            selectorStr = `#${CSS.escape(el.id)}`;
          } else if (el.name) {
            selectorStr = `[name="${el.name}"]`;
          } else {
            const tag = el.tagName.toLowerCase();
            const allTags = Array.from(document.querySelectorAll(tag));
            const idx = allTags.indexOf(el);
            selectorStr = `${tag} >> nth=${idx}`;
          }

          results.push({
            element: el,   // store DOM element reference (for later use)
            selector: selectorStr,
            score,
            text: text.slice(0, 50),
          });
      }
    }
    return results.sort((a,b) => b.score - a.score);
  }, keywords);
  
  // If we have a high‑confidence heuristic match (score >= 1.5), use it
  if (candidates.length && candidates[0].score >= 1.5) {
    return candidates;
  }
  
  // Step 2: AI discovery fallback (only when heuristic is uncertain)
  log(`    ℹ Heuristic score low (${candidates[0]?.score || 0}). Falling back to AI discovery for "${intent}"...`);
  
  // Get all clickable candidates in the format expected by identifyTrigger
  const clickableCandidates = await page.evaluate(findClickableCandidates);
  const bestIndex = await identifyTrigger(intent, clickableCandidates);
  
  if (bestIndex !== null) {
    // Re‑fetch the element at that index and build a selector
    const aiSelector = await page.evaluate((idx) => {
      const els = document.querySelectorAll('button, a, [role="button"], [class*="btn"], [class*="button"], input[type="submit"]');
      const visible = Array.from(els).filter(el => el.offsetWidth > 0);
      const target = visible[idx];
      if (!target) return null;
      if (target.id) return `#${CSS.escape(target.id)}`;
      if (target.name) return `[name="${target.name}"]`;
      // fallback: nth‑of‑type based on tag + class (more robust than nth=idx)
      const tag = target.tagName.toLowerCase();
      const allTags = Array.from(document.querySelectorAll(tag));
      const pos = allTags.indexOf(target);
      return `${tag} >> nth=${pos}`;
    }, bestIndex);
    
    if (aiSelector) {
      log(`    ✓ AI found candidate at index ${bestIndex} → selector: ${aiSelector}`);
      return [{ selector: aiSelector, score: 2.0, text: "AI‑discovered" }];
    }
  }
  
  // No AI match either – return whatever heuristic found, but only if score is safe
  if (candidates.length && candidates[0].score >= 1.0) {
    return candidates;
  }
  return [];
}

// ── Safe click with new‑tab handling ──────────────────────────
export async function clickIntent(page, context, intent, log) {
  const hostname = new URL(page.url()).hostname;

  // 1. Check cache (stored as a robust selector)
  const cached = getSelector(hostname, intent);
  if (cached) {
    try {
      const btn = page.locator(cached).first();
      if (await btn.isVisible({ timeout: 2000 })) {
        const newPage = await clickWithTabHandling(page, context, btn, log);
        log(`  ✓ [CACHE] Clicked ${intent} using ${cached}`);
        return newPage;
      }
    } catch {
      /* fall through */
    }
  }

  // 2. Rank elements by intent (no hardcoded strings)
  const ranked = await rankElementsByIntent(page, intent, log);
  if (ranked.length === 0) return false;

  for (const { selector, score } of ranked) {
    try {
      const btn = page.locator(selector).first();
      if (await btn.isVisible({ timeout: 1000 })) {
        const newPage = await clickWithTabHandling(page, context, btn, log);
        // Learn this selector for future
        setSelector(hostname, intent, selector);
        log(`  ✓ [LEARNED] Clicked ${intent} (score ${score}) → ${selector}`);
        return newPage;
      }
    } catch {
      continue;
    }
  }
  return false;
}

async function clickWithTabHandling(page, context, locator, log) {
  // Listen for new pages before clicking
  const pagePromise = context
    .waitForEvent("page", { timeout: 3000 })
    .catch(() => null);
  await locator
    .click({ timeout: 5000 })
    .catch(() => locator.evaluate((el) => el.click()));
  const newPage = await pagePromise;
  if (newPage) {
    log(`  → New tab opened, switching to it`);
    await newPage.waitForLoadState();
    return newPage; // return the new page so caller can continue
  }
  return page; // no new tab, same page
}

// ── Detect and watch for conditional fields ───────────────────
async function setupMutationObserver(page) {
  return page.evaluate(() => {
    window.__fieldObserver = new MutationObserver(() => {
      window.__domChanged = true;
    });
    window.__domChanged = false;
    window.__fieldObserver.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["class", "style"],
    });
  });
}

async function hasDomChanged(page) {
  return page
    .evaluate(() => {
      const changed = window.__domChanged === true;
      window.__domChanged = false;
      return changed;
    })
    .catch(() => false);
}

// ── Main explorer: builds a manifest without hardcoded steps ──
export async function exploreJob(url, opts = {}) {
  const { timeout = 30000, log = console.log } = opts;
  log(`› Exploring Job: ${url}`);

  const browser = await chromium.launch({
    headless: true,
    args: ["--no-sandbox"],
  });
  try {
    const context = await browser.newContext({
      viewport: { width: 1280, height: 900 },
    });
    // Block images/fonts for speed
    await context.route("**/*", (route) => {
      const type = route.request().resourceType();
      if (["image", "font", "media"].includes(type)) return route.abort();
      return route.continue();
    });

    let page = await context.newPage();
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });
    await waitForContentToLoad(page, 15000); // reuse agnostic wait

    // 1. Scrape JD (reuse agnostic extractor)
    log("  › Scraping description...");
    const jd = await extractJDFromPage(page);

    // 2. Click Apply (handles new tabs)
    log("  › Probing application form...");
    const applyResult = await clickIntent(page, context, "apply", log);
    if (!applyResult) {
      log("  ✗ No Apply button found – cannot continue");
      return { url, jd, steps: [], error: "apply_not_found" };
    }
    if (applyResult !== true && applyResult !== page) {
      page = applyResult; // new page after tab switch
    }
    await sleep(2000);
    await setupMutationObserver(page);

    // 3. Walk form dynamically (no fixed max steps, no arbitrary cycle limit)
    const steps = [];
    let stepIndex = 0;
    let lastUrl = page.url();

    while (true) {
      stepIndex++;
      log(`  › Step ${stepIndex}: scanning fields...`);

      // Wait for fields to appear (dynamic content)
      await page
        .waitForFunction(
          () => document.querySelectorAll("input,select,textarea").length > 0,
          { timeout: 5000 },
        )
        .catch(() => {});
      const fields = await page.evaluate(scanFields);
      steps.push({ step: stepIndex, fields, url: page.url() });

      // Try to click Next/Continue
      const nextResult = await clickIntent(page, context, "next", log);
      if (!nextResult) {
        log("  › No Next button found – assuming final step");
        break;
      }

      // Handle possible new tab
      if (nextResult !== true && nextResult !== page) {
        page = nextResult;
      }

      // Wait for potential async updates after click
      await sleep(1500);

      // Check if URL changed or DOM mutated (new fields appeared)
      const newUrl = page.url();
      const domChanged = await hasDomChanged(page);

      if (newUrl !== lastUrl || domChanged) {
        // Progress detected – continue to next step
        lastUrl = newUrl;
        continue;
      }

      // No URL change and no DOM mutation after click – but maybe fields are still loading?
      // Wait a bit longer and re-scan once more
      await sleep(2000);
      const newFields = await page.evaluate(scanFields);
      if (newFields.length === fields.length) {
        // No new fields appeared – form is complete
        log("  › No new fields after second wait – stopping");
        break;
      }
      // Otherwise, fields changed without URL change (e.g., SPA reveal) – continue
      lastUrl = newUrl;
    }

    const manifest = { url, jd, steps, scrapedAt: new Date().toISOString() };
    const slug = new URL(url).hostname.replace(/\./g, "-");
    fs.writeFileSync(
      path.join(OUTPUT_DIR, `${slug}-manifest.json`),
      JSON.stringify(manifest, null, 2),
    );
    await browser.close();
    return manifest;
  } catch (err) {
    await browser.close().catch(() => {});
    throw err;
  }
}

export function getQuestionsFromManifest(manifest) {
  const allFields = manifest.steps.flatMap((s) => s.fields);
  return allFields.filter(
    (f) => !isStandardField(f) && f.type !== "file" && !f.ariaHidden,
  );
}
