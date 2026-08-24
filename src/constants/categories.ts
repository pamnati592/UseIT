import {
  Camera, Gamepad2, Tent, Wrench, Music, Dumbbell, Shirt, Package,
  type LucideIcon,
} from 'lucide-react-native';

// Single source of truth for item categories (backlog: "add a category in
// one place, it shows up everywhere relevant"). Add or edit an entry here
// and every consumer below picks it up automatically — nothing else in the
// app should hardcode a category list, icon mapping, or Impact Score
// baseline of its own.
//
// icon           — CategoryIcon (item card fallback art, category badges)
// impactBase     — Impact Score baseline (backlog R, src/utils/format.ts)
// filterLabel    — shorter label for the Home feed filter chip; falls back
//                   to `label` when omitted
//
// One real limit: supabase/functions/analyze-item-photo (a Deno edge
// function, a separate deployed runtime that can't import from src/) keeps
// its own copy of just the category keys for the AI prompt — that one has
// to be kept in sync by hand, it's called out at its definition site.
export type CategoryDef = {
  key: string;
  label: string;
  filterLabel?: string;
  icon: LucideIcon;
  impactBase: number;
};

export const CATEGORY_DEFS: CategoryDef[] = [
  { key: 'photography', label: 'Photography',        filterLabel: 'Cameras', icon: Camera,   impactBase: 3.6 },
  { key: 'camping',     label: 'Camping',                                     icon: Tent,     impactBase: 3.8 },
  { key: 'diy',         label: 'DIY & Tools',         filterLabel: 'DIY',     icon: Wrench,   impactBase: 3.5 },
  { key: 'gaming',      label: 'Gaming',                                      icon: Gamepad2, impactBase: 3.2 },
  { key: 'music',       label: 'Music',                                       icon: Music,    impactBase: 3.3 },
  { key: 'sports',      label: 'Sports',                                      icon: Dumbbell, impactBase: 3.7 },
  { key: 'clothing',    label: 'Clothing & Fashion',  filterLabel: 'Clothing', icon: Shirt,    impactBase: 3.4 },
  { key: 'other',       label: 'Other',                                       icon: Package,  impactBase: 3.0 },
];

// The item-category enum itself (AddItemScreen/EditItemScreen pickers,
// analyze-item-photo's response validation).
export const CATEGORY_KEYS: string[] = CATEGORY_DEFS.map(c => c.key);

const BY_KEY: Record<string, CategoryDef> = Object.fromEntries(CATEGORY_DEFS.map(c => [c.key, c]));

export function categoryIcon(category: string): LucideIcon {
  return BY_KEY[category]?.icon ?? Package;
}

export function categoryLabel(category: string): string {
  return BY_KEY[category]?.label ?? category;
}

export function categoryImpactBase(category: string): number {
  return BY_KEY[category]?.impactBase ?? BY_KEY.other.impactBase;
}

// Home feed filter bar — real categories first, in registry order.
export const CATEGORY_FILTER_CHIPS: { key: string; label: string }[] =
  CATEGORY_DEFS.map(c => ({ key: c.key, label: c.filterLabel ?? c.label }));

// Onboarding "interests" reuses the exact same keys as categories (so
// get_feed's interest-matching bonus actually matches real item
// categories) — this is that half of the list. OnboardingScreen appends a
// few broader interest-only tags of its own (cooking, art, etc.) that
// aren't real item categories, so aren't part of this shared registry.
export const CATEGORY_INTEREST_OPTIONS: { value: string; label: string; icon: LucideIcon }[] =
  CATEGORY_DEFS.map(c => ({ value: c.key, label: c.label, icon: c.icon }));
