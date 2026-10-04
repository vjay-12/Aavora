export type FolderColorId = "sky" | "indigo" | "emerald" | "amber" | "rose" | "purple";

export interface FolderPalette {
  id: FolderColorId;
  label: string;
  badge: string;
  bg: string;
  border: string;
  icon: string;
}

export const FOLDER_COLOR_LIST: FolderPalette[] = [
  {
    id: "sky",
    label: "Sky",
    badge: "bg-sky-500",
    bg: "from-sky-500/20 to-blue-600/10",
    border: "border-sky-500/30",
    icon: "text-sky-400",
  },
  {
    id: "indigo",
    label: "Indigo",
    badge: "bg-indigo-500",
    bg: "from-indigo-500/20 to-purple-600/10",
    border: "border-indigo-500/30",
    icon: "text-indigo-400",
  },
  {
    id: "emerald",
    label: "Emerald",
    badge: "bg-emerald-500",
    bg: "from-emerald-500/20 to-teal-600/10",
    border: "border-emerald-500/30",
    icon: "text-emerald-400",
  },
  {
    id: "amber",
    label: "Amber",
    badge: "bg-amber-500",
    bg: "from-amber-500/20 to-orange-600/10",
    border: "border-amber-500/30",
    icon: "text-amber-400",
  },
  {
    id: "rose",
    label: "Rose",
    badge: "bg-rose-500",
    bg: "from-rose-500/20 to-pink-600/10",
    border: "border-rose-500/30",
    icon: "text-rose-400",
  },
  {
    id: "purple",
    label: "Purple",
    badge: "bg-purple-500",
    bg: "from-purple-500/20 to-fuchsia-600/10",
    border: "border-purple-500/30",
    icon: "text-purple-400",
  },
];

export const DEFAULT_FOLDER_COLOR: FolderColorId = "sky";

/**
 * Returns a stable folder color palette.
 * Never generates colors from random values, array indices, or name hashes.
 * If no color or an invalid color is provided, returns the fixed default color ("sky").
 */
export function getFolderPalette(colorKey?: string): FolderPalette {
  const normalized = (colorKey || "").trim().toLowerCase();
  const match = FOLDER_COLOR_LIST.find((c) => c.id === normalized);
  return match || FOLDER_COLOR_LIST[0];
}
