import * as React from "react"

function Slot({ children, ...props }: React.HTMLAttributes<HTMLElement>) {
  if (!React.isValidElement(children)) {
    return <>{children}</>
  }

  return React.cloneElement(children as React.ReactElement, {
    ...props,
    className: [
      (children as React.ReactElement).props?.className,
      (props as any).className,
    ]
      .filter(Boolean)
      .join(" ") || undefined,
  })
}

Slot.displayName = "Slot"

export { Slot }
