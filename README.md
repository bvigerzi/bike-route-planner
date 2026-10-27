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

- **Click the map** to set the start / meeting point (red **S**), then click again to add waypoints. On touch screens a tap adds its point after a brief pause, so a double tap zooms in instead. You can also **search** for a place and choose *Set start* or *Add*.
- Points you place **snap** onto the nearest rideable way (road, bike path, shared path, etc.) if one is within 30 m. Further away, they stay exactly where you put them. "Rideable" means any way the BRouter profile can route on.
- **Drag** a marker to move it. **Click** a marker and choose *Remove?*, or **right-click** it (or use × in the sidebar) to remove it.
- Each leg has a **Route / Direct** toggle. *Direct* ignores the router and draws a straight line. Use it where you know something the map doesn't, e.g. a footpath that's fine to ride.
- **Optimise** removes waypoints you don't need. It tries each waypoint between two routed legs in turn. If routing past that point gives the same path (within 10 m), the waypoint is removed. If not, it is kept.
- The summary shows distance, estimated time, ascent and the distance in each path type.
- The route (waypoints, leg modes, place names, waypoint names and the **route name**) is kept in the page URL as you edit. Reloading, going Back/Forward to the page, bookmarking or sharing the link brings the route back. **Copy link** copies it. No server or account is involved.
- **Save** keeps the route's name and link in browser localStorage, so it shows under *Saved routes* to load again later.
- **Open in maps** opens cycling directions in a maps app, with every waypoint as a stop. On iPhone and iPad it uses an Apple Maps link, which iOS may pass to your default navigation app. Everywhere else it uses Google Maps, which opens its app on Android. Google Maps allows at most 9 stops between the start and the end, so the button is disabled for longer routes. The maps app does its own routing between stops, so *Direct* legs aren't kept.
- **Download GPX** saves the exact routed track, with the waypoints, for bike apps such as Komoot, Strava, Garmin or OsmAnd.
- **Export image** saves a PNG of the route on the map, zoomed in as far as the whole route and every waypoint will fit (up to 1600 px each way), rendered at 2× with more detailed map tiles so you can zoom in on it to check the streets. It uses the standard OpenStreetMap tiles, so it looks different from the map on screen. Only the start and end are marked, so the route stays clear.

### Route links

The whole route is stored in the URL hash as a compact binary encoding written in base64url, e.g. `#AgtTdW5kYXkgcmlkZQffy80D7MjpDRFGZWRlcmF0aW9uIFNxdWFyZdAF5AoAoB_QDwAC` (a route named *Sunday ride* with three waypoints, one labelled *Federation Square*, and a direct second leg). The link isn't a key into a database. It holds the name, the waypoints (5 decimal places, about 1 m, each stored as a small offset from the one before), their place names, any names you gave them, and the leg modes. Legs are routed again when a link is opened. The format is in `src/lib/routeUrl.ts`. Older readable links (`#v=1&n=...&w=...`) still open.

Each waypoint adds about 7 characters, plus its place name, so 100 waypoints is about 0.7 KB. The hash is never sent to a server, and browsers accept far longer URLs, so there's no fixed limit on waypoints. Some apps cut off links longer than about 2,000 characters, though, so the sidebar warns past that. Optimise shortens the link.

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

- **Map:** [MapLibre GL JS](https://maplibre.org) with [OpenFreeMap](https://openfreemap.org) vector tiles (no API key). The light theme uses its *Liberty* style and the dark theme its *Dark* style. All map-library code is in `src/lib/MapView.svelte`. Route data stays plain `[lat, lng]` arrays tagged by category (`src/lib/routing.ts`).
- **Routing:** the public [BRouter](https://brouter.de) instance, `safety` profile. No API key is needed. Each leg is routed on its own and cached. BRouter returns the OSM tags for every section of a leg, and the app uses them to choose the colour. Time and ascent come from BRouter. Direct legs are estimated at 15 km/h.
- **Rate limiting:** BRouter documents no rate limit, but brouter.de answers 403 if it gets too many requests. So the app sends BRouter requests one at a time (`src/lib/throttle.ts`). During a burst, such as rapid clicking or Optimise, the gap between requests doubles from 250 ms up to 2 s. Points show on the map straight away, and their legs stay grey and dotted until routed. After a 403 or 429, the app waits 2 s, doubling up to 30 s, and retries up to 3 times.
- **Search:** [Photon](https://photon.komoot.io), which searches OpenStreetMap as you type. Results favour the area the map is showing. Requests wait for a 350 ms pause in typing and need at least 3 characters; Enter searches straight away.

Settings (router URL, profile, direct-leg speed, snap radius, default map centre) are in `src/lib/config.ts`.

## Future considerations

- Render **Export image** from the vector map too, so it matches the screen. This would also stop the export fetching from the OSM tile servers.
- Areas you draw where the router should prefer riding (local knowledge, beyond straight-line overrides).
- A global "allow footpaths" toggle, using a custom BRouter profile.
- Self-hosting BRouter if the public instance becomes a limitation.
- Self-hosting Overpass (Australia extract) for waypoint snapping. Snapping currently uses BRouter, which finds the nearest way its profile can ride but doesn't say what kind of way it is, so it can't prefer a bike path over a closer road. Overpass returns each way's tags, which would allow that. Public Overpass instances were too slow and unreliable for snapping on every click: in testing, most queries took 20–40 s or timed out after 60 s. None is hosted near Australia. Send a descriptive `User-Agent` header, or the public instances reject requests with 406.
- A modifier key (e.g. Alt+click) to place a point exactly, without snapping.
- GPX export.
