// src/scrapper.ts
import puppeteer from "puppeteer-extra";
import StealthPlugin from "puppeteer-extra-plugin-stealth";
import fs from "fs";

puppeteer.use(StealthPlugin());

const BASE_URL = "https://jiji.co.ke/sellerpage-fpYsOXD7fz2sZqygUQ1Qtd6z";
const OUTPUT_FILE = "ads.json";
const DELAY_BETWEEN_PAGES = 2500; // 2.5s delay to avoid rate-limits
const MAX_RETRIES = 3;

async function scrapeJiji() {
  const browser = await puppeteer.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });

  const page = await browser.newPage();
  await page.setUserAgent(
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
    "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
  );

  console.log(`🌍 Navigating to: ${BASE_URL}`);
  await page.goto(BASE_URL, { waitUntil: "domcontentloaded", timeout: 60000 });

  // Detect pagination (total pages)
  const totalPages = await page.evaluate(() => {
    const pagination = document.querySelector(".b-pagination__list");
    if (!pagination) return 1;
    const pages = Array.from(pagination.querySelectorAll("a"))
      .map(a => parseInt(a.textContent || "0"))
      .filter(n => !isNaN(n));
    return Math.max(...pages, 1);
  });

  console.log(`📄 Found ${totalPages} page(s) of ads.`);

  const allAds: any[] = [];

  for (let currentPage = 1; currentPage <= totalPages; currentPage++) {
    const pageUrl = `${BASE_URL}?page=${currentPage}`;
    console.log(`\n➡️ Scraping page ${currentPage}/${totalPages}: ${pageUrl}`);

    let success = false;
    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      try {
        await page.goto(pageUrl, { waitUntil: "domcontentloaded", timeout: 60000 });
        await page.waitForSelector(".b-seller-page__listing-items", { timeout: 20000 });

        const ads = await page.evaluate(() => {
          const items = document.querySelectorAll(".b-list-advert__item-wrapper");
          return Array.from(items).map(el => {
            const title = el.querySelector("a")?.textContent?.trim() || "Untitled";
            const price =
              el.querySelector(".b-list-advert-base__price")?.textContent?.trim() ||
              "Price not listed";
            const link = (el.querySelector("a") as HTMLAnchorElement)?.href || "";
            const img = (el.querySelector("img") as HTMLImageElement)?.src || "";
            return { title, price, link, image: img };
          });
        });

        console.log(`✅ Scraped ${ads.length} ads on page ${currentPage}`);
        allAds.push(...ads);
        success = true;
        break;
      } catch (err) {
        console.warn(`⚠️ Retry ${attempt}/${MAX_RETRIES} for page ${currentPage} failed:`, (err as Error).message);
        await new Promise(r => setTimeout(r, 3000)); // Wait before retry
      }
    }

    if (!success) {
      console.error(`❌ Failed to scrape page ${currentPage} after ${MAX_RETRIES} retries.`);
    }

    // Save progress after each page
    fs.writeFileSync(OUTPUT_FILE, JSON.stringify(allAds, null, 2));

    // Wait between pages
    await new Promise(res => setTimeout(res, DELAY_BETWEEN_PAGES));
  }

  console.log(`\n📦 Total scraped: ${allAds.length} ads saved to ${OUTPUT_FILE}`);
  await browser.close();
}

scrapeJiji().catch(err => {
  console.error("🚨 Fatal error:", err);
  process.exit(1);
}); 