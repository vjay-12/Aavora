import React, { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { formatDate } from "../lib/utils";
import {
  Activity as ActivityIcon,
  Upload,
  FolderPlus,
  Trash2,
  RefreshCw,
  FolderInput,
  Edit2,
  AlertCircle,
} from "lucide-react";

export const ActivityPage: React.FC = () => {
  const [selectedAction, setSelectedAction] = useState<string>("all");

  const { data, isLoading } = useQuery({
    queryKey: ["activity-feed", selectedAction],
    queryFn: async () => {
      const url = new URL("/api/activity", window.location.origin);
      if (selectedAction !== "all") url.searchParams.set("action", selectedAction);
      url.searchParams.set("limit", "50");

      const res = await fetch(url.toString());
      if (!res.ok) throw new Error("Failed to load activity");
      return res.json();
    },
  });

  const activities: any[] = data?.items || [];

  const getActionBadge = (action: string) => {
    switch (action) {
      case "upload":
        return {
          icon: Upload,
          label: "Uploaded",
          color: "bg-sky-500/15 text-sky-400 border-sky-500/20",
        };
      case "create_folder":
        return {
          icon: FolderPlus,
          label: "Created Folder",
          color: "bg-emerald-500/15 text-emerald-400 border-emerald-500/20",
        };
      case "trash":
        return {
          icon: Trash2,
          label: "Moved to Bin",
          color: "bg-amber-500/15 text-amber-400 border-amber-500/20",
        };
      case "restore":
        return {
          icon: RefreshCw,
          label: "Restored",
          color: "bg-teal-500/15 text-teal-400 border-teal-500/20",
        };
      case "move":
        return {
          icon: FolderInput,
          label: "Moved",
          color: "bg-indigo-500/15 text-indigo-400 border-indigo-500/20",
        };
      case "rename":
        return {
          icon: Edit2,
          label: "Renamed",
          color: "bg-purple-500/15 text-purple-400 border-purple-500/20",
        };
      case "delete":
        return {
          icon: AlertCircle,
          label: "Deleted Permanently",
          color: "bg-rose-500/15 text-rose-400 border-rose-500/20",
        };
      default:
        return {
          icon: ActivityIcon,
          label: action,
          color: "bg-white/10 text-muted-foreground border-white/10",
        };
    }
  };

  // Group by relative day
  const groupActivitiesByDay = (items: any[]) => {
    const groups: Record<string, any[]> = {};
    const now = new Date();

    items.forEach((item) => {
      const date = new Date(item.createdAt);
      const isToday =
        date.getDate() === now.getDate() &&
        date.getMonth() === now.getMonth() &&
        date.getFullYear() === now.getFullYear();

      const yesterday = new Date(now);
      yesterday.setDate(now.getDate() - 1);
      const isYesterday =
        date.getDate() === yesterday.getDate() &&
        date.getMonth() === yesterday.getMonth() &&
        date.getFullYear() === yesterday.getFullYear();

      let groupKey = "Earlier";
      if (isToday) groupKey = "Today";
      else if (isYesterday) groupKey = "Yesterday";

      if (!groups[groupKey]) groups[groupKey] = [];
      groups[groupKey].push(item);
    });

    return groups;
  };

  const grouped = React.useMemo(() => groupActivitiesByDay(activities), [activities]);

  return (
    <div className="space-y-6">
      {/* Header & Neon Performance Badge */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="inline-flex items-center gap-2 px-2.5 py-1 rounded-full bg-indigo-500/10 border border-indigo-500/20 text-indigo-400 text-xs font-medium mb-2">
            <ActivityIcon className="w-3.5 h-3.5" />
            <span>Neon Postgres Singapore (sin1)</span>
          </div>
          <h1 className="text-2xl md:text-3xl font-extrabold text-white font-['Outfit']">
            Activity Feed
          </h1>
          <p className="text-xs md:text-sm text-muted-foreground mt-0.5">
            Audit log of all uploads, edits, moves, and deletions across the vault.
          </p>
        </div>

        {/* Filters */}
        <div className="flex items-center gap-2">
          <select
            value={selectedAction}
            onChange={(e) => setSelectedAction(e.target.value)}
            className="px-3 py-2 bg-[#090d16] border border-white/10 rounded-xl text-xs text-white focus:outline-none focus:border-sky-500"
          >
            <option value="all">All Actions</option>
            <option value="upload">Uploads</option>
            <option value="create_folder">Folder Created</option>
            <option value="rename">Renamed</option>
            <option value="move">Moved</option>
            <option value="trash">Moved to Bin</option>
            <option value="restore">Restored</option>
            <option value="delete">Deleted</option>
          </select>
        </div>
      </div>

      {/* Feed */}
      {isLoading ? (
        <div className="space-y-3">
          {[1, 2, 3, 4, 5].map((i) => (
            <div key={i} className="h-16 rounded-2xl bg-white/5 animate-pulse" />
          ))}
        </div>
      ) : activities.length === 0 ? (
        <div className="p-12 rounded-3xl border border-dashed border-white/10 text-center space-y-2">
          <ActivityIcon className="w-8 h-8 text-muted-foreground mx-auto" />
          <p className="text-xs text-muted-foreground">
            No activity found matching the selected filter.
          </p>
        </div>
      ) : (
        <div className="space-y-6">
          {Object.entries(grouped).map(([dayLabel, items]) => (
            <div key={dayLabel} className="space-y-3">
              <h3 className="text-xs font-bold uppercase tracking-wider text-muted-foreground pl-1">
                {dayLabel}
              </h3>

              <div className="space-y-2.5">
                {items.map((act) => {
                  const badge = getActionBadge(act.action);
                  const Icon = badge.icon;

                  return (
                    <div
                      key={act.id}
                      className="glass-card p-3.5 rounded-2xl flex items-center justify-between gap-4"
                    >
                      <div className="flex items-center gap-3.5 overflow-hidden">
                        <div
                          className={`w-9 h-9 rounded-xl border flex items-center justify-center flex-shrink-0 ${badge.color}`}
                        >
                          <Icon className="w-4 h-4" />
                        </div>
                        <div className="overflow-hidden">
                          <p className="text-xs font-medium text-white truncate">
                            <span className="font-semibold text-sky-400">
                              {act.userName || act.userId.split("@")[0]}
                            </span>{" "}
                            {badge.label.toLowerCase()}{" "}
                            <span className="font-semibold text-white">&ldquo;{act.name}&rdquo;</span>
                          </p>
                          <div className="flex items-center gap-2 text-[11px] text-muted-foreground mt-0.5">
                            <span>{act.userId}</span>
                            <span>•</span>
                            <span>{formatDate(act.createdAt)}</span>
                          </div>
                        </div>
                      </div>

                      <span
                        className={`text-[10px] px-2 py-0.5 rounded-md border font-mono font-medium flex-shrink-0 ${badge.color}`}
                      >
                        {act.action}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
