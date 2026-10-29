import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Download, FileText, Upload } from "lucide-react";
import { useRef } from "react";
import { toast } from "sonner";
import { Button, Card, Empty, PageLoader } from "@/components/ui";
import { api, toastError } from "@/services/api";

/** Project file uploads. Every upload, replacement and download is written to the file contribution log. */
export default function Files({ pid, canUpload = true }: { pid: string; canUpload?: boolean }) {
  const qc = useQueryClient(); const input = useRef<HTMLInputElement>(null);
  const { data, isLoading } = useQuery({ queryKey: ["files", pid], queryFn: async () => (await api.get<{ name: string; size?: number; updated_at?: string }[]>(`/projects/${pid}/files`)).data });
  const up = useMutation({ mutationFn: async (file: File) => { const fd = new FormData(); fd.append("file", file); return (await api.post(`/projects/${pid}/files`, fd)).data; },
    onSuccess: (d) => { toast.success(d.replaced ? "File replaced" : "File uploaded"); qc.invalidateQueries({ queryKey: ["files", pid] }); qc.invalidateQueries({ queryKey: ["logs", pid] }); }, onError: toastError });
  const get = async (name: string) => { try { const { data: d } = await api.get<{ url: string }>(`/projects/${pid}/files/${encodeURIComponent(name)}/url`); window.open(d.url, "_blank"); qc.invalidateQueries({ queryKey: ["logs", pid] }); } catch (e) { toastError(e); } };
  return (
    <div className="space-y-3">
      {canUpload && <div className="flex justify-end"><input ref={input} type="file" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) up.mutate(f); e.target.value = ""; }} /><Button size="sm" loading={up.isPending} onClick={() => input.current?.click()}><Upload className="h-4 w-4" />Upload file</Button></div>}
      {isLoading ? <PageLoader /> : !data?.length ? <Empty title="No files yet" hint="Upload reports, diagrams or datasets (up to 20 MB each)." /> : (
        <Card className="divide-y">{data.map((f) => <div key={f.name} className="flex items-center justify-between px-4 py-2.5"><span className="flex items-center gap-2 text-sm"><FileText className="h-4 w-4 text-muted-foreground" />{f.name}</span><Button variant="ghost" size="sm" onClick={() => get(f.name)}><Download className="h-3.5 w-3.5" />Download</Button></div>)}</Card>)}
    </div>
  );
}
