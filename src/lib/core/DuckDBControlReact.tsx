import { useEffect, useRef } from 'react';
import { DuckDBControl } from './DuckDBControl';
import type { DuckDBControlReactProps } from './types';

export function DuckDBControlReact({
  map,
  onStateChange,
  onLoad,
  onQuery,
  onError,
  onSelect,
  ...options
}: DuckDBControlReactProps): null {
  const controlRef = useRef<DuckDBControl | null>(null);
  const previousDatabaseUrlRef = useRef(options.databaseUrl);
  const previousInitialQueryRef = useRef(options.initialQuery);

  useEffect(() => {
    if (!map) return;

    const control = new DuckDBControl(options);
    controlRef.current = control;

    if (onStateChange) {
      control.on('statechange', (event) => onStateChange(event.state));
    }
    if (onLoad) {
      control.on('load', (event) => onLoad(event.state));
    }
    if (onQuery) {
      control.on('query', (event) => onQuery(event.state));
    }
    if (onError) {
      control.on('error', (event) => onError(event.error ?? new Error('DuckDB operation failed'), event.state));
    }
    if (onSelect) {
      control.on('select', (event) => onSelect(event.selection ?? null, event.state));
    }

    map.addControl(control, options.position || 'top-right');

    return () => {
      if (map.hasControl(control)) {
        map.removeControl(control);
      }
      controlRef.current = null;
    };
  }, [map]);

  useEffect(() => {
    const control = controlRef.current;
    if (!control || options.collapsed === undefined) return;
    if (options.collapsed) control.collapse();
    else control.expand();
  }, [options.collapsed]);

  useEffect(() => {
    const control = controlRef.current;
    if (!control || !options.databaseUrl || previousDatabaseUrlRef.current === options.databaseUrl) return;
    previousDatabaseUrlRef.current = options.databaseUrl;
    control.loadUrl(options.databaseUrl).catch(() => {});
  }, [options.databaseUrl]);

  useEffect(() => {
    const control = controlRef.current;
    if (!control || !options.initialQuery || previousInitialQueryRef.current === options.initialQuery) return;
    previousInitialQueryRef.current = options.initialQuery;
    control.executeQuery(options.initialQuery).catch(() => {});
  }, [options.initialQuery]);

  return null;
}

export const PluginControlReact = DuckDBControlReact;
