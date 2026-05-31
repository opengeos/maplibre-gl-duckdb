import { describe, expect, it, vi } from 'vitest';
import { DuckDBRenderer } from '../src/lib/duckdb/renderer';

const mocks = vi.hoisted(() => ({
  setProps: vi.fn(),
  createdLayers: [] as Array<{ type: string; props: Record<string, unknown> }>,
}));

vi.mock('@deck.gl/mapbox', () => ({
  MapboxOverlay: class {
    setProps = mocks.setProps;
  },
}));

vi.mock('@geoarrow/deck.gl-geoarrow', () => ({
  GeoArrowPathLayer: class {
    constructor(props: Record<string, unknown>) {
      mocks.createdLayers.push({ type: 'path', props });
    }
  },
  GeoArrowPolygonLayer: class {
    constructor(props: Record<string, unknown>) {
      mocks.createdLayers.push({ type: 'polygon', props });
    }
  },
  GeoArrowScatterplotLayer: class {
    constructor(props: Record<string, unknown>) {
      mocks.createdLayers.push({ type: 'point', props });
    }
  },
}));

function createMapStub() {
  const controls = new Set<unknown>();
  return {
    addControl: (control: unknown) => controls.add(control),
    removeControl: (control: unknown) => controls.delete(control),
    hasControl: (control: unknown) => controls.has(control),
    triggerRepaint: vi.fn(),
    getCanvas: () => document.createElement('canvas'),
  };
}

function createResult(geometryType: string) {
  return {
    geometryType,
    bounds: [0, 0, 1, 1],
    table: {
      getChild: () => ({
        toArray: () => [0],
      }),
    },
  };
}

describe('DuckDBRenderer', () => {
  it('creates deck.gl layers for point, line, and polygon results', () => {
    mocks.createdLayers.length = 0;
    mocks.setProps.mockClear();
    const renderer = new DuckDBRenderer(createMapStub() as never, { onSelect: vi.fn() });

    renderer.setData([
      {
        id: 'layer-a',
        name: 'Layer A',
        beforeId: null,
        results: [
          createResult('point'),
          createResult('linestring'),
          createResult('polygon'),
        ] as never,
      },
    ]);

    expect(mocks.createdLayers.map((layer) => layer.type)).toEqual(['point', 'path', 'polygon']);
    expect(mocks.setProps).toHaveBeenCalledWith({ layers: expect.any(Array) });
  });

  it('clears and removes the overlay', () => {
    const map = createMapStub();
    const renderer = new DuckDBRenderer(map as never, { onSelect: vi.fn() });

    renderer.clear();
    renderer.remove();

    expect(mocks.setProps).toHaveBeenCalledWith({ layers: [] });
  });
});
