// Category registry. The `create_calendar` and `update_calendar` tools
// dispatch by `calendar.category` to the correct validator and helpers.
// Adding a new category (NBA, NFL, tennis, etc.) is a one-line entry
// here plus the per-category model module.

import type { ValidationResult } from "./types.js";
import { validateSoccerEvent } from "./soccer/validators.js";
import { validateF1Event } from "./formula1/validators.js";

export type Category = "soccer" | "formula1";

export interface CategoryModel {
  validate: (event: unknown) => ValidationResult;
}

const REGISTRY: Record<Category, CategoryModel> = {
  soccer: { validate: validateSoccerEvent },
  formula1: { validate: validateF1Event },
};

export const knownCategories: readonly Category[] = Object.keys(
  REGISTRY,
) as Category[];

export function isKnownCategory(value: unknown): value is Category {
  return typeof value === "string" && value in REGISTRY;
}

export function getCategoryModel(category: Category): CategoryModel {
  return REGISTRY[category];
}

// Lowercase, replace non-alphanumeric runs with a single dash, strip
// leading/trailing dashes. Used to derive `id` from `name` when
// `create_calendar` callers omit it.
//
//   slugify("UEFA Champions League 2025-26") → "uefa-champions-league-2025-26"
//   slugify("Formula 1 2026")                → "formula-1-2026"
//   slugify("  Hello, World!  ")             → "hello-world"
export function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}
