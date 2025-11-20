import * as React from "react"

const Base = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ children, ...props }, ref) => (
    <div ref={ref} {...props}>
      {children}
    </div>
  ),
)

Base.displayName = "Command"

const create = (name: string, tag: keyof JSX.IntrinsicElements = "div") => {
  const Comp = React.forwardRef<any, any>(({ children, ...props }, ref) => {
    const Element = tag as any
    return (
      <Element ref={ref} {...props}>
        {children}
      </Element>
    )
  })
  Comp.displayName = `Command${name}`
  return Comp
}

const CommandInput = create("Input", "input")
const CommandList = create("List")
const CommandEmpty = create("Empty")
const CommandGroup = create("Group")
const CommandSeparator = create("Separator")
const CommandItem = create("Item")
const CommandShortcut = create("Shortcut", "span")

export const Command = Object.assign(Base, {
  Input: CommandInput,
  List: CommandList,
  Empty: CommandEmpty,
  Group: CommandGroup,
  Separator: CommandSeparator,
  Item: CommandItem,
  Shortcut: CommandShortcut,
})

export default Command
