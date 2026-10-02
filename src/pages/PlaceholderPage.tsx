import React from "react";
import { Link } from "react-router-dom";
import { FolderClosed, ArrowRight, LucideIcon } from "lucide-react";

interface PlaceholderProps {
  title: string;
  subtitle: string;
  icon: LucideIcon;
  badge: string;
  phaseInfo: string;
}

export const PlaceholderPage: React.FC<PlaceholderProps> = ({
  title,
  subtitle,
  icon: Icon,
  badge,
  phaseInfo,
}) => {
  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] text-center p-6 space-y-5 animate-fadeIn">
      <div className="w-16 h-16 rounded-2xl bg-white/5 border border-white/10 flex items-center justify-center text-sky-400">
        <Icon className="w-8 h-8" />
      </div>

      <div className="space-y-1.5 max-w-sm">
        <span className="text-[10px] font-mono uppercase tracking-wider px-2.5 py-1 rounded-full bg-sky-500/10 border border-sky-500/20 text-sky-400">
          {badge}
        </span>
        <h1 className="text-xl md:text-2xl font-bold text-white font-['Outfit'] pt-2">
          {title}
        </h1>
        <p className="text-xs text-muted-foreground leading-relaxed">
          {subtitle}
        </p>
      </div>

      <div className="p-4 rounded-2xl bg-white/5 border border-white/5 max-w-md text-xs text-muted-foreground text-left space-y-1">
        <p className="font-semibold text-white">Upcoming in Phase 2+:</p>
        <p>{phaseInfo}</p>
      </div>

      <Link
        to="/docs"
        className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-gradient-to-r from-sky-500 to-indigo-600 hover:from-sky-400 hover:to-indigo-500 text-white font-semibold text-xs shadow-lg shadow-sky-500/20 transition-all"
      >
        <FolderClosed className="w-4 h-4" />
        <span>Go to Docs Explorer</span>
        <ArrowRight className="w-3.5 h-3.5" />
      </Link>
    </div>
  );
};
