import type { PageServerLoad } from "./$types";

export const load: PageServerLoad = async ({ locals, setHeaders }) => {
  setHeaders({ "cache-control": "no-store" });
  return { user: locals.user };
};
