import * as React from "react"

export function primitive<T extends keyof JSX.IntrinsicElements>(
  tag: T,
  displayName: string,
) {
  const Component = React.forwardRef<
    React.ElementRef<T>,
    React.ComponentPropsWithoutRef<T>
  >(({ children, ...props }, ref) => {
    const Element = tag as any
    return (
      <Element ref={ref} {...props}>
        {children}
      </Element>
    )
  })

  Component.displayName = displayName
  return Component
}

export function passThrough<T extends object>(value: T): T {
  return value
}
