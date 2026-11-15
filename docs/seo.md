# Search discovery

The public landing page (`/`) and Help (`/help`) use shared metadata from `apps/web/src/lib/seo.ts` and `Seo.svelte`. Titles, descriptions, canonical URLs, Open Graph and Twitter card tags are server-rendered. Canonical URLs use `https://ssh.amarjay.com`, regardless of query parameters or the incoming host. The existing 512px app icon is the sharing image.

`apps/web/static/robots.txt` advertises `/sitemap.xml`. The sitemap contains only those two public pages. Add public content to both the metadata map and the sitemap; the SEO test checks that they agree. Sitemap dates are intentionally omitted rather than inventing last-modified values.

The server sends `X-Robots-Tag: noindex, nofollow` on private app routes, API responses, redirects, errors, and alternate/development origins. Successful public HTML on the production origin permits indexing. Crawling stays allowed in robots.txt so search engines can read those noindex responses. Authentication and no-store behavior remain in place. These rules do not replace authorization.

After deployment, verify the domain in Google Search Console and Bing Webmaster Tools, then submit `https://ssh.amarjay.com/sitemap.xml`. Domain verification requires access to the relevant operator account or DNS; no verification token is embedded in the repository. Use URL inspection to request indexing of the landing page and Help.

Run the web checks/tests/build and `node scripts/smoke-production.mjs https://ssh.amarjay.com` after deployment. The smoke check verifies canonical/social tags, sitemap discovery, and public/private indexing headers.

Reference: https://developers.google.com/search/docs/crawling-indexing/block-indexing
