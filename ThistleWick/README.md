# Thistlewick

A survival-crafting game about a gnome in a procedurally generated voxel forest. TypeScript, Three.js r128, bundled with esbuild.

## Run it
```
npm install
npm run build        # bundles src/ into dist/game.js and one self-contained dist/thistlewick.html
```
Open `index.html` (uses `dist/game.js`) or `dist/thistlewick.html` in a browser, or serve the folder (`python -m http.server`). `npm run dev` rebuilds on change. It needs internet only for the font.

## Checks
- `npm run typecheck`  strict TypeScript, no emit
- `npm test`           vitest: world generation parity with the original JS, item and recipe consistency
- `npm run smoke`      boots the built game in headless Chrome/Edge: starts a game, opens the journal and pack, saves and reloads, upgrades a v1 save, plants a crop and sleeps until it grows. Fails on any console error. It uses the `?debug` hooks (`window.__tw`), which only exist when the page URL contains `?debug`.

## Layout (`src/`)
- `main.ts`          the stateful game core: player, world chunks and scenery, enemies, combat, input, HUD, saving, main loop. To be split further as new systems are added.
- `world/worldgen.ts` pure world generator: terrain, biomes, mountains, lakes, caves, ores, lava. Runs in the browser and in node.
- `render/`          `gfx.ts` renderer, scene, lights, post-processing and materials; `geometry.ts` procedural meshes; `textures.ts` canvas-painted textures.
- `items.ts`         items, blocks, recipes and tool tables. `icons.ts` hand-drawn item icons. `audio.ts` synthesized sound.
- `systems/`         pure, unit-tested game rules: `journal.ts` goal arcs, `discoveries.ts` collection log, `dawn.ts` morning summary, `garden.ts` crop growth and soil/water rules.
- `save.ts`          save format (v2) and the v1 to v2 migration.
- `types.ts`         shared interfaces (inventory slot, chunk, enemy, station).
- `constants.ts`, `math.ts`, `dom.ts`  small shared helpers.
- `legacy/`          the original plain-JS version (kept as the reference for the parity tests).

## Tuning the world (`src/world/worldgen.ts`)
- `terr()`         mountain, lake and biome thresholds. `mm` is the mountain mask, `wet` the lake mask.
- `carve()`        cave shapes: thin winding tunnels plus large chambers.
- `genChunk()`     ore rarity, crystal density, lava depth (`LAVA_Y`), sea level (`SEA`).
- `S`, `JMIN`, `JMAX` chunk size and world height range.

## Adding a block
1. Add an id to `B` in `world/worldgen.ts`.
2. Paint a tile in `makeVoxelAtlas()` (`render/textures.ts`) and add it to `TL` in `items.ts`.
3. Register it with `bdef(...)` in `items.ts` (hardness, tool, drop) and, if placeable, add an item with `bid`.

## Gardening
Berry bushes sometimes give a wild seed. Plant it in grass or dirt (right click / place); crops within three blocks of water grow at full speed, others at half. They keep growing while you sleep, and the dawn card reports it. Hit or press E on a ripe crop to harvest thistle roots (roast them at a campfire); uprooting an unripe one returns the seed.

## Saving
The game autosaves to `localStorage` (key `thistlewick-save-v1`, type `SaveV1`) every 30 seconds and when the tab is hidden or closed. A save stores your position, stats, inventory, time of day, every block you changed (a compact list), placed stations and torches, felled trees, broken rocks and collected pickups. World generation is deterministic, so only your changes are stored, not the terrain.
To wipe it: press "Start over" on the title screen, or run `localStorage.removeItem('thistlewick-save-v1')` in the console.
