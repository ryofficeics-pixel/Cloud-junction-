# Cloud Junction — The Celestial Railway

Visual development follows the project’s committed reference images and the shape-language rules in [ART_DIRECTION.md](./ART_DIRECTION.md). New world or rolling-stock work should preserve that contract.

An original, playable 3D fantasy railway journey built with Three.js and Vite. The world, trains, track geometry, islands, weather, audio, map, and creatures are generated in code; there are no external runtime assets or CDN dependencies.

## Run locally

```bash
npm install
npm run dev
```

## Production validation

```bash
npm run check
npm run build
npm run test:e2e
```

## Controls

- `W` / `S`: adjust power
- `Space`: brake
- `C`: change camera
- `H`: horn
- `M`: route map
- Drag: orbit camera
- Mouse wheel: orbit zoom

Touch controls expose the same functions on mobile. Graphics automatically default to Low or Medium on Android-class devices and can be changed in Settings.

## Railway systems

- Six active multi-car trains with separate locomotive and carriage placement
- Three long continuous routes with a working junction route choice
- Simplified block occupancy, signal aspects, collision spacing, station stops, acceleration, braking, grades, and curve speed limits
- Eight camera modes, live network map, destination selection, day/night cycle, five weather modes, and procedural Web Audio
- Procedural floating islands, settlements, region stations, layered cloud ocean, instanced vegetation, bridges, waterfalls, and original sky creatures

Vercel configuration is included. Deploying the repository builds `dist/` with `npm run build`.
