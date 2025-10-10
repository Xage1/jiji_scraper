import puppeteerExtra from "puppeteer-extra";
import StealthPlugin from "puppeteer-extra-plugin-stealth";
import fs from "fs";
import { parse } from "json2csv";
import type { Page, HTTPResponse } from "puppeteer";

puppeteerExtra.use(StealthPlugin());

const SELLER_URL = "https://jiji.co.ke/sellerpage-fpYsOXD7fz2sZqygUQ1Qtd6z";
const OUTPUT_JSON = "ads.json";
const OUTPUT_CSV = "ads.csv";
const SCROLL_DELAY = 1500;
const NETWORK_IDLE_TIMEOUT = 10000;

interface RawAd {
  title: string;
  price: string;
  description: string;
  location: string;
  image: string;
  url: string;
}

/** Scroll repeatedly until no new ads appear */
async function autoScroll(page: Page) {
  let lastHeight = await page.evaluate("document.body.scrollHeight");
  let sameCount = 0;
  while (sameCount < 5) {
    await page.evaluate("window.scrollTo(0, document.body.scrollHeight)");
    await new Promise((res) => setTimeout(res, SCROLL_DELAY));
    const newHeight = await page.evaluate("document.body.scrollHeight");
    if (newHeight === lastHeight) sameCount++;
    else sameCount = 0;
    lastHeight = newHeight;
  }
}

/** Capture ads dynamically loaded through network XHRs */
async function captureNetworkAds(page: Page): Promise<RawAd[]> {
  const results: RawAd[] = [];
  const seen = new Set<string>();
  let lastResponseTime = Date.now();

  page.on("response", async (res: HTTPResponse) => {
    try {
      const url = res.url();
      if (!url.includes("/api_web/v1/items/list")) return;
      const json = await res.json();
      if (!json?.banners?.items) return;

      json.banners.items.forEach((item: any) => {
        const id = item.id;
        if (seen.has(id)) return;
        seen.add(id);
        results.push({
          title: item.title || "",
          price: item.price?.value_text || "",
          description: item.description || "",
          location: item.region?.name || "",
          image: item.image?.url || "",
          url: `https://jiji.co.ke/${item.slug}-${item.id}`,
        });
      });
      lastResponseTime = Date.now();
    } catch {}
  });

  while (Date.now() - lastResponseTime < NETWORK_IDLE_TIMEOUT) {
    await page.evaluate("window.scrollTo(0, document.body.scrollHeight)");
    await new Promise((res) => setTimeout(res, SCROLL_DELAY));
  }

  return results;
}

/** Fallback DOM scrape (static visible ads) */
async function scrapeDOMAds(page: Page): Promise<RawAd[]> {
  return await page.$$eval(
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
}

/** Main scraper */
async function scrapeJiji() {
  const browser = await puppeteerExtra.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1366, height: 768 });

  console.log(`🌍 Opening seller page (network capture enabled)...`);
  await page.goto(SELLER_URL, { waitUntil: "domcontentloaded" });

  // capture ads via network
  const networkPromise = captureNetworkAds(page);
  await autoScroll(page);
  const networkAds = await networkPromise;

  let ads: RawAd[] = [];
  if (networkAds.length > 0) {
    console.log(`✅ Captured ${networkAds.length} ads via network requests.`);
    ads = networkAds;
  } else {
    console.log(`⚠️ Network capture found nothing — falling back to DOM scrape.`);
    ads = await scrapeDOMAds(page);
  }

  // dedupe
  const unique = Array.from(new Map(ads.map((a) => [a.url, a])).values());
  console.log(`✅ Final aggregated ads: ${unique.length}`);

  fs.writeFileSync(OUTPUT_JSON, JSON.stringify(unique, null, 2));
  fs.writeFileSync(OUTPUT_CSV, parse(unique));
  console.log(`💾 Saved ${unique.length} ads to ${OUTPUT_JSON} and ${OUTPUT_CSV}`);

  await browser.close();
}

scrapeJiji().catch(console.error);