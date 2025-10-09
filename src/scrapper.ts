import puppeteer from "puppeteer-extra";
import StealthPlugin from "puppeteer-extra-plugin-stealth";
import fs from "fs";
import { parse } from "json2csv";

puppeteer.use(StealthPlugin());

const SELLER_URL = "https://jiji.co.ke/sellerpage-fpYsOXD7fz2sZqygUQ1Qtd6z";
const OUTPUT_JSON = "ads.json";
const OUTPUT_CSV = "ads.csv";
const DELAY_BETWEEN_PAGES = 3000;

// 🕒 Helper function to replace deprecated waitForTimeout
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

interface Ad {
  title: string;
  price: string;
  description: string;
  location: string;
  image: string;
  url: string;
}

async function scrapeJiji() {
  const browser = await puppeteer.launch({ headless: true });
  const page = await browser.newPage();

  console.log(`🌍 Navigating to seller: ${SELLER_URL}`);
  await page.goto(SELLER_URL, { waitUntil: "domcontentloaded" });
  await page.waitForSelector(".b-list-advert-base.b-list-advert-base--list.qa-advert-list-item", { timeout: 15000 });

  const totalPages = await page.$$eval(".b-pagination__item", (els) => els.length || 1);
  console.log(`📄 Found ${totalPages} page(s) of ads for this seller.`);

  const allAds: Ad[] = [];

  for (let i = 1; i <= totalPages; i++) {
    const url = `${SELLER_URL}?page=${i}`;
    console.log(`➡️ Scraping page ${i}/${totalPages}: ${url}`);

    await page.goto(url, { waitUntil: "domcontentloaded" });
    await sleep(3000); // ⏳ replaced waitForTimeout(3000)

    const ads = await page.$$eval(
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

    await sleep(DELAY_BETWEEN_PAGES); // ⏳ replaced waitForTimeout(DELAY_BETWEEN_PAGES)
  }

  if (allAds.length > 0) {
    fs.writeFileSync(OUTPUT_JSON, JSON.stringify(allAds, null, 2));
    fs.writeFileSync(OUTPUT_CSV, parse(allAds));
    console.log(`📦 Total scraped: ${allAds.length} ads saved to ${OUTPUT_JSON} and ${OUTPUT_CSV}`);
  } else {
    console.log("⚠️ No ads found.");
  }

  await browser.close();
}

scrapeJiji().catch(console.error);