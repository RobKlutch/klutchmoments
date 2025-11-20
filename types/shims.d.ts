// Minimal ambient module declarations for environments without external typings

declare var process: { env: Record<string, string | undefined> };
declare var Buffer: any;

declare namespace NodeJS {
  type Timeout = any;
}

declare interface ImportMeta {
  env: Record<string, string | undefined>;
  url?: string;
  dirname?: string;
  hot?: any;
}

declare namespace JSX {
  interface IntrinsicElements {
    [elemName: string]: any;
  }
  interface IntrinsicAttributes {
    key?: any;
  }
  type Element = any;
}

// React runtime shims
declare module "react" {
  export type FC<P = any> = (props: P & { children?: any }) => any;
  export type ReactNode = any;
  export type Dispatch<A = any> = (value: A) => void;
  export type SetStateAction<S> = S | ((prev: S) => S);
  export type ComponentPropsWithoutRef<T> = any;
  export type ElementRef<T> = any;
  export type RefObject<T> = { current: T | null };
  export type MutableRefObject<T> = { current: T };
  export type PropsWithChildren<P = any> = P & { children?: any };
  export type ComponentProps<T = any> = any;
  export type HTMLAttributes<T = any> = any;
  export type CSSProperties = any;
  export function useState<S = any>(initial: S | (() => S)): [S, Dispatch<SetStateAction<S>>];
  export function useEffect(effect: any, deps?: any[]): void;
  export function useLayoutEffect(effect: any, deps?: any[]): void;
  export function useMemo<T = any>(factory: () => T, deps?: any[]): T;
  export function useCallback<T extends (...args: any[]) => any>(callback: T, deps?: any[]): T;
  export function useRef<T = any>(initialValue: T | null): { current: T | null };
  export function useContext<T = any>(context: any): T;
  export function createContext<T = any>(defaultValue: T): any;
  export function useReducer<R extends (state: any, action: any) => any>(reducer: R, initialState: any, initializer?: any): [ReturnType<R>, Dispatch<any>];
  export const useTransition: any;
  export const useId: any;
  export const Fragment: any;
  export function forwardRef<T, P = any>(render: any): any;
  export function memo<T>(component: T): T;
  export as namespace React;
  const React: any;
  export default React;
}

declare module "react/jsx-runtime" {
  export const jsx: any;
  export const jsxs: any;
  export const Fragment: any;
}

declare module "react-dom" {
  export const createRoot: any;
  export default any;
}

declare module "react-dom/client" {
  export const createRoot: any;
}

// Library stubs
declare module "axios" { const axios: any; export default axios; }
declare module "express" {
  const exp: any;
  export type Request = any;
  export type Response = any;
  export type NextFunction = any;
  export type Express = any;
  export function Router(): any;
  export default exp;
}
declare module "multer" { const multer: any; export default multer; }
declare module "ws" { const ws: any; export default ws; }
declare module "nanoid" { export function nanoid(): string; }
declare module "path" { const path: any; export default path; export function resolve(...args: any[]): string; export function join(...args: any[]): string; }
declare module "fs" { const fs: any; export default fs; }
declare module "http" { export const Server: any; export function createServer(...args: any[]): any; }
declare module "vite" {
  export const createServer: any;
  export const createLogger: any;
  export type PluginOption = any;
}
declare module "@tanstack/react-query" {
  export const QueryClient: any;
  export const QueryClientProvider: any;
  export function useQuery<TData = any, TError = any>(options?: any): any;
  export function useMutation<TData = any, TError = any, TVariables = any, TContext = any>(options?: any): any;
  export const useQueryClient: any;
  export type UseMutationResult<TData = any, TError = any, TVariables = any, TContext = any> = any;
}
declare module "wouter" { export const Link: any; export const Route: any; export const Router: any; export const Switch: any; export const useLocation: any; export const useRoute: any; }
declare module "lucide-react" {
  export const LoaderCircle: any;
  export const CheckCircle2: any;
  export const AlertCircle: any;
  export const LockKeyhole: any;
  export const Shield: any;
  export const Zap: any;
  export const Sparkles: any;
  export const Camera: any;
  export const Play: any;
  export const Clock: any;
  export const ChevronLeft: any;
  export const ChevronRight: any;
  export const MoreHorizontal: any;
  export const Circle: any;
  export const GripVertical: any;
  export const Check: any;
  export const ChevronDown: any;
  export const ChevronUp: any;
  export const X: any;
  export const PanelLeftIcon: any;
  export const Bell: any;
}

declare module "@radix-ui/react-toggle-group" { export const Root: any; export const Item: any; }
declare module "@radix-ui/react-toggle" { export const Root: any; export const Item: any; }
declare module "@radix-ui/react-tooltip" { export const Provider: any; export const Root: any; export const Trigger: any; export const Content: any; export const Portal: any; export const Arrow: any; }
declare module "@radix-ui/react-slot" { export const Slot: any; }
declare module "class-variance-authority" { export const cva: any; export type VariantProps<T> = any; }
declare module "@radix-ui/*" { const mod: any; export = mod; }
declare module "@vitejs/plugin-react" { const plugin: any; export default plugin; }
declare module "@replit/vite-plugin-runtime-error-modal" { const plugin: any; export default plugin; }
declare module "@replit/vite-plugin-cartographer" { const plugin: any; export default plugin; }
declare module "react-resizable-panels" { export const PanelGroup: any; export const Panel: any; export const PanelResizeHandle: any; }
declare module "drizzle-orm" { export const sql: any; export type AnyColumn = any; }
declare module "drizzle-orm/pg-core" { export const pgTable: any; export const text: any; export const varchar: any; export const integer: any; export const timestamp: any; export const decimal: any; export const boolean: any; }
declare module "drizzle-zod" { export const createInsertSchema: any; }
declare module "zod" { export const z: any; export default z; }
declare module "react-resizable-panels" { const mod: any; export = mod; }

declare module "@/hooks/useFullscreen" { const hook: any; export default hook; }

declare module "@/utils" { export * from "../client/src/utils"; }

declare module "vite/client" {
  const env: Record<string, string | undefined>;
  export { env };
  export interface ImportMetaEnv extends Record<string, string | undefined> {}
  export interface ImportMeta {
    readonly env: ImportMetaEnv;
    readonly hot?: any;
  }
}
