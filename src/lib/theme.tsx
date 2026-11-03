// Light and dark themes. Dark is the default look of Gaia; the choice is saved in this browser.
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

export type Theme = "dark" | "light";

export const THEME_STORE = "gaia-theme";

/** Runs in <head> before first paint so a saved light theme never flashes dark. */
export const THEME_INIT_SCRIPT = `try{if(localStorage.getItem("${THEME_STORE}")==="light"){document.documentElement.classList.remove("dark")}}catch(e){}`;

interface ThemeApi {
  theme: Theme;
  setTheme: (theme: Theme) => void;
  toggle: () => void;
}

const ThemeContext = createContext<ThemeApi | null>(null);

export function ThemeProvider({
  children,
  initial = "dark",
}: {
  children: ReactNode;
  initial?: Theme;
}) {
  const [theme, setThemeState] = useState<Theme>(initial);

  // Adopt whatever the startup script applied, after mount so server and client markup match.
  useEffect(() => {
    setThemeState(document.documentElement.classList.contains("dark") ? "dark" : "light");
  }, []);

  const setTheme = useCallback((next: Theme) => {
    setThemeState(next);
    document.documentElement.classList.toggle("dark", next === "dark");
    try {
      localStorage.setItem(THEME_STORE, next);
    } catch {
      /* storage unavailable: the theme still applies for this visit */
    }
  }, []);

  const value = useMemo<ThemeApi>(
    () => ({ theme, setTheme, toggle: () => setTheme(theme === "dark" ? "light" : "dark") }),
    [theme, setTheme],
  );
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeApi {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error("useTheme must be used inside <ThemeProvider>");
  return ctx;
}
