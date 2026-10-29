import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { Button, Dialog, Field, Input } from "@/components/ui";
import { api, toastError } from "@/services/api";
import type { Project } from "@/types";

/** Lets the project lead (or an admin) assign a supervisor after the project exists, or replace the current one. */
export default function AssignSupervisorDialog({ project, onClose }: { project: Project; onClose: () => void }) {
  const qc = useQueryClient();
  const [email, setEmail] = useState("");
  const changing = !!project.supervisor;
  const assign = useMutation({
    mutationFn: async () => (await api.post<Project>(`/projects/${project.id}/assign-supervisor`, { supervisor_email: email.trim() })).data,
    onSuccess: (p) => {
      toast.success(`${p.supervisor?.full_name ?? "Supervisor"} is now the supervisor of ${project.name}.`);
      ["project", "overview", "members", "projects"].forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
      onClose();
    },
    onError: toastError,
  });
  return (
    <Dialog open onClose={onClose} title={changing ? "Change supervisor" : "Assign a supervisor"}
      description={changing ? `${project.supervisor!.full_name} is the current supervisor. They will lose access when you replace them.` : "Supervisors can view the project, comment and react. They can't change tasks, milestones or meetings."}>
      <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); if (email.trim()) assign.mutate(); }}>
        <Field label="Supervisor's email" hint="They must already be registered with the Supervisor role."><Input type="email" required autoFocus value={email} onChange={(e) => setEmail(e.target.value)} placeholder="supervisor@university.edu" /></Field>
        <div className="flex justify-end gap-2"><Button type="button" variant="ghost" onClick={onClose}>Cancel</Button><Button type="submit" loading={assign.isPending}>{changing ? "Change supervisor" : "Assign supervisor"}</Button></div>
      </form>
    </Dialog>
  );
}
