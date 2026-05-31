import { describe, expect, it } from 'vitest';
import {
  buildCountQuery,
  buildResultQuery,
  buildTableQuery,
  cleanSql,
  detectGeometryColumn,
  detectGeometryFormat,
  escapeSource,
  friendlyError,
  quoteIdentifier,
} from '../src/lib/duckdb/utils';
import type { DuckDBColumn } from '../src/lib/core/types';

const schema: DuckDBColumn[] = [
  { name: 'id', type: 'BIGINT', nullable: false },
  { name: 'name', type: 'VARCHAR', nullable: true },
  { name: 'geom', type: 'GEOMETRY', nullable: true },
];

describe('DuckDB SQL utility functions', () => {
  it('escapes SQL literals and quotes identifiers', () => {
    expect(escapeSource("Bob's data.duckdb")).toBe("Bob''s data.duckdb");
    expect(quoteIdentifier('weird"name')).toBe('"weird""name"');
  });

  it('cleans trailing semicolons', () => {
    expect(cleanSql('SELECT 1;;;')).toBe('SELECT 1');
  });

  it('detects geometry columns and formats', () => {
    expect(detectGeometryColumn(schema)).toBe('geom');
    expect(detectGeometryFormat(schema[2], 'auto')).toBe('geometry');
    expect(detectGeometryFormat({ name: 'shape_wkb', type: 'BLOB', nullable: true }, 'auto')).toBe('wkb');
    expect(detectGeometryFormat({ name: 'shape_wkt', type: 'VARCHAR', nullable: true }, 'auto')).toBe('wkt');
  });

  it('builds count and render queries', () => {
    const sql = 'SELECT id, name, geom FROM data.main.features;';
    expect(buildCountQuery(sql)).toBe('SELECT COUNT(*) AS cnt FROM (SELECT id, name, geom FROM data.main.features) AS q');

    const renderSql = buildResultQuery({
      sql,
      schema,
      geometryColumn: 'geom',
      geometryFormat: 'geometry',
      limit: 100,
    });

    expect(renderSql).toContain('q."id"');
    expect(renderSql).toContain('q."name"');
    expect(renderSql).toContain('ST_AsWKB(q."geom") AS __wkb');
    expect(renderSql).toContain('LIMIT 100');
  });

  it('builds table queries with optional CRS transforms', () => {
    const tableSql = buildTableQuery({
      tableName: '"data"."main"."nyc_neighborhoods"',
      schema,
      geometryColumn: 'geom',
      sourceCrs: 'EPSG:32618',
      targetCrs: 'EPSG:4326',
      limit: 1000,
    });

    expect(tableSql).toContain('"id"');
    expect(tableSql).toContain('"name"');
    expect(tableSql).toContain('ST_Transform("geom", \'EPSG:32618\', \'EPSG:4326\', true) AS "geom"');
    expect(tableSql).toContain('FROM "data"."main"."nyc_neighborhoods"');
  });

  it('maps common failures to friendly errors', () => {
    expect(friendlyError(new Error('Failed to fetch')).title).toBe('Network error');
    expect(friendlyError(new Error('Parser Error: syntax error')).title).toBe('SQL error');
    expect(friendlyError(new Error('Out of memory')).title).toBe('Out of memory');
  });
});
