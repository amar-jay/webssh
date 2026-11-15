// Public service endpoints only. No credentials or application descriptors.
const mapURL = process.argv[2] || "https://tailcat.dev/derpmap.json";
if (new URL(mapURL).protocol !== "https:")
  throw new Error("Relay map must use HTTPS");
const response = await fetch(mapURL, { signal: AbortSignal.timeout(15000) });
if (!response.ok) throw new Error("Relay map unavailable");
const map = await response.json();
let failures = 0;
for (const region of Object.values(map.Regions || {}))
  for (const node of region.Nodes || []) {
    const start = performance.now();
    try {
      await new Promise((resolve, reject) => {
        const socket = new WebSocket(
          `wss://${node.HostName}:${node.DERPPort || 443}/derp`,
          ["derp"],
        );
        const timer = setTimeout(() => {
          socket.close();
          reject(new Error("timeout"));
        }, 10000);
        socket.addEventListener(
          "open",
          () => {
            clearTimeout(timer);
            socket.close();
            resolve();
          },
          { once: true },
        );
        socket.addEventListener(
          "error",
          () => {
            clearTimeout(timer);
            reject(new Error("unavailable"));
          },
          { once: true },
        );
      });
      console.log(
        JSON.stringify({
          component: "relay",
          region: region.RegionCode,
          status: "websocket_tls_ok",
          milliseconds: Math.round(performance.now() - start),
        }),
      );
    } catch {
      failures++;
      console.log(
        JSON.stringify({
          component: "relay",
          region: region.RegionCode,
          status: "unavailable",
        }),
      );
    }
  }
if (!Object.keys(map.Regions || {}).length || failures) process.exitCode = 1;
