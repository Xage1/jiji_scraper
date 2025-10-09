import puppeteer, { Page } from "puppeteer";

async function scrapeJiji() {
  const browser = await puppeteer.launch({
    headless: false,
    defaultViewport: null,
    args: [
      "--start-maximized",
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-blink-features=AutomationControlled",
      "--disable-dev-shm-usage",
    ],
  });

  const page = await browser.newPage();

  // Pretend to be a normal user browser
  await page.setUserAgent(
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
      "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
  );

  const profileUrl = "https://jiji.co.ke/sellerpage-fpYsOXD7fz2sZqygUQ1Qtd6z";
  console.log("Navigating to:", profileUrl);

  try {
    await page.goto(profileUrl, { waitUntil: "domcontentloaded", timeout: 60000 });
  } catch (err) {
    console.error("❌ Navigation failed:", err);
    await browser.close();
    return;
  }

  // Scroll to trigger lazy loading
  await autoScroll(page);

  console.log("🔍 Waiting for ads section...");
  try {
    await page.waitForSelector(".b-list-advert__item-wrapper", { timeout: 15000 });
  } catch {
    console.log("⚠️ Ads container not found. Page layout may have changed.");
  }

  const ads = await page.$$eval(".b-list-advert__item-wrapper", (cards) =>
    cards.map((card) => {
      const link = (card.querySelector("a") as HTMLAnchorElement)?.href;
      const title =
        card.querySelector(".b-advert-title-inner")?.textContent?.trim() ||
        card.querySelector("img")?.getAttribute("alt") ||
        "Untitled";
      const price =
        card.querySelector(".b-advert-price-inner")?.textContent?.trim() ||
        "Price not listed";
      const image =
        (card.querySelector("img") as HTMLImageElement)?.src ||
        card.querySelector("source")?.getAttribute("srcset") ||
        "";
      return { title, price, link, image };
    })
  );

  console.log(`✅ Scraped ${ads.length} ads`);
  console.table(ads);

  await browser.close();
}

// Smooth scrolling to trigger lazy loading
async function autoScroll(page: Page) {
  await page.evaluate(async () => {
    await new Promise<void>((resolve) => {
      let totalHeight = 0;
      const distance = 300;
      const timer = setInterval(() => {
        const scrollHeight = document.body.scrollHeight;
        window.scrollBy(0, distance);
        totalHeight += distance;

        if (totalHeight >= scrollHeight - window.innerHeight) {
          clearInterval(timer);
          resolve();
        }
      }, 300);
    });
  });
}

scrapeJiji().catch(console.error);