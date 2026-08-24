import {
  Camera, Gamepad2, Tent, Wrench, Music, Dumbbell, Package,
  Bike, Utensils, Palette, Sailboat, Snowflake, Film, Shirt,
  type LucideIcon,
} from 'lucide-react-native';

// Single source of truth for category -> icon, matching the Figma wireframes.
// Used for the item card fallback art and anywhere a category is shown.
const CATEGORY_ICON: Record<string, LucideIcon> = {
  photography: Camera,
  gaming: Gamepad2,
  camping: Tent,
  diy: Wrench,
  music: Music,
  sports: Dumbbell,
  clothing: Shirt,
  // extended interest tags (onboarding)
  biking: Bike,
  cooking: Utensils,
  art: Palette,
  water: Sailboat,
  winter: Snowflake,
  film: Film,
};

export function categoryIcon(category: string): LucideIcon {
  return CATEGORY_ICON[category] ?? Package;
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
