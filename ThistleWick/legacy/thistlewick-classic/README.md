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

## World identity and generator versions (`src/world/seed.ts`)
A save records `worldSeed` and `genVersion`. The world is the seed run through the generator, plus the player's changes (`edits`, `collected`, `dead`) stored on top.
- Seed 0 is the original world and must stay bit-identical (the parity tests enforce it). New worlds get a random seed.
- Scenery in generator v2 draws each spawn attempt of a persisted kind (trees, rocks, ore, bushes, pickups) from its own stream, so its ids survive edits elsewhere in `genChunk`. v1 keeps the old shared stream for old saves.
- **Any change that alters what an existing world generates must bump `GEN_VERSION` and be gated on `world.genVersion`**, otherwise old saves reshuffle under the player's edits. A save from a newer generator than the build knows is not loaded.

## Adding a block
1. Add an id to `B` in `world/worldgen.ts`.
2. Paint a tile in `makeVoxelAtlas()` (`render/textures.ts`) and add it to `TL` in `items.ts`.
3. Register it with `bdef(...)` in `items.ts` (hardness, tool, drop) and, if placeable, add an item with `bid`.

## Gardening
Berry bushes sometimes give a wild seed. Plant it in grass or dirt (right click / place); crops within three blocks of water grow at full speed, others at half. They keep growing while you sleep, and the dawn card reports it. Hit or press E on a ripe crop to harvest thistle roots (roast them at a campfire); uprooting an unripe one returns the seed.

## Exploring and gathering

The original spawn at (0, 3) has a permanent 24-block beetle sanctuary, marked **Safe clearing** in the HUD. Sleeping elsewhere does not move it. Ordinary beetles notice players within 10 blocks, give up beyond 16 blocks or behind solid cover, and cannot spawn inside light wards. Returning to the clearing ends pursuit, including the Elder Beetle. Wilderness danger remains at night and in caves, with fewer, slower beetles.

Aim at ground scenery and press **E** or left click to harvest. Mushrooms give food; loose stones give stone; twigs give sticks; grass, ferns, leaves and flowers give fibre. Grass and flowers sometimes also give plantable wild seeds. A full pack leaves the resource in place. Harvests persist through saves and chunk reloads. Loose pickups still collect when walked over; standing plants require deliberate harvesting. These materials feed the existing cooking, bandage, bed, tool and farming recipes.

Ancient trunks and fallen logs can be chopped for wood. Felled trees leave no permanent stump collision. **E** picks berries without removing the bush; hitting uproots it so the ground can be reshaped.

Terrain extends about 320 blocks using surface meshes outside the existing detailed voxel radius. Distant meshes become fully editable terrain as you approach. The sky follows the camera, with a 1,200-block radius and a 1,600-block far plane; biome fog is lighter while underwater fog remains dense. The generator and existing scenery positions are unchanged, so old saves retain their terrain and resource identities.

This pass applies the gather/craft/shelter progression from Minecraft's [first-day guide](https://www.minecraft.net/en-us/article/how-survive-your-first-day), the grass-to-seeds farming loop described in the [first-ten-minutes guide](https://minecraft.wiki/w/Tutorial:Your_first_10_minutes), and the separation of [render distance and simulation distance](https://learn.microsoft.com/en-us/minecraft/creator/documents/simulationrenderdistanceguide?view=minecraft-bedrock-stable). The permanent spawn sanctuary is a Thistlewick accessibility choice.

Run `npm run smoke:survival` after building to check nighttime sanctuary protection, wilderness spawning, all eight scenery harvest categories, full-pack handling, camera targeting and save persistence in headless Chrome/Edge. Screenshots are written to `dist/smoke-survival.png`.

## Saving
The game autosaves to `localStorage` (key `thistlewick-save-v1`, type `SaveV1`) every 30 seconds and when the tab is hidden or closed. A save stores your position, stats, inventory, time of day, every block you changed (a compact list), placed stations and torches, felled trees, broken rocks and collected pickups. World generation is deterministic, so only your changes are stored, not the terrain.
To wipe it: press "Start over" on the title screen, or run `localStorage.removeItem('thistlewick-save-v1')` in the console.
