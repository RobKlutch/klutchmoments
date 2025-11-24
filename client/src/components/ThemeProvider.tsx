// TEMPORARY FIX: Simplified ThemeProvider to bypass Vite bundling issue
// This provides a minimal implementation until the React bundling issue is resolved

type Theme = "dark" | "light" | "system";

type ThemeProviderProps = {
  children: React.ReactNode;
  defaultTheme?: Theme;
  storageKey?: string;
};

type ThemeProviderState = {
  theme: Theme;
  setTheme: (theme: Theme) => void;
};

// Simple implementation without hooks to bypass bundling issue
export function ThemeProvider({ children, defaultTheme = "light" }: ThemeProviderProps) {
  // Apply default theme on mount
  if (typeof window !== 'undefined') {
    window.document.documentElement.classList.add(defaultTheme);
  }
  
  return <>{children}</>;
}

export const useTheme = (): ThemeProviderState => {
  return {
    theme: "light",
    setTheme: (theme: Theme) => {
      if (typeof window !== 'undefined') {
        const root = window.document.documentElement;
        root.classList.remove("light", "dark");
        root.classList.add(theme);
      }
    },
  };
};