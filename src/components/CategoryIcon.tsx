import {
  Bike, Utensils, Palette, Sailboat, Snowflake, Film,
  type LucideIcon,
} from 'lucide-react-native';
import { categoryIcon as registryIcon } from '../constants/categories';

// Real item categories live in constants/categories.ts (the single source
// of truth) — these are the broader onboarding-only interest tags that
// aren't real item categories (see CATEGORY_INTEREST_OPTIONS's own comment
// there), so they stay local to this icon lookup.
const EXTRA_TAG_ICON: Record<string, LucideIcon> = {
  biking: Bike,
  cooking: Utensils,
  art: Palette,
  water: Sailboat,
  winter: Snowflake,
  film: Film,
};

export function categoryIcon(category: string): LucideIcon {
  // registryIcon already falls back to Package internally for unknown keys.
  return EXTRA_TAG_ICON[category] ?? registryIcon(category);
}

type Props = {
  category: string;
  size?: number;
  color: string;
  strokeWidth?: number;
};

export function CategoryIcon({ category, size = 28, color, strokeWidth = 2 }: Props) {
  const Icon = categoryIcon(category);
  return <Icon size={size} color={color} strokeWidth={strokeWidth} />;
}
