declare module 'node:sqlite' {
  export class DatabaseSync {
    constructor(filename:string)
    exec(sql:string):void
    prepare(sql:string):{
      get(...values:unknown[]):Record<string,unknown>|undefined
      all(...values:unknown[]):Record<string,unknown>[]
      run(...values:unknown[]):{changes:number|bigint}
    }
  }
}
