import { useMutation } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { Button, Dialog, Field, Select, Textarea } from "@/components/ui";
import { api, toastError } from "@/services/api";

const REASONS = [["harassment", "Harassment or abuse"], ["no_contribution", "Not contributing"], ["plagiarism", "Plagiarism"], ["spam", "Spam"], ["other", "Something else"]];

/** "Report user" dialog. Files a complaint that appears in the admin review queue. */
export function ReportUserModal({ userId, userName, projectId, onClose }: { userId: string; userName: string; projectId?: string; onClose: () => void }) {
  const [reason, setReason] = useState("harassment");
  const [details, setDetails] = useState("");
  const send = useMutation({
    mutationFn: () => api.post("/reports/complaints", { reported_user_id: userId, project_id: projectId ?? null, reason, details: details || null }),
    onSuccess: () => { toast.success("Report sent to the administrators"); onClose(); },
    onError: toastError,
  });
  return (
    <Dialog open onClose={onClose} title={`Report ${userName}`} description="Administrators review every report. The person is not notified.">
      <div className="space-y-3">
        <Field label="Reason"><Select value={reason} onChange={(e) => setReason(e.target.value)}>{REASONS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</Select></Field>
        <Field label="Details (optional)"><Textarea value={details} onChange={(e) => setDetails(e.target.value)} maxLength={2000} placeholder="What happened?" /></Field>
        <div className="flex justify-end gap-2"><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="destructive" loading={send.isPending} onClick={() => send.mutate()}>Send report</Button></div>
      </div>
    </Dialog>
  );
}
