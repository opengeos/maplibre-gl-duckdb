import type { AsyncDuckDB, AsyncDuckDBConnection, DuckDBBundles } from '@duckdb/duckdb-wasm';
import type { Table } from 'apache-arrow';
import type { DuckDBColumn, DuckDBTable } from '../core/types';
import { DATABASE_SCHEMA_ALIAS } from './constants';
import { cleanSql, escapeSource, quoteIdentifier } from './utils';

const DEFAULT_EXTENSION_REPOSITORY = 'https://extensions.duckdb.org';

export interface DuckDBSourceConfig {
  bundles?: DuckDBBundles;
  extensionRepository?: string;
}

let database: AsyncDuckDB | null = null;
let connection: AsyncDuckDBConnection | null = null;
let initPromise: Promise<void> | null = null;
let lastProgressMessage: string | null = null;
const progressListeners = new Set<(message: string) => void>();

let customBundles: DuckDBBundles | null = null;
let extensionRepository = DEFAULT_EXTENSION_REPOSITORY;
let activeDatabaseFile: string | null = null;

export function configureDuckDB(config: DuckDBSourceConfig): void {
  if (config.bundles !== undefined) {
    customBundles = config.bundles;
  }
  if (config.extensionRepository !== undefined) {
    extensionRepository = config.extensionRepository.replace(/\/+$/, '') || DEFAULT_EXTENSION_REPOSITORY;
  }
}

function emitProgress(message: string): void {
  lastProgressMessage = message;
  progressListeners.forEach((listener) => listener(message));
}

export async function initDB(onProgress?: (message: string) => void): Promise<void> {
  if (database && connection) return;

  if (onProgress) {
    progressListeners.add(onProgress);
    if (lastProgressMessage) onProgress(lastProgressMessage);
  }

  if (initPromise) {
    await initPromise;
    return;
  }

  initPromise = (async () => {
    emitProgress('Loading DuckDB...');
    const duckdb = await import('@duckdb/duckdb-wasm');
    const bundle = await duckdb.selectBundle(customBundles ?? duckdb.getJsDelivrBundles());
    const workerUrl = URL.createObjectURL(
      new Blob([`importScripts("${bundle.mainWorker}");`], { type: 'text/javascript' })
    );
    const worker = new Worker(workerUrl);
    const logger = new duckdb.ConsoleLogger(duckdb.LogLevel.WARNING);
    database = new duckdb.AsyncDuckDB(logger, worker);

    emitProgress('Starting DuckDB...');
    await database.instantiate(bundle.mainModule, bundle.pthreadWorker);
    URL.revokeObjectURL(workerUrl);
    await database.open({});

    emitProgress('Opening database connection...');
    connection = await database.connect();

    emitProgress('Loading spatial extension...');
    await connection.query('SELECT * FROM duckdb_coordinate_systems()');
    const versionResult = await connection.query('SELECT version() AS version');
    const duckdbVersion = String(versionResult.toArray()[0].version);
    const extensionRepo = `${extensionRepository}/${duckdbVersion}/wasm_eh`;
    await connection.query(`LOAD '${extensionRepo}/spatial.duckdb_extension.wasm'`);
    progressListeners.clear();
  })();

  await initPromise;
}

export async function getDB(): Promise<AsyncDuckDB> {
  if (!database) await initDB();
  return database!;
}

export async function query(sql: string): Promise<Table> {
  if (!connection) await initDB();
  const result = await connection!.query(sql);
  return result as unknown as Table;
}

export async function registerLocalDatabase(file: File, virtualName: string): Promise<void> {
  const duckdb = await import('@duckdb/duckdb-wasm');
  const db = await getDB();
  try {
    await db.registerFileHandle(virtualName, file, duckdb.DuckDBDataProtocol.BROWSER_FILEREADER, true);
  } catch {
    const buffer = await file.arrayBuffer();
    await db.registerFileBuffer(virtualName, new Uint8Array(buffer));
  }
}

export async function registerRemoteDatabase(url: string, virtualName: string): Promise<void> {
  const duckdb = await import('@duckdb/duckdb-wasm');
  const db = await getDB();
  await db.registerFileURL(virtualName, url, duckdb.DuckDBDataProtocol.HTTP, true);
}

export async function dropFile(name: string): Promise<void> {
  const db = await getDB();
  try {
    await db.dropFile(name);
  } catch {
    // DuckDB throws when a file is already absent. Cleanup can ignore that.
  }
}

export async function attachDatabase(virtualName: string): Promise<void> {
  if (!connection) await initDB();
  if (activeDatabaseFile) {
    try {
      await connection!.query(`DETACH ${quoteIdentifier(DATABASE_SCHEMA_ALIAS)}`);
    } catch {
      // The schema may already be detached after a previous failed load.
    }
  }
  await connection!.query(
    `ATTACH '${escapeSource(virtualName)}' AS ${quoteIdentifier(DATABASE_SCHEMA_ALIAS)} (READ_ONLY)`
  );
  activeDatabaseFile = virtualName;
}

export async function detachDatabase(): Promise<void> {
  if (!connection || !activeDatabaseFile) return;
  try {
    await connection.query(`DETACH ${quoteIdentifier(DATABASE_SCHEMA_ALIAS)}`);
  } finally {
    activeDatabaseFile = null;
  }
}

export async function getQuerySchema(sql: string): Promise<DuckDBColumn[]> {
  const result = await query(`DESCRIBE SELECT * FROM (${cleanSql(sql)}) AS q`);
  return result.toArray().map((row) => ({
    name: String(row.column_name),
    type: String(row.column_type),
    nullable: String(row.null) === 'YES',
  }));
}

export async function getTableSchema(qualifiedName: string): Promise<DuckDBColumn[]> {
  const result = await query(`DESCRIBE SELECT * FROM ${qualifiedName}`);
  return result.toArray().map((row) => ({
    name: String(row.column_name),
    type: String(row.column_type),
    nullable: String(row.null) === 'YES',
  }));
}

export async function listTables(): Promise<DuckDBTable[]> {
  const result = await query(
    `SELECT database_name, schema_name, table_name
     FROM duckdb_tables()
     WHERE database_name = '${DATABASE_SCHEMA_ALIAS}'
     ORDER BY schema_name, table_name`
  );
  return result.toArray().map((row) => {
    const databaseName = String(row.database_name);
    const schemaName = String(row.schema_name);
    const tableName = String(row.table_name);
    return {
      databaseName,
      schemaName,
      tableName,
      qualifiedName: `${quoteIdentifier(databaseName)}.${quoteIdentifier(schemaName)}.${quoteIdentifier(tableName)}`,
      displayName: `${schemaName}.${tableName}`,
    };
  });
}
