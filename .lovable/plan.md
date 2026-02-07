

# Plan: Remove SMS Segment Warning

## Overview
Remove the 160-character segment warning UI elements from the SMS compose dialog. Users don't need to see this technical detail.

---

## File to Modify

**`src/components/crm/bulk/SmsComposeDialog.tsx`**

### Changes

1. **Remove unused constant** (line 24)
   - Delete `const SMS_SEGMENT_LENGTH = 160;`

2. **Remove unused variables** (lines 51-53)
   - Delete `characterCount`, `segmentCount`, and `isMultiSegment` calculations

3. **Simplify character counter** (lines 69-72)
   - Replace the conditional styling and segment count display with a simple character count
   - Change from amber warning color to always use muted text

4. **Remove warning paragraph** (lines 83-87)
   - Delete the entire conditional block that shows "Messages over 160 characters will be split into multiple segments"

### Before
```typescript
const SMS_SEGMENT_LENGTH = 160;
// ...
const characterCount = body.length;
const segmentCount = Math.ceil(characterCount / SMS_SEGMENT_LENGTH) || 1;
const isMultiSegment = characterCount > SMS_SEGMENT_LENGTH;
// ...
<span className={`text-xs ${isMultiSegment ? 'text-amber-600 dark:text-amber-400' : 'text-muted-foreground'}`}>
  {characterCount} / {SMS_SEGMENT_LENGTH} characters
  {isMultiSegment && ` (${segmentCount} segments)`}
</span>
// ...
{isMultiSegment && (
  <p className="text-xs text-amber-600 dark:text-amber-400">
    Messages over 160 characters will be split into multiple segments.
  </p>
)}
```

### After
```typescript
// No segment constant needed
// ...
// Just show simple character count
<span className="text-xs text-muted-foreground">
  {body.length} characters
</span>
// ...
// No warning paragraph
```

---

## Result
The SMS compose dialog will show a clean character count without any warnings about segment limits.

