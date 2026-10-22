# bike-route-planner
A tool optimised and enhanced for bike route planning beyond the capabilities of standard mapping tools

A personal, static web app for planning bike routes on OpenStreetMap data. Routes prefer dedicated bike paths and shared paths over roads, and each part of the route is coloured by path type.

## Usage

```sh
yarn install
yarn dev        # http://localhost:5173
yarn test       # unit tests (vitest)
yarn typecheck  # svelte-check
yarn build      # static output in dist/
```

- **Click the map** to set the start / meeting point (red **S**), then click again to add waypoints. You can also **search** for a place and choose *Set start* or *Add*.
- **Drag** a marker to move it, and **click** a marker (or ×) to remove it.
- Each leg has a **Route / Direct** toggle. *Direct* ignores the router and draws a straight line. Use it where you know something the map doesn't, e.g. a footpath that's fine to ride.
- The summary shows distance, estimated time, ascent and the distance in each path type. Finished routes can be **saved** to browser localStorage and loaded again later.

### Path colours

| Colour | Meaning |
|---|---|
| Dark green | Dedicated bike path (`highway=cycleway`, not shared with pedestrians) |
| Light green | Shared path (cycleway with foot access, or path/footway with bike access) |
| Blue | Road with a painted lane or separated track |
| Grey | Road |
| Orange | Footpath with no official bike access |
| Purple dashed | Direct leg (your override) |

Classification rules are in `src/lib/categories.ts`.

## How it works

- **Map:** [Leaflet](https://leafletjs.com) with standard OSM raster tiles.
- **Routing:** the public [BRouter](https://brouter.de) instance, `safety` profile. No API key is needed. Each leg is routed on its own and cached. BRouter returns the OSM tags for every section of a leg, and the app uses them to choose the colour. Time and ascent come from BRouter. Direct legs are estimated at 15 km/h.
- **Search:** [Nominatim](https://nominatim.org). It searches only when you submit, as its usage policy requires.

Settings (router URL, profile, direct-leg speed, default map centre) are in `src/lib/config.ts`.

## Future considerations

- **Switch to MapLibre GL (vector tiles).** We started with Leaflet for the MVP because it is small and simple, but vector maps are preferred long term. To keep the switch cheap, all Leaflet code is in `src/lib/MapView.svelte`, and route data is plain `[lat, lng]` arrays tagged by category (`src/lib/routing.ts`). Only that component should need rewriting.
- Areas you draw where the router should prefer riding (local knowledge, beyond straight-line overrides).
- A global "allow footpaths" toggle, using a custom BRouter profile.
- Self-hosting BRouter if the public instance becomes a limitation.
- Search-as-you-type using Photon.
- GPX export.
