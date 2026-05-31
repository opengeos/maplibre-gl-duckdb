import { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import maplibregl, { Map } from 'maplibre-gl';
import { DuckDBControlReact, useDuckDBState } from '../../src/react';
import '../../src/index.css';
import 'maplibre-gl/dist/maplibre-gl.css';

function App() {
  const mapContainer = useRef<HTMLDivElement>(null);
  const [map, setMap] = useState<Map | null>(null);
  const { state, toggle } = useDuckDBState({ collapsed: false });

  useEffect(() => {
    if (!mapContainer.current) return;

    const mapInstance = new maplibregl.Map({
      container: mapContainer.current,
      style: 'https://tiles.openfreemap.org/styles/positron',
      center: [0, 20],
      zoom: 2,
    });

    mapInstance.addControl(new maplibregl.NavigationControl(), 'top-right');
    mapInstance.addControl(new maplibregl.FullscreenControl(), 'top-right');

    mapInstance.on('load', () => {
      setMap(mapInstance);
    });

    return () => {
      mapInstance.remove();
    };
  }, []);

  return (
    <div style={{ width: '100%', height: '100%', position: 'relative' }}>
      <div ref={mapContainer} style={{ width: '100%', height: '100%' }} />

      <button
        onClick={toggle}
        style={{
          position: 'absolute',
          top: 10,
          left: 10,
          zIndex: 1,
          padding: '8px 16px',
          background: '#287e9b',
          color: 'white',
          border: 'none',
          borderRadius: 4,
          cursor: 'pointer',
          fontWeight: 600,
        }}
      >
        {state.collapsed ? 'Expand' : 'Collapse'} DuckDB
      </button>

      {map && (
        <DuckDBControlReact
          map={map}
          title="DuckDB"
          collapsed={state.collapsed}
          panelWidth={360}
          databaseUrl="https://data.source.coop/giswqs/opengeos/nyc_data.db"
          sampleDatabaseUrl="https://data.source.coop/giswqs/opengeos/nyc_data.db"
          initialQuery={`SELECT BORONAME, NAME, ST_Transform(geom, 'EPSG:32618', 'EPSG:4326', true) AS geom
FROM data.main.nyc_neighborhoods
LIMIT 1000`}
          geometryColumn="geom"
          geometryFormat="auto"
          sourceCrs="EPSG:32618"
          layerName="DuckDB features"
          onStateChange={(newState) => console.log('DuckDB state changed:', newState)}
          onQuery={(newState) => console.log('DuckDB query rendered:', newState)}
          onError={(error) => console.error('DuckDB control error:', error)}
        />
      )}
    </div>
  );
}

const root = createRoot(document.getElementById('root')!);
root.render(<App />);
