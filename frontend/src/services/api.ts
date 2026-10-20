import axios from "axios";
import { toast } from "sonner";
import { supabase } from "./supabase";

export const API_ORIGIN = (import.meta.env.VITE_API_URL as string | undefined)?.replace(/\/$/, "") ?? "";

/** Axios client for the FastAPI backend. Attaches the Supabase access token to every request. */
export const api = axios.create({ baseURL: `${API_ORIGIN}/api/v1` });

api.interceptors.request.use(async (config) => {
  const { data } = await supabase.auth.getSession();
  if (data.session) config.headers.Authorization = `Bearer ${data.session.access_token}`;
  return config;
});

/** Pull a readable message out of any thrown error. */
export function errMsg(e: unknown): string {
  if (axios.isAxiosError(e)) {
    const m = e.response?.data?.error?.message ?? e.response?.data?.detail;
    if (typeof m === "string") return m;
    if (!e.response) return "Cannot reach the server. Check your connection and that the API is running.";
  }
  return e instanceof Error ? e.message : "Something went wrong";
}

/** Show an error toast for a failed mutation. */
export const toastError = (e: unknown) => toast.error(errMsg(e));

/** Download a file from an authenticated endpoint. */
export async function download(path: string, filename: string) {
  const res = await api.get(path, { responseType: "blob" });
  const url = URL.createObjectURL(res.data);
  const a = document.createElement("a");
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}
