import puppeteer from "puppeteer-extra";
import StealthPlugin from "puppeteer-extra-plugin-stealth";
import fs from "fs";
import { parse } from "json2csv";

puppeteer.use(StealthPlugin());

const SELLER_URL = "https://jiji.co.ke/sellerpage-fpYsOXD7fz2sZqygUQ1Qtd6z";
const OUTPUT_JSON = "ads.json";
const OUTPUT_CSV = "ads.csv";
const SCROLL_DELAY = 2000;
const MAX_SCROLL_ATTEMPTS = 25;

interface Ad {
  title: string;
  price: string;
  description: string;
  location: string;
  image: string;
  url: string;
}

const delay = (ms: number) => new Promise((res) => setTimeout(res, ms));

async function autoScroll(page: any) {
  let previousHeight = await page.evaluate(() => document.body.scrollHeight);
  let scrollAttempts = 0;

  while (scrollAttempts < MAX_SCROLL_ATTEMPTS) {
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await delay(SCROLL_DELAY);
    const newHeight = await page.evaluate(() => document.body.scrollHeight);
    if (newHeight === previousHeight) break;
    previousHeight = newHeight;
    scrollAttempts++;
  }
}

async function scrapeJiji() {
  const browser = await puppeteer.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });
  const page = await browser.newPage();

  console.log(`🌍 Navigating to seller: ${SELLER_URL}`);
  await page.goto(SELLER_URL, { waitUntil: "domcontentloaded" });
  await page.waitForSelector(".b-list-advert-base.b-list-advert-base--list.qa-advert-list-item", { timeout: 15000 });

  // ✅ Detect number of pagination pages (if available)
  const totalPages = await page.$$eval(".b-pagination__item", (els) => {
    const nums = els.map((el) => parseInt(el.textContent || "0")).filter((n) => !isNaN(n));
    return nums.length > 0 ? Math.max(...nums) : 1;
  });

  console.log(`📄 Found ${totalPages} page(s) of ads for this seller.`);

  const allAds: Ad[] = [];

  for (let i = 1; i <= totalPages; i++) {
    const pageUrl = `${SELLER_URL}?page=${i}`;
    console.log(`➡️ Scraping page ${i}/${totalPages}: ${pageUrl}`);

    await page.goto(pageUrl, { waitUntil: "domcontentloaded" });
    await page.waitForSelector(".b-list-advert-base.b-list-advert-base--list.qa-advert-list-item", { timeout: 15000 });

    console.log("🔄 Scrolling to load all ads...");
    await autoScroll(page);

    console.log("📸 Extracting ads...");
    const ads: Ad[] = await page.$$eval(
      ".b-list-advert-base.b-list-advert-base--list.qa-advert-list-item",
      (cards) =>
        cards.map((el) => {
          const title = el.querySelector(".b-advert-title-inner")?.textContent?.trim() || "";
          const price = el.querySelector(".qa-advert-price")?.textContent?.trim() || "";
          const description = el.querySelector(".b-list-advert-base__description-text")?.textContent?.trim() || "";
          const location = el.querySelector(".b-list-advert__region__text")?.textContent?.trim() || "";
          const image = el.querySelector("img")?.getAttribute("src") || "";
          const url = (el.closest("a") as HTMLAnchorElement)?.href || "";
          return { title, price, description, location, image, url };
        })
    );

    console.log(`✅ Scraped ${ads.length} ads on page ${i}`);
    allAds.push(...ads);

    await delay(2000);
  }

  console.log(`📦 Total scraped: ${allAds.length} ads`);

  if (allAds.length > 0) {
    fs.writeFileSync(OUTPUT_JSON, JSON.stringify(allAds, null, 2));
    fs.writeFileSync(OUTPUT_CSV, parse(allAds));
    console.log(`💾 Saved data to ${OUTPUT_JSON} and ${OUTPUT_CSV}`);
  } else {
    console.log("⚠️ No ads found at all.");
  }

  await browser.close();
}

scrapeJiji().catch((err) => console.error("❌ Error:", err.message));