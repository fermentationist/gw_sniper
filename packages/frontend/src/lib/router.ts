export type Route = "inbox" | "snipers" | "searches" | "config";

const ROUTES: Route[] = ["inbox", "snipers", "searches", "config"];

export function parseRoute(hash: string): Route {
  const clean = hash.replace(/^#\/?/, "");
  return (ROUTES as string[]).includes(clean) ? (clean as Route) : "inbox";
}

export function navigate(route: Route): void {
  window.location.hash = `/${route}`;
}
