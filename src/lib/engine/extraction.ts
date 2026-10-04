export const PIPELINE = "extract-v2-evidence";
export const MODEL = "openai/gpt-6-luna";
const CHUNK = 40000, OVERLAP = 1500;
export function chunkCount(len: number) { return Math.max(1, Math.ceil((len - OVERLAP) / (CHUNK - OVERLAP))); }
export function chunkText(text: string, index: number) {
  if (!Number.isInteger(index) || index < 0 || index >= chunkCount(text.length)) throw new Error("Invalid chunk index");
  return text.slice(index * (CHUNK - OVERLAP), index * (CHUNK - OVERLAP) + CHUNK);
}
export function pendingChunks(length: number, runs: { chunk_index: number; chunk_count: number; status: string; pipeline_version: string; model: string; created_at?:string }[]) {
  const count = chunkCount(length);
  const latest=new Map<number,(typeof runs)[number]>();
  for(const run of runs.filter(r=>r.pipeline_version===PIPELINE && r.chunk_count===count)) {
    const previous=latest.get(run.chunk_index);
    if(!previous || (run.created_at??"") >= (previous.created_at??"")) latest.set(run.chunk_index,run);
  }
  const done = new Set(Array.from(latest.values()).filter(r=>r.status==="done").map(r=>r.chunk_index));
  return Array.from({ length: count }, (_, i) => i).filter((i) => !done.has(i));
}
