export type VariantProps<T> = Record<string, never>

export function cva(base?: string, _config?: unknown) {
  return (_variants?: Record<string, unknown>) => base ?? ""
}

export default cva
