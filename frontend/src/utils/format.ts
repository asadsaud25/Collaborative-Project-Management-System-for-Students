import { format, formatDistanceToNowStrict, isPast, parseISO } from "date-fns";
export const fmtDate = (d?: string | null) => (d ? format(parseISO(d), "d MMM yyyy") : "—");
export const fmtDateTime = (d?: string | null) => (d ? format(parseISO(d), "d MMM, HH:mm") : "—");
export const ago = (d: string) => formatDistanceToNowStrict(parseISO(d), { addSuffix: true });
export const isOverdue = (d?: string | null) => !!d && isPast(parseISO(d + (d.length === 10 ? "T23:59:59" : "")));
export const initials = (name?: string) => (name || "?").split(" ").map((p) => p[0]).slice(0, 2).join("").toUpperCase();
export const label = (s: string) => s.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase());
export const csvToList = (s: string) => s.split(",").map((x) => x.trim()).filter(Boolean);
