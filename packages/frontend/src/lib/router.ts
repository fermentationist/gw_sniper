export type Route = "inbox" | "bids" | "searches" | "config";

const ROUTES: Route[] = ["inbox", "bids", "searches", "config"];

// Legacy aliases: keep "snipers" working so bookmarks/back-buttons don't break.
const ALIASES: Record<string, Route> = { snipers: "bids" };

export function parseRoute(hash: string): Route {
  const clean = hash.replace(/^#\/?/, "");
  if ((ROUTES as string[]).includes(clean)) return clean as Route;
  if (clean in ALIASES) return ALIASES[clean]!;
  return "inbox";
}

export function navigate(route: Route): void {
  window.location.hash = `/${route}`;
}
