// ─────────────────────────────────────────────
//  explorer.js — Unified Job Explorer
//  Consolidates JD scraping and multi-page form probing 
//  into a single stateful browser session.
// ─────────────────────────────────────────────

import { chromium } from "playwright-extra";
import StealthPlugin from "puppeteer-extra-plugin-stealth";
import fs from "fs";
import path from "path";
import os from "os";
import { extractJDFromPage } from "./scraper.js";
import { scanFields, findClickableCandidates, isStandardField } from "../../utils/browserUtils.js";
import { getSelector, setSelector } from "../../services/selectors.js";
import { identifyTrigger } from "../../services/ai/discovery.js";

chromium.use(StealthPlugin());

const OUTPUT_DIR = path.join(os.homedir(), ".jobtailor", "outputs");
fs.mkdirSync(OUTPUT_DIR, { recursive: true });

const sleep = ms => new Promise(r => setTimeout(r, ms));


/**
 * Main entry point: Fully explores a job URL to build a JobManifest.
 */
export async function exploreJob(url, opts = {}) {
  const { timeout = 30_000, log = console.log } = opts;
  log(`› Exploring Job: ${url}`);

  const browser = await chromium.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });

  try {
    const context = await browser.newContext({
      viewport: { width: 1280, height: 900 },
      userAgent: "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36",
    });

    // Speed up exploration by blocking non-essential assets
    await context.route("**/*", route => {
      const type = route.request().resourceType();
      if (["image", "font", "media", "google-analytics", "facebook-pixel"].includes(type)) {
        return route.abort();
      }
      return route.continue();
    });

    const page = await context.newPage();
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60_000 });
    await sleep(2000);

    // 1. Scrape JD
    log("  › Scraping description...");
    const jd = await extractJDFromPage(page);
    
    // 2. Click Apply
    log("  › Probing application form...");
    const hostname = new URL(url).hostname;
    
    // Discovery Loop for "apply"
    let applyClicked = false;
    let successfulApplySelector = null;

    // A. Check Cache
    const cachedApply = getSelector(hostname, "apply");
    if (cachedApply) {
      log(`    › Trying cached selector: ${cachedApply}`);
      const btn = page.locator(cachedApply).first();
      if (await btn.isVisible({ timeout: 3000 }).catch(() => false)) {
        await btn.click({ timeout: 5000 }).catch(() => btn.evaluate(el => el.click()));
        applyClicked = true;
      }
    }

    // B. Heuristic / Hardcoded Broad Search
    if (!applyClicked) {
      const applySelectors = [
        'button:has-text("Apply")', 'a:has-text("Apply")',
        'button:has-text("I\'m interested")', '[data-ui="apply-button"]',
        '[data-cy="apply-button"]', '#apply-button', '.jobs-apply-button'
      ];
      for (const sel of applySelectors) {
        const btn = page.locator(sel).first();
        if (await btn.isVisible({ timeout: 2000 }).catch(() => false)) {
          await btn.click({ timeout: 5000 }).catch(() => btn.evaluate(el => el.click()));
          applyClicked = true;
          successfulApplySelector = sel;
          break;
        }
      }
    }

    // C. AI Discovery Fallback
    if (!applyClicked) {
      log("    ⚠ Standard selectors failed. Invoking AI discovery...");
      const candidates = await page.evaluate(findClickableCandidates);
      const bestIndex = await identifyTrigger("apply", candidates);
      if (bestIndex !== null) {
        log(`    › AI found candidate at index ${bestIndex}`);
        applyClicked = await page.evaluate((idx) => {
          const els = document.querySelectorAll('button, a, [role="button"], [class*="btn"], [class*="button"]');
          const target = Array.from(els).filter(e => e.offsetWidth > 0)[idx];
          if (target) { target.click(); return true; }
          return false;
        }, bestIndex);

        if (applyClicked) {
          // Construct a simple positional or attribute-based selector to store
          successfulApplySelector = `button, a >> nth=${bestIndex}`; 
        }
      }
    }

    if (applyClicked && successfulApplySelector) {
      setSelector(hostname, "apply", successfulApplySelector);
    }

    const steps = [];
    if (applyClicked) {
      await sleep(2500);
      // 3. Walk multi-page forms
      for (let step = 1; step <= 5; step++) {
        await page.waitForSelector("input,select,textarea", { timeout: 5000 }).catch(() => {});
        const fields = await page.evaluate(scanFields);
        steps.push({ step, fields });
        
        // Try Next
        let advanced = false;
        let successfulNextSelector = null;

        // A. Check Cache
        const cachedNext = getSelector(hostname, "next");
        if (cachedNext) {
          const btn = page.locator(cachedNext).first();
          if (await btn.isVisible({ timeout: 2000 }).catch(() => false)) {
            await btn.click({ timeout: 3000 }).catch(() => btn.evaluate(el => el.click()));
            advanced = true;
          }
        }

        // B. Heuristics
        if (!advanced) {
          const nextSelectors = ['button:has-text("Next")', 'button:has-text("Continue")', '[data-ui="next"]', '[data-cy="next-step"]'];
          for (const sel of nextSelectors) {
            const btn = page.locator(sel).first();
            if (await btn.isVisible({ timeout: 1500 }).catch(() => false)) {
              await btn.click({ timeout: 3000 }).catch(() => btn.evaluate(el => el.click()));
              advanced = true;
              successfulNextSelector = sel;
              break;
            }
          }
        }

        // C. AI Discovery
        if (!advanced) {
          log(`    › AI discovery for Next (step ${step})...`);
          const candidates = await page.evaluate(findClickableCandidates);
          const bestIndex = await identifyTrigger("next", candidates);
          if (bestIndex !== null) {
            advanced = await page.evaluate((idx) => {
              const els = document.querySelectorAll('button, a, [role="button"], [class*="btn"], [class*="button"]');
              const target = Array.from(els).filter(e => e.offsetWidth > 0)[idx];
              if (target) { target.click(); return true; }
              return false;
            }, bestIndex);
            if (advanced) successfulNextSelector = `button, a >> nth=${bestIndex}`;
          }
        }

        if (advanced && successfulNextSelector) {
          setSelector(hostname, "next", successfulNextSelector);
        }

        if (!advanced) break;
        log(`    › Advanced to step ${step + 1}`);
        await sleep(2000);
      }
    }

    const manifest = {
      url,
      jd,
      steps,
      scrapedAt: new Date().toISOString()
    };

    // Save manifest for debugging
    const slug = new URL(url).hostname.replace(/\./g, "-");
    fs.writeFileSync(path.join(OUTPUT_DIR, `${slug}-manifest.json`), JSON.stringify(manifest, null, 2));

    await browser.close();
    return manifest;

  } catch (err) {
    await browser.close().catch(() => {});
    throw err;
  }
}

/**
 * Filter manifest steps to extract only questions that need AI answers.
 */
export function getQuestionsFromManifest(manifest) {
  const allFields = manifest.steps.flatMap(s => s.fields);
  return allFields.filter(f =>
    !isStandardField(f) &&
    f.type !== "file" &&
    !f.ariaHidden &&
    // skip already-filled text/textarea fields
    !(["text", "number", "textarea"].includes(f.type) && String(f.value ?? "").trim())
  );
}
