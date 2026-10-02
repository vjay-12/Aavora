import React from "react";
import { NavLink, Outlet, useLocation } from "react-router-dom";
import { useAuth } from "../../context/AuthContext";
import {
  Home,
  FolderClosed,
  Bookmark,
  Activity as ActivityIcon,
  MoreHorizontal,
  Shield,
  LogOut,
} from "lucide-react";
import { UserAvatar } from "../common/UserAvatar";
import { getUserFullName } from "../../lib/user-format";

export const AppLayout: React.FC = () => {
  const { user, logout } = useAuth();
  const location = useLocation();

  const navItems = [
    { name: "Home", path: "/home", icon: Home },
    { name: "Docs", path: "/docs", icon: FolderClosed },
    { name: "Saved", path: "/saved", icon: Bookmark },
    { name: "Activity", path: "/activity", icon: ActivityIcon },
    { name: "More", path: "/more", icon: MoreHorizontal },
  ];

  return (
    <div className="min-h-screen bg-[#070b12] text-foreground flex flex-col md:flex-row antialiased select-none md:select-auto">
      {/* Laptop Sidebar (Desktop md+) */}
      <aside className="hidden md:flex flex-col w-64 border-r border-white/5 bg-[#090d16]/80 backdrop-blur-xl h-screen sticky top-0 z-30 justify-between p-4">
        <div className="space-y-6">
          {/* Brand Header */}
          <div className="flex items-center gap-3 px-2 pt-1">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-tr from-sky-500 to-indigo-600 p-[1px] shadow-lg shadow-sky-500/20">
              <div className="w-full h-full bg-[#070b12] rounded-[11px] flex items-center justify-center">
                <Shield className="w-4 h-4 text-sky-400" />
              </div>
            </div>
            <div>
              <span className="font-extrabold text-base tracking-tight text-white block font-['Outfit']">
                AAVORA
              </span>
              <span className="text-[10px] text-muted-foreground uppercase tracking-widest font-mono">
                Family Vault
              </span>
            </div>
          </div>

          {/* Navigation Links */}
          <nav className="space-y-1.5">
            {navItems.map((item) => {
              const Icon = item.icon;
              const isActive = location.pathname.startsWith(item.path);

              return (
                <NavLink
                  key={item.name}
                  to={item.path}
                  className={`flex items-center gap-3 px-3.5 py-2.5 rounded-xl text-sm font-medium transition-all duration-150 ${
                    isActive
                      ? "bg-gradient-to-r from-sky-500/15 to-indigo-500/10 text-sky-400 border border-sky-500/20 shadow-sm"
                      : "text-muted-foreground hover:text-white hover:bg-white/5"
                  }`}
                >
                  <Icon className={`w-4 h-4 ${isActive ? "text-sky-400" : ""}`} />
                  <span>{item.name}</span>
                  {item.path === "/docs" && (
                    <span className="ml-auto text-[10px] px-1.5 py-0.5 rounded-md bg-sky-500/20 text-sky-300 font-mono">
                      Active
                    </span>
                  )}
                </NavLink>
              );
            })}
          </nav>
        </div>

        {/* Sidebar Footer with User Profile and Logout */}
        <div className="space-y-3 pt-4 border-t border-white/5">
          <div className="flex items-center justify-between p-2 rounded-xl bg-white/5 border border-white/5">
            <div className="flex items-center gap-2.5 overflow-hidden">
              <UserAvatar
                name={user?.name}
                email={user?.email}
                picture={user?.picture}
                size="sm"
              />
              <div className="overflow-hidden text-left">
                <div className="text-xs font-medium text-white truncate">{getUserFullName(user)}</div>
                <div className="text-[10px] text-muted-foreground truncate font-mono uppercase">
                  {user?.role}
                </div>
              </div>
            </div>

            <button
              onClick={() => logout()}
              title="Log Out"
              className="p-1.5 rounded-lg hover:bg-white/10 text-muted-foreground hover:text-rose-400 transition-colors"
            >
              <LogOut className="w-4 h-4" />
            </button>
          </div>
        </div>
      </aside>

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col min-w-0 pb-20 md:pb-6">
        {/* Mobile Header (Phone only) */}
        <header className="md:hidden flex items-center justify-between px-4 py-3 border-b border-white/5 bg-[#090d16]/90 backdrop-blur-md sticky top-0 z-30">
          <div className="flex items-center gap-2.5">
            <div className="w-7 h-7 rounded-lg bg-gradient-to-tr from-sky-500 to-indigo-600 p-[1px]">
              <div className="w-full h-full bg-[#070b12] rounded-[7px] flex items-center justify-center">
                <Shield className="w-3.5 h-3.5 text-sky-400" />
              </div>
            </div>
            <span className="font-extrabold text-sm tracking-tight text-white font-['Outfit']">
              AAVORA
            </span>
          </div>

          <div className="flex items-center gap-2">
            <UserAvatar
              name={user?.name}
              email={user?.email}
              picture={user?.picture}
              size="xs"
            />
            <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-sky-500/10 text-sky-300 border border-sky-500/20">
              {user?.role}
            </span>
            <button
              onClick={() => logout()}
              className="p-1.5 rounded-lg bg-white/5 text-muted-foreground hover:text-rose-400"
              title="Log Out"
            >
              <LogOut className="w-4 h-4" />
            </button>
          </div>
        </header>

        {/* Page Content */}
        <main className="flex-1 p-4 md:p-8 max-w-7xl w-full mx-auto">
          <Outlet />
        </main>
      </div>

      {/* Phone Bottom Navigation Bar */}
      <nav className="md:hidden fixed bottom-0 left-0 right-0 z-40 bg-[#090d16]/95 backdrop-blur-xl border-t border-white/10 safe-bottom">
        <div className="flex items-center justify-around px-2 py-1.5">
          {navItems.map((item) => {
            const Icon = item.icon;
            const isActive = location.pathname.startsWith(item.path);

            return (
              <NavLink
                key={item.name}
                to={item.path}
                className={`flex flex-col items-center justify-center min-h-[44px] min-w-[48px] py-1 px-2 rounded-xl transition-all duration-150 ${
                  isActive ? "text-sky-400 font-semibold" : "text-muted-foreground"
                }`}
              >
                <div className="relative">
                  <Icon className={`w-5 h-5 transition-transform ${isActive ? "scale-110" : ""}`} />
                  {isActive && (
                    <span className="absolute -bottom-1 left-1/2 -translate-x-1/2 w-1 h-1 rounded-full bg-sky-400 shadow-[0_0_6px_#38bdf8]" />
                  )}
                </div>
                <span className="text-[10px] mt-1 tracking-tight">{item.name}</span>
              </NavLink>
            );
          })}
        </div>
      </nav>
    </div>
  );
};
