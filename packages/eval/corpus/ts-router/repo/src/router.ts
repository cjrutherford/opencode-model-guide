export interface RouteMatch {
  handler: string;
  params: Record<string, string>;
}

export function matchPath(
  pattern: string,
  path: string,
): Record<string, string> | null {
  const patternParts = pattern.split("/").filter(Boolean);
  const pathParts = path.split("/").filter(Boolean);
  if (patternParts.length !== pathParts.length) return null;

  const params: Record<string, string> = {};
  for (let index = 0; index < patternParts.length; index += 1) {
    const part = patternParts[index]!;
    const value = pathParts[index]!;
    if (part.startsWith(":")) {
      params[part.slice(1)] = value;
    } else if (part !== value) {
      return null;
    }
  }
  return params;
}

export class Router {
  private readonly routes: Array<{ pattern: string; handler: string }> = [];

  add(pattern: string, handler: string): void {
    this.routes.push({ pattern, handler });
  }

  match(path: string): RouteMatch | null {
    for (const route of this.routes) {
      const params = matchPath(route.pattern, path);
      if (params) return { handler: route.handler, params };
    }
    return null;
  }
}
