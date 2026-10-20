import type { Session } from "@supabase/supabase-js";
import { create } from "zustand";
import { api } from "@/services/api";
import { supabase } from "@/services/supabase";
import type { Profile } from "@/types";

interface AuthState {
  session: Session | null;
  profile: Profile | null;
  loading: boolean;
  init: () => Promise<void>;
  refreshProfile: () => Promise<void>;
  signOut: () => Promise<void>;
}

let started = false;

/** Global auth state: Supabase session + CPMS profile (role, skills, ...). */
export const useAuth = create<AuthState>((set, get) => ({
  session: null, profile: null, loading: true,
  async refreshProfile() {
    try {
      const { data } = await api.get<Profile>("/auth/me");
      set({ profile: data });
    } catch {
      set({ profile: null });
    }
  },
  async init() {
    if (started) return;
    started = true;
    const { data } = await supabase.auth.getSession();
    set({ session: data.session });
    if (data.session) await afterLogin(get().refreshProfile);
    set({ loading: false });
    supabase.auth.onAuthStateChange(async (event, session) => {
      set({ session });
      if (!session) return set({ profile: null });
      if (event === "SIGNED_IN") await afterLogin(get().refreshProfile);
    });
  },
  async signOut() {
    await supabase.auth.signOut();
    set({ session: null, profile: null });
  },
}));

/** Joins the user to any project they were invited to (matched by email), then loads their profile. */
async function afterLogin(refresh: () => Promise<void>) {
  try { await api.post("/invites/claim"); } catch { /* not fatal */ }
  await refresh();
}
