import { useQuery } from "@tanstack/react-query";
import { api } from "@/services/api";
import type { Member, Milestone, Progress, Task } from "@/types";

export const useMembers = (pid: string) => useQuery({ queryKey: ["members", pid], queryFn: async () => (await api.get<Member[]>(`/projects/${pid}/members`)).data });
export const useTasks = (pid: string) => useQuery({ queryKey: ["tasks", pid], queryFn: async () => (await api.get<Task[]>(`/projects/${pid}/tasks`)).data });
export const useMilestones = (pid: string) => useQuery({ queryKey: ["milestones", pid], queryFn: async () => (await api.get<{ milestones: Milestone[]; progress: Progress }>(`/projects/${pid}/milestones`)).data });
