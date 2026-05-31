# Examples

This directory contains vanilla TypeScript and React examples for `maplibre-gl-duckdb`.

Both examples show the same MapLibre control workflow:

- Load a local `.duckdb` or `.db` file.
- Or enter a CORS-enabled remote DuckDB database URL.
- Select a discovered table to populate the SQL editor.
- Run SQL against the attached database schema alias `data`.
- Render query results that include a `GEOMETRY`, WKB, or WKT column.

The examples default to `https://data.source.coop/giswqs/opengeos/nyc_data.db`.
They use `https://tiles.openfreemap.org/styles/positron` as the basemap.
The NYC sample geometry is transformed from `EPSG:32618` to `EPSG:4326` in generated table queries.

Run the examples locally with:

```bash
npm run dev
```
