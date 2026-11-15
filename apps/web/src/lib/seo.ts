/** Public discovery uses one production origin, never request-supplied hosts. */
export const siteOrigin = "https://ssh.amarjay.com";
export const publicPages = {
  "/": {
    title: "WebSSH — Persistent browser terminal for your machines",
    description:
      "Open your own machines’ terminals from a browser. Pair with GitHub, connect through encrypted transport, and keep remote work running with persistent tmux sessions.",
  },
  "/help": {
    title: "WebSSH Help — Pair machines and open terminal sessions",
    description:
      "Learn how to install WebSSH, pair a machine, open a browser terminal, and configure CLI logging. Find answers to common setup questions.",
  },
} as const;

export function indexablePage(
  url: URL,
  status: number,
  contentType: string | null,
): boolean {
  return (
    url.origin === siteOrigin &&
    status === 200 &&
    Object.hasOwn(publicPages, url.pathname) &&
    !url.searchParams.has("error") &&
    !!contentType?.includes("text/html")
  );
}
