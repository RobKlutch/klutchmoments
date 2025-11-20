import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";
import runtimeErrorOverlay from "@replit/vite-plugin-runtime-error-modal";

export default defineConfig({
  plugins: [
    react(),
    runtimeErrorOverlay(),
    ...(process.env.NODE_ENV !== "production" &&
    process.env.REPL_ID !== undefined
      ? [
          await import("@replit/vite-plugin-cartographer").then((m) =>
            m.cartographer(),
          ),
        ]
      : []),
  ],
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "client", "src"),
      "@shared": path.resolve(import.meta.dirname, "shared"),
      "@assets": path.resolve(import.meta.dirname, "attached_assets"),
      "@radix-ui/react-accordion": path.resolve(
        import.meta.dirname,
        "shared",
        "radix-stubs",
        "accordion.tsx",
      ),
      "@radix-ui/react-alert-dialog": path.resolve(
        import.meta.dirname,
        "shared",
        "radix-stubs",
        "universal.tsx",
      ),
      "@radix-ui/react-aspect-ratio": path.resolve(
        import.meta.dirname,
        "shared",
        "radix-stubs",
        "universal.tsx",
      ),
      "@radix-ui/react-avatar": path.resolve(
        import.meta.dirname,
        "shared",
        "radix-stubs",
        "universal.tsx",
      ),
      "@radix-ui/react-checkbox": path.resolve(
        import.meta.dirname,
        "shared",
        "radix-stubs",
        "universal.tsx",
      ),
      "@radix-ui/react-collapsible": path.resolve(
        import.meta.dirname,
        "shared",
        "radix-stubs",
        "universal.tsx",
      ),
      "@radix-ui/react-context-menu": path.resolve(
        import.meta.dirname,
        "shared",
        "radix-stubs",
        "universal.tsx",
      ),
      "@radix-ui/react-dialog": path.resolve(
        import.meta.dirname,
        "shared",
        "radix-stubs",
        "universal.tsx",
      ),
      "@radix-ui/react-dropdown-menu": path.resolve(
        import.meta.dirname,
        "shared",
        "radix-stubs",
        "universal.tsx",
      ),
      "@radix-ui/react-hover-card": path.resolve(
        import.meta.dirname,
        "shared",
        "radix-stubs",
        "universal.tsx",
      ),
      "@radix-ui/react-label": path.resolve(
        import.meta.dirname,
        "shared",
        "radix-stubs",
        "universal.tsx",
      ),
      "@radix-ui/react-menubar": path.resolve(
        import.meta.dirname,
        "shared",
        "radix-stubs",
        "universal.tsx",
      ),
      "@radix-ui/react-navigation-menu": path.resolve(
        import.meta.dirname,
        "shared",
        "radix-stubs",
        "universal.tsx",
      ),
      "@radix-ui/react-popover": path.resolve(
        import.meta.dirname,
        "shared",
        "radix-stubs",
        "universal.tsx",
      ),
      "@radix-ui/react-progress": path.resolve(
        import.meta.dirname,
        "shared",
        "radix-stubs",
        "universal.tsx",
      ),
      "@radix-ui/react-radio-group": path.resolve(
        import.meta.dirname,
        "shared",
        "radix-stubs",
        "universal.tsx",
      ),
      "@radix-ui/react-scroll-area": path.resolve(
        import.meta.dirname,
        "shared",
        "radix-stubs",
        "universal.tsx",
      ),
      "@radix-ui/react-select": path.resolve(
        import.meta.dirname,
        "shared",
        "radix-stubs",
        "universal.tsx",
      ),
      "@radix-ui/react-separator": path.resolve(
        import.meta.dirname,
        "shared",
        "radix-stubs",
        "universal.tsx",
      ),
      "@radix-ui/react-slider": path.resolve(
        import.meta.dirname,
        "shared",
        "radix-stubs",
        "universal.tsx",
      ),
      "@radix-ui/react-slot": path.resolve(
        import.meta.dirname,
        "shared",
        "radix-stubs",
        "slot.tsx",
      ),
      "@radix-ui/react-switch": path.resolve(
        import.meta.dirname,
        "shared",
        "radix-stubs",
        "universal.tsx",
      ),
      "@radix-ui/react-tabs": path.resolve(
        import.meta.dirname,
        "shared",
        "radix-stubs",
        "universal.tsx",
      ),
      "@radix-ui/react-toast": path.resolve(
        import.meta.dirname,
        "shared",
        "radix-stubs",
        "universal.tsx",
      ),
      "@radix-ui/react-toggle": path.resolve(
        import.meta.dirname,
        "shared",
        "radix-stubs",
        "universal.tsx",
      ),
      "@radix-ui/react-toggle-group": path.resolve(
        import.meta.dirname,
        "shared",
        "radix-stubs",
        "universal.tsx",
      ),
      "@radix-ui/react-tooltip": path.resolve(
        import.meta.dirname,
        "shared",
        "radix-stubs",
        "universal.tsx",
      ),
      "class-variance-authority": path.resolve(
        import.meta.dirname,
        "shared",
        "stubs",
        "class-variance-authority.ts",
      ),
      clsx: path.resolve(import.meta.dirname, "shared", "stubs", "clsx.ts"),
      "tailwind-merge": path.resolve(
        import.meta.dirname,
        "shared",
        "stubs",
        "tailwind-merge.ts",
      ),
      cmdk: path.resolve(import.meta.dirname, "shared", "stubs", "cmdk.tsx"),
    },
  },
  root: path.resolve(import.meta.dirname, "client"),
  build: {
    outDir: path.resolve(import.meta.dirname, "dist"),
    emptyOutDir: true,
  },
  server: {
    fs: {
      strict: true,
      deny: ["**/.*"],
    },
  },
});
