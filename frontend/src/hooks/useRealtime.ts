import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { API_ORIGIN } from "@/services/api";
import { supabase } from "@/services/supabase";
import type { Notification } from "@/types";
import { playMessageTone } from "@/utils/sound";

type NotificationCache = { items: Notification[]; unread: number };

/** Opens the FastAPI WebSocket and turns pushed events into toasts, sounds, badge counts and cache refreshes. */
export function useRealtime(enabled: boolean) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const routerLocation = useLocation();
  // read through refs so route changes never tear down and reopen the socket
  const where = useRef(routerLocation);
  where.current = routerLocation;
  const go = useRef(navigate);
  go.current = navigate;

  useEffect(() => {
    if (!enabled) return;
    let ws: WebSocket | null = null, timer: number | undefined, ping: number | undefined, closed = false, tries = 0;

    const onNotification = (n: Notification) => {
      // bump the bell immediately instead of waiting for the next refetch
      qc.setQueryData<NotificationCache>(["notifications"], (old) =>
        old && !old.items.some((i) => i.id === n.id) ? { items: [n, ...old.items], unread: old.unread + 1 } : old);
      qc.invalidateQueries({ queryKey: ["notifications"] });
      qc.invalidateQueries({ queryKey: ["tasks"] });
      qc.invalidateQueries({ queryKey: ["milestones"] });

      if (n.type === "dm") {
        const watching = where.current.pathname === "/messages" && n.link === `/messages${where.current.search}`;
        if (watching) return;      // the open conversation already shows it
        playMessageTone();
        toast(n.title, {
          description: n.body ?? undefined,
          action: n.link ? { label: "Open", onClick: () => go.current(n.link!) } : undefined,
        });
      } else {
        toast(n.title, { description: n.body ?? undefined });
      }
    };

    const connect = async () => {
      const { data } = await supabase.auth.getSession();
      if (!data.session || closed) return;
      const base = API_ORIGIN || `${location.protocol}//${location.host}`;
      ws = new WebSocket(`${base.replace(/^http/, "ws")}/api/v1/ws?token=${data.session.access_token}`);
      ws.onopen = () => { tries = 0; ping = window.setInterval(() => ws?.readyState === 1 && ws.send("ping"), 25000); };
      ws.onmessage = (e) => {
        try {
          const msg = JSON.parse(e.data);
          if (msg.event === "notification") onNotification(msg.data as Notification);
          else if (msg.event === "dm") {
            qc.invalidateQueries({ queryKey: ["dm"] });
            qc.invalidateQueries({ queryKey: ["conversations"] });
            qc.invalidateQueries({ queryKey: ["dashboard-student"] });
          }
        } catch { /* ignore malformed frames such as keep-alive replies */ }
      };
      ws.onclose = () => {
        window.clearInterval(ping);
        if (!closed) timer = window.setTimeout(connect, Math.min(30000, 1000 * 2 ** tries++));
      };
    };
    connect();
    return () => { closed = true; window.clearTimeout(timer); window.clearInterval(ping); ws?.close(); };
  }, [enabled, qc]);
}
