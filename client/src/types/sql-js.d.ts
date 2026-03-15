declare module 'sql.js' {
  interface Database {
    run(sql: string, params?: any[]): Database
    exec(sql: string): QueryExecResult[]
    export(): Uint8Array
    close(): void
    getRowsModified(): number
  }

  interface QueryExecResult {
    columns: string[]
    values: any[][]
  }

  interface SqlJsStatic {
    Database: new (data?: ArrayLike<number>) => Database
  }

  interface InitSqlJsConfig {
    locateFile?: (file: string) => string
  }

  export default function initSqlJs(config?: InitSqlJsConfig): Promise<SqlJsStatic>
  export type { Database, SqlJsStatic, QueryExecResult }
}
