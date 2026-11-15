import { redirect } from "@sveltejs/kit";
import type { PageServerLoad } from "./$types";

// No descriptor or grant is ever serialized into SSR HTML or page data.
export const load: PageServerLoad = async ({ locals, url, setHeaders }) => {
  setHeaders({ "cache-control": "no-store", "referrer-policy": "no-referrer" });
  if (!import.meta.env.DEV && !locals.user)
    throw redirect(303, `/login?next=${encodeURIComponent(url.pathname)}`);
  return {};
};
