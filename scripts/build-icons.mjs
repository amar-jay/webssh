#!/usr/bin/env node
// Regenerate the app icons from apps/web/static/icon.svg.
// Usage: pnpm icons
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const staticDir = fileURLToPath(
  new URL("../apps/web/static/", import.meta.url),
);
const tile = "#1e2030";
const source = await readFile(join(staticDir, "icon.svg"));

/** Render the SVG at high density so every size downsamples from vector detail. */
async function raster(size, { opaque = false } = {}) {
  let image = sharp(source, { density: 384 }).resize(size, size, {
    fit: "contain",
  });
  // Launchers round their own corners, so full-bleed tiles use the tile colour.
  if (opaque) image = image.flatten({ background: tile });
  return image.png({ compressionLevel: 9 }).toBuffer();
}

// ICO entries may embed PNG data; 16/32/48 cover browser tabs and shortcuts.
const icoSizes = [16, 32, 48];
const images = await Promise.all(icoSizes.map((size) => raster(size)));
const header = Buffer.alloc(6 + 16 * images.length);
header.writeUInt16LE(0, 0); // reserved
header.writeUInt16LE(1, 2); // 1 = icon
header.writeUInt16LE(images.length, 4);
let offset = header.length;
images.forEach((image, index) => {
  const entry = 6 + index * 16;
  header.writeUInt8(icoSizes[index], entry);
  header.writeUInt8(icoSizes[index], entry + 1);
  header.writeUInt8(0, entry + 2); // palette size
  header.writeUInt8(0, entry + 3); // reserved
  header.writeUInt16LE(1, entry + 4); // colour planes
  header.writeUInt16LE(32, entry + 6); // bits per pixel
  header.writeUInt32LE(image.length, entry + 8);
  header.writeUInt32LE(offset, entry + 12);
  offset += image.length;
});
await writeFile(
  join(staticDir, "favicon.ico"),
  Buffer.concat([header, ...images]),
);

await writeFile(
  join(staticDir, "apple-touch-icon.png"),
  await raster(180, { opaque: true }),
);
for (const size of [192, 512]) {
  await writeFile(
    join(staticDir, `icon-${size}.png`),
    await raster(size, { opaque: true }),
  );
}

// Keep the complete mark within the launcher's central safe area.
await writeFile(
  join(staticDir, "icon-maskable-512.png"),
  await sharp({
    create: { width: 512, height: 512, channels: 4, background: tile },
  })
    .composite([
      { input: await raster(384, { opaque: true }), gravity: "centre" },
    ])
    .png({ compressionLevel: 9 })
    .toBuffer(),
);

console.log(
  "wrote favicon.ico, apple-touch-icon.png, icon-192.png, icon-512.png, icon-maskable-512.png",
);
