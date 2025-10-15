import fs from "fs";
import path from "path";

interface Ad {
  title: string;
  price: string;
  description: string;
  location: string;
  link: string;
  main_image: string;
  other_images: string[];
  main_image_local?: string;
}

const adsPath = path.join(process.cwd(), "ads.json");
const imagesDir = path.join(process.cwd(), "images");
const outputPath = path.join(process.cwd(), "enhanced_ads.json");

const ads: Ad[] = JSON.parse(fs.readFileSync(adsPath, "utf8"));
const allImages = fs.readdirSync(imagesDir);

const enhanced = ads.map(ad => {
  const mainImage = ad.main_image_local ? path.basename(ad.main_image_local) : null;
  if (!mainImage) return ad;

  // extract numeric prefix before first underscore
  const prefixMatch = mainImage.match(/^(\d+)_/);
  const prefix = prefixMatch ? prefixMatch[1] : null;

  if (!prefix) return ad;

  const related = allImages.filter(img =>
    img.startsWith(prefix) && img !== mainImage
  );

  return {
    ...ad,
    other_images: related.map(img => `images/${img}`)
  };
});

fs.writeFileSync(outputPath, JSON.stringify(enhanced, null, 2));
console.log(`✅ Enhanced ads saved to ${outputPath}`);
