// @ts-nocheck
import puppeteer from "puppeteer-extra";
import StealthPlugin from "puppeteer-extra-plugin-stealth";
import fs from "fs";
import { parse } from "json2csv";

puppeteer.use(StealthPlugin());

const SELLER_URL = "https://jiji.co.ke/sellerpage-fpYsOXD7fz2sZqygUQ1Qtd6z";
const OUTPUT_JSON = "ads.json";
const OUTPUT_NEW_JSON = "new_ads.json";
const OUTPUT_CSV = "ads.csv";

interface Ad {
  title: string;
  price: string;
  description: string;
  location: string;
  image: string;
  url: string;
}

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function autoScroll(page: any) {
  let lastHeight = await page.evaluate("document.body.scrollHeight");
  let stableRounds = 0;
  const maxStableRounds = 5;

  while (stableRounds < maxStableRounds) {
    await page.evaluate("window.scrollTo(0, document.body.scrollHeight)");
    await delay(2000);
    const newHeight = await page.evaluate("document.body.scrollHeight");
    if (newHeight === lastHeight) {
      stableRounds++;
    } else {
      stableRounds = 0;
      lastHeight = newHeight;
    }
  }
}

async function scrapeAllAds(page: any): Promise<Ad[]> {
  return await page.$$eval(
    ".b-list-advert-base.b-list-advert-base--list.qa-advert-list-item",
    (cards: Element[]) =>
      cards.map((el: Element) => {
        const title =
          (el.querySelector(".b-advert-title-inner")?.textContent || "").trim();
        const price =
          (el.querySelector(".qa-advert-price")?.textContent || "").trim();
        const description =
          (el.querySelector(".b-list-advert-base__description-text")
            ?.textContent || "").trim();
        const location =
          (el.querySelector(".b-list-advert__region__text")?.textContent || "").trim();
        const image = (el.querySelector("img") as HTMLImageElement)?.src || "";
        const url = (el.closest("a") as HTMLAnchorElement)?.href || "";

        return { title, price, description, location, image, url };
      })
  );
}

function mergeAndDetectNewAds(existingAds: Ad[], newAds: Ad[]): {
  allAds: Ad[];
  newOnly: Ad[];
} {
  const existingUrls = new Set(existingAds.map((a) => a.url));
  const newOnly = newAds.filter((a) => !existingUrls.has(a.url));
  const allAds = [...existingAds, ...newOnly];
  return { allAds, newOnly };
}

async function scrapeJiji() {
  console.log(`🌍 Opening seller page...`);
  const browser = await puppeteer.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });
  const page = await browser.newPage();

  await page.goto(SELLER_URL, { waitUntil: "domcontentloaded" });
  console.log(`🔄 Scrolling to load all ads...`);
  await autoScroll(page);

  console.log(`📸 Extracting ads...`);
  const scrapedAds = await scrapeAllAds(page);
  console.log(`✅ Scraped ${scrapedAds.length} ads from page.`);

  let existingAds: Ad[] = [];
  if (fs.existsSync(OUTPUT_JSON)) {
    existingAds = JSON.parse(fs.readFileSync(OUTPUT_JSON, "utf-8"));
  }

  const { allAds, newOnly } = mergeAndDetectNewAds(existingAds, scrapedAds);

  // Save updated main ads
  fs.writeFileSync(OUTPUT_JSON, JSON.stringify(allAds, null, 2));
  fs.writeFileSync(OUTPUT_CSV, parse(allAds));

  // Save new ads separately if any
  if (newOnly.length > 0) {
    fs.writeFileSync(OUTPUT_NEW_JSON, JSON.stringify(newOnly, null, 2));
    console.log(`🆕 ${newOnly.length} new ads detected and saved to ${OUTPUT_NEW_JSON}`);
  } else {
    console.log("✅ No new ads found — everything is up to date!");
  }

  console.log(`📦 Total ads in store: ${allAds.length}`);
  await browser.close();
}

scrapeJiji().catch(console.error);