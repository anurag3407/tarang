"use client";

import { createContext, useContext, type ReactNode } from "react";

/**
 * The site ships a single poster theme; `dark` is fixed on <html> in the root
 * layout. The provider stays so existing `useTheme()` callers keep working.
 */
type Theme = "dark";

interface ThemeContextType {
  theme: Theme;
}

const ThemeContext = createContext<ThemeContextType>({ theme: "dark" });

export function ThemeProvider({ children }: { children: ReactNode }) {
  return <ThemeContext.Provider value={{ theme: "dark" }}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  return useContext(ThemeContext);
}
