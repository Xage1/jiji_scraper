import fs from "fs";
import path from "path";
import * as puppeteer from "puppeteer";
import { createObjectCsvWriter } from "csv-writer";
import sharp from "sharp";
import fetch from "node-fetch";

const ADS_JSON = path.join("ads.json");
const ADS_CSV = path.join("ads.csv");
const IMAGES_DIR = path.join("images");
const SELLER_URL = "https://jiji.co.ke/sellerpage-fpYsOXD7fz2sZqygUQ1Qtd6z";
const CONCURRENCY = 15;

interface Ad {
  title: string;
  price: string;
  description?: string;
  location?: string;
  link: string;
  main_image: string;
  other_images: string[];
  main_image_local?: string | null;
}

async function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function autoScroll(page: puppeteer.Page) {
  console.log("🔄 Scrolling seller page...");
  let previousCount = 0;
  let sameCountRounds = 0;

  while (sameCountRounds < 10) {
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await delay(2500);

    const adCount = await page.evaluate(
      () =>
        document.querySelectorAll(
          ".b-list-advert-base.b-list-advert-base--list.qa-advert-list-item"
        ).length
    );
    console.log(`🌀 Loaded ads: ${adCount}`);

    if (adCount === previousCount) sameCountRounds++;
    else {
      previousCount = adCount;
      sameCountRounds = 0;
    }
  }

  console.log(`✅ Finished scrolling. Total: ${previousCount}`);
}

async function scrapeListing(page: puppeteer.Page): Promise<Ad[]> {
  return page.evaluate(() => {
    const ads: Ad[] = [];
    const adEls = document.querySelectorAll(
      ".b-list-advert-base.b-list-advert-base--list.qa-advert-list-item"
    );
    adEls.forEach((el) => {
      const title =
        el.querySelector(".b-advert-title-inner")?.textContent?.trim() || "";
      const price =
        el.querySelector(".qa-advert-price")?.textContent?.trim() || "";
      const description =
        el.querySelector(".b-list-advert-base__description-text")
          ?.textContent?.trim() || "";
      const location =
        el.querySelector(".b-list-advert__region__text")?.textContent?.trim() ||
        "";
      const link = (el.closest("a") as HTMLAnchorElement)?.href || "";
      const img = el.querySelector("img") as HTMLImageElement;
      const main_image = img?.getAttribute("src") || "";
      if (title && price && link && main_image) {
        ads.push({
          title,
          price,
          description,
          location,
          link,
          main_image,
          other_images: [],
        });
      }
    });
    return ads;
  });
}

async function scrapeAdImages(page: puppeteer.Page, url: string): Promise<string[]> {
  try {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 90000 });
    await delay(2000);
    const imgs = await page.evaluate(() => {
      const urls: string[] = [];
      document.querySelectorAll("img").forEach((img) => {
        const src = img.getAttribute("src");
        if (
          src &&
          src.startsWith("https") &&
          !src.includes("badge") &&
          !src.includes("placeholder") &&
          !src.includes("svg") &&
          !src.includes("data:image")
        ) {
          urls.push(src.split("?")[0]);
        }
      });
      return Array.from(new Set(urls));
    });
    return imgs;
  } catch {
    return [];
  }
}

async function enhanceImage(url: string, savePath: string) {
  try {
    const response = await fetch(url);
    const buffer = Buffer.from(await response.arrayBuffer());
    const enhanced = await sharp(buffer)
      .resize({ width: 1000, height: 1000, fit: "inside" })
      .jpeg({ quality: 90 })
      .toBuffer();
    fs.writeFileSync(savePath, enhanced);
    return savePath;
  } catch {
    return null;
  }
}

function sanitize(name: string) {
  return name.replace(/[<>:"/\\|?*\x00-\x1F]/g, "").slice(0, 80).trim();
}

function chunkArray<T>(arr: T[], size: number): T[][] {
  const result = [];
  for (let i = 0; i < arr.length; i += size) result.push(arr.slice(i, i + size));
  return result;
}

(async () => {
  console.log("🌍 Opening seller page...");
  const browser = await puppeteer.launch({
    headless: true,
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-blink-features=AutomationControlled",
      "--window-size=1366,768",
    ],
  });

  const page = await browser.newPage();
  await page.setUserAgent(
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
  );

  await page.goto(SELLER_URL, { waitUntil: "domcontentloaded", timeout: 240000 });
  await autoScroll(page);

  console.log("📋 Scraping listing data...");
  const ads = await scrapeListing(page);
  console.log(`✅ Found ${ads.length} ads in listing.`);

  fs.mkdirSync(IMAGES_DIR, { recursive: true });

  // 🟡 Load existing data for resume
  let existingAds: Ad[] = [];
  if (fs.existsSync(ADS_JSON)) {
    try {
      existingAds = JSON.parse(fs.readFileSync(ADS_JSON, "utf-8"));
      console.log(`♻️ Loaded ${existingAds.length} previously scraped ads from ads.json`);
    } catch {
      console.log("⚠️ Failed to parse ads.json, starting fresh.");
      existingAds = [];
    }
  }

  // 🧠 Build lookup sets
  const scrapedTitles = new Set(existingAds.map((a) => sanitize(a.title).toLowerCase()));
  const existingFolders = new Set(
    fs
      .readdirSync(IMAGES_DIR, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name.toLowerCase())
  );

  // 🧩 Determine ads to scrape
  const toScrape = ads.filter((ad) => {
    const cleanTitle = sanitize(ad.title).toLowerCase();
    const folder = path.join(IMAGES_DIR, cleanTitle);
    const mainPath = path.join(folder, "main.jpg");
    return (
      !scrapedTitles.has(cleanTitle) &&
      !(existingFolders.has(cleanTitle) && fs.existsSync(mainPath))
    );
  });

  console.log(`🧩 ${toScrape.length} ads remaining to scrape after smart resume.`);

  const adChunks = chunkArray(toScrape, CONCURRENCY);
  let processed = existingAds.length;

  for (const chunk of adChunks) {
    console.log(`⚙️ Processing ${chunk.length} ads in parallel...`);
    const results = await Promise.allSettled(
      chunk.map(async (ad) => {
        const page = await browser.newPage();
        const folder = path.join(IMAGES_DIR, sanitize(ad.title));
        fs.mkdirSync(folder, { recursive: true });

        const allImgs = await scrapeAdImages(page, ad.link);
        if (allImgs.length > 0) {
          ad.main_image = allImgs[0];
          ad.other_images = allImgs.slice(1);
        }

        const mainPath = path.join(folder, "main.jpg");
        ad.main_image_local = await enhanceImage(ad.main_image, mainPath);

        const localExtras: string[] = [];
        for (const [i, imgUrl] of ad.other_images.entries()) {
          const extraPath = path.join(folder, `extra_${i + 1}.jpg`);
          const saved = await enhanceImage(imgUrl, extraPath);
          if (saved) localExtras.push(saved);
          await delay(300);
        }
        ad.other_images = localExtras;

        await page.close();
        processed++;
        console.log(`✅ Done [${processed}/${ads.length}] - ${ad.title}`);

        // 🔁 Save progress incrementally (avoid duplicates)
        if (!scrapedTitles.has(sanitize(ad.title).toLowerCase())) {
          existingAds.push(ad);
          scrapedTitles.add(sanitize(ad.title).toLowerCase());
          fs.writeFileSync(ADS_JSON, JSON.stringify(existingAds, null, 2));
        }

        return ad;
      })
    );
  }

  // ✅ Export CSV after completion
  const csvWriter = createObjectCsvWriter({
    path: ADS_CSV,
    header: [
      { id: "title", title: "Title" },
      { id: "price", title: "Price" },
      { id: "link", title: "Link" },
      { id: "main_image_local", title: "MainImageLocal" },
      { id: "other_images", title: "OtherImages" },
      { id: "description", title: "Description" },
      { id: "location", title: "Location" },
    ],
  });
  await csvWriter.writeRecords(existingAds);

  console.log("✅ All scraping done with concurrency =", CONCURRENCY);
  await browser.close();
})();