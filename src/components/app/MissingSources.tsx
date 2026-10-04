import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

/** Lists active-dataset references without captured text and which jurisdictions depend on them. */
export function MissingSources() {
  const q = useQuery({
    queryKey: ["missing-sources"],
    queryFn: async () => {
      const { data, error } = await supabase.from("source_documents").select("doc_id,jurisdictions,source_type,url,dataset_versions!inner(status)").eq("dataset_versions.status", "active").eq("text_available", false).order("doc_id");
      if (error) throw error;
      return data ?? [];
    },
  });
  const rows = q.data ?? [];
  const byJur = new Map<string, string[]>();
  for (const r of rows) for (const j of (r.jurisdictions ?? "Unspecified").split(";").map((x) => x.trim()).filter(Boolean)) byJur.set(j, [...(byJur.get(j) ?? []), r.doc_id]);
  return (
    <section className="paper rounded-sm p-5">
      <h2 className="text-xl">Missing legal texts ({rows.length})</h2>
      <p className="mt-1 text-sm text-muted-foreground">These references came as a link only, so no rules can be read from them. Where one is the only source for a law, that law is simply absent from the answers. To add a text, put the official wording into the package file (same 500 addresses and 87 references) and import it as a new dataset version; earlier versions are kept.</p>
      <div className="mt-3 grid gap-2 text-sm md:grid-cols-2">
        {Array.from(byJur.entries()).sort((a, b) => b[1].length - a[1].length).map(([j, ids]) => (
          <div key={j} className="flex justify-between border-b border-border/60 py-1"><span>{j}</span><span className="font-mono text-xs text-muted-foreground">{ids.join(", ")}</span></div>
        ))}
      </div>
    </section>
  );
}
