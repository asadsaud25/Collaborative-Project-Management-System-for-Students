export type AppRole = "admin" | "supervisor" | "student";
export type TaskStatus = "todo" | "in_progress" | "in_review" | "completed";
export type ProjectRole = "admin" | "owner" | "member" | "supervisor";
export type Priority = "low" | "medium" | "high" | "urgent";

export interface Profile {
  id: string; email: string; full_name: string; avatar_url?: string | null; role: AppRole;
  university?: string | null; course?: string | null; semester?: number | null;
  skills: string[]; interests?: string[]; availability?: string | null; github_username?: string | null;
  profile_complete?: boolean; is_suspended?: boolean;
}
export type MiniProfile = Pick<Profile, "id" | "full_name" | "email"> & Partial<Profile>;
export interface Project {
  id: string; name: string; description: string; course?: string | null; status: string; visibility: "public" | "private";
  owner_id: string; supervisor_id?: string | null; required_skills: string[]; start_date?: string | null; due_date?: string | null;
  github_owner?: string | null; github_repo?: string | null; github_connected: boolean; github_auth_type?: string | null;
  progress?: number; my_role?: ProjectRole; owner?: MiniProfile | null; supervisor?: MiniProfile | null;
}
export interface Member { id: string; user_id: string; role: string; joined_at: string; profile: MiniProfile | null }
export interface Task {
  id: string; project_id: string; milestone_id?: string | null; title: string; description: string; status: TaskStatus; priority: Priority;
  start_date?: string | null; deadline?: string | null; assignee_ids: string[]; depends_on: string[]; project_name?: string;
}
export interface Milestone {
  id: string; project_id: string; title: string; description?: string | null; completion_criteria?: string | null; weight: number;
  status: "planned" | "in_progress" | "in_review" | "approved" | "changes_requested"; start_date?: string | null; end_date?: string | null;
  assignee_id?: string | null; submission_note?: string | null; submission_commit_shas: string[];
  review_note?: string | null; submitted_at?: string | null; project_name?: string; assignee?: MiniProfile | null;
}
export interface Progress {
  overall_percent: number; planned_weight: number; unallocated_weight: number; approved_weight: number;
  per_user: Record<string, { assigned_weight: number; completed_weight: number; percent: number }>;
}
export interface Risk { kind: string; severity: "low" | "medium" | "high"; title: string; entity_id?: string; project_name?: string }
export interface Commit { sha: string; short_sha: string; message: string; author: string; date: string | null; url: string | null; project_name?: string }
export interface Notification { id: string; type: string; title: string; body?: string | null; link?: string | null; read_at?: string | null; created_at: string }
export interface DM { id: string; sender_id: string; recipient_id: string; body: string; kind: string; created_at: string; read_at?: string | null }
export interface Meeting {
  id: string; title: string; description?: string | null; starts_at: string; duration_min: number; is_instant: boolean;
  meet_link?: string | null; link_provider?: string | null; participant_ids: string[];
}
export interface ActivityItem { id: string; action: string; entity_type: string; created_at: string; actor?: MiniProfile | null; meta?: Record<string, unknown>; project_id?: string }
