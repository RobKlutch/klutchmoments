import * as React from "react"

const cache = new Map<string, React.ComponentType<any>>()

function makeComponent(tag: keyof JSX.IntrinsicElements, displayName: string) {
  if (cache.has(displayName)) return cache.get(displayName) as any
  const Comp = React.forwardRef<any, any>(({ children, ...props }, ref) => {
    const Element = tag as any
    return (
      <Element ref={ref} {...props}>
        {children}
      </Element>
    )
  })

  Comp.displayName = displayName
  cache.set(displayName, Comp)
  return Comp
}

const FragmentPortal = ({ children }: React.PropsWithChildren) => <>{children}</>

const Root = makeComponent("div", "Root")
const Trigger = makeComponent("button", "Trigger")
const Group = makeComponent("div", "Group")
const Portal = FragmentPortal
const Sub = makeComponent("div", "Sub")
const RadioGroup = makeComponent("div", "RadioGroup")
const SubTrigger = makeComponent("button", "SubTrigger")
const SubContent = makeComponent("div", "SubContent")
const Content = makeComponent("div", "Content")
const Item = makeComponent("div", "Item")
const CheckboxItem = makeComponent("div", "CheckboxItem")
const ItemIndicator = makeComponent("span", "ItemIndicator")
const RadioItem = makeComponent("div", "RadioItem")
const Label = makeComponent("label", "Label")
const Separator = makeComponent("div", "Separator")
const ScrollAreaScrollbar = makeComponent("div", "ScrollAreaScrollbar")
const ScrollAreaThumb = makeComponent("div", "ScrollAreaThumb")
const Corner = makeComponent("div", "Corner")
const Viewport = makeComponent("div", "Viewport")
const Scrollbar = makeComponent("div", "Scrollbar")
const ScrollUpButton = makeComponent("button", "ScrollUpButton")
const ScrollDownButton = makeComponent("button", "ScrollDownButton")
const Icon = makeComponent("span", "Icon")
const Value = makeComponent("span", "Value")
const ItemText = makeComponent("span", "ItemText")
const Overlay = makeComponent("div", "Overlay")
const Close = makeComponent("button", "Close")
const Title = makeComponent("div", "Title")
const Description = makeComponent("div", "Description")
const Action = makeComponent("button", "Action")
const Cancel = makeComponent("button", "Cancel")
const Thumb = makeComponent("div", "Thumb")
const Track = makeComponent("div", "Track")
const Range = makeComponent("div", "Range")
const List = makeComponent("div", "List")
const Link = makeComponent("a", "Link")
const Indicator = makeComponent("div", "Indicator")
const Image = makeComponent("img", "Image")
const Fallback = makeComponent("div", "Fallback")
const CollapsibleTrigger = makeComponent("button", "CollapsibleTrigger")
const CollapsibleContent = makeComponent("div", "CollapsibleContent")
const ThumbIndicator = makeComponent("div", "ThumbIndicator")
const Provider = ({ children }: React.PropsWithChildren) => <>{children}</>

export {
  Action,
  Cancel,
  CheckboxItem,
  Close,
  CollapsibleContent,
  CollapsibleTrigger,
  Content,
  Corner,
  Description,
  Fallback,
  Group,
  Icon,
  Image,
  Indicator,
  Item,
  ItemIndicator,
  ItemText,
  Label,
  Link,
  List,
  Overlay,
  Portal,
  Provider,
  RadioGroup,
  RadioItem,
  Range,
  Track,
  Root,
  ScrollAreaScrollbar,
  ScrollAreaThumb,
  ScrollDownButton,
  ScrollUpButton,
  Scrollbar,
  Separator,
  Sub,
  SubContent,
  SubTrigger,
  Thumb,
  ThumbIndicator,
  Title,
  Trigger,
  Value,
  Viewport,
}

export default {
  Action,
  Cancel,
  CheckboxItem,
  Close,
  CollapsibleContent,
  CollapsibleTrigger,
  Content,
  Corner,
  Description,
  Fallback,
  Group,
  Icon,
  Image,
  Indicator,
  Item,
  ItemIndicator,
  ItemText,
  Label,
  Link,
  List,
  Overlay,
  Portal,
  Provider,
  RadioGroup,
  RadioItem,
  Range,
  Track,
  Root,
  ScrollAreaScrollbar,
  ScrollAreaThumb,
  ScrollDownButton,
  ScrollUpButton,
  Scrollbar,
  Separator,
  Sub,
  SubContent,
  SubTrigger,
  Thumb,
  ThumbIndicator,
  Title,
  Trigger,
  Value,
  Viewport,
}
