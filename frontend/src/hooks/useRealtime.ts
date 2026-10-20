import { useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { toast } from "sonner";
import { API_ORIGIN } from "@/services/api";
import { supabase } from "@/services/supabase";

/** Opens the FastAPI WebSocket and turns pushed events into toasts + cache refreshes. */
export function useRealtime(enabled: boolean) {
  const qc = useQueryClient();
  useEffect(() => {
    if (!enabled) return;
    let ws: WebSocket | null = null, timer: number | undefined, ping: number | undefined, closed = false, tries = 0;

    const connect = async () => {
      const { data } = await supabase.auth.getSession();
      if (!data.session || closed) return;
      const base = API_ORIGIN || `${location.protocol}//${location.host}`;
      ws = new WebSocket(`${base.replace(/^http/, "ws")}/api/v1/ws?token=${data.session.access_token}`);
      ws.onopen = () => { tries = 0; ping = window.setInterval(() => ws?.readyState === 1 && ws.send("ping"), 25000); };
      ws.onmessage = (e) => {
        const msg = JSON.parse(e.data);
        if (msg.event === "notification") {
          toast(msg.data.title, { description: msg.data.body ?? undefined });
          qc.invalidateQueries({ queryKey: ["notifications"] });
          qc.invalidateQueries({ queryKey: ["tasks"] });
          qc.invalidateQueries({ queryKey: ["milestones"] });
        } else if (msg.event === "dm") {
          qc.invalidateQueries({ queryKey: ["dm"] });
          qc.invalidateQueries({ queryKey: ["conversations"] });
          qc.invalidateQueries({ queryKey: ["dashboard-student"] });
        }
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
