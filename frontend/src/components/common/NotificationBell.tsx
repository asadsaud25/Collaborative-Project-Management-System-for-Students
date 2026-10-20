import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Bell } from "lucide-react";
import { Link } from "react-router-dom";
import { api } from "@/services/api";
import type { Notification } from "@/types";

export function useNotifications() {
  return useQuery({ queryKey: ["notifications"], queryFn: async () => (await api.get<{ items: Notification[]; unread: number }>("/notifications")).data, refetchInterval: 60000 });
}

export function NotificationBell() {
  const { data } = useNotifications();
  return (
    <Link to="/notifications" data-tour="bell" className="relative grid h-8 w-8 place-items-center rounded-md hover:bg-accent" aria-label="Notifications">
      <Bell className="h-4 w-4" />
      {!!data?.unread && <span className="absolute -right-0.5 -top-0.5 grid h-4 min-w-4 place-items-center rounded-full bg-danger px-1 text-[10px] font-semibold text-white">{data.unread > 9 ? "9+" : data.unread}</span>}
    </Link>
  );
}
export const useInvalidateNotifications = () => { const qc = useQueryClient(); return () => qc.invalidateQueries({ queryKey: ["notifications"] }); };
