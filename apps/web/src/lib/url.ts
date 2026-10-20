/**
 * Prefix an internal path with the Astro base path exactly once.
 *
 * `import.meta.env.BASE_URL` is `/` locally and `/repo/` on GitHub Pages.
 */
export function url(
  path: string,
  base: string = import.meta.env.BASE_URL,
): string {
  const normalizedBase = base.replace(/\/+$/, "");
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;

  if (
    normalizedBase &&
    (normalizedPath === normalizedBase ||
      normalizedPath.startsWith(`${normalizedBase}/`) ||
      normalizedPath.startsWith(`${normalizedBase}?`))
  ) {
    return normalizedPath;
  }

  return normalizedBase
    ? `${normalizedBase}${normalizedPath}`
    : normalizedPath || "/";
}
