const dev = import.meta.env.DEV;
import { error } from "@sveltejs/kit";
export function load({ url }: { url: URL }) {
  if (!dev || !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname))
    error(404, "Not found");
}
