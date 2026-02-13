

# Fix: Blank Screen from Duplicate React Instance

## The Problem

Vite's dependency optimizer is creating separate bundled copies of React. The `TooltipProvider` component (which wraps the entire app in `App.tsx`) ends up using a different React instance than the rest of the application. React hooks like `useRef` require a single shared React instance to work -- when there are two copies, hooks crash with "Cannot read properties of null," and the entire screen goes blank.

## The Fix

Add a `resolve.dedupe` entry in `vite.config.ts` to force Vite to always use a single copy of `react` and `react-dom`. This is a one-line addition to the existing config.

## File Changed

**`vite.config.ts`** -- Add `dedupe: ['react', 'react-dom']` inside the existing `resolve` block, alongside the current `alias` setting.

This does not change any application code, database, or dependencies -- it only adjusts how Vite bundles them.

