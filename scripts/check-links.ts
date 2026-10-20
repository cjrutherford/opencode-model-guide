import { readdir, readFile, stat } from "node:fs/promises";
import { join, posix, relative, sep } from "node:path";

export interface BrokenLink {
  source: string;
  href: string;
  target: string;
  reason: string;
}

export interface LinkCheckResult {
  files: number;
  links: number;
  broken: BrokenLink[];
}

type Resolution =
  | { kind: "ignored" }
  | { kind: "path"; path: string }
  | { kind: "error"; reason: string };

const EXTERNAL = /^(?:[a-z][a-z0-9+.-]*:|\/\/)/i;

function decodeEntities(value: string): string {
  return value
    .replace(/&amp;/gi, "&")
    .replace(/&#0*38;/g, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#0*39;/g, "'");
}

export function extractHrefs(html: string): string[] {
  const hrefs: string[] = [];
  const pattern = /\bhref\s*=\s*(?:"([^"]*)"|'([^']*)')/gi;
  for (const match of html.matchAll(pattern)) {
    const value = match[1] ?? match[2];
    if (value !== undefined) hrefs.push(decodeEntities(value.trim()));
  }
  return hrefs;
}

export function normalizeBasePath(basePath: string | undefined): string {
  const trimmed = (basePath ?? "").trim();
  if (!trimmed || trimmed === "/") return "";
  const withLeading = trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
  return withLeading.replace(/\/+$/, "");
}

export function resolveInternalHref(
  href: string,
  sourceRelative: string,
  basePath = "",
): Resolution {
  if (href.length === 0 || href.startsWith("#")) return { kind: "ignored" };
  if (EXTERNAL.test(href)) return { kind: "ignored" };

  const base = normalizeBasePath(basePath);
  const [rawPath = ""] = href.split(/[?#]/, 1);
  if (rawPath.length === 0) {
    return { kind: "path", path: sourceRelative };
  }

  let decoded: string;
  try {
    decoded = decodeURIComponent(rawPath);
  } catch {
    return { kind: "error", reason: "invalid percent-encoding" };
  }

  let path: string;
  if (decoded.startsWith("/")) {
    if (base.length > 0) {
      if (decoded === base) {
        path = "";
      } else if (decoded.startsWith(`${base}/`)) {
        path = decoded.slice(base.length);
      } else {
        return {
          kind: "error",
          reason: `root-relative link does not start with BASE_PATH ${base}`,
        };
      }
    } else {
      path = decoded;
    }
    path = path.replace(/^\/+/, "");
  } else {
    path = posix.join(posix.dirname(sourceRelative), decoded);
  }

  path = posix.normalize(path);
  if (path === ".") path = "";
  if (path === ".." || path.startsWith("../")) {
    return { kind: "error", reason: "link escapes the build directory" };
  }
  return { kind: "path", path };
}

export function targetPath(path: string): string {
  if (path.length === 0 || path.endsWith("/")) {
    return path.length === 0 ? "index.html" : `${path}index.html`;
  }
  return path;
}

async function isFile(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isFile();
  } catch {
    return false;
  }
}

async function targetExists(distDir: string, path: string): Promise<boolean> {
  const candidate = targetPath(path);
  const full = join(distDir, ...candidate.split("/"));
  if (await isFile(full)) return true;

  if (!path.endsWith("/") && posix.extname(path) === "") {
    return isFile(join(distDir, ...`${path}/index.html`.split("/")));
  }
  return false;
}

async function walkHtml(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await walkHtml(path)));
    } else if (entry.isFile() && entry.name.endsWith(".html")) {
      files.push(path);
    }
  }
  return files;
}

export async function checkLinks(
  distDir: string,
  basePath = "",
): Promise<LinkCheckResult> {
  let files: string[];
  try {
    files = await walkHtml(distDir);
  } catch (error) {
    throw new Error(
      `could not read ${distDir}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  const broken: BrokenLink[] = [];
  let links = 0;

  for (const file of files) {
    const source = relative(distDir, file).split(sep).join("/");
    const html = await readFile(file, "utf8");
    for (const href of extractHrefs(html)) {
      const resolution = resolveInternalHref(href, source, basePath);
      if (resolution.kind === "ignored") continue;
      links += 1;
      if (resolution.kind === "error") {
        broken.push({ source, href, target: href, reason: resolution.reason });
        continue;
      }
      if (!(await targetExists(distDir, resolution.path))) {
        broken.push({
          source,
          href,
          target: targetPath(resolution.path),
          reason: "target file does not exist",
        });
      }
    }
  }

  return { files: files.length, links, broken };
}

export async function main(): Promise<void> {
  const distDir = process.env.DIST_DIR ?? "apps/web/dist";
  const basePath = process.env.BASE_PATH ?? "";
  const result = await checkLinks(distDir, basePath);

  if (result.broken.length > 0) {
    for (const link of result.broken) {
      console.error(
        `${link.source}: ${link.href} -> ${link.target} (${link.reason})`,
      );
    }
    console.error(
      `link check: ${result.broken.length} broken of ${result.links} internal links in ${result.files} files`,
    );
    process.exitCode = 1;
    return;
  }

  console.log(
    `link check: ${result.links} internal links in ${result.files} files; 0 broken`,
  );
}

const invokedDirectly =
  process.argv[1] !== undefined &&
  /(?:^|[/\\])check-links\.ts$/.test(process.argv[1]);

if (invokedDirectly) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
