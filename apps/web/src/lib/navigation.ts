export type NavTab = { href: string; label: string };

/** Primary sections, shared by the landing page and the signed-in app. */
export const primaryTabs: readonly NavTab[] = [
  { href: "/machines", label: "Machines" },
  { href: "/pair", label: "Pair" },
  { href: "/help", label: "Help" },
];

/** A tab is current on its own page and on its nested pages, such as /machines/<id>. */
export function isCurrentTab(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`);
}
