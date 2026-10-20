import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Bell } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useNotifications } from "@/components/common/NotificationBell";
import { Button, Card, Empty, PageLoader } from "@/components/ui";
import { api } from "@/services/api";
import { cn } from "@/utils/cn";
import { ago } from "@/utils/format";

export default function Notifications() {
  const { data, isLoading } = useNotifications(); const qc = useQueryClient(); const nav = useNavigate();
  const refresh = () => qc.invalidateQueries({ queryKey: ["notifications"] });
  const readAll = useMutation({ mutationFn: () => api.post("/notifications/read-all"), onSuccess: refresh });
  const readOne = useMutation({ mutationFn: (id: string) => api.post(`/notifications/${id}/read`), onSuccess: refresh });
  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <div className="flex items-center justify-between"><h1 className="text-xl font-semibold tracking-tight">Notifications</h1><Button variant="outline" size="sm" disabled={!data?.unread} onClick={() => readAll.mutate()}>Mark all read</Button></div>
      {isLoading ? <PageLoader /> : !data?.items.length ? <Empty title="You are all caught up" hint="Task assignments, reviews, meetings, join requests and deadlines show up here." /> : (
        <Card className="divide-y">{data.items.map((n) => (
          <button key={n.id} onClick={() => { if (!n.read_at) readOne.mutate(n.id); if (n.link) nav(n.link); }} className={cn("flex w-full items-start gap-3 px-4 py-3 text-left hover:bg-accent/50", !n.read_at && "bg-accent/30")}>
            <Bell className={cn("mt-0.5 h-4 w-4 shrink-0", n.read_at ? "text-muted-foreground" : "text-primary")} />
            <div className="min-w-0 flex-1"><p className={cn("text-sm", !n.read_at && "font-medium")}>{n.title}</p>{n.body && <p className="truncate text-xs text-muted-foreground">{n.body}</p>}</div>
            <span className="shrink-0 text-xs text-muted-foreground">{ago(n.created_at)}</span>
          </button>))}</Card>
      )}
    </div>
  );
}
