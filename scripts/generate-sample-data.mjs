import fs from "node:fs";
import path from "node:path";

// Deterministic PRNG (Mulberry32) so the bundled dataset is reproducible
function mulberry32(seed) {
  let a = seed;
  return function () {
    let t = (a += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const rand = mulberry32(20260401);

const regions = [
  { name: "North America", countries: ["United States", "Canada"], weight: 1.35 },
  { name: "Europe", countries: ["Germany", "United Kingdom", "France", "Netherlands"], weight: 1.15 },
  { name: "Asia Pacific", countries: ["Japan", "Australia", "Singapore", "South Korea"], weight: 1.0 },
  { name: "Latin America", countries: ["Brazil", "Mexico", "Colombia"], weight: 0.72 },
];

const segments = ["Consumer", "Corporate", "Home Office", "Enterprise"];
const shipModes = ["Standard Class", "Second Class", "First Class", "Same Day"];

const catalog = [
  { category: "Technology", subCategory: "Phones", basePrice: 420, margin: 0.24 },
  { category: "Technology", subCategory: "Laptops", basePrice: 1180, margin: 0.21 },
  { category: "Technology", subCategory: "Accessories", basePrice: 110, margin: 0.34 },
  { category: "Technology", subCategory: "Monitors", basePrice: 360, margin: 0.22 },
  { category: "Furniture", subCategory: "Chairs", basePrice: 280, margin: 0.16 },
  { category: "Furniture", subCategory: "Desks", basePrice: 540, margin: 0.12 },
  { category: "Furniture", subCategory: "Bookcases", basePrice: 220, margin: 0.11 },
  { category: "Office Supplies", subCategory: "Storage", basePrice: 85, margin: 0.27 },
  { category: "Office Supplies", subCategory: "Paper", basePrice: 28, margin: 0.42 },
  { category: "Office Supplies", subCategory: "Binders", basePrice: 34, margin: 0.38 },
  { category: "Office Supplies", subCategory: "Appliances", basePrice: 195, margin: 0.25 },
  { category: "Cloud Services", subCategory: "Analytics Seats", basePrice: 640, margin: 0.58 },
  { category: "Cloud Services", subCategory: "Data Storage", basePrice: 310, margin: 0.52 },
];

const rows = [
  "order_id,order_date,region,country,segment,category,sub_category,ship_mode,quantity,discount,sales,profit",
];

const startDate = new Date("2024-01-01T00:00:00Z");
const totalDays = 730; // 2 full years (2024-2025)
const numOrders = 2400;

for (let i = 1; i <= numOrders; i++) {
  const dayOffset = Math.floor(rand() * totalDays);
  const dt = new Date(startDate.getTime() + dayOffset * 86400 * 1000);
  const month = dt.getUTCMonth(); // 0..11
  const yearFactor = dt.getUTCFullYear() === 2025 ? 1.18 : 1.0;
  // Q4 seasonal lift + slight summer dip
  const seasonalFactor = month >= 9 ? 1.28 : month === 6 || month === 7 ? 0.9 : 1.0;

  const regionObj = regions[Math.floor(rand() * regions.length)];
  const country = regionObj.countries[Math.floor(rand() * regionObj.countries.length)];
  const segment = segments[Math.floor(rand() * segments.length)];
  const shipMode = shipModes[Math.floor(rand() * shipModes.length)];
  const item = catalog[Math.floor(rand() * catalog.length)];

  const quantity = Math.max(1, Math.floor(rand() * 8) + 1);
  const discountChoices = [0, 0, 0, 0.05, 0.1, 0.15, 0.2, 0.3];
  const discount = discountChoices[Math.floor(rand() * discountChoices.length)];

  const unitVariance = 0.75 + rand() * 0.6;
  const grossSales =
    item.basePrice * quantity * unitVariance * regionObj.weight * yearFactor * seasonalFactor;
  const sales = Math.round(grossSales * (1 - discount) * 100) / 100;

  const effectiveMargin = item.margin - discount * 0.65 + (rand() - 0.5) * 0.08;
  const profit = Math.round(sales * effectiveMargin * 100) / 100;

  const orderId = `QB-${dt.getUTCFullYear()}-${String(i).padStart(5, "0")}`;
  const orderDate = dt.toISOString().slice(0, 10);

  rows.push(
    [
      orderId,
      orderDate,
      regionObj.name,
      country,
      segment,
      item.category,
      item.subCategory,
      shipMode,
      quantity,
      discount.toFixed(2),
      sales.toFixed(2),
      profit.toFixed(2),
    ].join(",")
  );
}

const outPath = path.resolve(process.cwd(), "public/samples/superstore.csv");
fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, rows.join("\n") + "\n", "utf8");
console.log(`Generated ${numOrders} rows at ${outPath}`);
