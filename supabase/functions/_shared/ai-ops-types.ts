// Runtime-free type declarations shared by AI Operations modules.
// Kept free of Deno globals so browser/test builds can import it safely.

/** Task-specific reasoning effort requested from the model. */
export type ThinkingLevel = "low" | "medium" | "high";
