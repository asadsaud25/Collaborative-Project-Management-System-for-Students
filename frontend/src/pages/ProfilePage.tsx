import { useMutation } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { Button, Card, CardBody, Field, Input, Select } from "@/components/ui";
import { useAuth } from "@/hooks/useAuth";
import { api, toastError } from "@/services/api";
import { csvToList } from "@/utils/format";

/** Name, university, course, semester, skills and GitHub username. */
export default function ProfilePage() {
  const { profile, refreshProfile } = useAuth();
  const p = profile!;
  const [f, setF] = useState({ full_name: p.full_name, university: p.university ?? "", course: p.course ?? "", semester: p.semester ? String(p.semester) : "",
    skills: (p.skills ?? []).join(", "), interests: (p.interests ?? []).join(", "), availability: p.availability ?? "", github_username: p.github_username ?? "" });
  const save = useMutation({
    mutationFn: () => api.patch("/auth/me", { ...f, skills: csvToList(f.skills), interests: csvToList(f.interests), github_username: f.github_username.replace(/^@/, "") || null,
      university: f.university || null, course: f.course || null, semester: f.semester ? Number(f.semester) : null, availability: f.availability || null }),
    onSuccess: async () => { await refreshProfile(); toast.success("Profile saved"); }, onError: toastError,
  });
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setF({ ...f, [k]: e.target.value });
  return (
    <div className="mx-auto max-w-xl space-y-4">
      <div><h1 className="text-xl font-semibold tracking-tight">Profile</h1><p className="text-xs text-muted-foreground">{p.email} · {p.role}</p></div>
      <Card><CardBody className="space-y-3">
        <Field label="Full name"><Input value={f.full_name} onChange={set("full_name")} /></Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="University"><Input value={f.university} onChange={set("university")} placeholder="Aligarh Muslim University" /></Field>
          <Field label="Course"><Input value={f.course} onChange={set("course")} placeholder="MCA" /></Field>
          <Field label="Semester"><Select value={f.semester} onChange={set("semester")}><option value="">Not set</option>{[1, 2, 3, 4, 5, 6, 7, 8].map((n) => <option key={n} value={n}>Semester {n}</option>)}</Select></Field>
          <Field label="GitHub username" hint="Links your commits to milestone submissions."><Input value={f.github_username} onChange={set("github_username")} placeholder="octocat" /></Field>
        </div>
        <Field label="Skills" hint="Comma separated. Used for team matching."><Input value={f.skills} onChange={set("skills")} placeholder="Java, React, SQL" /></Field>
        <Field label="Interests"><Input value={f.interests} onChange={set("interests")} placeholder="Web, ML, Android" /></Field>
        <Field label="Availability"><Select value={f.availability} onChange={set("availability")}><option value="">Not set</option><option>Weekdays</option><option>Evenings</option><option>Weekends</option><option>Flexible</option></Select></Field>
        <div className="flex justify-end"><Button loading={save.isPending} onClick={() => save.mutate()}>Save changes</Button></div>
      </CardBody></Card>
    </div>
  );
}
