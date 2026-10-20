import { readFileSync, readdirSync } from "node:fs";

const repoRoot = new URL("../", import.meta.url);
const distModels = new URL("apps/web/dist/models", repoRoot);
const snapshot = JSON.parse(
  readFileSync(new URL("data/snapshot.json", repoRoot), "utf8"),
);

function slugify(value) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

const expected = new Set(snapshot.models.map((model) => slugify(model.key)));
const files = readdirSync(distModels, { recursive: true });
const actual = new Set();

for (const file of files) {
  const path = typeof file === "string" ? file : file.toString();
  if (path === "index.html") continue;
  if (!path.endsWith("/index.html")) continue;
  actual.add(path.slice(0, -"/index.html".length));
}

const missing = [...expected].filter((slug) => !actual.has(slug));
const extra = [...actual].filter((slug) => !expected.has(slug));

if (actual.size !== expected.size || missing.length > 0 || extra.length > 0) {
  console.error(
    `model page check failed: expected ${expected.size}, found ${actual.size}`,
  );
  if (missing.length > 0) console.error(`missing: ${missing.slice(0, 8).join(", ")}`);
  if (extra.length > 0) console.error(`extra: ${extra.slice(0, 8).join(", ")}`);
  process.exit(1);
}

for (const required of ["apps/web/dist/models/index.html", "apps/web/dist/compare/index.html"]) {
  try {
    readFileSync(new URL(required, repoRoot));
  } catch {
    console.error(`missing required page: ${required}`);
    process.exit(1);
  }
}

const distRoot = new URL("apps/web/dist/", repoRoot);
const htmlFiles = readdirSync(distRoot, { recursive: true }).filter((file) =>
  file.toString().endsWith(".html"),
);
for (const file of htmlFiles) {
  const html = readFileSync(new URL(file.toString(), distRoot), "utf8");
  if (/(?:undefined|NaN|Infinity)/.test(html)) {
    console.error(`invalid rendered value in: ${file.toString()}`);
    process.exit(1);
  }
}

console.log(
  `model page check: ${actual.size} detail pages, ${htmlFiles.length} HTML files, compare and directory present`,
);
