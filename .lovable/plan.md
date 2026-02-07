

# Implementation Plan: Fix Filter Menu Scrollability

## The Problem

The Radix UI `ScrollArea` component has an internal architecture where the `Viewport` element (the actual scrollable container) uses `h-full w-full` sizing. When you apply `max-h-[70vh]` to the `ScrollArea` Root element, the Viewport ignores this constraint because:

1. The Root has `overflow-hidden` but no explicit height
2. The Viewport uses `h-full` which inherits from its parent's computed height
3. Without a fixed height on the parent, the Viewport expands to fit its content

This is why the individual sections scroll (they use native `overflow-auto` with explicit `max-h` values) but the overall popover doesn't.

## The Technical Decision

**Solution: Target the Viewport directly using Tailwind's child selector syntax.**

The fix involves applying the height constraint to the Viewport element using:
```
[&>[data-radix-scroll-area-viewport]]:max-h-[70vh]
```

This approach is the correct one because:

1. **It follows the documented pattern** - This is the official workaround from both the Radix UI community and Shadcn UI users when you need fixed-height scroll areas
2. **It doesn't modify the shared ScrollArea component** - Changing `scroll-area.tsx` would affect every usage across the app, potentially breaking the Kanban and Table scrolling which rely on the parent providing height context
3. **It's explicit and localized** - The constraint is applied exactly where needed, making it clear this popover has specific sizing requirements
4. **It maintains component reusability** - The ScrollArea component remains general-purpose

## Files to Modify

| File | Change |
|------|--------|
| `src/components/crm/clients/ClientFilters.tsx` | Update ScrollArea className to target Viewport |
| `src/components/crm/staff/StaffFilters.tsx` | Add ScrollArea wrapper for consistency and future-proofing |

## Implementation Details

### ClientFilters.tsx

Change line 87 from:
```tsx
<ScrollArea className="max-h-[70vh]">
```

To:
```tsx
<ScrollArea className="[&>[data-radix-scroll-area-viewport]]:max-h-[70vh]">
```

This targets the internal `data-radix-scroll-area-viewport` element directly and applies the max-height constraint where it will actually be enforced.

### StaffFilters.tsx

Wrap the content in a ScrollArea with the same pattern for consistency:
```tsx
<PopoverContent className="w-80 p-0" align="start">
  <ScrollArea className="[&>[data-radix-scroll-area-viewport]]:max-h-[70vh]">
    <div className="space-y-4 p-4">
      {/* existing content */}
    </div>
  </ScrollArea>
</PopoverContent>
```

This ensures both filter components behave identically and are ready for any future additions without hitting the same issue.

## Why Not Other Approaches

**Option rejected: Modify `scroll-area.tsx` to accept a `viewportClassName` prop**
- Would require changing the shared component API
- Could break existing usages that expect current behavior
- Adds unnecessary abstraction for a localized need

**Option rejected: Use native `overflow-auto` instead of ScrollArea**
- Loses the styled scrollbar appearance
- Inconsistent with how scrolling is handled elsewhere in the app

**Option rejected: Apply height to PopoverContent**
- PopoverContent should remain content-sized by default
- This would require calculating remaining space and is fragile

## Expected Result

After this change:
- The entire filter popover content will scroll when it exceeds 70% of viewport height
- The styled scrollbar will appear on the right side of the popover
- Individual section scrolling (Tags, Status, State) will continue to work as nested scroll areas
- Mobile users will be able to access all filter options by scrolling
- StaffFilters will have the same behavior for consistency

