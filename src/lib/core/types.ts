import type { Map } from 'maplibre-gl';

export type DuckDBControlPosition = 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';
export type DuckDBGeometryFormat = 'auto' | 'geometry' | 'wkb' | 'wkt';

export interface DuckDBColumn {
  name: string;
  type: string;
  nullable: boolean;
}

export interface DuckDBTable {
  databaseName: string;
  schemaName: string;
  tableName: string;
  qualifiedName: string;
  displayName: string;
}

export interface DuckDBFeatureSelection {
  layerId: string;
  layerName: string;
  index: number;
  properties: Record<string, unknown>;
}

export interface DuckDBLayerState {
  id: string;
  name: string;
  beforeId: string | null;
  query: string;
  schema: DuckDBColumn[];
  geometryColumn: string | null;
  geometryFormat: Exclude<DuckDBGeometryFormat, 'auto'> | null;
  totalRows: number;
  loadedRows: number;
}

export interface DuckDBState {
  collapsed: boolean;
  panelWidth: number;
  databaseSource: string | null;
  displaySource: string;
  tables: DuckDBTable[];
  selectedTable: string | null;
  tableColumns: DuckDBColumn[];
  query: string;
  schema: DuckDBColumn[];
  geometryColumn: string | null;
  geometryFormat: DuckDBGeometryFormat;
  resolvedGeometryFormat: Exclude<DuckDBGeometryFormat, 'auto'> | null;
  pageSize: number;
  totalRows: number;
  loadedRows: number;
  layer: DuckDBLayerState | null;
  loading: boolean;
  statusMessage: string;
  error: string | null;
  selectedFeature: DuckDBFeatureSelection | null;
  pickable: boolean;
}

export interface DuckDBControlOptions {
  collapsed?: boolean;
  position?: DuckDBControlPosition;
  title?: string;
  panelWidth?: number;
  className?: string;
  databaseUrl?: string;
  sampleDatabaseUrl?: string;
  initialQuery?: string;
  geometryColumn?: string;
  geometryFormat?: DuckDBGeometryFormat;
  sourceCrs?: string;
  targetCrs?: string;
  pageSize?: number;
  fitBoundsOnLoad?: boolean;
  allowLocalFiles?: boolean;
  allowRemoteUrls?: boolean;
  pickable?: boolean;
  layerName?: string;
  beforeId?: string;
  interleaved?: boolean;
}

export interface DuckDBControlReactProps extends DuckDBControlOptions {
  map: Map;
  onStateChange?: (state: DuckDBState) => void;
  onLoad?: (state: DuckDBState) => void;
  onQuery?: (state: DuckDBState) => void;
  onError?: (error: Error, state: DuckDBState) => void;
  onSelect?: (selection: DuckDBFeatureSelection | null, state: DuckDBState) => void;
}

export type DuckDBControlEvent =
  | 'collapse'
  | 'expand'
  | 'statechange'
  | 'loadstart'
  | 'progress'
  | 'load'
  | 'query'
  | 'error'
  | 'select';

export interface DuckDBControlEventData {
  type: DuckDBControlEvent;
  state: DuckDBState;
  error?: Error;
  selection?: DuckDBFeatureSelection | null;
}

export type DuckDBControlEventHandler = (event: DuckDBControlEventData) => void;

export type PluginControlOptions = DuckDBControlOptions;
export type PluginState = DuckDBState;
export type PluginControlReactProps = DuckDBControlReactProps;
export type PluginControlEvent = DuckDBControlEvent;
export type PluginControlEventHandler = DuckDBControlEventHandler;
