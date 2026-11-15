<script lang="ts">
  import { Dialog } from "bits-ui";
  import { onMount } from "svelte";
  import { invalidateAll } from "$app/navigation";
  import type { AgentRecord, RunRecord } from "@webssh/state/types";
  import CommandBlock from "./CommandBlock.svelte";
  import Icon from "./Icon.svelte";
  import {
    buttonPrimary,
    buttonQuiet,
    buttonSubtle,
    eyebrow,
    machineIcon,
    pill,
  } from "#lib/ui.js";
  let {
    agents,
    runs,
    unavailable,
    message,
  }: {
    agents: AgentRecord[];
    runs: RunRecord[];
    unavailable: boolean;
    message?: string;
  } = $props();
  let refreshing = $state(false);
  let refreshFailed = $state(false);
  async function refresh() {
    if (refreshing) return;
    refreshing = true;
    try {
      await invalidateAll();
      refreshFailed = false;
    } catch {
      refreshFailed = true;
    } finally {
      refreshing = false;
    }
  }
  onMount(() => {
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") void refresh();
    }, 10_000);
    return () => clearInterval(timer);
  });
</script>

<main class="pt-14 pb-[70px]">
  <div
    class="mb-9 flex flex-col items-start justify-between gap-6 min-[721px]:flex-row min-[721px]:items-center"
  >
    <div>
      <p class={eyebrow}>YOUR WORKSPACE</p>
      <h1 class="mb-3 text-3xl tracking-tight min-[721px]:text-4xl">Machines.</h1>
      <p class="mb-0 text-secondary">
        Open a running workspace, or pair a new machine.
      </p>
    </div>
    <a class={buttonPrimary} href="/pair"
      >Pair machine <Icon name="plus" class="size-4" /></a
    >
  </div>
  {#if message}<p
      class="border-l-2 border-accent bg-accent/5 px-3 py-2 text-sm text-secondary"
      role="status"
    >
      {message}
    </p>{/if}
  {#if unavailable || refreshFailed}<p
      class="mt-5 rounded-lg border border-coral/50 bg-raised p-3.5 text-sm text-danger"
      role="alert"
    >
      Couldn’t load your workspaces. Check your connection and refresh.
    </p>{/if}
  <div class="mt-8 mb-[18px] flex items-center justify-between gap-[18px]">
    <h2 class="m-0 text-lg">
      Machines <span class="{pill} ml-2.5">{agents.length}</span>
    </h2>
    <button class={buttonQuiet} onclick={refresh} disabled={refreshing}
      >{refreshing ? "Refreshing…" : "Refresh"}</button
    >
  </div>
  {#if !agents.length}<section class="rounded-xl border border-line bg-surface p-6">
      <h3>Your first machine starts here.</h3>
      <p class="text-secondary">
        Run this on the machine you want to access, then approve its code.
      </p>
      <CommandBlock command="webssh pair" />
    </section>{/if}
  <div class="grid grid-cols-[repeat(auto-fit,minmax(min(100%,310px),1fr))] gap-5">
    {#each agents as agent (agent.agentId)}
      {@const workspaces = runs.filter(
        (r) =>
          r.agentId === agent.agentId &&
          !["ended", "expired"].includes(r.status),
      )}
      <section class="rounded-xl border border-line bg-surface p-6">
        <div class="mb-5 flex items-center gap-3.5">
          <span class="{machineIcon} m-0" aria-hidden="true">›_</span>
          <div>
            <h3 class="mt-0 mb-1.5 wrap-anywhere">{agent.machineName}</h3>
            <span class="text-sm text-secondary"
              >{workspaces.some((r) => r.status === "online")
                ? "Available"
                : "Offline"}</span
            >
          </div>
          <Dialog.Root>
            <Dialog.Trigger class={buttonQuiet}>Revoke access</Dialog.Trigger>
            <Dialog.Portal>
              <Dialog.Overlay
                class="fixed inset-0 z-50 bg-canvas/80 backdrop-blur-sm"
              />
              <Dialog.Content
                class="fixed top-1/2 left-1/2 z-[51] max-h-[85dvh] w-[min(520px,calc(100vw-32px))] -translate-1/2 overflow-auto rounded-2xl border border-line bg-surface p-6 shadow-2xl min-[721px]:p-8"
              >
                <Dialog.Title class="mt-3.5 mb-2.5 text-3xl tracking-tight"
                  >Revoke {agent.machineName}?</Dialog.Title
                >
                <Dialog.Description class="text-sm text-secondary"
                  >Current browser connections will detach and new connections
                  will be blocked. Tmux work stays on the machine. Pair the
                  machine again to restore access.</Dialog.Description
                >
                <form method="POST" action="?/revoke">
                  <input type="hidden" name="agentId" value={agent.agentId} />
                  <button type="submit" class="{buttonPrimary} mt-6"
                    >Revoke access</button
                  >
                  <Dialog.Close class={buttonQuiet}>Cancel</Dialog.Close>
                </form>
              </Dialog.Content>
            </Dialog.Portal>
          </Dialog.Root>
        </div>
        {#if !workspaces.length}<p class="text-sm text-secondary">
            Start the agent in your workspace to make it available here.
          </p>
          <CommandBlock command="webssh serve ." />{/if}
        {#each workspaces as run (run.runId)}<div
            class="mt-[18px] border-t border-line pt-[18px]"
          >
            <div class="mb-3.5 flex items-center gap-3 wrap-anywhere">
              <strong class="min-w-0 wrap-anywhere">{run.workspaceLabel}</strong
              ><span class="text-sm text-secondary"
                >{run.backend === "tmux" ? "Persistent" : "Ephemeral"}</span
              ><span class={pill}
                >{run.status === "online"
                  ? "Ready"
                  : run.status === "starting"
                    ? "Starting"
                    : "Offline"}</span
              >
            </div>
            <form method="POST" action="?/start">
              <input type="hidden" name="runId" value={run.runId} /><button
                class={buttonSubtle}
                disabled={run.status !== "online"}
                type="submit"
                >Open terminal <Icon name="arrow-up-right" class="size-3.5" /></button
              >
            </form>
          </div>{/each}
      </section>
    {/each}
  </div>
</main>
