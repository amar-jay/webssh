<script lang="ts">
  import { onDestroy } from "svelte";
  import CheckCircle2 from "@lucide/svelte/icons/circle-check";
  import LoaderCircle from "@lucide/svelte/icons/loader-circle";
  import Monitor from "@lucide/svelte/icons/monitor";
  import CommandCard from "./CommandCard.svelte";
  import { buttonPrimary, buttonQuiet } from "#lib/ui.js";

  let {
    code,
    machineName,
    error,
  }: {
    code: string;
    machineName?: string;
    error?: string | null;
  } = $props();
  let status = $state<"idle" | "working" | "done" | "error">("idle");
  let message = $state("");
  let pairedName = $state("");
  const controller = new AbortController();
  onDestroy(() => controller.abort());

  async function approve() {
    if (!code || status === "working" || status === "done") return;
    status = "working";
    message = "";
    try {
      const response = await fetch("/api/pairing/approve", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ code }),
        signal: controller.signal,
      });
      if (controller.signal.aborted) return;
      if (!response.ok) {
        status = "error";
        message =
          response.status === 401
            ? "Your sign-in expired. Sign in again, then reopen the pairing link."
            : "This request is unavailable. Run webssh pair again for a fresh code.";
        return;
      }
      const body = (await response.json()) as { machineName?: string };
      if (controller.signal.aborted) return;
      pairedName = body.machineName ?? machineName ?? "Machine";
      status = "done";
    } catch {
      if (controller.signal.aborted) return;
      status = "error";
      message =
        "Couldn’t confirm pairing. Check your terminal before trying again.";
    }
  }
</script>

<section class="w-full text-center" aria-label="Machine pairing">
  {#if status === "done"}
    <div class="w-full">
      <div class="mb-3 flex items-center justify-center gap-2.5">
        <CheckCircle2
          class="size-5 shrink-0 text-[#c3e88d]"
          aria-hidden="true"
        />
        <h2 class="m-0 text-lg">Machine paired</h2>
      </div>
      <p class="mb-6 text-sm text-secondary" role="status">
        <span class="font-medium text-ink">{pairedName}</span> is now linked to your
        account.
      </p>
      <p class="mb-3 text-sm text-secondary">
        Run this on your machine, then open the URL it prints.
      </p>
      <div class="flex justify-center">
        <CommandCard command="webssh serve ." />
      </div>
      <div class="mt-7 flex flex-wrap items-center justify-center gap-2">
        <a class={buttonPrimary} href="/machines">View machines</a><a
          class={buttonQuiet}
          href="/pair">Pair another</a
        >
      </div>
    </div>
  {:else if !code || error}
    <div class="mb-8">
      <p class="mb-3 text-sm text-secondary">
        Start on the machine you want to connect.
      </p>
      <div class="flex justify-center">
        <CommandCard command="webssh pair" />
      </div>
    </div>
    <form class="mx-auto w-full max-w-[340px]" method="GET" action="/pair">
      <label class="mb-3 block text-sm font-medium" for="pairing-code"
        >Pairing code</label
      >
      <input
        class="w-full rounded-lg border border-line bg-canvas/60 px-3 py-3.5 text-center font-mono text-2xl tracking-[.25em] text-ink uppercase placeholder:text-secondary/70 focus:border-accent"
        id="pairing-code"
        name="code"
        type="text"
        placeholder="XXXXXXXX"
        minlength="8"
        maxlength="8"
        pattern="[A-Za-z0-9]{8}"
        required
        autocomplete="off"
        autocapitalize="characters"
        spellcheck="false"
        enterkeyhint="go"
        aria-invalid={!!error}
        aria-describedby={error ? "pair-error pair-hint" : "pair-hint"}
      />
      <p id="pair-hint" class="mt-3 mb-0 text-xs text-secondary">
        Enter the 8-character code. Keep webssh pair running.
      </p>
      {#if error}<p
          id="pair-error"
          class="mt-4 mb-0 text-sm text-danger"
          role="alert"
        >
          {error === "invalid_code"
            ? "Use an 8-character code with letters and numbers."
            : "This code is unavailable or expired. Run webssh pair again."}
        </p>{/if}
      <div class="mt-6 flex items-center justify-center gap-2">
        <button class={buttonPrimary} type="submit">Continue</button><a
          class={buttonQuiet}
          href="/machines">Cancel</a
        >
      </div>
    </form>
  {:else}
    <div class="w-full">
      <p class="mb-5 text-sm text-secondary">
        Match this machine and code with your terminal.
      </p>
      <div class="mb-5 flex items-center justify-center gap-3">
        <Monitor class="size-5 shrink-0 text-accent" aria-hidden="true" />
        <h2 class="m-0 min-w-0 text-lg wrap-anywhere">
          {machineName ?? "Machine"}
        </h2>
      </div>
      <div class="py-2">
        <span class="sr-only">Pairing code: </span><code
          class="text-2xl tracking-[.25em]">{code}</code
        >
      </div>
      <p class="mt-4 mb-0 text-xs text-secondary">
        Only approve a request you started.
      </p>
      {#if status === "error"}<p
          class="mt-4 mb-0 text-sm text-danger"
          role="alert"
        >
          {message}
        </p>{/if}
      <div class="mt-6 flex flex-wrap items-center justify-center gap-2">
        <button
          class={buttonPrimary}
          type="button"
          onclick={approve}
          disabled={status === "working"}
          aria-busy={status === "working"}
        >
          {#if status === "working"}<LoaderCircle
              class="size-4 animate-spin motion-reduce:animate-none"
              aria-hidden="true"
            />{/if}
          {status === "working" ? "Approving…" : "Approve machine"}
        </button>
        <a class={buttonQuiet} href="/pair">Change code</a>
      </div>
    </div>
  {/if}
</section>
