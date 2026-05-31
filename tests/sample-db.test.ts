import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import * as duckdb from '@duckdb/duckdb-wasm/dist/duckdb-node-blocking.cjs';
import { buildResultQuery } from '../src/lib/duckdb/utils';
import type { DuckDBColumn } from '../src/lib/core/types';

const samplePath = 'data/nyc_data.db';
const describeSample = existsSync(samplePath) ? describe : describe.skip;

const bundles = {
  mvp: {
    mainModule: 'node_modules/@duckdb/duckdb-wasm/dist/duckdb-mvp.wasm',
    mainWorker: 'node_modules/@duckdb/duckdb-wasm/dist/duckdb-node-mvp.worker.cjs',
  },
  eh: {
    mainModule: 'node_modules/@duckdb/duckdb-wasm/dist/duckdb-eh.wasm',
    mainWorker: 'node_modules/@duckdb/duckdb-wasm/dist/duckdb-node-eh.worker.cjs',
  },
};

describeSample('local NYC DuckDB sample database', () => {
  it('exposes spatial sample tables and produces WKB rows', async () => {
    const db = await duckdb.createDuckDB(bundles, new duckdb.VoidLogger(), duckdb.NODE_RUNTIME);
    await db.instantiate();
    db.open({});
    const connection = db.connect();
    db.registerFileBuffer('nyc_data.db', new Uint8Array(readFileSync(samplePath)));
    connection.query(`ATTACH 'nyc_data.db' AS data (READ_ONLY)`);

    const tables = connection
      .query(
        `SELECT schema_name, table_name
         FROM duckdb_tables()
         WHERE database_name = 'data'
         ORDER BY schema_name, table_name`
      )
      .toArray()
      .map((row) => `${row.schema_name}.${row.table_name}`);

    expect(tables).toContain('main.nyc_neighborhoods');
    expect(tables).toContain('main.nyc_subway_stations');

    const schema: DuckDBColumn[] = [
      { name: 'BORONAME', type: 'VARCHAR', nullable: true },
      { name: 'NAME', type: 'VARCHAR', nullable: true },
      { name: 'geom', type: 'GEOMETRY', nullable: true },
    ];
    const sql = `SELECT BORONAME, NAME, geom
FROM data.main.nyc_neighborhoods
LIMIT 5`;
    const result = connection.query(
      buildResultQuery({
        sql,
        schema,
        geometryColumn: 'geom',
        geometryFormat: 'geometry',
        limit: 5,
      })
    );

    expect(result.numRows).toBe(5);
    expect(result.getChild('__wkb')?.get(0)).toBeInstanceOf(Uint8Array);
  });
});
