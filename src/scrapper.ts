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
 * — includes image deduplication
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

    // Helper to normalize image URLs for deduplication
    const normalizeImageUrl = (url: string) =>
      url
        .replace(/\?.*$/, "") // remove query params
        .replace(/\/+$/, "") // remove trailing slashes
        .trim();

    return adElements
      .map((el) => {
        const title =
          el.querySelector(".b-advert-title-inner")?.textContent?.trim() || "";
        const price =
          el.querySelector(".qa-advert-price")?.textContent?.trim() || "";
        const description =
          el.querySelector(".b-list-advert-base__description-text")?.textContent?.trim() ||
          "";
        const location =
          el.querySelector(".b-list-advert__region__text")?.textContent?.trim() || "";
        const link = (el.closest("a") as HTMLAnchorElement)?.href || "";

        // 🖼️ Collect *every* possible image source
        const rawImages = Array.from(el.querySelectorAll("img"))
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

        // 🚫 Deduplicate normalized image URLs
        const uniqueImages = Array.from(
          new Set(rawImages.map((url) => normalizeImageUrl(url)))
        );

        if (!title || !price || !link || uniqueImages.length === 0) return null;

        return {
          title,
          price,
          description,
          location,
          link,
          main_image: uniqueImages[0],
          other_images: uniqueImages.slice(1),
        };
      })
      .filter(Boolean) as Ad[];
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

  // Quick image summary per ad
  scrapedAds.forEach((ad) =>
    console.log(`🖼️ ${ad.title}: ${1 + ad.other_images.length} unique image(s)`)
  );

  // --- Load previous ads
  let existingAds: Ad[] = [];
  if (fs.existsSync(ADS_JSON)) {
    try {
      existingAds = JSON.parse(fs.readFileSync(ADS_JSON, "utf-8"));
    } catch {
      existingAds = [];
    }
  }

  // Normalize link comparison
  const normalizeLink = (url: string) =>
    url.replace(/\?.*$/, "").replace(/\/+$/, "").toLowerCase();

  // Identify new ads
  const newAds = scrapedAds.filter(
    (ad) => !existingAds.some((e) => normalizeLink(e.link) === normalizeLink(ad.link))
  );

  // Merge old + new uniquely
  const mergedMap = new Map<string, Ad>();
  [...existingAds, ...scrapedAds].forEach((ad) => {
    mergedMap.set(normalizeLink(ad.link), ad);
  });
  const merged = Array.from(mergedMap.values());

  // 🧠 Download images for new ads
  for (const ad of newAds) {
    console.log(`📥 Processing new ad: ${ad.title}`);
    const mainFilename = path.basename(ad.main_image).split("?")[0] || `img_${Date.now()}.jpg`;
    ad.main_image_local = await enhanceImage(ad.main_image, mainFilename);

    const localOtherImages: string[] = [];
    for (const [i, imgUrl] of ad.other_images.entries()) {
      try {
        const imgFilename = `${path.parse(mainFilename).name}_extra_${i}${path.extname(imgUrl) || ".jpg"}`;
        const localPath = await enhanceImage(imgUrl, imgFilename);
        if (localPath) localOtherImages.push(localPath);
        await delay(1500);
      } catch {
        // ignore
      }
    }
    ad.other_images = localOtherImages;
  }

  // 💾 Write updates
  if (newAds.length > 0) {
    fs.writeFileSync(NEW_ADS_JSON, JSON.stringify(newAds, null, 2));
    console.log(`🆕 ${newAds.length} new ads detected and saved.`);
  } else {
    console.log("🔁 No new ads — all up to date!");
  }

  fs.writeFileSync(ADS_JSON, JSON.stringify(merged, null, 2));
  await saveCSV(merged);

  console.log(`📦 Total ads in store: ${merged.length}`);
  await browser.close();
})();