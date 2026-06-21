# MapLibre GL DuckDB

A MapLibre GL JS control for querying and visualizing geospatial data from DuckDB databases in the browser.

[![npm version](https://img.shields.io/npm/v/maplibre-gl-duckdb.svg)](https://www.npmjs.com/package/maplibre-gl-duckdb)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Open in CodeSandbox](https://img.shields.io/badge/Open%20in-CodeSandbox-blue?logo=codesandbox)](https://codesandbox.io/p/github/opengeos/maplibre-gl-duckdb)
[![Open in StackBlitz](https://img.shields.io/badge/Open%20in-StackBlitz-blue?logo=stackblitz)](https://stackblitz.com/github/opengeos/maplibre-gl-duckdb)

## Features

- Browser DuckDB WASM runtime with the spatial extension.
- Local `.duckdb` and `.db` database loading.
- CORS-enabled remote database URL loading.
- Table selector populated from attached DuckDB databases.
- SQL query panel inside a collapsible MapLibre control.
- Rendering for query results with `GEOMETRY`, WKB, or WKT columns.
- deck.gl and GeoArrow rendering for points, lines, and polygons.
- React wrapper and state hook.
- Vite library build with ESM and CommonJS outputs.

## Installation

```bash
npm install maplibre-gl-duckdb
```

## Quick Start

```typescript
import maplibregl from 'maplibre-gl';
import { DuckDBControl } from 'maplibre-gl-duckdb';
import 'maplibre-gl-duckdb/style.css';
import 'maplibre-gl/dist/maplibre-gl.css';

const map = new maplibregl.Map({
  container: 'map',
  style: 'https://tiles.openfreemap.org/styles/positron',
  center: [0, 20],
  zoom: 2,
});

map.on('load', () => {
  const control = new DuckDBControl({
    title: 'DuckDB',
    collapsed: false,
    databaseUrl: 'https://data.source.coop/giswqs/opengeos/nyc_data.db',
    sampleDatabaseUrl: 'https://data.source.coop/giswqs/opengeos/nyc_data.db',
    initialQuery: `SELECT BORONAME, NAME, ST_Transform(geom, 'EPSG:32618', 'EPSG:4326', true) AS geom
FROM data.main.nyc_neighborhoods
LIMIT 1000`,
    geometryColumn: 'geom',
    sourceCrs: 'EPSG:32618',
    geometryFormat: 'auto',
  });

  map.addControl(control, 'top-right');
});
```

The attached database is available through the schema alias `data`. For example, the local sample database can be queried as `data.main.nyc_neighborhoods`.
After a database is loaded, use the table selector to populate the SQL editor for any discovered table, then run or edit the query.
The geometry column control is populated from the selected table's columns and defaults to `geom` or `geometry` when either name exists.

## Rendering Pipeline

The control renders query results directly in the browser. It does not generate vector tiles and does not convert results to GeoJSON.

The pipeline is:

```text
DuckDB SQL -> Arrow result -> WKB geometry column -> GeoArrow -> deck.gl layers over MapLibre
```

DuckDB WASM executes the SQL and returns an Arrow table. The selected geometry column is converted to WKB with DuckDB spatial functions, then the WKB values are converted to GeoArrow tables. Those GeoArrow tables are rendered with deck.gl layers through `MapboxOverlay` on top of the MapLibre map.

## React

```tsx
import { useEffect, useRef, useState } from 'react';
import maplibregl, { Map } from 'maplibre-gl';
import { DuckDBControlReact, useDuckDBState } from 'maplibre-gl-duckdb/react';
import 'maplibre-gl-duckdb/style.css';

function App() {
  const mapContainer = useRef<HTMLDivElement>(null);
  const [map, setMap] = useState<Map | null>(null);
  const { state } = useDuckDBState({ collapsed: false });

  useEffect(() => {
    if (!mapContainer.current) return;
    const mapInstance = new maplibregl.Map({
      container: mapContainer.current,
      style: 'https://tiles.openfreemap.org/styles/positron',
      center: [0, 20],
      zoom: 2,
    });
    mapInstance.on('load', () => setMap(mapInstance));
    return () => mapInstance.remove();
  }, []);

  return (
    <div style={{ width: '100%', height: '100vh' }}>
      <div ref={mapContainer} style={{ width: '100%', height: '100%' }} />
      {map && (
        <DuckDBControlReact
          map={map}
          collapsed={state.collapsed}
          databaseUrl="https://data.source.coop/giswqs/opengeos/nyc_data.db"
          sampleDatabaseUrl="https://data.source.coop/giswqs/opengeos/nyc_data.db"
          initialQuery="SELECT BORONAME, NAME, ST_Transform(geom, 'EPSG:32618', 'EPSG:4326', true) AS geom FROM data.main.nyc_neighborhoods LIMIT 1000"
          geometryColumn="geom"
          sourceCrs="EPSG:32618"
          onQuery={(newState) => console.log(newState)}
        />
      )}
    </div>
  );
}
```

## API

### DuckDBControl Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `collapsed` | `boolean` | `true` | Whether the panel starts collapsed |
| `position` | `string` | `'top-right'` | MapLibre control position |
| `title` | `string` | `'DuckDB'` | Panel title |
| `panelWidth` | `number` | `360` | Panel width in pixels |
| `databaseUrl` | `string` | | CORS-enabled remote DuckDB database URL |
| `sampleDatabaseUrl` | `string` | | URL shown in the input without auto-loading |
| `sampleData` | `DuckDBSampleDataset[]` | | Sample databases shown as a "Load sample data" dropdown above the URL input; picking one fills the input (hidden when empty) |
| `sampleDataLabel` | `string` | `'Load sample data...'` | Placeholder shown in the sample-data dropdown |
| `initialQuery` | `string` | sample query | SQL query to run after loading a database |
| `geometryColumn` | `string` | auto-detected | Geometry, WKB, or WKT column |
| `geometryFormat` | `'auto' \| 'geometry' \| 'wkb' \| 'wkt'` | `'auto'` | Geometry conversion mode |
| `sourceCrs` | `string` | | Source CRS for generated table queries |
| `targetCrs` | `string` | `'EPSG:4326'` | Target CRS for generated table queries |
| `pageSize` | `number` | `10000` | Maximum rendered rows |
| `fitBoundsOnLoad` | `boolean` | `true` | Fit the map to rendered results |
| `allowLocalFiles` | `boolean` | `true` | Enable local database file input |
| `allowRemoteUrls` | `boolean` | `true` | Enable remote URL input |
| `pickable` | `boolean` | `true` | Enable feature click popups |
| `layerName` | `string` | `'DuckDB query'` | Rendered layer name |
| `beforeId` | `string` | | Map layer id for insertion order |
| `interleaved` | `boolean` | `true` | deck.gl MapboxOverlay interleaving |

### Methods

- `loadUrl(url)` loads a remote database URL.
- `loadFile(file)` loads a local browser `File`.
- `executeQuery(sql?)` runs SQL and renders geospatial results.
- `clear()` removes the database, rendered layer, and selection.
- `setPickable(pickable)` enables or disables feature selection.
- `toggle()`, `expand()`, and `collapse()` control the panel.
- `getState()` returns the current `DuckDBState`.
- `on(event, handler)` and `off(event, handler)` manage events.

### Events

`collapse`, `expand`, `statechange`, `loadstart`, `progress`, `load`, `query`, `error`, and `select`.

## DuckDB Runtime Configuration

By default, DuckDB WASM is loaded from jsDelivr and the spatial extension is loaded from the official DuckDB extension repository. Use `configureDuckDB` before creating the first control to self-host runtime assets.

```typescript
import { configureDuckDB } from 'maplibre-gl-duckdb';

configureDuckDB({
  extensionRepository: 'https://example.com/duckdb-extensions',
});
```

## Development

```bash
npm install
npm run dev
npm test
npm run build
npm run build:examples
```

The examples use `https://data.source.coop/giswqs/opengeos/nyc_data.db` as the default DuckDB URL and `https://tiles.openfreemap.org/styles/positron` as the basemap. The sample tables use projected coordinates, so the examples transform `geom` from `EPSG:32618` to `EPSG:4326` before rendering.

## Docker

```bash
docker build -t maplibre-gl-duckdb .
docker run -p 8080:80 maplibre-gl-duckdb
```

Open `http://localhost:8080/maplibre-gl-duckdb/`.

## Notes

Remote database loading requires browser-accessible URLs with CORS enabled. Large databases and broad queries may be limited by browser memory and DuckDB WASM file access constraints.
