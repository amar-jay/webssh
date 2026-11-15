import type { PageServerLoad } from "./$types";

export const load: PageServerLoad = async ({ locals, url, setHeaders }) => {
  setHeaders({ "cache-control": "no-store" });
  return { user: locals.user, error: url.searchParams.get("error") };
};
