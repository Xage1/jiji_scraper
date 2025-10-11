// src/scrapper.ts
import fs from "fs";
import path from "path";
import * as puppeteer from "puppeteer";
import { createObjectCsvWriter } from "csv-writer";
import sharp from "sharp";
import fetch from "node-fetch";

const ADS_JSON = path.join("ads.json");
const NEW_ADS_JSON = path.join("new_ads.json");
const ADS_CSV = path.join("ads.csv");
const IMAGES_DIR = path.join("images");
const SELLER_URL = "https://jiji.co.ke/sellerpage-fpYsOXD7fz2sZqygUQ1Qtd6z";

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

/**
 * 🔁 Deep scrolling logic to load *all* ads patiently.
 */
async function autoScroll(page: puppeteer.Page) {
  console.log("🔄 Starting deep scroll for all ads...");
  let previousCount = 0;
  let sameCountRounds = 0;
  const maxSameRounds = 20;
  const scrollPause = 2500;
  const maxRuntime = 10 * 60 * 1000; // 10 minutes

  const start = Date.now();
  while (sameCountRounds < maxSameRounds) {
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await delay(scrollPause);

    const adCount = await page.evaluate(
      () =>
        document.querySelectorAll(
          ".b-list-advert-base.b-list-advert-base--list.qa-advert-list-item"
        ).length
    );
    console.log(`🌀 Currently loaded ads: ${adCount}`);

    if (adCount === previousCount) sameCountRounds++;
    else {
      previousCount = adCount;
      sameCountRounds = 0;
    }

    if (Date.now() - start > maxRuntime) {
      console.warn("⚠️ Max runtime reached, stopping scroll.");
      break;
    }
  }
  console.log(`✅ Finished scrolling. Total ads visible: ${previousCount}`);
}

/**
 * 🧠 Extract full ad data including lazy-loaded images
 */
async function scrapeAllAds(page: puppeteer.Page): Promise<Ad[]> {
  return page.evaluate(() => {
    const adElements = Array.from(
      document.querySelectorAll(
        ".b-list-advert-base.b-list-advert-base--list.qa-advert-list-item"
      )
    );

    const getAllImageUrls = (img: HTMLImageElement) => {
      const urls: string[] = [];
      const src = img.getAttribute("src");
      const dataSrc = img.getAttribute("data-src");
      const srcset = img.getAttribute("srcset");

      if (src) urls.push(src);
      if (dataSrc) urls.push(dataSrc);
      if (srcset) {
        srcset.split(",").forEach((part) => {
          const u = part.trim().split(" ")[0];
          if (u) urls.push(u);
        });
      }

      return urls;
    };

    return adElements
      .map((el) => {
        const title =
          el.querySelector(".b-advert-title-inner")?.textContent?.trim() || "";
        const price =
          el.querySelector(".qa-advert-price")?.textContent?.trim() || "";
        const description =
          el.querySelector(".b-list-advert-base__description-text")?.textContent?.trim() || "";
        const location =
          el.querySelector(".b-list-advert__region__text")?.textContent?.trim() || "";
        const link = (el.closest("a") as HTMLAnchorElement)?.href || "";

        // 🖼️ Collect *every* possible image source
        const images = Array.from(el.querySelectorAll("img"))
          .flatMap((img) => getAllImageUrls(img))
          .filter(
            (src) =>
              src &&
              !src.includes("crown") &&
              !src.includes("badge") &&
              !src.includes("placeholder") &&
              !src.includes("data:image") &&
              !src.endsWith(".svg")
          );

        if (!title || !price || !link || images.length === 0) return null;

        return {
          title,
          price,
          description,
          location,
          link,
          main_image: images[0],
          other_images: images.slice(1),
        };
      })
      .filter(Boolean) as Ad[];
  });
}

/**
 * 🚫 Deduplicate ads across runs
 */
function deduplicateAds(ads: Ad[]): Ad[] {
  const seen = new Set<string>();
  return ads.filter((ad) => {
    const id = ad.link.split("?")[0]; // ignore query params
    if (seen.has(id)) return false;
    seen.add(id);
    return true;
  });
}

/**
 * 🧩 Enhance and save image locally
 */
async function enhanceImage(url: string, filename: string) {
  try {
    const response = await fetch(url);
    const buffer = Buffer.from(await response.arrayBuffer());
    const enhanced = await sharp(buffer)
      .resize({ width: 1000, height: 1000, fit: "inside" })
      .sharpen()
      .jpeg({ quality: 90 })
      .toBuffer();

    fs.mkdirSync(IMAGES_DIR, { recursive: true });
    const filepath = path.join(IMAGES_DIR, filename);
    fs.writeFileSync(filepath, enhanced);
    return filepath;
  } catch {
    return null;
  }
}

/**
 * 💾 Save to CSV
 */
async function saveCSV(ads: Ad[]) {
  const csvWriter = createObjectCsvWriter({
    path: ADS_CSV,
    header: [
      { id: "title", title: "Title" },
      { id: "price", title: "Price" },
      { id: "link", title: "Link" },
      { id: "main_image", title: "MainImage" },
      { id: "main_image_local", title: "LocalImage" },
      { id: "other_images", title: "OtherImages" },
      { id: "description", title: "Description" },
      { id: "location", title: "Location" },
    ],
  });
  await csvWriter.writeRecords(ads);
}

/**
 * 🚀 Main runner
 */
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

  try {
    await page.goto(SELLER_URL, { waitUntil: "networkidle2", timeout: 180000 });
  } catch {
    console.warn("⚠️ Page load failed — retrying...");
    await delay(4000);
    await page.goto(SELLER_URL, { waitUntil: "domcontentloaded", timeout: 240000 });
  }

  console.log("🔄 Scrolling to load all ads...");
  await autoScroll(page);

  console.log("📸 Extracting ads...");
  const scrapedAds = await scrapeAllAds(page);
  console.log(`✅ Scraped ${scrapedAds.length} ads from page.`);

  // --- Load previous ads
  let existingAds: Ad[] = [];
  if (fs.existsSync(ADS_JSON)) {
    existingAds = JSON.parse(fs.readFileSync(ADS_JSON, "utf-8"));
  }

  const merged = deduplicateAds([...existingAds, ...scrapedAds]);
  const newAds = scrapedAds.filter(
    (ad) => !existingAds.some((e) => e.link.split("?")[0] === ad.link.split("?")[0])
  );

  for (const ad of newAds) {
    const filename = path.basename(ad.main_image).split("?")[0] || `img_${Date.now()}.jpg`;
    ad.main_image_local = await enhanceImage(ad.main_image, filename);
  }

  if (newAds.length > 0) {
    fs.writeFileSync(NEW_ADS_JSON, JSON.stringify(newAds, null, 2));
    console.log(`🆕 ${newAds.length} new ads detected and saved.`);
  } else {
    console.log("🔁 No new ads — all up to date!");
  }

  fs.writeFileSync(ADS_JSON, JSON.stringify(merged, null, 2));
  await saveCSV(merged);

  console.log(`📦 Total unique ads in store: ${merged.length}`);
  await browser.close();
})();