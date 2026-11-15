import script from "../../../../../scripts/install.sh?raw";
import type { RequestHandler } from "./$types";

/** Public installer. The URL stays unversioned; the script resolves the current release. */
export const GET: RequestHandler = () =>
  new Response(script, {
    headers: { "content-type": "text/plain; charset=utf-8" },
  });
