export type ClassValue = any

export function clsx(...values: ClassValue[]) {
  return values.filter(Boolean).join(" ")
}

export default clsx
