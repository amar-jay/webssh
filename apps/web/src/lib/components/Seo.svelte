<script lang="ts">
  import { publicPages, siteOrigin } from "#lib/seo.js";
  let { path }: { path: keyof typeof publicPages } = $props();
  let metadata = $derived(publicPages[path]);
  let canonical = $derived(`${siteOrigin}${path}`);
</script>

<svelte:head>
  <title>{metadata.title}</title>
  <meta name="description" content={metadata.description} />
  <link rel="canonical" href={canonical} />
  <meta property="og:type" content="website" />
  <meta property="og:site_name" content="WebSSH" />
  <meta property="og:locale" content="en_US" />
  <meta property="og:title" content={metadata.title} />
  <meta property="og:description" content={metadata.description} />
  <meta property="og:url" content={canonical} />
  <meta property="og:image" content={`${siteOrigin}/icon-512.png`} />
  <meta property="og:image:width" content="512" />
  <meta property="og:image:height" content="512" />
  <meta property="og:image:alt" content="WebSSH terminal app icon" />
  <meta name="twitter:card" content="summary" />
  <meta name="twitter:title" content={metadata.title} />
  <meta name="twitter:description" content={metadata.description} />
  <meta name="twitter:image" content={`${siteOrigin}/icon-512.png`} />
  <meta name="twitter:image:alt" content="WebSSH terminal app icon" />
</svelte:head>
