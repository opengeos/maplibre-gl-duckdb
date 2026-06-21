import maplibregl, { type IControl, type Map as MapLibreMap } from 'maplibre-gl';
import type { GeoArrowResult } from '@walkthru-earth/objex-utils';
import {
  attachDatabase,
  detachDatabase,
  dropFile,
  getQuerySchema,
  getTableSchema,
  initDB,
  listTables,
  query,
  registerLocalDatabase,
  registerRemoteDatabase,
} from '../duckdb/duckdb';
import { DATABASE_SCHEMA_ALIAS, DEFAULT_PAGE_SIZE, DEFAULT_PANEL_WIDTH, DEFAULT_QUERY, DEFAULT_TITLE } from '../duckdb/constants';
import {
  buildCountQuery,
  buildResultQuery,
  buildTableQuery,
  cleanSql,
  detectGeometryColumn,
  detectGeometryFormat,
  formatDisplayValue,
  friendlyError,
  normalizeBinary,
} from '../duckdb/utils';
import type { DuckDBRenderer, DuckDBPickInfo } from '../duckdb/renderer';
import type {
  DuckDBColumn,
  DuckDBControlEvent,
  DuckDBControlEventData,
  DuckDBControlEventHandler,
  DuckDBControlOptions,
  DuckDBFeatureSelection,
  DuckDBGeometryFormat,
  DuckDBLayerState,
  DuckDBState,
  DuckDBTable,
} from './types';

const DEFAULT_OPTIONS: Required<
  Omit<
    DuckDBControlOptions,
    'databaseUrl' | 'sampleDatabaseUrl' | 'sampleData' | 'sampleDataLabel' | 'initialQuery' | 'geometryColumn' | 'layerName' | 'beforeId' | 'sourceCrs' | 'targetCrs'
  >
> = {
  collapsed: true,
  position: 'top-right',
  title: DEFAULT_TITLE,
  panelWidth: DEFAULT_PANEL_WIDTH,
  className: '',
  geometryFormat: 'auto',
  pageSize: DEFAULT_PAGE_SIZE,
  fitBoundsOnLoad: true,
  allowLocalFiles: true,
  allowRemoteUrls: true,
  pickable: true,
  interleaved: true,
};

/** Smallest user-resized panel footprint. */
const PANEL_MIN_WIDTH = 260;
const PANEL_MIN_HEIGHT = 180;
/** Breathing room kept between a resized panel and the map edges. */
const PANEL_EDGE_MARGIN = 12;

type EventHandlersMap = globalThis.Map<DuckDBControlEvent, Set<DuckDBControlEventHandler>>;

interface LoadedDuckDBLayer {
  id: string;
  name: string;
  beforeId: string | null;
  query: string;
  schema: DuckDBColumn[];
  geometryColumn: string | null;
  geometryFormat: Exclude<DuckDBGeometryFormat, 'auto'> | null;
  totalRows: number;
  rows: Record<number, Record<string, unknown>>;
  geoArrowResults: GeoArrowResult[];
}

export class DuckDBControl implements IControl {
  private map?: MapLibreMap;
  private mapContainer?: HTMLElement;
  private container?: HTMLElement;
  private panel?: HTMLElement;
  private content?: HTMLElement;
  private renderer?: DuckDBRenderer;
  private popup: maplibregl.Popup | null = null;
  private options: Required<
    Omit<
      DuckDBControlOptions,
      'databaseUrl' | 'sampleDatabaseUrl' | 'sampleData' | 'sampleDataLabel' | 'initialQuery' | 'geometryColumn' | 'layerName' | 'beforeId' | 'sourceCrs' | 'targetCrs'
    >
  > &
    Pick<
      DuckDBControlOptions,
      'databaseUrl' | 'sampleDatabaseUrl' | 'sampleData' | 'sampleDataLabel' | 'initialQuery' | 'geometryColumn' | 'layerName' | 'beforeId' | 'sourceCrs' | 'targetCrs'
    >;
  private eventHandlers: EventHandlersMap = new globalThis.Map();
  private resizeHandler: (() => void) | null = null;
  private mapResizeHandler: (() => void) | null = null;
  /**
   * User-chosen panel size from the bottom-corner resize handles, reapplied
   * by updatePanelPosition so repositioning keeps it. null means auto.
   */
  private userWidth: number | null = null;
  private userHeight: number | null = null;
  /** Active drag teardown, so onRemove can detach mid-resize. */
  private resizeDragCleanup: (() => void) | null = null;

  private collapsed: boolean;
  private databaseSource: string | null = null;
  private displaySource = '';
  private tables: DuckDBTable[] = [];
  private selectedTable: string | null = null;
  private tableColumns: DuckDBColumn[] = [];
  private localFileName: string | null = null;
  private queryText: string;
  private geometryColumn: string;
  private geometryFormat: DuckDBGeometryFormat;
  private sourceCrs: string;
  private targetCrs: string;
  private layerName: string;
  private beforeId: string;
  private layer: LoadedDuckDBLayer | null = null;
  private loading = false;
  private statusMessage = '';
  private error: string | null = null;
  private selectedFeature: DuckDBFeatureSelection | null = null;
  private pickable: boolean;

  constructor(options?: Partial<DuckDBControlOptions>) {
    this.options = { ...DEFAULT_OPTIONS, ...options };
    this.collapsed = this.options.collapsed;
    this.pickable = this.options.pickable;
    this.queryText = this.options.initialQuery ?? DEFAULT_QUERY;
    this.geometryColumn = this.options.geometryColumn ?? '';
    this.geometryFormat = this.options.geometryFormat;
    this.sourceCrs = this.options.sourceCrs ?? '';
    this.targetCrs = this.options.targetCrs ?? 'EPSG:4326';
    this.layerName = this.options.layerName ?? '';
    this.beforeId = this.options.beforeId ?? '';
  }

  onAdd(map: MapLibreMap): HTMLElement {
    this.map = map;
    this.mapContainer = map.getContainer();
    this.container = this.createContainer();
    this.panel = this.createPanel();
    this.content = this.panel.querySelector('.duckdb-control-content') as HTMLElement;
    this.mapContainer.appendChild(this.panel);
    this.setupEventListeners();

    if (!this.collapsed) {
      this.panel.classList.add('expanded');
      requestAnimationFrame(() => this.updatePanelPosition());
    }
    this.renderContent();

    if (this.options.databaseUrl) {
      this.loadUrl(this.options.databaseUrl).catch(() => {});
    }

    return this.container;
  }

  onRemove(): void {
    if (this.resizeHandler) window.removeEventListener('resize', this.resizeHandler);
    if (this.mapResizeHandler && this.map) this.map.off('resize', this.mapResizeHandler);
    // Detach any in-flight resize drag listeners.
    this.resizeDragCleanup?.();

    this.popup?.remove();
    this.renderer?.remove();
    this.panel?.parentNode?.removeChild(this.panel);
    this.container?.parentNode?.removeChild(this.container);
    if (this.localFileName) dropFile(this.localFileName).catch(() => {});

    this.map = undefined;
    this.mapContainer = undefined;
    this.container = undefined;
    this.panel = undefined;
    this.content = undefined;
    this.renderer = undefined;
    this.eventHandlers.clear();
  }

  getState(): DuckDBState {
    return {
      collapsed: this.collapsed,
      panelWidth: this.options.panelWidth,
      databaseSource: this.databaseSource,
      displaySource: this.displaySource,
      tables: this.tables.map((table) => ({ ...table })),
      selectedTable: this.selectedTable,
      tableColumns: this.tableColumns.map((column) => ({ ...column })),
      query: this.queryText,
      schema: this.layer ? [...this.layer.schema] : [],
      geometryColumn: this.layer?.geometryColumn ?? (this.geometryColumn || null),
      geometryFormat: this.geometryFormat,
      resolvedGeometryFormat: this.layer?.geometryFormat ?? null,
      pageSize: this.options.pageSize,
      totalRows: this.layer?.totalRows ?? -1,
      loadedRows: this.layer ? Object.keys(this.layer.rows).length : 0,
      layer: this.layer ? this.toLayerState(this.layer) : null,
      loading: this.loading,
      statusMessage: this.statusMessage,
      error: this.error,
      selectedFeature: this.selectedFeature,
      pickable: this.pickable,
    };
  }

  toggle(): void {
    this.collapsed = !this.collapsed;
    if (this.panel) {
      if (this.collapsed) {
        this.panel.classList.remove('expanded');
        this.emit('collapse');
      } else {
        this.panel.classList.add('expanded');
        this.updatePanelPosition();
        this.emit('expand');
      }
    }
    this.emit('statechange');
  }

  expand(): void {
    if (this.collapsed) this.toggle();
  }

  collapse(): void {
    if (!this.collapsed) this.toggle();
  }

  on(event: DuckDBControlEvent, handler: DuckDBControlEventHandler): void {
    if (!this.eventHandlers.has(event)) this.eventHandlers.set(event, new Set());
    this.eventHandlers.get(event)!.add(handler);
  }

  off(event: DuckDBControlEvent, handler: DuckDBControlEventHandler): void {
    this.eventHandlers.get(event)?.delete(handler);
  }

  getMap(): MapLibreMap | undefined {
    return this.map;
  }

  getContainer(): HTMLElement | undefined {
    return this.container;
  }

  setPickable(pickable: boolean): void {
    this.pickable = pickable;
    this.renderer?.setPickable(pickable);
    if (!pickable) {
      this.selectedFeature = null;
      this.popup?.remove();
      this.popup = null;
      this.renderer?.setSelectedFeature(null, null);
    }
    void this.renderLayer();
    this.renderContent();
    this.emit('statechange');
  }

  async loadUrl(url: string): Promise<void> {
    if (!this.options.allowRemoteUrls) {
      throw new Error('Remote URL loading is disabled for this DuckDB control');
    }
    const normalizedUrl = url.trim();
    if (!normalizedUrl) return;
    const fileName = this.createDatabaseFileName(normalizedUrl);
    this.emit('loadstart');
    this.setLoading(`Registering ${this.displayNameFromSource(normalizedUrl)}...`);
    try {
      await initDB((message) => this.setProgress(message));
      await registerRemoteDatabase(normalizedUrl, fileName);
      await this.activateDatabase(fileName, normalizedUrl, normalizedUrl);
    } catch (error) {
      this.handleError(error);
      throw error;
    }
  }

  async loadFile(file: File): Promise<void> {
    if (!this.options.allowLocalFiles) {
      throw new Error('Local file loading is disabled for this DuckDB control');
    }
    const fileName = this.createDatabaseFileName(file.name);
    this.emit('loadstart');
    this.setLoading(`Reading ${file.name}...`);
    try {
      await initDB((message) => this.setProgress(message));
      await registerLocalDatabase(file, fileName);
      await this.activateDatabase(fileName, file.name, file.name);
    } catch (error) {
      dropFile(fileName).catch(() => {});
      this.handleError(error);
      throw error;
    }
  }

  async executeQuery(sql = this.queryText): Promise<void> {
    if (!this.databaseSource) {
      throw new Error('Load a DuckDB database before running a query');
    }
    const sourceSql = cleanSql(sql);
    if (!sourceSql) return;

    await this.runTask('Running query...', async () => {
      const schema = await getQuerySchema(sourceSql);
      const geometryColumn = detectGeometryColumn(schema, this.geometryColumn || undefined, this.geometryFormat);
      if (!geometryColumn) {
        throw new Error('No geometry, WKB, or WKT column was detected in the query result');
      }
      const geometryFormat = detectGeometryFormat(
        schema.find((column) => column.name === geometryColumn),
        this.geometryFormat
      );
      if (!geometryFormat) {
        throw new Error(`Could not determine geometry format for column "${geometryColumn}"`);
      }

      const countResult = await query(buildCountQuery(sourceSql));
      const totalRows = Number(countResult.toArray()[0].cnt);
      const result = await query(
        buildResultQuery({
          sql: sourceSql,
          schema,
          geometryColumn,
          geometryFormat,
          limit: this.options.pageSize,
        })
      );

      const displayFields = result.schema.fields
        .map((field) => field.name)
        .filter((name) => name !== '__wkb');
      const rows: Record<number, Record<string, unknown>> = {};
      const wkbs: Uint8Array[] = [];
      const indices: number[] = [];
      const wkbVector = result.getChild('__wkb');

      for (let rowIndex = 0; rowIndex < result.numRows; rowIndex += 1) {
        const row: Record<string, unknown> = { __index: rowIndex, __layer: this.layerName || 'DuckDB query' };
        displayFields.forEach((name) => {
          row[name] = formatDisplayValue(result.getChild(name)?.get(rowIndex));
        });
        rows[rowIndex] = row;
        const wkb = normalizeBinary(wkbVector?.get(rowIndex));
        if (wkb) {
          wkbs.push(wkb);
          indices.push(rowIndex);
        }
      }

      const attributes = new globalThis.Map([['__index', { values: indices, type: 'BIGINT' }]]);
      const geoArrowResults = wkbs.length
        ? (await import('@walkthru-earth/objex-utils')).buildGeoArrowTables(wkbs, attributes)
        : [];
      this.layer = {
        id: this.layer?.id ?? this.createLayerId(),
        name: this.layerName.trim() || 'DuckDB query',
        beforeId: this.beforeId.trim() || null,
        query: sourceSql,
        schema,
        geometryColumn,
        geometryFormat,
        totalRows,
        rows,
        geoArrowResults,
      };
      this.queryText = sourceSql;
      await this.renderLayer();
      if (this.options.fitBoundsOnLoad) this.fitToData(geoArrowResults);
      this.emit('query');
    });
  }

  clear(): void {
    detachDatabase().catch(() => {});
    if (this.localFileName) dropFile(this.localFileName).catch(() => {});
    this.databaseSource = null;
    this.displaySource = '';
    this.tables = [];
    this.selectedTable = null;
    this.tableColumns = [];
    this.localFileName = null;
    this.layer = null;
    this.loading = false;
    this.statusMessage = '';
    this.error = null;
    this.selectedFeature = null;
    this.popup?.remove();
    this.popup = null;
    this.renderer?.clear();
    this.renderContent();
    this.emit('statechange');
  }

  private async activateDatabase(fileName: string, source: string, displaySource: string): Promise<void> {
    if (this.localFileName && this.localFileName !== fileName) {
      dropFile(this.localFileName).catch(() => {});
    }
    this.setProgress(`Opening ${this.displayNameFromSource(displaySource)}...`);
    await attachDatabase(fileName);
    this.databaseSource = source;
    this.displaySource = displaySource;
    this.localFileName = fileName;
    this.layer = null;
    this.tables = await listTables();
    this.selectedTable = this.findSelectedTableFromQuery(this.queryText)?.qualifiedName ?? this.tables[0]?.qualifiedName ?? null;
    this.tableColumns = this.selectedTable ? await getTableSchema(this.selectedTable) : [];
    this.geometryColumn = this.pickDefaultGeometryColumn(this.tableColumns);
    this.selectedFeature = null;
    this.popup?.remove();
    this.popup = null;
    this.renderer?.clear();
    await this.setQueryFromFirstTable();
    this.loading = false;
    this.statusMessage = '';
    this.error = null;
    this.renderContent();
    this.emit('load');
    this.emit('statechange');
    if (this.options.initialQuery) {
      await this.executeQuery(this.options.initialQuery);
    }
  }

  private async setQueryFromFirstTable(): Promise<void> {
    if (this.options.initialQuery && cleanSql(this.queryText) === cleanSql(this.options.initialQuery)) return;
    if (this.queryText !== DEFAULT_QUERY) return;
    if (this.tables.length > 0) {
      await this.applySelectedTable(this.tables[0].qualifiedName);
    } else {
      this.queryText = `SELECT *\nFROM ${DATABASE_SCHEMA_ALIAS}.main.your_table\nLIMIT ${this.options.pageSize}`;
    }
  }

  private async applySelectedTable(qualifiedName: string): Promise<void> {
    const table = this.tables.find((item) => item.qualifiedName === qualifiedName);
    if (!table) return;
    this.selectedTable = table.qualifiedName;
    this.tableColumns = await getTableSchema(table.qualifiedName);
    this.geometryColumn = this.pickDefaultGeometryColumn(this.tableColumns);
    this.queryText = this.buildSelectedTableQuery();
    this.layerName = table.tableName;
  }

  private clearQueryEditorState(): void {
    this.queryText = '';
    this.selectedTable = null;
    this.tableColumns = [];
    this.geometryColumn = '';
    this.layerName = '';
    this.layer = null;
    this.selectedFeature = null;
    this.popup?.remove();
    this.popup = null;
    this.renderer?.clear();
  }

  private buildSelectedTableQuery(): string {
    if (!this.selectedTable) return this.queryText;
    const geometryColumn = this.geometryColumn || this.pickDefaultGeometryColumn(this.tableColumns);
    if (!geometryColumn) {
      return `SELECT *\nFROM ${this.selectedTable}\nLIMIT ${this.options.pageSize}`;
    }
    return buildTableQuery({
      tableName: this.selectedTable,
      schema: this.tableColumns,
      geometryColumn,
      sourceCrs: this.sourceCrs,
      targetCrs: this.targetCrs,
      limit: this.options.pageSize,
    });
  }

  private pickDefaultGeometryColumn(columns: DuckDBColumn[]): string {
    const exact = columns.find((column) => ['geom', 'geometry'].includes(column.name.toLowerCase()));
    return exact?.name ?? detectGeometryColumn(columns, this.geometryColumn || undefined, this.geometryFormat) ?? '';
  }

  private findSelectedTableFromQuery(sql: string): DuckDBTable | null {
    const normalized = sql.replace(/"/g, '').toLowerCase();
    return (
      this.tables.find((table) => {
        const unquotedQualified = `${table.databaseName}.${table.schemaName}.${table.tableName}`.toLowerCase();
        return normalized.includes(unquotedQualified);
      }) ?? null
    );
  }

  private async runTask(message: string, task: () => Promise<void>): Promise<void> {
    try {
      this.setLoading(message);
      await task();
      this.loading = false;
      this.statusMessage = '';
      this.error = null;
      this.renderContent();
      this.emit('statechange');
    } catch (error) {
      this.handleError(error);
      throw error;
    }
  }

  private async getRenderer(): Promise<DuckDBRenderer | null> {
    if (!this.map) return null;
    if (!this.renderer) {
      const { DuckDBRenderer } = await import('../duckdb/renderer');
      this.renderer = new DuckDBRenderer(this.map, {
        onSelect: (selection) => this.handleMapSelect(selection),
        interleaved: this.options.interleaved,
      });
      this.renderer.setPickable(this.pickable);
    }
    return this.renderer;
  }

  private async renderLayer(): Promise<void> {
    if (!this.layer) {
      this.renderer?.clear();
      return;
    }
    const renderer = await this.getRenderer();
    if (!renderer) return;
    renderer.setPickable(this.pickable);
    renderer.setSelectedFeature(this.selectedFeature?.layerId ?? null, this.selectedFeature?.index ?? null);
    renderer.setData([
      {
        id: this.layer.id,
        name: this.layer.name,
        beforeId: this.layer.beforeId,
        results: this.layer.geoArrowResults,
      },
    ]);
  }

  private fitToData(results: GeoArrowResult[]): void {
    if (!this.map || !results.length) return;
    const minX = Math.min(...results.map((result) => result.bounds[0]));
    const minY = Math.min(...results.map((result) => result.bounds[1]));
    const maxX = Math.max(...results.map((result) => result.bounds[2]));
    const maxY = Math.max(...results.map((result) => result.bounds[3]));
    const bounds: [number, number, number, number] = [minX, minY, maxX, maxY];
    if (bounds.some((value) => !Number.isFinite(value))) return;
    const [west, south, east, north] = bounds;
    if (Math.abs(west) > 180 || Math.abs(east) > 180 || Math.abs(south) > 90 || Math.abs(north) > 90) {
      return;
    }
    if (Math.abs(east - west) < 1e-9 && Math.abs(north - south) < 1e-9) {
      this.map.flyTo({ center: [west, south], zoom: Math.max(this.map.getZoom(), 12), duration: 500 });
    } else {
      this.map.fitBounds(
        [
          [west, south],
          [east, north],
        ],
        { padding: 60, maxZoom: 15, duration: 500 }
      );
    }
  }

  private handleMapSelect(selection: DuckDBPickInfo | null): void {
    if (!this.pickable || !selection || !this.layer) {
      this.selectedFeature = null;
      this.popup?.remove();
      this.popup = null;
      this.renderer?.setSelectedFeature(null, null);
      this.renderContent();
      this.emit('select', { selection: null });
      this.emit('statechange');
      return;
    }

    this.selectedFeature = {
      layerId: this.layer.id,
      layerName: this.layer.name,
      index: selection.index,
      properties: this.layer.rows[selection.index] ?? { __index: selection.index },
    };
    this.renderer?.setSelectedFeature(this.layer.id, selection.index);
    void this.renderLayer();
    this.showAttributePopup(selection.coordinate);
    this.renderContent();
    this.emit('select', { selection: this.selectedFeature });
    this.emit('statechange');
  }

  private showAttributePopup(coordinate: [number, number] | null): void {
    if (!this.map || !this.selectedFeature || !coordinate) return;
    const rows = Object.entries(this.selectedFeature.properties)
      .filter(([key]) => !key.startsWith('__'))
      .slice(0, 8)
      .map(([key, value]) => `<tr><th>${this.escapeHtml(key)}</th><td>${this.escapeHtml(String(value ?? ''))}</td></tr>`)
      .join('');
    this.popup?.remove();
    this.popup = new maplibregl.Popup({
      className: 'duckdb-attribute-popup',
      closeButton: true,
      closeOnClick: false,
      maxWidth: '320px',
    })
      .setLngLat(coordinate)
      .setHTML(
        `<div class="duckdb-popup"><strong>${this.escapeHtml(this.selectedFeature.layerName)}</strong><table>${rows}</table></div>`
      )
      .addTo(this.map);
  }

  private setLoading(message: string): void {
    this.loading = true;
    this.statusMessage = message;
    this.error = null;
    this.renderContent();
    this.emit('progress');
    this.emit('statechange');
  }

  private setProgress(message: string): void {
    this.statusMessage = message;
    this.renderContent();
    this.emit('progress');
    this.emit('statechange');
  }

  private handleError(error: unknown): void {
    const info = friendlyError(error);
    const actualError = error instanceof Error ? error : new Error(String(error));
    this.loading = false;
    this.statusMessage = '';
    this.error = [info.detail, info.suggestion].filter(Boolean).join(' ');
    this.renderContent();
    this.emit('error', { error: actualError });
    this.emit('statechange');
  }

  private emit(event: DuckDBControlEvent, extra: Partial<DuckDBControlEventData> = {}): void {
    const handlers = this.eventHandlers.get(event);
    if (!handlers) return;
    const eventData: DuckDBControlEventData = {
      type: event,
      state: this.getState(),
      ...extra,
    };
    handlers.forEach((handler) => handler(eventData));
  }

  private createContainer(): HTMLElement {
    const container = document.createElement('div');
    container.className = `maplibregl-ctrl maplibregl-ctrl-group duckdb-control${
      this.options.className ? ` ${this.options.className}` : ''
    }`;

    const toggleButton = document.createElement('button');
    toggleButton.className = 'duckdb-control-toggle';
    toggleButton.type = 'button';
    toggleButton.setAttribute('aria-label', this.options.title);
    toggleButton.innerHTML = `
      <span class="duckdb-control-icon">
        <svg viewBox="0 0 24 24" width="22" height="22" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <ellipse cx="12" cy="5" rx="7" ry="3"/>
          <path d="M5 5v7c0 1.7 3.1 3 7 3s7-1.3 7-3V5"/>
          <path d="M5 12v7c0 1.7 3.1 3 7 3s7-1.3 7-3v-7"/>
        </svg>
      </span>
    `;
    toggleButton.addEventListener('click', () => this.toggle());
    container.appendChild(toggleButton);
    return container;
  }

  private createPanel(): HTMLElement {
    const panel = document.createElement('div');
    panel.className = 'duckdb-control-panel';
    panel.style.width = `${this.options.panelWidth}px`;

    const header = document.createElement('div');
    header.className = 'duckdb-control-header';

    const title = document.createElement('span');
    title.className = 'duckdb-control-title';
    title.textContent = this.options.title;

    const closeButton = document.createElement('button');
    closeButton.className = 'duckdb-control-close';
    closeButton.type = 'button';
    closeButton.setAttribute('aria-label', 'Close panel');
    closeButton.innerHTML = '&times;';
    closeButton.addEventListener('click', () => this.collapse());

    const content = document.createElement('div');
    content.className = 'duckdb-control-content';

    header.appendChild(title);
    header.appendChild(closeButton);
    panel.appendChild(header);
    panel.appendChild(content);
    this.addResizeHandles(panel);
    return panel;
  }

  /**
   * Adds drag handles in the panel's bottom-left and bottom-right corners.
   * The panel is absolutely positioned, so a custom handle is used instead of
   * CSS `resize` (which is unreliable in WebKitGTK). Pointer drags resize the
   * panel and the chosen size is kept (in {@link userWidth}/{@link userHeight})
   * so repositioning does not reset it.
   *
   * @param panel - The panel element to attach handles to.
   */
  private addResizeHandles(panel: HTMLElement): void {
    for (const side of ['left', 'right'] as const) {
      const handle = document.createElement('div');
      handle.className = `duckdb-control-resize-handle duckdb-control-resize-${side}`;
      handle.setAttribute('aria-hidden', 'true');
      handle.addEventListener('pointerdown', (event) => this.beginResize(event, side, panel, handle));
      panel.appendChild(handle);
    }
  }

  /**
   * Starts a pointer-driven resize from one of the bottom-corner handles.
   *
   * The panel is first frozen to explicit left/top pixels (clearing any
   * right/bottom anchor) so the opposite edge stays put no matter which corner
   * the control sits in. The right handle then grows the panel rightward, the
   * left handle leftward; both grow it downward. Sizes are clamped to a
   * sensible minimum and to the map container.
   *
   * @param event - The pointerdown event.
   * @param side - Which corner handle started the drag.
   * @param panel - The panel element being resized.
   * @param handle - The handle element (for pointer capture).
   */
  private beginResize(event: PointerEvent, side: 'left' | 'right', panel: HTMLElement, handle: HTMLElement): void {
    if (!this.mapContainer) return;
    event.preventDefault();
    // Keep the drag from bubbling to any document-level click handler.
    event.stopPropagation();

    const mapRect = this.mapContainer.getBoundingClientRect();
    const rect = panel.getBoundingClientRect();
    const startX = event.clientX;
    const startY = event.clientY;
    const startWidth = rect.width;
    const startHeight = rect.height;
    const startLeft = rect.left - mapRect.left;
    const startRight = rect.right;
    const startTop = rect.top;

    // Clamp the preferred minimums to what the map can actually hold, so a
    // small map container never forces the panel past its edges.
    const minWidth = Math.min(PANEL_MIN_WIDTH, Math.max(120, mapRect.width - 2 * PANEL_EDGE_MARGIN));
    const minHeight = Math.min(PANEL_MIN_HEIGHT, Math.max(120, mapRect.height - 2 * PANEL_EDGE_MARGIN));

    // Pin the panel to its current rect so the size grows from the dragged
    // corner regardless of the original anchor, and drop the CSS max-size
    // caps for the duration of the drag.
    panel.style.left = `${startLeft}px`;
    panel.style.top = `${startTop - mapRect.top}px`;
    panel.style.right = '';
    panel.style.bottom = '';
    panel.style.maxWidth = 'none';
    panel.style.maxHeight = 'none';

    const onMove = (moveEvent: PointerEvent): void => {
      const dx = moveEvent.clientX - startX;
      const dy = moveEvent.clientY - startY;

      const maxHeight = Math.max(minHeight, mapRect.bottom - startTop - PANEL_EDGE_MARGIN);
      const nextHeight = Math.max(minHeight, Math.min(startHeight + dy, maxHeight));

      let nextWidth: number;
      let nextLeft = startLeft;
      if (side === 'right') {
        const maxWidth = Math.max(minWidth, mapRect.right - rect.left - PANEL_EDGE_MARGIN);
        nextWidth = Math.max(minWidth, Math.min(startWidth + dx, maxWidth));
      } else {
        const maxWidth = Math.max(minWidth, startRight - mapRect.left - PANEL_EDGE_MARGIN);
        nextWidth = Math.max(minWidth, Math.min(startWidth - dx, maxWidth));
        // Hold the right edge fixed while the left edge follows the drag.
        nextLeft = startLeft + (startWidth - nextWidth);
      }

      panel.style.width = `${nextWidth}px`;
      panel.style.height = `${nextHeight}px`;
      panel.style.left = `${nextLeft}px`;
      this.userWidth = nextWidth;
      this.userHeight = nextHeight;
    };

    const cleanup = (): void => {
      handle.releasePointerCapture?.(event.pointerId);
      handle.removeEventListener('pointermove', onMove);
      handle.removeEventListener('pointerup', cleanup);
      handle.removeEventListener('pointercancel', cleanup);
      this.resizeDragCleanup = null;
    };

    handle.setPointerCapture?.(event.pointerId);
    handle.addEventListener('pointermove', onMove);
    handle.addEventListener('pointerup', cleanup);
    // Touch/pen drags can end with pointercancel instead of pointerup.
    handle.addEventListener('pointercancel', cleanup);
    this.resizeDragCleanup = cleanup;
  }

  private setupEventListeners(): void {
    this.resizeHandler = () => {
      if (!this.collapsed) this.updatePanelPosition();
    };
    window.addEventListener('resize', this.resizeHandler);

    this.mapResizeHandler = () => {
      if (!this.collapsed) this.updatePanelPosition();
    };
    this.map?.on('resize', this.mapResizeHandler);
  }

  private getControlPosition(): 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right' {
    const parent = this.container?.parentElement;
    if (!parent) return 'top-right';
    if (parent.classList.contains('maplibregl-ctrl-top-left')) return 'top-left';
    if (parent.classList.contains('maplibregl-ctrl-top-right')) return 'top-right';
    if (parent.classList.contains('maplibregl-ctrl-bottom-left')) return 'bottom-left';
    if (parent.classList.contains('maplibregl-ctrl-bottom-right')) return 'bottom-right';
    return 'top-right';
  }

  private updatePanelPosition(): void {
    if (!this.container || !this.panel || !this.mapContainer) return;
    const button = this.container.querySelector('.duckdb-control-toggle');
    if (!button) return;

    const buttonRect = button.getBoundingClientRect();
    const mapRect = this.mapContainer.getBoundingClientRect();
    const position = this.getControlPosition();
    const top = buttonRect.top - mapRect.top;
    const bottom = mapRect.bottom - buttonRect.bottom;
    const left = buttonRect.left - mapRect.left;
    const right = mapRect.right - buttonRect.right;
    const gap = 5;
    const edgeMargin = 10; // Breathing room between the panel and the map edge

    this.panel.style.top = '';
    this.panel.style.bottom = '';
    this.panel.style.left = '';
    this.panel.style.right = '';

    // Offset of the panel's anchored edge from the same edge of the map
    // container (top edge for top-* positions, bottom edge for bottom-*).
    const anchorOffset =
      (position === 'top-left' || position === 'top-right' ? top : bottom) +
      buttonRect.height +
      gap;

    if (position === 'top-left') {
      this.panel.style.top = `${anchorOffset}px`;
      this.panel.style.left = `${left}px`;
    } else if (position === 'top-right') {
      this.panel.style.top = `${anchorOffset}px`;
      this.panel.style.right = `${right}px`;
    } else if (position === 'bottom-left') {
      this.panel.style.bottom = `${anchorOffset}px`;
      this.panel.style.left = `${left}px`;
    } else {
      this.panel.style.bottom = `${anchorOffset}px`;
      this.panel.style.right = `${right}px`;
    }

    // The stylesheet sizes the panel to its content, but it must not extend
    // past the map container (maps commonly have overflow: hidden) before its
    // own scrollbar engages. Cap the panel to the space left between the
    // anchor and the opposite map edge; the 160px floor keeps it usable when
    // the map is tiny, and overflow-y: auto then scrolls the content.
    const available = Math.max(160, mapRect.height - anchorOffset - edgeMargin);
    this.panel.style.maxHeight = `min(80vh, 720px, ${available}px)`;
    const availableWidth = Math.max(PANEL_MIN_WIDTH, mapRect.width - 2 * edgeMargin);
    this.panel.style.maxWidth = `${availableWidth}px`;

    // Reapply a resize the user made, clamped to the current map size, so
    // repositioning keeps their chosen dimensions instead of snapping back.
    // The lower bound guards a tiny map where the available room goes negative.
    if (this.userWidth !== null) {
      this.panel.style.width = `${Math.max(PANEL_MIN_WIDTH, Math.min(this.userWidth, availableWidth))}px`;
    }
    if (this.userHeight !== null) {
      this.panel.style.height = `${Math.max(PANEL_MIN_HEIGHT, Math.min(this.userHeight, available))}px`;
    }
  }

  private renderContent(): void {
    if (!this.content) return;
    this.content.replaceChildren();
    const fragment = document.createDocumentFragment();
    fragment.appendChild(this.renderLoadSection());
    fragment.appendChild(this.renderQuerySection());
    fragment.appendChild(this.renderStatusSection());
    if (this.layer) {
      fragment.appendChild(this.renderResultSection());
    }
    if (this.selectedFeature) {
      fragment.appendChild(this.renderSelectionSection());
    }
    this.content.appendChild(fragment);
  }

  private renderLoadSection(): HTMLElement {
    const section = document.createElement('div');
    section.className = 'duckdb-control-section';

    if (this.options.allowRemoteUrls) {
      const label = document.createElement('label');
      label.className = 'duckdb-control-label';
      label.textContent = 'DuckDB URL';
      const row = document.createElement('div');
      row.className = 'duckdb-control-row';
      const input = document.createElement('input');
      input.className = 'duckdb-control-input duckdb-control-url';
      input.type = 'text';
      input.placeholder = 'https://example.com/data.duckdb';
      input.value = this.options.sampleDatabaseUrl ?? '';
      const button = document.createElement('button');
      button.className = 'duckdb-control-button';
      button.type = 'button';
      button.textContent = 'Load';
      button.disabled = this.loading;
      button.addEventListener('click', (event) => {
        event.stopPropagation();
        if (input.value.trim()) this.loadUrl(input.value).catch(() => {});
      });
      row.appendChild(input);
      row.appendChild(button);
      const sampleDropdown = this.createSampleDropdown((url) => {
        input.value = url;
      });
      if (sampleDropdown) section.appendChild(sampleDropdown);
      section.appendChild(label);
      section.appendChild(row);
    }

    if (this.options.allowLocalFiles) {
      const fileInput = document.createElement('input');
      fileInput.className = 'duckdb-control-file';
      fileInput.type = 'file';
      fileInput.accept = '.duckdb,.db,application/octet-stream';
      fileInput.disabled = this.loading;
      fileInput.addEventListener('change', () => {
        const file = fileInput.files?.[0];
        if (file) this.loadFile(file).catch(() => {});
      });
      section.appendChild(fileInput);
    }

    const pickableLabel = document.createElement('label');
    pickableLabel.className = 'duckdb-control-check';
    const pickableInput = document.createElement('input');
    pickableInput.type = 'checkbox';
    pickableInput.checked = this.pickable;
    pickableInput.addEventListener('change', () => this.setPickable(pickableInput.checked));
    const pickableText = document.createElement('span');
    pickableText.textContent = 'Show attribute popup on feature click';
    pickableLabel.appendChild(pickableInput);
    pickableLabel.appendChild(pickableText);
    section.appendChild(pickableLabel);

    if (this.databaseSource) {
      const clearButton = document.createElement('button');
      clearButton.className = 'duckdb-control-secondary-button';
      clearButton.type = 'button';
      clearButton.textContent = 'Clear';
      clearButton.disabled = this.loading;
      clearButton.addEventListener('click', () => this.clear());
      section.appendChild(clearButton);
    }

    return section;
  }

  /**
   * Builds the "Load sample data" dropdown: a custom (not native `<select>`)
   * dropdown so the menu themes correctly in dark mode. Picking an entry calls
   * `onSelect` with its URL. Returns null when no samples are configured.
   */
  private createSampleDropdown(onSelect: (url: string) => void): HTMLElement | null {
    const samples = this.options.sampleData ?? [];
    if (samples.length === 0) return null;
    const placeholder = this.options.sampleDataLabel ?? 'Load sample data...';

    const triggerLabel = document.createElement('span');
    triggerLabel.className = 'duckdb-sample-trigger-label';
    triggerLabel.textContent = placeholder;
    const caret = document.createElement('span');
    caret.className = 'duckdb-sample-caret';
    caret.textContent = '▾';
    const trigger = document.createElement('button');
    trigger.type = 'button';
    trigger.className = 'duckdb-sample-trigger';
    trigger.setAttribute('aria-haspopup', 'listbox');
    trigger.setAttribute('aria-expanded', 'false');
    trigger.setAttribute('aria-label', placeholder);
    trigger.appendChild(triggerLabel);
    trigger.appendChild(caret);

    const menu = document.createElement('div');
    menu.className = 'duckdb-sample-menu';
    menu.setAttribute('role', 'listbox');
    menu.hidden = true;

    let menuOpen = false;
    const setMenuOpen = (open: boolean): void => {
      menuOpen = open;
      menu.hidden = !open;
      trigger.setAttribute('aria-expanded', String(open));
      trigger.classList.toggle('open', open);
      if (open) (menu.firstElementChild as HTMLElement | null)?.focus();
    };

    for (const sample of samples) {
      const option = document.createElement('button');
      option.type = 'button';
      option.className = 'duckdb-sample-option';
      option.setAttribute('role', 'option');
      option.textContent = sample.label;
      option.title = sample.url;
      option.addEventListener('click', (event) => {
        event.stopPropagation();
        setMenuOpen(false);
        trigger.focus();
        onSelect(sample.url);
      });
      menu.appendChild(option);
    }

    trigger.addEventListener('click', (event) => {
      event.stopPropagation();
      setMenuOpen(!menuOpen);
    });

    const wrap = document.createElement('div');
    wrap.className = 'duckdb-control-label duckdb-sample-dropdown';
    wrap.appendChild(trigger);
    wrap.appendChild(menu);

    // Close on Escape or when focus leaves the dropdown (no document listener).
    wrap.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && menuOpen) {
        setMenuOpen(false);
        trigger.focus();
      }
    });
    wrap.addEventListener('focusout', (e) => {
      const next = (e as FocusEvent).relatedTarget as Node | null;
      if (!next || !wrap.contains(next)) setMenuOpen(false);
    });

    return wrap;
  }

  private renderQuerySection(): HTMLElement {
    const section = document.createElement('div');
    section.className = 'duckdb-control-section';

    if (this.tables.length > 0) {
      const tableLabel = document.createElement('label');
      tableLabel.className = 'duckdb-control-label';
      tableLabel.textContent = 'Table';
      const tableSelect = document.createElement('select');
      tableSelect.className = 'duckdb-control-input duckdb-control-table';
      tableSelect.disabled = this.loading;
      const placeholder = document.createElement('option');
      placeholder.value = '';
      placeholder.textContent = 'Select a table';
      placeholder.selected = this.selectedTable === null;
      tableSelect.appendChild(placeholder);
      this.tables.forEach((table) => {
        const option = document.createElement('option');
        option.value = table.qualifiedName;
        option.textContent = table.displayName;
        option.selected = table.qualifiedName === this.selectedTable;
        tableSelect.appendChild(option);
      });
      tableSelect.addEventListener('change', () => {
        if (!tableSelect.value) {
          this.clearQueryEditorState();
          this.renderContent();
          this.emit('statechange');
          return;
        }
        this.applySelectedTable(tableSelect.value)
          .then(() => {
            this.renderContent();
            this.emit('statechange');
          })
          .catch((error) => this.handleError(error));
      });
      tableLabel.appendChild(tableSelect);
      section.appendChild(tableLabel);
    }

    const queryLabel = document.createElement('label');
    queryLabel.className = 'duckdb-control-label';
    queryLabel.textContent = 'SQL query';
    const textarea = document.createElement('textarea');
    textarea.className = 'duckdb-control-textarea duckdb-control-sql';
    textarea.rows = 7;
    textarea.value = this.queryText;
    textarea.disabled = this.loading;
    textarea.addEventListener('input', () => {
      if (!textarea.value.trim()) {
        this.clearQueryEditorState();
        this.renderContent();
        this.emit('statechange');
        return;
      }
      this.queryText = textarea.value;
    });
    queryLabel.appendChild(textarea);
    section.appendChild(queryLabel);

    if (!this.queryText.trim()) {
      const runButton = document.createElement('button');
      runButton.className = 'duckdb-control-button';
      runButton.type = 'button';
      runButton.textContent = 'Run query';
      runButton.disabled = true;
      section.appendChild(runButton);
      return section;
    }

    const fields = document.createElement('div');
    fields.className = 'duckdb-control-grid';
    fields.appendChild(this.createGeometryColumnField());
    fields.appendChild(this.createSelectField('Geometry format', this.geometryFormat, ['auto', 'geometry', 'wkb', 'wkt'], (value) => {
      this.geometryFormat = value as DuckDBGeometryFormat;
    }));
    fields.appendChild(this.createTextField('Source CRS', this.sourceCrs, (value) => {
      this.sourceCrs = value;
      if (this.selectedTable) this.queryText = this.buildSelectedTableQuery();
    }));
    fields.appendChild(this.createTextField('Target CRS', this.targetCrs, (value) => {
      this.targetCrs = value;
      if (this.selectedTable) this.queryText = this.buildSelectedTableQuery();
    }));
    fields.appendChild(this.createTextField('Layer name', this.layerName, (value) => {
      this.layerName = value;
    }));
    fields.appendChild(this.createTextField('before_id', this.beforeId, (value) => {
      this.beforeId = value;
    }));
    section.appendChild(fields);

    const runButton = document.createElement('button');
    runButton.className = 'duckdb-control-button';
    runButton.type = 'button';
    runButton.textContent = 'Run query';
    runButton.disabled = this.loading || !this.databaseSource;
    runButton.addEventListener('click', () => this.executeQuery().catch(() => {}));
    section.appendChild(runButton);
    return section;
  }

  private createGeometryColumnField(): HTMLLabelElement {
    if (this.tableColumns.length === 0) {
      return this.createTextField('Geometry column', this.geometryColumn, (value) => {
        this.geometryColumn = value;
      });
    }

    const label = document.createElement('label');
    label.className = 'duckdb-control-label';
    label.textContent = 'Geometry column';
    const select = document.createElement('select');
    select.className = 'duckdb-control-input duckdb-control-geometry-column';
    select.disabled = this.loading;
    this.tableColumns.forEach((column) => {
      const option = document.createElement('option');
      option.value = column.name;
      option.textContent = column.name;
      option.selected = column.name === this.geometryColumn;
      select.appendChild(option);
    });
    select.addEventListener('change', () => {
      this.geometryColumn = select.value;
      if (this.selectedTable) {
        this.queryText = this.buildSelectedTableQuery();
        this.renderContent();
        this.emit('statechange');
      }
    });
    label.appendChild(select);
    return label;
  }

  private createTextField(labelText: string, value: string, onInput: (value: string) => void): HTMLLabelElement {
    const label = document.createElement('label');
    label.className = 'duckdb-control-label';
    label.textContent = labelText;
    const input = document.createElement('input');
    input.className = 'duckdb-control-input';
    input.type = 'text';
    input.value = value;
    input.disabled = this.loading;
    input.addEventListener('input', () => onInput(input.value));
    label.appendChild(input);
    return label;
  }

  private createSelectField(
    labelText: string,
    value: string,
    values: string[],
    onChange: (value: string) => void
  ): HTMLLabelElement {
    const label = document.createElement('label');
    label.className = 'duckdb-control-label';
    label.textContent = labelText;
    const select = document.createElement('select');
    select.className = 'duckdb-control-input';
    select.disabled = this.loading;
    values.forEach((item) => {
      const option = document.createElement('option');
      option.value = item;
      option.textContent = item;
      option.selected = item === value;
      select.appendChild(option);
    });
    select.addEventListener('change', () => onChange(select.value));
    label.appendChild(select);
    return label;
  }

  private renderStatusSection(): HTMLElement {
    const section = document.createElement('div');
    section.className = 'duckdb-control-section';
    if (this.statusMessage) {
      const status = document.createElement('div');
      status.className = 'duckdb-control-status';
      status.textContent = this.statusMessage;
      section.appendChild(status);
    }
    if (this.error) {
      const error = document.createElement('div');
      error.className = 'duckdb-control-error';
      error.textContent = this.error;
      section.appendChild(error);
    }
    if (!section.childElementCount) {
      const placeholder = document.createElement('p');
      placeholder.className = 'duckdb-control-placeholder';
      placeholder.textContent = this.databaseSource
        ? 'Run a SQL query that returns a geometry, WKB, or WKT column.'
        : 'Load a DuckDB database to query and visualize geospatial rows.';
      section.appendChild(placeholder);
    }
    return section;
  }

  private renderResultSection(): HTMLElement {
    const section = document.createElement('div');
    section.className = 'duckdb-control-section duckdb-control-summary';
    const items: [string, string][] = [
      ['Database', this.displaySource],
      ['Layer', this.layer!.name],
      ['before_id', this.layer!.beforeId ?? ''],
      ['Rows', this.layer!.totalRows >= 0 ? this.layer!.totalRows.toLocaleString() : 'Unknown'],
      ['Loaded', Object.keys(this.layer!.rows).length.toLocaleString()],
      ['Geometry', this.layer!.geometryColumn ?? 'Not detected'],
      ['Format', this.layer!.geometryFormat ?? 'Not detected'],
    ];
    items.forEach(([label, value]) => {
      const row = document.createElement('div');
      row.className = 'duckdb-control-summary-row';
      const key = document.createElement('span');
      key.textContent = label;
      const val = document.createElement('strong');
      val.textContent = value;
      row.appendChild(key);
      row.appendChild(val);
      section.appendChild(row);
    });
    return section;
  }

  private renderSelectionSection(): HTMLElement {
    const section = document.createElement('div');
    section.className = 'duckdb-control-section';
    const title = document.createElement('div');
    title.className = 'duckdb-control-section-title';
    title.textContent = `Selected ${this.selectedFeature!.layerName} #${this.selectedFeature!.index + 1}`;
    section.appendChild(title);

    const list = document.createElement('dl');
    list.className = 'duckdb-control-properties';
    Object.entries(this.selectedFeature!.properties)
      .filter(([key]) => !key.startsWith('__'))
      .slice(0, 20)
      .forEach(([key, value]) => {
        const term = document.createElement('dt');
        term.textContent = key;
        const description = document.createElement('dd');
        description.textContent = String(value ?? '');
        list.appendChild(term);
        list.appendChild(description);
      });
    section.appendChild(list);
    return section;
  }

  private toLayerState(layer: LoadedDuckDBLayer): DuckDBLayerState {
    return {
      id: layer.id,
      name: layer.name,
      beforeId: layer.beforeId,
      query: layer.query,
      schema: [...layer.schema],
      geometryColumn: layer.geometryColumn,
      geometryFormat: layer.geometryFormat,
      totalRows: layer.totalRows,
      loadedRows: Object.keys(layer.rows).length,
    };
  }

  private createLayerId(): string {
    return `layer-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
  }

  private createDatabaseFileName(source: string): string {
    const safeName = this.displayNameFromSource(source).replace(/[^a-zA-Z0-9._-]/g, '_');
    return `duckdb_${Date.now()}_${Math.random().toString(36).slice(2)}_${safeName}`;
  }

  private displayNameFromSource(source: string): string {
    return source.split(/[\\/]/).pop() || source;
  }

  private escapeHtml(value: string): string {
    return value.replace(/[&<>"']/g, (char) => {
      const entities: Record<string, string> = {
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;',
      };
      return entities[char] ?? char;
    });
  }
}

export const PluginControl = DuckDBControl;
