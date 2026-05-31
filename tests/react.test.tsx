import { render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { DuckDBControlReact } from '../src/react';

vi.mock('@deck.gl/mapbox', () => ({
  MapboxOverlay: class {
    setProps = vi.fn();
  },
}));

vi.mock('@geoarrow/deck.gl-layers', () => ({
  GeoArrowPathLayer: class {},
  GeoArrowPolygonLayer: class {},
  GeoArrowScatterplotLayer: class {},
}));

function createMapStub() {
  const mapContainer = document.createElement('div');
  document.body.appendChild(mapContainer);
  const controls = new Set<unknown>();

  return {
    controls,
    map: {
      getContainer: () => mapContainer,
      addControl: vi.fn((control: unknown) => controls.add(control)),
      removeControl: vi.fn((control: unknown) => controls.delete(control)),
      hasControl: (control: unknown) => controls.has(control),
      on: vi.fn(),
      off: vi.fn(),
      triggerRepaint: vi.fn(),
      getCanvas: () => document.createElement('canvas'),
      getZoom: () => 2,
      fitBounds: vi.fn(),
      flyTo: vi.fn(),
    },
  };
}

describe('DuckDBControlReact', () => {
  it('mounts and removes a DuckDB control', () => {
    const { map, controls } = createMapStub();
    const { unmount } = render(<DuckDBControlReact map={map as never} title="DuckDB" />);

    expect(map.addControl).toHaveBeenCalledTimes(1);
    expect(controls.size).toBe(1);

    unmount();

    expect(map.removeControl).toHaveBeenCalledTimes(1);
    expect(controls.size).toBe(0);
  });

  it('forwards state changes', () => {
    const { map, controls } = createMapStub();
    const onStateChange = vi.fn();
    render(<DuckDBControlReact map={map as never} onStateChange={onStateChange} />);

    const control = Array.from(controls)[0] as { expand: () => void };
    control.expand();

    expect(onStateChange).toHaveBeenCalledWith(expect.objectContaining({ collapsed: false }));
  });
});
