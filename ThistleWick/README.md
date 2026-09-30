# ThistleWick

ThistleWick is a browser-based voxel sandbox with a woodland surface and a layered underground of caverns, aquifers, ravines, lava chambers, and glowing cave biomes.

## Play

```bash
pnpm install
pnpm dev
```

Use WASD to move, Space to jump, Shift to sprint, left click to mine, right click to place, E for inventory, and Escape to pause. F3 toggles the diagnostics overlay.

## Engine

- Three.js rendering with a procedural texture atlas and greedy chunk meshing
- Typed-array chunks streamed through module workers
- Fixed-step player physics and DDA block targeting
- Deterministic terrain, feature grids, ore veins, and cross-chunk trees
- Cheese, spaghetti, noodle, and region-cell ravine cave families
- Local aquifers, deep lava, and crystal, lush, and dripstone cave climates
- IndexedDB world snapshots with versioned generation and stale-worker rejection
- Vitest and Playwright coverage for generation, rendering, interaction, and saves

World generation is a pure function of the seed, generator version, and world coordinates. Stable block IDs and append-only seed slots protect existing worlds from accidental reshuffling.

## Commands

```bash
pnpm run typecheck
pnpm run test
pnpm run test:e2e:run
pnpm run build
pnpm run check
```

The previous ThistleWick implementation is preserved under `legacy/thistlewick-classic/` and is excluded from the production entry point. Its `thistlewick-save-v1` localStorage data is never loaded, changed, or deleted by this runtime.

## Credits

This rebuild is based on the MIT-licensed `my-mc-v2` engine and incorporates world-generation patterns from other MIT voxel projects. No proprietary, leaked, or decompiled Minecraft source code or assets are included. Exact repositories, pinned commits, and license texts are recorded in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

## License

MIT. See [LICENSE](LICENSE) and [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
