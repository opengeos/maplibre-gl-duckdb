import { useCallback, useState } from 'react';
import type { DuckDBState } from '../core/types';
import { DEFAULT_PAGE_SIZE, DEFAULT_PANEL_WIDTH, DEFAULT_QUERY } from '../duckdb/constants';

const DEFAULT_STATE: DuckDBState = {
  collapsed: true,
  panelWidth: DEFAULT_PANEL_WIDTH,
  databaseSource: null,
  displaySource: '',
  tables: [],
  selectedTable: null,
  tableColumns: [],
  query: DEFAULT_QUERY,
  schema: [],
  geometryColumn: null,
  geometryFormat: 'auto',
  resolvedGeometryFormat: null,
  pageSize: DEFAULT_PAGE_SIZE,
  totalRows: -1,
  loadedRows: 0,
  layer: null,
  loading: false,
  statusMessage: '',
  error: null,
  selectedFeature: null,
  pickable: true,
};

export function useDuckDBState(initialState?: Partial<DuckDBState>) {
  const [state, setState] = useState<DuckDBState>({
    ...DEFAULT_STATE,
    ...initialState,
  });

  const setCollapsed = useCallback((collapsed: boolean) => {
    setState((previous) => ({ ...previous, collapsed }));
  }, []);

  const setPanelWidth = useCallback((panelWidth: number) => {
    setState((previous) => ({ ...previous, panelWidth }));
  }, []);

  const reset = useCallback(() => {
    setState({ ...DEFAULT_STATE, ...initialState });
  }, [initialState]);

  const toggle = useCallback(() => {
    setState((previous) => ({ ...previous, collapsed: !previous.collapsed }));
  }, []);

  return {
    state,
    setState,
    setCollapsed,
    setPanelWidth,
    reset,
    toggle,
  };
}

export const usePluginState = useDuckDBState;
