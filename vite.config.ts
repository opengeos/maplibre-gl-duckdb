import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'path';
import dts from 'vite-plugin-dts';

const external = [
  'react',
  'react-dom',
  'maplibre-gl',
  '@deck.gl/aggregation-layers',
  '@deck.gl/core',
  '@deck.gl/geo-layers',
  '@deck.gl/layers',
  '@deck.gl/mapbox',
  '@duckdb/duckdb-wasm',
  '@geoarrow/deck.gl-geoarrow',
  '@math.gl/polygon',
  '@walkthru-earth/objex-utils',
  'apache-arrow',
];

export default defineConfig({
  plugins: [
    react(),
    dts({
      include: ['src'],
      entryRoot: 'src',
      outDirs: 'dist/types',
      rollupTypes: false,
    }),
  ],
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src'),
    },
  },
  build: {
    lib: {
      entry: {
        index: resolve(__dirname, 'src/index.ts'),
        react: resolve(__dirname, 'src/react.ts'),
      },
      name: 'MapLibreGLDuckDB',
      formats: ['es', 'cjs'],
      fileName: (format, entryName) => {
        const ext = format === 'es' ? 'mjs' : 'cjs';
        return `${entryName}.${ext}`;
      },
    },
    rollupOptions: {
      external,
      output: {
        globals: {
          react: 'React',
          'react-dom': 'ReactDOM',
          'maplibre-gl': 'maplibregl',
          '@deck.gl/aggregation-layers': 'deck',
          '@deck.gl/core': 'deck',
          '@deck.gl/geo-layers': 'deck',
          '@deck.gl/layers': 'deck',
          '@deck.gl/mapbox': 'deck',
          '@duckdb/duckdb-wasm': 'duckdb',
          '@geoarrow/deck.gl-geoarrow': 'geoarrowDeck',
          '@math.gl/polygon': 'mathGlPolygon',
          '@walkthru-earth/objex-utils': 'objexUtils',
          'apache-arrow': 'Arrow',
        },
        assetFileNames: (assetInfo) => {
          if (assetInfo.name === 'style.css') return 'maplibre-gl-duckdb.css';
          return assetInfo.name || '';
        },
      },
    },
    target: 'esnext',
    cssCodeSplit: false,
    sourcemap: false,
    minify: 'oxc',
  },
});
