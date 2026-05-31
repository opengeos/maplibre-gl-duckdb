import { MapboxOverlay } from '@deck.gl/mapbox';
import {
  GeoArrowPathLayer,
  GeoArrowPolygonLayer,
  GeoArrowScatterplotLayer,
} from '@geoarrow/deck.gl-geoarrow';
import type { Map as MapLibreMap } from 'maplibre-gl';
import type { GeoArrowResult } from '@walkthru-earth/objex-utils';

const NORMAL_FILL = [40, 126, 155, 125] as [number, number, number, number];
const NORMAL_LINE = [31, 84, 105, 230] as [number, number, number, number];
const SELECTED_FILL = [217, 119, 6, 170] as [number, number, number, number];
const SELECTED_LINE = [180, 83, 9, 255] as [number, number, number, number];
const HIGHLIGHT = [245, 158, 11, 160] as [number, number, number, number];

type DeckInfo = {
  picked?: boolean;
  object?: Record<string, unknown>;
  index?: number;
  coordinate?: number[];
};

export interface DuckDBRenderedLayer {
  id: string;
  name: string;
  beforeId: string | null;
  results: GeoArrowResult[];
}

export interface DuckDBPickInfo {
  layerId: string;
  index: number;
  coordinate: [number, number] | null;
}

export interface DuckDBRendererOptions {
  onSelect: (selection: DuckDBPickInfo | null) => void;
  interleaved?: boolean;
}

export class DuckDBRenderer {
  private map: MapLibreMap;
  private overlay: MapboxOverlay;
  private selectedLayerId: string | null = null;
  private selectedIndex: number | null = null;
  private pickable = true;
  private onSelect: (selection: DuckDBPickInfo | null) => void;
  private currentLayers: DuckDBRenderedLayer[] = [];

  constructor(map: MapLibreMap, options: DuckDBRendererOptions) {
    this.map = map;
    this.onSelect = options.onSelect;
    this.overlay = new MapboxOverlay({ layers: [], interleaved: options.interleaved ?? true });
    this.map.addControl(this.overlay);
  }

  setPickable(pickable: boolean): void {
    this.pickable = pickable;
  }

  setSelectedFeature(layerId: string | null, index: number | null): void {
    this.selectedLayerId = layerId;
    this.selectedIndex = index;
  }

  setData(layers: DuckDBRenderedLayer[]): void {
    this.currentLayers = layers;
    const deckLayers = layers.flatMap((layer) =>
      layer.results.flatMap((result, index) => this.createLayers(layer.id, result, index))
    );
    this.overlay.setProps({ layers: deckLayers as never[] });
    this.map.triggerRepaint();
  }

  clear(): void {
    this.overlay.setProps({ layers: [] });
    this.map.triggerRepaint();
  }

  remove(): void {
    this.clear();
    if (this.map.hasControl(this.overlay)) {
      this.map.removeControl(this.overlay);
    }
  }

  private rowIndex(info: DeckInfo): number | null {
    const value = info.object?.__index;
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'bigint') return Number(value);
    return null;
  }

  private createLayers(layerId: string, result: GeoArrowResult, index: number): unknown[] {
    const layerKey = `duckdb-${layerId}-${result.geometryType}-${index}`;
    const indexColumn = result.table.getChild('__index');
    const indexValues = indexColumn ? indexColumn.toArray() : null;
    const isSelected = (objectInfo: { index: number }) =>
      this.selectedLayerId === layerId &&
      this.selectedIndex !== null &&
      indexValues !== null &&
      indexValues[objectInfo.index] === this.selectedIndex;
    const handleHover = (info: DeckInfo) => {
      this.map.getCanvas().style.cursor = this.pickable && info.object ? 'pointer' : '';
    };
    const handleClick = (info: DeckInfo) => {
      if (!this.pickable || !info.picked) return false;
      const indexValue = this.rowIndex(info);
      if (indexValue === null) return false;
      const isSameSelection = this.selectedLayerId === layerId && this.selectedIndex === indexValue;
      this.selectedLayerId = isSameSelection ? null : layerId;
      this.selectedIndex = isSameSelection ? null : indexValue;
      const coordinate =
        info.coordinate && info.coordinate.length >= 2
          ? ([info.coordinate[0], info.coordinate[1]] as [number, number])
          : null;
      this.onSelect(
        this.selectedLayerId && this.selectedIndex !== null
          ? {
              layerId: this.selectedLayerId,
              index: this.selectedIndex,
              coordinate,
            }
          : null
      );
      return true;
    };

    if (result.geometryType === 'point' || result.geometryType === 'multipoint') {
      return [
        new GeoArrowScatterplotLayer({
          id: layerKey,
          beforeId: this.getLayerBeforeId(layerId),
          data: result.table as never,
          getFillColor: (objectInfo: { index: number }) =>
            isSelected(objectInfo) ? SELECTED_FILL : NORMAL_FILL,
          getRadius: 6,
          radiusUnits: 'pixels',
          radiusMinPixels: 4,
          radiusMaxPixels: 12,
          pickable: this.pickable,
          autoHighlight: this.pickable,
          highlightColor: HIGHLIGHT,
          _validate: false,
          onHover: handleHover,
          onClick: handleClick,
          updateTriggers: {
            getFillColor: [this.selectedLayerId, this.selectedIndex],
          },
        }),
      ];
    }

    if (result.geometryType === 'linestring' || result.geometryType === 'multilinestring') {
      return [
        new GeoArrowPathLayer({
          id: layerKey,
          beforeId: this.getLayerBeforeId(layerId),
          data: result.table as never,
          getColor: (objectInfo: { index: number }) => (isSelected(objectInfo) ? SELECTED_LINE : NORMAL_LINE),
          getWidth: 2.5,
          widthUnits: 'pixels',
          widthMinPixels: 1.5,
          pickable: this.pickable,
          autoHighlight: this.pickable,
          highlightColor: HIGHLIGHT,
          _validate: false,
          onHover: handleHover,
          onClick: handleClick,
          updateTriggers: {
            getColor: [this.selectedLayerId, this.selectedIndex],
          },
        }),
      ];
    }

    return [
      new GeoArrowPolygonLayer({
        id: layerKey,
        beforeId: this.getLayerBeforeId(layerId),
        data: result.table as never,
        getFillColor: (objectInfo: { index: number }) =>
          isSelected(objectInfo) ? SELECTED_FILL : NORMAL_FILL,
        getLineColor: (objectInfo: { index: number }) =>
          isSelected(objectInfo) ? SELECTED_LINE : NORMAL_LINE,
        getLineWidth: 2,
        lineWidthMinPixels: 1.5,
        pickable: this.pickable,
        autoHighlight: this.pickable,
        highlightColor: HIGHLIGHT,
        _validate: false,
        onHover: handleHover,
        onClick: handleClick,
        updateTriggers: {
          getFillColor: [this.selectedLayerId, this.selectedIndex],
          getLineColor: [this.selectedLayerId, this.selectedIndex],
        },
      }),
    ];
  }

  private getLayerBeforeId(layerId: string): string | undefined {
    return this.currentLayers.find((layer) => layer.id === layerId)?.beforeId ?? undefined;
  }
}
