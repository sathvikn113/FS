import { useCallback } from "react";
import { CssBaseline } from "@mui/material";
import { ThemeProvider, createTheme, useColorScheme } from "@mui/material/styles";

const theme = createTheme({
  cssVariables: true,
  colorSchemeSelector: "data",
  colorSchemes: {
    light: {
      palette: {
        primary: { main: "#286B57", contrastText: "#FFFFFF" },
        background: { default: "#F5F6F2", paper: "#FFFFFF" },
        text: { primary: "#202823", secondary: "#59655E" },
        divider: "#DDE3DE",
        success: { main: "#286B57" },
      },
    },
    dark: {
      palette: {
        primary: { main: "#83C9A8", contrastText: "#10251B" },
        background: { default: "#111713", paper: "#1A241E" },
        text: { primary: "#EDF3EE", secondary: "#B4C0B8" },
        divider: "#34423A",
        success: { main: "#83C9A8" },
      },
    },
  },
  shape: { borderRadius: 12 },
  typography: {
    fontFamily: "Inter, system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
    h1: { fontWeight: 700, letterSpacing: "-0.04em" },
    h2: { fontWeight: 700, letterSpacing: "-0.035em" },
    h3: { fontWeight: 700, letterSpacing: "-0.03em" },
    button: { textTransform: "none", fontWeight: 600 },
  },
});

function SchemeContent({ children }) {
  const { mode, setMode } = useColorScheme();
  const activeMode = mode === "dark" ? "dark" : "light";
  const toggle = useCallback(() => {
    setMode(activeMode === "light" ? "dark" : "light");
  }, [activeMode, setMode]);

  return typeof children === "function" ? children(activeMode, toggle) : children;
}

export function ThemeWrapper({ children }) {
  return (
    <ThemeProvider
      theme={theme}
      defaultMode="light"
      modeStorageKey="mode"
      disableTransitionOnChange
    >
      <CssBaseline />
      <SchemeContent>{children}</SchemeContent>
    </ThemeProvider>
  );
}
