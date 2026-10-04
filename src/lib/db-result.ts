export function assertDb(result: { error: { message: string } | null }) {
  if (result.error) throw new Error(`Database request failed: ${result.error.message}`);
}
export function getData<T>(result: { data: T; error: { message: string } | null }): T {
  assertDb(result);
  return result.data;
}
/** Pages below Supabase's usual server row cap; never silently accepts a truncated set. */
export async function readAll<T>(query: {range(from:number,to:number):PromiseLike<{data:T[]|null;error:{message:string}|null}>}, maxRows=10000) {
  const rows:T[]=[];
  for(let offset=0;offset<=maxRows;offset+=500) {
    const page=await query.range(offset,offset+499); assertDb(page);
    rows.push(...(page.data??[]));
    if(rows.length>maxRows) throw new Error("Dataset exceeds the supported query limit; refusing a truncated report");
    if((page.data?.length??0)<500) return {data:rows,error:null};
  }
  throw new Error("Unable to establish that all rows were read");
}
