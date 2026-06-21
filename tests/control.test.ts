import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DuckDBControl } from '../src';

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

vi.mock('../src/lib/duckdb/duckdb', () => ({
  attachDatabase: vi.fn(),
  detachDatabase: vi.fn(),
  dropFile: vi.fn(),
  getQuerySchema: vi.fn(),
  getTableSchema: vi.fn(async (tableName: string) =>
    tableName.includes('subway')
      ? [
          { name: 'OBJECTID', type: 'DOUBLE', nullable: true },
          { name: 'NAME', type: 'VARCHAR', nullable: true },
          { name: 'geom', type: 'GEOMETRY', nullable: true },
        ]
      : [
          { name: 'BORONAME', type: 'VARCHAR', nullable: true },
          { name: 'NAME', type: 'VARCHAR', nullable: true },
          { name: 'geom', type: 'GEOMETRY', nullable: true },
        ]
  ),
  initDB: vi.fn(),
  listTables: vi.fn(),
  query: vi.fn(),
  registerLocalDatabase: vi.fn(),
  registerRemoteDatabase: vi.fn(),
}));

function createMapStub() {
  const mapContainer = document.createElement('div');
  document.body.appendChild(mapContainer);
  const controls = new Set<unknown>();

  return {
    mapContainer,
    map: {
      getContainer: () => mapContainer,
      addControl: (control: unknown) => controls.add(control),
      removeControl: (control: unknown) => controls.delete(control),
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

describe('DuckDBControl', () => {
  beforeEach(() => {
    document.body.replaceChildren();
  });

  it('creates the compact button and floating panel', () => {
    const { map, mapContainer } = createMapStub();
    const control = new DuckDBControl({ title: 'DuckDB', collapsed: true });

    const container = control.onAdd(map as never);

    expect(container.querySelector('.duckdb-control-toggle')).toBeTruthy();
    expect(mapContainer.querySelector('.duckdb-control-panel')).toBeTruthy();
    expect(control.getState().collapsed).toBe(true);
  });

  it('renders no sample dropdown by default', () => {
    const { map, mapContainer } = createMapStub();
    const control = new DuckDBControl({ collapsed: false });
    control.onAdd(map as never);
    expect(mapContainer.querySelector('.duckdb-sample-menu')).toBeNull();
  });

  it('renders a sample dropdown that fills the URL input on selection', () => {
    const { map, mapContainer } = createMapStub();
    const control = new DuckDBControl({
      collapsed: false,
      sampleData: [
        { label: 'NYC data', url: 'https://example.com/nyc.db' },
        { label: 'World', url: 'https://example.com/world.db' },
      ],
    });
    control.onAdd(map as never);

    const trigger = mapContainer.querySelector('.duckdb-sample-trigger') as HTMLButtonElement;
    expect(
      trigger.querySelector('.duckdb-sample-trigger-label')?.textContent,
    ).toBe('Load sample data...');
    const urlInput = mapContainer.querySelector('.duckdb-control-url') as HTMLInputElement;
    expect(urlInput.value).toBe('');

    const options = [...mapContainer.querySelectorAll('.duckdb-sample-option')];
    expect(options.map((o) => o.textContent)).toEqual(['NYC data', 'World']);

    (options[1] as HTMLButtonElement).click();
    expect(urlInput.value).toBe('https://example.com/world.db');
  });

  it('emits expand and collapse events when toggled', () => {
    const { map } = createMapStub();
    const control = new DuckDBControl();
    const expandHandler = vi.fn();
    const collapseHandler = vi.fn();

    control.on('expand', expandHandler);
    control.on('collapse', collapseHandler);
    control.onAdd(map as never);

    control.expand();
    control.collapse();

    expect(expandHandler).toHaveBeenCalledTimes(1);
    expect(collapseHandler).toHaveBeenCalledTimes(1);
  });

  it('keeps the panel open on outside document clicks', () => {
    const { map } = createMapStub();
    const control = new DuckDBControl({ collapsed: false });
    control.onAdd(map as never);

    document.body.dispatchEvent(new MouseEvent('click', { bubbles: true }));

    expect(control.getState().collapsed).toBe(false);
  });

  it('removes panel and button on cleanup', () => {
    const { map, mapContainer } = createMapStub();
    const control = new DuckDBControl();
    const container = control.onAdd(map as never);
    mapContainer.appendChild(container);

    control.onRemove();

    expect(mapContainer.querySelector('.duckdb-control-panel')).toBeNull();
    expect(container.parentNode).toBeNull();
  });

  it('renders database inputs, SQL textarea, and pickable toggle', () => {
    const { map, mapContainer } = createMapStub();
    const control = new DuckDBControl({
      pickable: false,
      collapsed: false,
      sampleDatabaseUrl: 'https://example.com/data.duckdb',
    });

    control.onAdd(map as never);

    const urlInput = mapContainer.querySelector<HTMLInputElement>('.duckdb-control-url');
    const fileInput = mapContainer.querySelector<HTMLInputElement>('.duckdb-control-file');
    const sqlInput = mapContainer.querySelector<HTMLTextAreaElement>('.duckdb-control-sql');
    const pickableInput = mapContainer.querySelector<HTMLInputElement>(
      '.duckdb-control-check input[type="checkbox"]'
    );

    expect(urlInput?.value).toBe('https://example.com/data.duckdb');
    expect(fileInput?.accept).toContain('.duckdb');
    expect(sqlInput?.value).toContain('SELECT');
    expect(pickableInput?.checked).toBe(false);

    control.setPickable(true);

    expect(control.getState().pickable).toBe(true);
  });

  it('renders layer name and before_id inputs for query options', () => {
    const { map, mapContainer } = createMapStub();
    const control = new DuckDBControl({
      beforeId: 'settlement-label',
      collapsed: false,
      layerName: 'Cities',
    });

    control.onAdd(map as never);

    const inputs = Array.from(mapContainer.querySelectorAll<HTMLInputElement>('.duckdb-control-input'));

    expect(inputs.some((input) => input.value === 'Cities')).toBe(true);
    expect(inputs.some((input) => input.value === 'settlement-label')).toBe(true);
  });

  it('renders table and geometry selectors and updates SQL when a table is selected', async () => {
    const { map, mapContainer } = createMapStub();
    const control = new DuckDBControl({ collapsed: false });
    control.onAdd(map as never);

    Object.assign(control as unknown as { tables: unknown[]; selectedTable: string | null; tableColumns: unknown[]; geometryColumn: string }, {
      tables: [
        {
          databaseName: 'data',
          schemaName: 'main',
          tableName: 'nyc_neighborhoods',
          qualifiedName: '"data"."main"."nyc_neighborhoods"',
          displayName: 'main.nyc_neighborhoods',
        },
        {
          databaseName: 'data',
          schemaName: 'main',
          tableName: 'nyc_subway_stations',
          qualifiedName: '"data"."main"."nyc_subway_stations"',
          displayName: 'main.nyc_subway_stations',
        },
      ],
      selectedTable: '"data"."main"."nyc_neighborhoods"',
      tableColumns: [
        { name: 'BORONAME', type: 'VARCHAR', nullable: true },
        { name: 'NAME', type: 'VARCHAR', nullable: true },
        { name: 'geom', type: 'GEOMETRY', nullable: true },
      ],
      geometryColumn: 'geom',
    });
    control.setPickable(true);

    const tableSelect = mapContainer.querySelector<HTMLSelectElement>('.duckdb-control-table');
    const geometrySelect = mapContainer.querySelector<HTMLSelectElement>('.duckdb-control-geometry-column');
    const sqlInput = mapContainer.querySelector<HTMLTextAreaElement>('.duckdb-control-sql');

    expect(tableSelect?.options).toHaveLength(3);
    expect(geometrySelect?.value).toBe('geom');
    tableSelect!.value = '"data"."main"."nyc_subway_stations"';
    tableSelect!.dispatchEvent(new Event('change'));

    expect(sqlInput?.value).toContain('SELECT');
    await vi.waitFor(() => {
      const nextSqlInput = mapContainer.querySelector<HTMLTextAreaElement>('.duckdb-control-sql');
      expect(nextSqlInput?.value).toContain('"data"."main"."nyc_subway_stations"');
    });
  });

  it('clears query-specific controls when SQL is emptied', () => {
    const { map, mapContainer } = createMapStub();
    const control = new DuckDBControl({ collapsed: false });
    control.onAdd(map as never);

    Object.assign(control as unknown as { tables: unknown[]; selectedTable: string | null; tableColumns: unknown[]; geometryColumn: string; layerName: string }, {
      tables: [
        {
          databaseName: 'data',
          schemaName: 'main',
          tableName: 'nyc_streets',
          qualifiedName: '"data"."main"."nyc_streets"',
          displayName: 'main.nyc_streets',
        },
      ],
      selectedTable: '"data"."main"."nyc_streets"',
      tableColumns: [
        { name: 'ID', type: 'INTEGER', nullable: true },
        { name: 'geom', type: 'GEOMETRY', nullable: true },
      ],
      geometryColumn: 'geom',
      layerName: 'nyc_streets',
    });
    control.setPickable(true);

    const sqlInput = mapContainer.querySelector<HTMLTextAreaElement>('.duckdb-control-sql')!;
    sqlInput.value = '';
    sqlInput.dispatchEvent(new Event('input'));

    const nextTableSelect = mapContainer.querySelector<HTMLSelectElement>('.duckdb-control-table');
    const nextGeometrySelect = mapContainer.querySelector<HTMLSelectElement>('.duckdb-control-geometry-column');
    const runButton = Array.from(mapContainer.querySelectorAll<HTMLButtonElement>('.duckdb-control-button')).find(
      (button) => button.textContent === 'Run query'
    );

    expect(nextTableSelect?.value).toBe('');
    expect(nextGeometrySelect).toBeNull();
    expect(runButton?.disabled).toBe(true);
    expect(control.getState().query).toBe('');
    expect(control.getState().selectedTable).toBeNull();
  });

  it('adds bottom-left and bottom-right resize handles', () => {
    const { map, mapContainer } = createMapStub();
    const control = new DuckDBControl({ collapsed: false, position: 'top-right' });
    const container = control.onAdd(map as never);
    // Mount the button container so getControlPosition can read the corner.
    const corner = document.createElement('div');
    corner.className = 'maplibregl-ctrl-top-right';
    corner.appendChild(container);
    mapContainer.appendChild(corner);

    const panel = mapContainer.querySelector<HTMLElement>('.duckdb-control-panel')!;
    const handles = panel.querySelectorAll<HTMLElement>('.duckdb-control-resize-handle');
    expect(handles).toHaveLength(2);
    const left = panel.querySelector<HTMLElement>('.duckdb-control-resize-left');
    const right = panel.querySelector<HTMLElement>('.duckdb-control-resize-right');
    expect(left).toBeTruthy();
    expect(right).toBeTruthy();
  });

  it('grows width rightward from the right handle and leftward from the left handle', () => {
    const { map, mapContainer } = createMapStub();
    Object.defineProperty(mapContainer, 'getBoundingClientRect', {
      configurable: true,
      value: () => ({ top: 0, bottom: 800, left: 0, right: 1200, width: 1200, height: 800 }),
    });
    const control = new DuckDBControl({ collapsed: false, position: 'top-right' });
    const container = control.onAdd(map as never);
    const corner = document.createElement('div');
    corner.className = 'maplibregl-ctrl-top-right';
    corner.appendChild(container);
    mapContainer.appendChild(corner);

    const panel = mapContainer.querySelector<HTMLElement>('.duckdb-control-panel')!;
    // Place the panel at a known rect so the resize math is deterministic.
    Object.defineProperty(panel, 'getBoundingClientRect', {
      configurable: true,
      value: () => ({ top: 100, bottom: 400, left: 400, right: 700, width: 300, height: 300 }),
    });

    const beginResize = (
      control as unknown as {
        beginResize: (e: PointerEvent, side: 'left' | 'right', p: HTMLElement, h: HTMLElement) => void;
      }
    ).beginResize.bind(control);

    const makeEvent = (clientX: number, clientY: number): PointerEvent =>
      ({
        clientX,
        clientY,
        pointerId: 1,
        preventDefault: () => {},
        stopPropagation: () => {},
      }) as unknown as PointerEvent;

    // Right handle: drag right by 80px, the left edge stays fixed and width grows.
    const rightHandle = panel.querySelector<HTMLElement>('.duckdb-control-resize-right')!;
    beginResize(makeEvent(700, 400), 'right', panel, rightHandle);
    rightHandle.dispatchEvent(
      Object.assign(new Event('pointermove'), { clientX: 780, clientY: 400, pointerId: 1 })
    );
    expect(panel.style.width).toBe('380px');
    // Left edge unchanged (panel started at map-relative left 400).
    expect(panel.style.left).toBe('400px');
    rightHandle.dispatchEvent(
      Object.assign(new Event('pointerup'), { clientX: 780, clientY: 400, pointerId: 1 })
    );

    // Left handle: drag left by 100px, the right edge stays fixed so the left
    // edge moves and width grows.
    const leftHandle = panel.querySelector<HTMLElement>('.duckdb-control-resize-left')!;
    beginResize(makeEvent(400, 400), 'left', panel, leftHandle);
    leftHandle.dispatchEvent(
      Object.assign(new Event('pointermove'), { clientX: 300, clientY: 400, pointerId: 1 })
    );
    expect(panel.style.width).toBe('400px');
    // Right edge held fixed: left moved from 400 to 300.
    expect(panel.style.left).toBe('300px');
    leftHandle.dispatchEvent(
      Object.assign(new Event('pointerup'), { clientX: 300, clientY: 400, pointerId: 1 })
    );

    // Both drags persisted a user size; max caps are released during drag.
    expect(panel.style.maxWidth).toBe('none');
    expect(panel.style.maxHeight).toBe('none');
    expect(panel.style.height).toMatch(/px$/);
  });
});
