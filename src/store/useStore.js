import { create } from "zustand";
import { setAuthToken } from "../services/api";

const THEME_KEY = "atlas_theme";
const TOKEN_KEY = "atlas_token";

const useStore = create((set) => ({
  // auth
  token: localStorage.getItem(TOKEN_KEY) || null,
  user: null,
  setToken: (token) => {
    if (token) {
      localStorage.setItem(TOKEN_KEY, token);
      setAuthToken(token);
    } else {
      localStorage.removeItem(TOKEN_KEY);
      setAuthToken("");
    }
    set({ token });
  },
  setUser: (user) => set({ user }),
  setCredits: (creditsOrFn) => set((s) => ({
    user: s.user
      ? { ...s.user, credits: typeof creditsOrFn === "function" ? creditsOrFn(s.user.credits) : creditsOrFn }
      : s.user,
  })),
  logout: () => {
    localStorage.removeItem(TOKEN_KEY);
    setAuthToken("");
    set({ token: null, user: null });
  },

  // annotation job
  videoPath: null,
  videoName: null,
  tier: "standard",
  context: "",
  setVideoPath: (videoPath) => set({
    videoPath,
    videoName: videoPath ? videoPath.split(/[\\/]/).pop() : null,
  }),
  setTier: (tier) => set({ tier }),
  setContext: (context) => set({ context }),

  // last result (for history)
  lastResult: null,
  setLastResult: (lastResult) => set({ lastResult }),

  // theme
  theme: localStorage.getItem(THEME_KEY) || "dark",
  setTheme: (theme) => {
    localStorage.setItem(THEME_KEY, theme);
    set({ theme });
  },

  // backend url
  backendUrl: "",
  setBackendUrl: (backendUrl) => set({ backendUrl }),
}));

export default useStore;
