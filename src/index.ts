import './lib/styles/plugin-control.css';

export { DuckDBControl, PluginControl } from './lib/core/DuckDBControl';

export type {
  DuckDBColumn,
  DuckDBControlEvent,
  DuckDBControlEventHandler,
  DuckDBControlOptions,
  DuckDBSampleDataset,
  DuckDBFeatureSelection,
  DuckDBGeometryFormat,
  DuckDBLayerState,
  DuckDBState,
  DuckDBTable,
  PluginControlEvent,
  PluginControlEventHandler,
  PluginControlOptions,
  PluginState,
} from './lib/core/types';

export {
  clamp,
  formatNumericValue,
  generateId,
  debounce,
  throttle,
  classNames,
} from './lib/utils';

export {
  buildCountQuery,
  buildResultQuery,
  cleanSql,
  detectGeometryColumn,
  detectGeometryFormat,
  escapeSource,
  friendlyError,
  quoteIdentifier,
} from './lib/duckdb/utils';

export { configureDuckDB } from './lib/duckdb/duckdb';
export type { DuckDBSourceConfig } from './lib/duckdb/duckdb';
