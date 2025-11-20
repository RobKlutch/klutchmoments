import * as React from "react"
import { primitive } from "./core"

type AccordionContextValue = {
  openItem: string | null
  setOpenItem: (value: string | null) => void
}

const AccordionContext = React.createContext<AccordionContextValue | null>(null)

type RootProps = React.PropsWithChildren<{
  defaultValue?: string
  value?: string
  onValueChange?: (value: string) => void
  className?: string
}>

const Root = React.forwardRef<HTMLDivElement, RootProps>(
  ({ children, defaultValue = null, value, onValueChange, ...props }, ref) => {
    const [openItem, setOpenItem] = React.useState<string | null>(
      value ?? defaultValue ?? null,
    )

    const handleSet = (next: string | null) => {
      setOpenItem(next)
      if (next && onValueChange) onValueChange(next)
    }

    return (
      <AccordionContext.Provider value={{ openItem, setOpenItem: handleSet }}>
        <div ref={ref} {...props}>
          {children}
        </div>
      </AccordionContext.Provider>
    )
  },
)

Root.displayName = "AccordionRoot"

const Item = primitive("div", "AccordionItem")

type TriggerProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  value?: string
}

const Trigger = React.forwardRef<HTMLButtonElement, TriggerProps>(
  ({ children, value, ...props }, ref) => {
    const context = React.useContext(AccordionContext)
    const isOpen = context?.openItem === value
    return (
      <button
        ref={ref}
        data-state={isOpen ? "open" : "closed"}
        aria-expanded={isOpen}
        onClick={() => context?.setOpenItem(isOpen ? null : value ?? null)}
        {...props}
      >
        {children}
      </button>
    )
  },
)

Trigger.displayName = "AccordionTrigger"

type ContentProps = React.HTMLAttributes<HTMLDivElement> & { value?: string }

const Content = React.forwardRef<HTMLDivElement, ContentProps>(
  ({ children, value, ...props }, ref) => {
    const context = React.useContext(AccordionContext)
    const isOpen = context?.openItem === value
    return (
      <div
        ref={ref}
        data-state={isOpen ? "open" : "closed"}
        hidden={!isOpen}
        {...props}
      >
        {children}
      </div>
    )
  },
)

Content.displayName = "AccordionContent"

export { Root, Item, Trigger, Content }
