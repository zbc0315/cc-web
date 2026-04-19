import * as React from 'react';
import * as TabsPrimitive from '@radix-ui/react-tabs';
import { cn } from '@/lib/utils';

const Tabs = TabsPrimitive.Root;

/**
 * Base classes shared by horizontal and vertical orientations. Anything that
 * differs by axis is split into `horiz*` / `vert*` — this replaces the earlier
 * pattern where callers passed long Tailwind overrides and silently depended
 * on later-wins specificity to defeat the horizontal defaults (fragile when
 * base classes get reordered or extended). Radix sets `data-orientation` on
 * the List/Trigger based on `<Tabs orientation="vertical">`, so variants key
 * off that attribute.
 */
const TABS_LIST_BASE =
  'flex rounded-md bg-muted p-1 text-muted-foreground ' +
  'data-[orientation=horizontal]:h-10 data-[orientation=horizontal]:items-center data-[orientation=horizontal]:justify-center data-[orientation=horizontal]:inline-flex ' +
  'data-[orientation=vertical]:flex-col data-[orientation=vertical]:items-center data-[orientation=vertical]:justify-start';

const TABS_TRIGGER_BASE =
  'inline-flex items-center justify-center whitespace-nowrap rounded-sm text-sm font-medium ring-offset-background transition-all ' +
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 ' +
  'disabled:pointer-events-none disabled:opacity-50 ' +
  'data-[state=active]:bg-background data-[state=active]:text-foreground data-[state=active]:shadow-sm ' +
  'data-[orientation=horizontal]:px-3 data-[orientation=horizontal]:py-1.5';

const TabsList = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.List>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.List>
>(({ className, ...props }, ref) => (
  <TabsPrimitive.List
    ref={ref}
    className={cn(TABS_LIST_BASE, className)}
    {...props}
  />
));
TabsList.displayName = TabsPrimitive.List.displayName;

const TabsTrigger = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.Trigger>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.Trigger>
>(({ className, ...props }, ref) => (
  <TabsPrimitive.Trigger
    ref={ref}
    className={cn(TABS_TRIGGER_BASE, className)}
    {...props}
  />
));
TabsTrigger.displayName = TabsPrimitive.Trigger.displayName;

const TabsContent = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.Content>
>(({ className, ...props }, ref) => (
  <TabsPrimitive.Content
    ref={ref}
    className={cn(
      'mt-2 ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
      className
    )}
    {...props}
  />
));
TabsContent.displayName = TabsPrimitive.Content.displayName;

export { Tabs, TabsList, TabsTrigger, TabsContent };
