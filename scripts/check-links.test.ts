import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  checkLinks,
  extractHrefs,
  resolveInternalHref,
  targetPath,
} from "./check-links";

const directories: string[] = [];

async function temporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "omg-links-"));
  directories.push(directory);
  return directory;
}

async function write(directory: string, path: string, body: string): Promise<void> {
  const full = join(directory, ...path.split("/"));
  await mkdir(join(full, ".."), { recursive: true });
  await writeFile(full, body, "utf8");
}

afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
});

describe("link parser", () => {
  it("extracts quoted href values and decodes ampersands", () => {
    const html = `
      <a href="/models">Models</a>
      <a href='/changes?type=free&amp;x=1'>Changes</a>
      <link href="/feed.xml">
    `;
    expect(extractHrefs(html)).toEqual([
      "/models",
      "/changes?type=free&x=1",
      "/feed.xml",
    ]);
  });

  it("ignores external, fragment, mail, and data links", () => {
    for (const href of [
      "https://example.com",
      "http://example.com",
      "mailto:hi@example.com",
      "tel:+15551212",
      "#main",
      "data:text/plain,hi",
      "//example.com/x",
      "",
    ]) {
      expect(resolveInternalHref(href, "index.html")).toEqual({ kind: "ignored" });
    }
  });

  it("resolves root links against BASE_PATH", () => {
    expect(
      resolveInternalHref(
        "/repo/models/foo/?free=open-free",
        "index.html",
        "/repo",
      ),
    ).toEqual({ kind: "path", path: "models/foo/" });
    expect(resolveInternalHref("/repo/feed.xml", "index.html", "/repo/")).toEqual({
      kind: "path",
      path: "feed.xml",
    });
  });

  it("rejects a root link that omits BASE_PATH", () => {
    expect(resolveInternalHref("/models", "index.html", "/repo")).toEqual({
      kind: "error",
      reason: "root-relative link does not start with BASE_PATH /repo",
    });
  });

  it("resolves relative links from nested pages", () => {
    expect(
      resolveInternalHref("../feed.xml", "models/foo/index.html", "/repo"),
    ).toEqual({ kind: "path", path: "models/feed.xml" });
    expect(resolveInternalHref("./", "models/index.html")).toEqual({
      kind: "path",
      path: "models/",
    });
    expect(resolveInternalHref("?free=open-free", "models/index.html")).toEqual({
      kind: "path",
      path: "models/index.html",
    });
  });

  it("rejects links that escape the build directory", () => {
    expect(resolveInternalHref("../../secret", "index.html")).toEqual({
      kind: "error",
      reason: "link escapes the build directory",
    });
  });

  it("maps directories and files to their built targets", () => {
    expect(targetPath("")).toBe("index.html");
    expect(targetPath("models")).toBe("models");
    expect(targetPath("models/")).toBe("models/index.html");
    expect(targetPath("feed.xml")).toBe("feed.xml");
  });
});

describe("link check", () => {
  it("passes when every internal link and asset resolves", async () => {
    const directory = await temporaryDirectory();
    await write(
      directory,
      "index.html",
      `<a href="/repo/models/foo/">Foo</a>
       <a href="/repo/feed.xml">Feed</a>
       <a href="/repo/models/">Models</a>
       <a href="https://example.com">External</a>`,
    );
    await write(directory, "models/index.html", `<a href="../feed.xml">Feed</a>`);
    await write(directory, "models/foo/index.html", `<a href="/repo/">Home</a>`);
    await write(directory, "feed.xml", "<rss />");

    const result = await checkLinks(directory, "/repo");

    expect(result).toMatchObject({ files: 3, broken: [] });
    expect(result.links).toBe(5);
  });

  it("reports missing files and bad base paths", async () => {
    const directory = await temporaryDirectory();
    await write(
      directory,
      "index.html",
      `<a href="/repo/missing/">Missing</a>
       <a href="/models">Wrong base</a>
       <a href="also-missing.xml">Missing file</a>`,
    );

    const result = await checkLinks(directory, "/repo");

    expect(result.files).toBe(1);
    expect(result.broken).toHaveLength(3);
    expect(result.broken.map((link) => link.target)).toEqual([
      "missing/index.html",
      "/models",
      "also-missing.xml",
    ]);
    expect(result.broken[1]?.reason).toContain("BASE_PATH");
  });

  it("fails clearly when the build directory is missing", async () => {
    await expect(checkLinks("/tmp/does-not-exist-omg", "")).rejects.toThrow(
      /could not read/,
    );
  });
});
