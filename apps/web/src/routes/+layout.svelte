<script lang="ts">
  import "#lib/styles.css";
  import type { LayoutProps } from "./$types";

  let { children }: LayoutProps = $props();
</script>

{@render children()}
