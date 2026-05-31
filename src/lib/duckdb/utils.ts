import type { DuckDBColumn, DuckDBGeometryFormat } from '../core/types';

export function escapeSource(source: string): string {
  return source.replace(/'/g, "''");
}

export function quoteIdentifier(identifier: string): string {
  return `"${identifier.replace(/"/g, '""')}"`;
}

export function cleanSql(sql: string): string {
  return sql.trim().replace(/;+$/, '').trim();
}

export function formatDisplayValue(value: unknown): unknown {
  if (value === null || value === undefined) return value;
  if (ArrayBuffer.isView(value)) return `[binary ${value.byteLength}B]`;
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'bigint') return value.toString();
  if (typeof value === 'object') {
    try {
      return JSON.stringify(value);
    } catch {
      return String(value);
    }
  }
  return value;
}

export function normalizeBinary(value: unknown): Uint8Array | null {
  if (value instanceof Uint8Array) return value;
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  if (ArrayBuffer.isView(value)) {
    return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  }
  return null;
}

export function detectGeometryFormat(
  column: DuckDBColumn | undefined,
  requestedFormat: DuckDBGeometryFormat
): Exclude<DuckDBGeometryFormat, 'auto'> | null {
  if (!column) return null;
  if (requestedFormat !== 'auto') return requestedFormat;

  const type = column.type.toUpperCase();
  const name = column.name.toLowerCase();
  if (type.startsWith('GEOMETRY')) return 'geometry';
  if (type.includes('BLOB') || type.includes('BINARY') || type.includes('WKB')) return 'wkb';
  if (type.includes('VARCHAR') || type.includes('TEXT') || type.includes('STRING')) {
    if (name.includes('wkt') || name.includes('geom') || name.includes('geometry')) return 'wkt';
  }
  return null;
}

export function detectGeometryColumn(
  schema: DuckDBColumn[],
  requestedColumn?: string,
  requestedFormat: DuckDBGeometryFormat = 'auto'
): string | null {
  if (requestedColumn && schema.some((column) => column.name === requestedColumn)) {
    return requestedColumn;
  }

  const ranked = schema
    .map((column) => {
      const type = column.type.toUpperCase();
      const name = column.name.toLowerCase();
      let score = 0;
      if (type.startsWith('GEOMETRY')) score += 100;
      if (name === 'geometry' || name === 'geom') score += 60;
      if (name.includes('wkb') || name.includes('wkt')) score += 50;
      if (type.includes('BLOB') || type.includes('BINARY')) score += 20;
      if (type.includes('VARCHAR') || type.includes('TEXT') || type.includes('STRING')) score += 10;
      if (detectGeometryFormat(column, requestedFormat)) score += 5;
      return { column, score };
    })
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score);

  return ranked[0]?.column.name ?? null;
}

export function buildResultQuery({
  sql,
  schema,
  geometryColumn,
  geometryFormat,
  limit,
}: {
  sql: string;
  schema: DuckDBColumn[];
  geometryColumn: string;
  geometryFormat: Exclude<DuckDBGeometryFormat, 'auto'>;
  limit: number;
}): string {
  const sourceSql = cleanSql(sql);
  const selectedColumns = schema
    .filter((column) => column.name !== geometryColumn && !column.name.startsWith('__'))
    .map((column) => `q.${quoteIdentifier(column.name)}`);
  const displaySelect = selectedColumns.length ? `${selectedColumns.join(', ')}, ` : '';
  const geometry = `q.${quoteIdentifier(geometryColumn)}`;
  const wkbExpression =
    geometryFormat === 'geometry'
      ? `ST_AsWKB(${geometry})`
      : geometryFormat === 'wkt'
        ? `ST_AsWKB(ST_GeomFromText(${geometry}))`
        : `ST_AsWKB(ST_GeomFromWKB(${geometry}))`;

  return `SELECT ${displaySelect}${wkbExpression} AS __wkb FROM (${sourceSql}) AS q LIMIT ${limit}`;
}

export function buildTableQuery({
  tableName,
  schema,
  geometryColumn,
  sourceCrs,
  targetCrs,
  limit,
}: {
  tableName: string;
  schema: DuckDBColumn[];
  geometryColumn: string;
  sourceCrs?: string;
  targetCrs?: string;
  limit: number;
}): string {
  const selectedColumns = schema
    .filter((column) => column.name !== geometryColumn)
    .map((column) => quoteIdentifier(column.name));
  const source = sourceCrs?.trim();
  const target = targetCrs?.trim() || 'EPSG:4326';
  const geometryExpression =
    source && source !== target
      ? `ST_Transform(${quoteIdentifier(geometryColumn)}, '${escapeSource(source)}', '${escapeSource(target)}', true) AS ${quoteIdentifier(geometryColumn)}`
      : quoteIdentifier(geometryColumn);
  return `SELECT ${[...selectedColumns, geometryExpression].join(', ')}\nFROM ${tableName}\nLIMIT ${limit}`;
}

export function buildCountQuery(sql: string): string {
  return `SELECT COUNT(*) AS cnt FROM (${cleanSql(sql)}) AS q`;
}

export function friendlyError(error: unknown): { title: string; detail: string; suggestion: string | null } {
  const message = error instanceof Error ? error.message : String(error);

  if (/malloc.*failed|out of memory|memory allocation/i.test(message)) {
    return {
      title: 'Out of memory',
      detail: 'The browser ran out of memory while processing this database or query.',
      suggestion: 'Try a smaller database, a tighter WHERE clause, or a lower row limit.',
    };
  }
  if (/fetch|networkerror|failed to fetch|ERR_CONNECTION/i.test(message)) {
    return {
      title: 'Network error',
      detail: 'Could not download the database file.',
      suggestion: 'Check the URL, CORS settings, and network connection.',
    };
  }
  if (/CORS|blocked by|access-control-allow-origin/i.test(message)) {
    return {
      title: 'Blocked by CORS',
      detail: 'The remote server does not allow browser requests.',
      suggestion: 'Use a CORS-enabled host or load the database locally.',
    };
  }
  if (/database.*does not exist|not a database|invalid database|IO Error/i.test(message)) {
    return {
      title: 'Invalid database',
      detail: 'DuckDB could not open the selected database file.',
      suggestion: 'Load a valid .duckdb or .db file.',
    };
  }
  if (/spatial|ST_/i.test(message)) {
    return {
      title: 'Spatial query error',
      detail: message,
      suggestion: 'Check the geometry column and format settings.',
    };
  }
  if (/Parser Error|Binder Error|Catalog Error/i.test(message)) {
    return {
      title: 'SQL error',
      detail: message,
      suggestion: 'Check the query text, schema names, and table names.',
    };
  }

  return {
    title: 'Error',
    detail: message,
    suggestion: null,
  };
}
