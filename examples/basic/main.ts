import maplibregl from 'maplibre-gl';
import { DuckDBControl } from '../../src/index';
import '../../src/index.css';
import 'maplibre-gl/dist/maplibre-gl.css';

const map = new maplibregl.Map({
  container: 'map',
  style: 'https://tiles.openfreemap.org/styles/positron',
  center: [0, 20],
  zoom: 2,
});

map.addControl(new maplibregl.NavigationControl(), 'top-right');
map.addControl(new maplibregl.FullscreenControl(), 'top-right');

map.on('load', () => {
  const duckdbControl = new DuckDBControl({
    title: 'DuckDB',
    collapsed: false,
    panelWidth: 360,
    databaseUrl: 'https://data.source.coop/giswqs/opengeos/nyc_data.db',
    // Offer the sample as an opt-in "Load sample data" dropdown instead of
    // prefilling the URL input.
    sampleData: [
      { label: 'NYC data', url: 'https://data.source.coop/giswqs/opengeos/nyc_data.db' },
    ],
    initialQuery: `SELECT BORONAME, NAME, ST_Transform(geom, 'EPSG:32618', 'EPSG:4326', true) AS geom
FROM data.main.nyc_neighborhoods
LIMIT 1000`,
    geometryColumn: 'geom',
    geometryFormat: 'auto',
    sourceCrs: 'EPSG:32618',
    layerName: 'DuckDB features',
  });

  map.addControl(duckdbControl, 'top-left');

  duckdbControl.on('query', (event) => {
    console.log('DuckDB query rendered:', event.state);
  });

  duckdbControl.on('error', (event) => {
    console.error('DuckDB control error:', event.error);
  });
});
