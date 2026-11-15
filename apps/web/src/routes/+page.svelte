<script lang="ts">
  import { Tabs } from "bits-ui";
  import AppShell from "#lib/components/AppShell.svelte";
  import CommandBlock from "#lib/components/CommandBlock.svelte";
  import WorkspaceDashboard from "#lib/components/WorkspaceDashboard.svelte";
  let { data, form } = $props();
</script>

<svelte:head
  ><title>WebSSH · Your machines, within reach</title><meta
    name="description"
    content="Pair your machines with WebSSH. A browser terminal for your own workspace."
  /></svelte:head
>
<AppShell signedIn={!!data.user}>
  {#if data.user}
    <WorkspaceDashboard
      agents={data.agents}
      runs={data.runs}
      sessions={data.sessions}
      unavailable={data.unavailable}
      message={form?.message}
    />
  {:else}
    <main class="overview">
      <section class="intro">
        <p class="eyebrow">
          <span class="status-dot"></span> A DIRECT LINE TO YOUR WORKSPACE
        </p>
        <h1>Your machines.<br /><span>Within reach.</span></h1>
        <p class="intro-copy">
          A familiar shell, a little closer. Connect your own machine to your
          account and take your workspace into the browser.
        </p>
        <div class="intro-actions">
          {#if data.user}<a class="button primary" href="/pair"
              >Pair a machine <span aria-hidden="true">→</span></a
            >{:else}<a class="button primary" href="/login"
              ><svg
                width="18"
                height="18"
                viewBox="0 0 24 24"
                fill="currentColor"
                aria-hidden="true"
                ><path
                  d="M12 .8a11.2 11.2 0 0 0-3.54 21.83c.56.1.77-.24.77-.54v-2.1c-3.13.68-3.79-1.33-3.79-1.33-.51-1.3-1.25-1.65-1.25-1.65-1.02-.7.08-.69.08-.69 1.13.08 1.72 1.16 1.72 1.16 1 1.71 2.63 1.22 3.27.93.1-.72.39-1.22.71-1.5-2.5-.29-5.13-1.25-5.13-5.54 0-1.23.44-2.23 1.16-3.02-.12-.29-.5-1.43.11-2.98 0 0 .95-.3 3.08 1.15a10.7 10.7 0 0 1 5.61 0c2.14-1.45 3.08-1.15 3.08-1.15.61 1.55.23 2.69.12 2.98.72.79 1.15 1.79 1.15 3.02 0 4.3-2.64 5.25-5.15 5.53.4.35.76 1.03.76 2.08v3.11c0 .3.2.65.78.54A11.2 11.2 0 0 0 12 .8Z"
                /></svg
              >Continue with GitHub <span aria-hidden="true">→</span></a
            >{/if}<span class="muted small">Linux & macOS</span>
        </div>
        {#if data.error}<p class="notice error" role="alert">
            {data.error === "auth_not_configured"
              ? "Sign-in is unavailable right now. Please try again later."
              : "Sign-in didn’t complete. Please try signing in again."}
          </p>{/if}
        <div class="feature-line">
          <span>Private by default</span><span>GitHub sign-in</span><span
            >Your own shell</span
          >
        </div>
      </section>
      <section class="setup-panel" aria-labelledby="setup-title">
        <div class="panel-heading">
          <span class="eyebrow">WORKSPACE SETUP</span><span class="pill"
            >{data.user ? "Signed in" : "Get started"}</span
          >
        </div>
        <h2 id="setup-title">Make the connection.</h2>
        <p class="muted">Start on your machine. Finish right here.</p>
        <Tabs.Root value="pair">
          <Tabs.List class="tabs-list" aria-label="Setup steps"
            ><Tabs.Trigger class="tab-trigger" value="pair"
              >Pair machine</Tabs.Trigger
            ><Tabs.Trigger class="tab-trigger" value="next"
              >After pairing</Tabs.Trigger
            ></Tabs.List
          >
          <Tabs.Content value="pair" class="tab-content"
            ><p class="step-label">RUN IN YOUR TERMINAL</p>
            <CommandBlock command="webssh pair" />
            <p class="muted small">
              The command prints a code and an approval link. Keep your terminal
              open while you confirm.
            </p>
            <a class="text-link" href="/pair"
              >Already have a code? Enter it here <span aria-hidden="true"
                >→</span
              ></a
            ></Tabs.Content
          >
          <Tabs.Content value="next" class="tab-content"
            ><p class="step-label">START YOUR WORKSPACE AGENT</p>
            <CommandBlock command="webssh serve ." />
            <p class="muted small">
              Run this in the folder you want to work in. Keep the agent running
              while you use your workspace.
            </p>
            <div class="inline-note">
              Open the browser URL printed by serve. Sign in with the same
              GitHub account you used to pair.
            </div></Tabs.Content
          >
        </Tabs.Root>
        <div class="terminal-strip" aria-hidden="true">
          <span>›_</span><span
            >Less distance.<br /><strong>Same workspace.</strong></span
          ><span class="terminal-cursor"></span>
        </div>
      </section>
    </main>
    <section class="workflow" aria-label="How pairing works">
      <div>
        <span class="workflow-number">01</span>
        <h3>Sign in</h3>
        <p>Use GitHub to create your private connection.</p>
      </div>
      <div>
        <span class="workflow-number">02</span>
        <h3>Pair your machine</h3>
        <p>Match the code and approve a machine you trust.</p>
      </div>
      <div>
        <span class="workflow-number">03</span>
        <h3>Open your terminal</h3>
        <p>
          Run serve and open its URL. Your terminal connects directly to your
          machine.
        </p>
      </div>
    </section>
  {/if}
</AppShell>
