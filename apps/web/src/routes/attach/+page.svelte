<script lang="ts">
  import AppShell from "#lib/components/AppShell.svelte";
  import { buttonPrimary, buttonQuiet } from "#lib/ui.js";
  let { data, form } = $props();
</script>

<svelte:head><title>Approve CLI access · WebSSH</title></svelte:head>
<AppShell signedIn={!!data.user} width="narrow">
  <section class="w-full max-w-[460px] text-center">
    {#if form?.approved}
      <h1 class="mb-4 text-2xl">CLI access approved</h1>
      <p class="text-sm text-secondary" role="status">
        Return to your terminal. Signing out here also revokes this connection.
      </p>
    {:else if data.code && data.workspace}
      <h1 class="mb-4 text-2xl">Connect from your terminal</h1>
      <p class="mb-6 text-sm text-secondary">
        Allow the CLI to control <strong class="text-ink"
          >{data.workspace}</strong
        >? Match this code with the request you started.
      </p>
      <code class="text-2xl tracking-widest">{data.code}</code>
      <form class="mt-6 flex justify-center gap-2" method="POST">
        <input type="hidden" name="code" value={data.code} /><button
          class={buttonPrimary}
          type="submit">Approve CLI access</button
        ><a class={buttonQuiet} href="/machines">Cancel</a>
      </form>
      {#if form && "message" in form}<p
          class="mt-4 text-sm text-danger"
          role="alert"
        >
          {form.message}
        </p>{/if}
    {:else}<h1 class="mb-4 text-2xl">Request unavailable</h1>
      <p class="text-sm text-secondary">
        Run webssh attach again for a fresh approval link.
      </p>{/if}
  </section>
</AppShell>
