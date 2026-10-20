import * as cheerio from "cheerio";

import { normalizeModelName, type SourceRef } from "@omg/shared";

export const CONSOLE_DOCS_URL = "https://opencode.ai/v2/docs/console/models/";
export const GO_DOCS_URL = "https://opencode.ai/v2/docs/console/go/";

export type DocsGroup = "console" | "go";
export type Training = "none" | "may-train" | "unknown";

export interface DocsFreeEntry {
  name: string;
  group: DocsGroup;
  limitedTime: boolean;
  stealth: boolean;
  training: Training;
  retentionDays?: number;
  regionsExcluded?: string[];
  trialOnly?: boolean;
  notes: string;
}

export interface DocsPriceEntry {
  name: string;
  group: DocsGroup;
  input?: number;
  output?: number;
  cacheRead?: number;
  cacheWrite?: number;
  free: boolean;
  unlimited: boolean;
  limitedTime: boolean;
  monthlyLimitUsd?: number;
  notes?: string;
}

export interface DocsPrivacyEntry {
  name: string;
  training: Training;
  retentionDays?: number;
  notes?: string;
}

export interface DocsEndpointEntry {
  name: string;
  id: string;
  group: DocsGroup;
}

export interface DocsEvidence {
  freeModels: DocsFreeEntry[];
  prices: DocsPriceEntry[];
  consoleFree: DocsFreeEntry[];
  consolePrices: DocsPriceEntry[];
  goPrices: DocsPriceEntry[];
  goPrivacy: DocsPrivacyEntry[];
  endpoints: DocsEndpointEntry[];
  planPrices: { go: number; goPlus: number };
  sources: SourceRef[];
  sourceRefs: SourceRef[];
  warnings: string[];
}

type Selection = cheerio.Cheerio<any>;

function normalize(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function cellText($: cheerio.CheerioAPI, cell: Selection): string {
  const clone = cell.clone();
  clone.find("del").remove();
  clone.find("small").remove();
  return normalize(clone.text());
}

function tableHeaders($: cheerio.CheerioAPI, table: Selection): string[] {
  return table
    .find("thead th")
    .map((_, header) => normalize($(header).text()))
    .get();
}

function findTable(
  $: cheerio.CheerioAPI,
  required: string[],
  excluded: string[] = [],
): Selection | null {
  let match: Selection | null = null;
  $("table").each((_, element) => {
    if (match) return;
    const table = $(element);
    const headers = tableHeaders($, table);
    const hasRequired = required.every((header) => headers.includes(header));
    const hasExcluded = excluded.some((header) => headers.includes(header));
    if (hasRequired && !hasExcluded) match = table;
  });
  return match;
}

function parseMoney(text: string | undefined): number | undefined {
  if (!text) return undefined;
  const cleaned = text.replace(/~~|\*\*|\$/g, "").replace(/,/g, "").trim();
  if (!cleaned || cleaned === "-") return undefined;
  if (/^free$/i.test(cleaned)) return 0;
  if (/^unlimited$/i.test(cleaned)) return undefined;
  const match = cleaned.match(/-?\d+(?:\.\d+)?/);
  if (!match) return undefined;
  const value = Number(match[0]);
  return Number.isFinite(value) ? value : undefined;
}

function parseTraining(text: string): Training {
  if (
    /does not use your data for model training|not used for training|prompts and other inputs are not used for training|^not used$/i.test(
      text,
    )
  ) {
    return "none";
  }
  if (
    /may be used to improve|improve the model|to improve (?:nvidia|the model)|trial use only|^yes$/i.test(
      text,
    )
  ) {
    return "may-train";
  }
  return "unknown";
}

function parseRetentionDays(text: string): number | undefined {
  if (/zero-retention/i.test(text)) return 0;
  const match = text.match(/(\d+)\s*days?/i);
  if (!match) return undefined;
  const value = Number(match[1]);
  return Number.isFinite(value) ? value : undefined;
}

function parseRegions(text: string): string[] | undefined {
  const match = text.match(/not available in (.+?)(?:\.|$)/i);
  if (!match) return undefined;
  const regions = match[1]!
    .split(",")
    .map((region) =>
      region
        .replace(/^\s*(?:or|and)\s+/i, "")
        .replace(/\.$/, "")
        .trim(),
    )
    .filter(Boolean);
  return regions.length > 0 ? regions : undefined;
}

function parseFreeItem(text: string, group: DocsGroup): DocsFreeEntry {
  const nameMatch = text.match(/^(.+?)\s+is(?:\s+available)?\s+/i);
  const name = (nameMatch?.[1] ?? text.split(".")[0] ?? text).trim();
  return {
    name,
    group,
    limitedTime: /limited time/i.test(text),
    stealth: /stealth/i.test(text),
    training: parseTraining(text),
    retentionDays: parseRetentionDays(text),
    regionsExcluded: parseRegions(text),
    trialOnly: /trial use only|trial only/i.test(text),
    notes: text,
  };
}

function parseConsolePrivacy($: cheerio.CheerioAPI, warnings: string[]): DocsPrivacyEntry[] {
  const heading = $("#privacy");
  if (!heading.length) {
    warnings.push("console: privacy section is missing");
    return [];
  }

  const list = heading.nextAll("ul").first();
  if (!list.length) {
    warnings.push("console: privacy list is missing");
    return [];
  }

  const entries: DocsPrivacyEntry[] = [];
  list.find("li").each((_, element) => {
    const text = normalize($(element).text());
    const colon = text.indexOf(":");
    if (colon === -1) return;

    const rawName = text.slice(0, colon).trim();
    const name = rawName.replace(/\s*\(.*?\)\s*$/, "").trim();
    if (!name || /\bAPIs?\b/i.test(name)) return;

    entries.push({
      name,
      training: parseTraining(text),
      retentionDays: parseRetentionDays(text),
      notes: text,
    });
  });

  return entries;
}

function mergeConsolePrivacy(
  free: DocsFreeEntry[],
  privacy: DocsPrivacyEntry[],
): void {
  const byName = new Map(
    privacy.map((entry) => [normalizeModelName(entry.name), entry]),
  );

  for (const entry of free) {
    const match = byName.get(normalizeModelName(entry.name));
    if (!match) continue;

    if (entry.training === "unknown" && match.training !== "unknown") {
      entry.training = match.training;
    }
    if (entry.retentionDays === undefined && match.retentionDays !== undefined) {
      entry.retentionDays = match.retentionDays;
    }
    if (/trial use only|trial only/i.test(match.notes ?? "")) {
      entry.trialOnly = true;
    }
  }
}

function parsePriceRows(
  $: cheerio.CheerioAPI,
  table: Selection,
  group: DocsGroup,
): DocsPriceEntry[] {
  const entries: DocsPriceEntry[] = [];

  table.find("tbody tr").each((_, element) => {
    const cells = $(element).find("td");
    if (cells.length < 3) return;

    const texts = cells.map((_, cell) => cellText($, $(cell))).get();
    const name = texts[0] ?? "";
    if (!name) return;

    const inputText = texts[1] ?? "";
    const outputText = texts[2] ?? "";
    const cacheReadText = texts[3] ?? "";
    const cacheWriteText = texts[4] ?? "";
    const monthlyText = texts[5] ?? "";
    const rowText = normalize($(element).text());

    const free = /^free$/i.test(inputText) && /^free$/i.test(outputText);
    const unlimited = /^unlimited$/i.test(monthlyText);
    const entry: DocsPriceEntry = {
      name,
      group,
      free,
      unlimited,
      limitedTime: /limited time/i.test(rowText),
    };

    const input = parseMoney(inputText);
    const output = parseMoney(outputText);
    const cacheRead = parseMoney(cacheReadText);
    const cacheWrite = parseMoney(cacheWriteText);
    if (input !== undefined) entry.input = input;
    if (output !== undefined) entry.output = output;
    if (cacheRead !== undefined) entry.cacheRead = cacheRead;
    if (cacheWrite !== undefined) entry.cacheWrite = cacheWrite;

    if (group === "go" && !unlimited) {
      const monthlyLimit = parseMoney(monthlyText);
      if (monthlyLimit !== undefined) entry.monthlyLimitUsd = monthlyLimit;
    }
    if (monthlyText) entry.notes = monthlyText;

    entries.push(entry);
  });

  return entries;
}

function parsePlanPrices(
  $: cheerio.CheerioAPI,
  warnings: string[],
): { go: number; goPlus: number } {
  const table = findTable($, ["Plan", "Price", "Included usage"]);
  if (!table) {
    warnings.push("go: plan table is missing");
    return { go: 0, goPlus: 0 };
  }

  let go = 0;
  let goPlus = 0;

  table.find("tbody tr").each((_, element) => {
    const cells = $(element).find("td");
    if (cells.length < 2) return;
    const planCell = cells[0];
    const priceCell = cells[1];
    if (!planCell || !priceCell) return;
    const plan = normalize($(planCell).text()).toLowerCase();
    const price = parseMoney(cellText($, $(priceCell)));
    if (price === undefined) return;
    if (/^go plus\b/.test(plan)) goPlus = price;
    else if (/^go\b/.test(plan)) go = price;
  });

  if (go === 0) warnings.push("go: Go plan price is missing");
  if (goPlus === 0) warnings.push("go: Go Plus plan price is missing");

  return { go, goPlus };
}

function parseEndpointRows(
  $: cheerio.CheerioAPI,
  group: DocsGroup,
  warnings: string[],
): DocsEndpointEntry[] {
  const table = findTable($, ["Model", "Model ID"]);
  if (!table) {
    warnings.push(`${group}: endpoint table is missing`);
    return [];
  }

  const entries: DocsEndpointEntry[] = [];
  table.find("tbody tr").each((_, element) => {
    const cells = $(element).find("td");
    const nameCell = cells[0];
    const idCell = cells[1];
    if (!nameCell || !idCell) return;
    const name = normalize($(nameCell).text());
    const id = normalize($(idCell).text());
    if (name && id) entries.push({ name, id, group });
  });

  return entries;
}

function parseGoPrivacy(
  $: cheerio.CheerioAPI,
  warnings: string[],
): DocsPrivacyEntry[] {
  const table = findTable($, ["Model", "Model training", "Data retention"]);
  if (!table) {
    warnings.push("go: privacy table is missing");
    return [];
  }

  const entries: DocsPrivacyEntry[] = [];
  table.find("tbody tr").each((_, element) => {
    const cells = $(element).find("td");
    if (cells.length < 3) return;

    const nameCell = cells[0];
    const trainingCell = cells[1];
    const retentionCell = cells[2];
    if (!nameCell || !trainingCell || !retentionCell) return;

    const name = normalize($(nameCell).text());
    if (!name) return;

    const training = parseTraining(normalize($(trainingCell).text()));
    const retentionText = normalize($(retentionCell).text());
    const retentionDays = parseRetentionDays(retentionText);
    const entry: DocsPrivacyEntry = { name, training };
    if (retentionDays !== undefined) entry.retentionDays = retentionDays;
    if (/not zdr/i.test(retentionText)) entry.notes = "Not ZDR";

    entries.push(entry);
  });

  return entries;
}

function deriveGoFreeEntries(
  prices: DocsPriceEntry[],
  privacy: DocsPrivacyEntry[],
): DocsFreeEntry[] {
  const byName = new Map(
    privacy.map((entry) => [normalizeModelName(entry.name), entry]),
  );

  const entries: DocsFreeEntry[] = [];
  for (const price of prices) {
    if (!price.free && !price.unlimited) continue;

    const match = byName.get(normalizeModelName(price.name));
    const entry: DocsFreeEntry = {
      name: price.name,
      group: "go",
      limitedTime: price.limitedTime,
      stealth: false,
      training: match?.training ?? "unknown",
      trialOnly: false,
      notes: price.notes ?? "",
    };
    if (match?.retentionDays !== undefined) {
      entry.retentionDays = match.retentionDays;
    } else if (price.free) {
      entry.retentionDays = 0;
    }

    entries.push(entry);
  }

  return entries;
}

export function emptyDocsEvidence(): DocsEvidence {
  return {
    freeModels: [],
    prices: [],
    consoleFree: [],
    consolePrices: [],
    goPrices: [],
    goPrivacy: [],
    endpoints: [],
    planPrices: { go: 0, goPlus: 0 },
    sources: [],
    sourceRefs: [],
    warnings: [],
  };
}

export function parseConsoleDocs(html: string, source?: SourceRef): DocsEvidence {
  const $ = cheerio.load(html);
  const warnings: string[] = [];

  let freeHeading = $("#free-models");
  if (!freeHeading.length) {
    freeHeading = $("h1, h2, h3, h4")
      .filter((_, element) => /free models/i.test($(element).text()))
      .first();
  }

  const freeList = freeHeading.nextAll("ul").first();
  if (!freeHeading.length) warnings.push("console: free-models heading is missing");
  if (!freeList.length) warnings.push("console: free-models list is missing");

  const consoleFree: DocsFreeEntry[] = [];
  freeList.find("li").each((_, element) => {
    const text = normalize($(element).text());
    if (text) consoleFree.push(parseFreeItem(text, "console"));
  });

  const consolePrivacy = parseConsolePrivacy($, warnings);
  mergeConsolePrivacy(consoleFree, consolePrivacy);

  const pricingTable = findTable(
    $,
    ["Model", "Input", "Output", "Cached Read", "Cached Write"],
    ["Monthly limit"],
  );
  if (!pricingTable) warnings.push("console: pricing table is missing");
  const consolePrices = pricingTable
    ? parsePriceRows($, pricingTable, "console")
    : [];

  const endpoints = parseEndpointRows($, "console", warnings);

  const hasExpectedSection =
    freeHeading.length > 0 ||
    pricingTable !== null ||
    $("#privacy").length > 0 ||
    endpoints.length > 0;
  if (!hasExpectedSection) {
    throw new Error("console docs page contains none of the expected sections");
  }

  const sources = source ? [source] : [];
  return {
    freeModels: consoleFree,
    prices: consolePrices,
    consoleFree,
    consolePrices,
    goPrices: [],
    goPrivacy: [],
    endpoints,
    planPrices: { go: 0, goPlus: 0 },
    sources,
    sourceRefs: sources,
    warnings,
  };
}

export function parseGoDocs(html: string, source?: SourceRef): DocsEvidence {
  const $ = cheerio.load(html);
  const warnings: string[] = [];

  const planPrices = parsePlanPrices($, warnings);

  const panelTable = $('[data-plan-panel="go"] table').first();
  const goPricingTable = panelTable.length
    ? panelTable
    : findTable($, ["Model", "Input", "Output", "Monthly limit"]);
  if (!goPricingTable) warnings.push("go: pricing table is missing");
  const goPrices = goPricingTable ? parsePriceRows($, goPricingTable, "go") : [];

  const goPrivacy = parseGoPrivacy($, warnings);
  const goFree = deriveGoFreeEntries(goPrices, goPrivacy);
  const endpoints = parseEndpointRows($, "go", warnings);

  const hasExpectedSection =
    planPrices.go > 0 ||
    planPrices.goPlus > 0 ||
    goPrices.length > 0 ||
    goPrivacy.length > 0 ||
    endpoints.length > 0;
  if (!hasExpectedSection) {
    throw new Error("go docs page contains none of the expected sections");
  }

  const sources = source ? [source] : [];
  return {
    freeModels: goFree,
    prices: goPrices,
    consoleFree: [],
    consolePrices: [],
    goPrices,
    goPrivacy,
    endpoints,
    planPrices,
    sources,
    sourceRefs: sources,
    warnings,
  };
}

export function mergeDocsEvidence(...parts: DocsEvidence[]): DocsEvidence {
  const merged = emptyDocsEvidence();
  const sources = new Map<string, SourceRef>();

  for (const part of parts) {
    merged.freeModels.push(...part.freeModels);
    merged.prices.push(...part.prices);
    merged.consoleFree.push(...part.consoleFree);
    merged.consolePrices.push(...part.consolePrices);
    merged.goPrices.push(...part.goPrices);
    merged.goPrivacy.push(...part.goPrivacy);
    merged.endpoints.push(...part.endpoints);
    if (part.planPrices.go > 0) merged.planPrices.go = part.planPrices.go;
    if (part.planPrices.goPlus > 0) merged.planPrices.goPlus = part.planPrices.goPlus;
    for (const source of [...part.sources, ...part.sourceRefs]) {
      sources.set(source.id, source);
    }
    merged.warnings.push(...part.warnings);
  }

  merged.sources = [...sources.values()];
  merged.sourceRefs = merged.sources;
  merged.warnings = [...new Set(merged.warnings)];
  return merged;
}
