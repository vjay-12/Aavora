import React, { useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { useLock } from "../context/LockContext";
import { useQuery } from "@tanstack/react-query";
import { formatBytes } from "../lib/utils";
import { wipeOfflineStorage } from "../lib/offline-crypto";
import {
  Trash2,
  Users,
  Shield,
  LogOut,
  Fingerprint,
  Lock,
  RefreshCw,
  AlertTriangle,
  UserPlus,
  Clock,
  HardDrive,
} from "lucide-react";
import { canUserDelete, DELETE_RESTRICTED_MESSAGE } from "../config/features";
import { UserAvatar } from "../components/common/UserAvatar";
import { getUserFullName } from "../lib/user-format";

export const MorePage: React.FC = () => {
  const { user, logout } = useAuth();
  const {
    autoLockMinutes,
    updateAutoLockMinutes,
    isBiometricSupported,
    isBiometricRegisteredState,
    enableBiometrics,
    setupLock,
  } = useLock();

  const [searchParams] = useSearchParams();
  const driveConnectedParam = searchParams.get("admin_drive_connected") || searchParams.get("driveConnected");
  const driveErrorParam = searchParams.get("driveError");
  const errorParam = searchParams.get("error") || driveErrorParam;
  const msgParam = searchParams.get("msg");

  const canDelete = canUserDelete(user?.role);
  const [restrictedToast, setRestrictedToast] = useState<string | null>(msgParam || null);

  const sectionParam = searchParams.get("section");
  const [activeSection, setActiveSection] = useState<"bin" | "members" | "security" | "drive">(() => {
    if (user?.role === "admin" && (driveConnectedParam || errorParam || driveErrorParam)) return "drive";
    if (sectionParam === "bin" && canUserDelete(user?.role)) return "bin";
    if (sectionParam === "security") return "security";
    if (sectionParam === "members" && user?.role === "admin") return "members";
    return canUserDelete(user?.role) ? "bin" : "security";
  });

  // Fetch Drive Health (Admin only)
  const { data: driveHealth, isLoading: isHealthLoading, refetch: refetchHealth } = useQuery({
    queryKey: ["drive-health"],
    queryFn: async () => {
      const res = await fetch("/api/drive/health");
      if (!res.ok) return null;
      return res.json();
    },
    enabled: user?.role === "admin",
  });

  // Admin Permanent Delete Modal State
  const [deleteConfirmItem, setDeleteConfirmItem] = useState<any | null>(null);
  const [deleteInputText, setDeleteInputText] = useState("");
  const [isDeleting, setIsDeleting] = useState(false);

  // New Member Modal State
  const [showAddMember, setShowAddMember] = useState(false);
  const [newEmail, setNewEmail] = useState("");
  const [newName, setNewName] = useState("");
  const [newRole, setNewRole] = useState<"admin" | "member">("member");

  // Change PIN State
  const [showChangePin, setShowChangePin] = useState(false);
  const [newPin, setNewPin] = useState("");
  const [pinSuccess, setPinSuccess] = useState(false);

  // 1. Fetch Bin Items
  const { data: binData, isLoading: isBinLoading, refetch: refetchBin } = useQuery({
    queryKey: ["drive-bin"],
    queryFn: async () => {
      const res = await fetch("/api/drive/bin");
      if (!res.ok) return { items: [] };
      return res.json();
    },
    enabled: activeSection === "bin" && canDelete,
  });
  const binItems = binData?.items || [];

  // 2. Fetch Members (Admin only)
  const { data: membersData, isLoading: isMembersLoading, refetch: refetchMembers } = useQuery({
    queryKey: ["admin-users"],
    queryFn: async () => {
      const res = await fetch("/api/admin/users");
      if (!res.ok) return { users: [] };
      return res.json();
    },
    enabled: activeSection === "members" && user?.role === "admin",
  });
  const members = membersData?.users || [];

  // Restore item from bin
  const handleRestore = async (item: any) => {
    try {
      await fetch("/api/drive/restore", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fileId: item.id, name: item.name }),
      });
      refetchBin();
    } catch (err) {
      console.error("Failed to restore item:", err);
    }
  };

  // Permanent Delete (Admin only)
  const handlePermanentDelete = async () => {
    if (!deleteConfirmItem || deleteInputText !== "DELETE") return;
    setIsDeleting(true);
    try {
      const res = await fetch("/api/drive/permanent-delete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fileId: deleteConfirmItem.id,
          name: deleteConfirmItem.name,
          confirmationText: deleteInputText,
        }),
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Failed to delete permanently");
      }

      setDeleteConfirmItem(null);
      setDeleteInputText("");
      refetchBin();
    } catch (err: any) {
      alert(err.message);
    } finally {
      setIsDeleting(false);
    }
  };

  // Add Member
  const handleAddMember = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const res = await fetch("/api/admin/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: newEmail,
          name: newName,
          role: newRole,
        }),
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Failed to add member");
      }

      setShowAddMember(false);
      setNewEmail("");
      setNewName("");
      refetchMembers();
    } catch (err: any) {
      alert(err.message);
    }
  };

  // Toggle Member Active
  const handleToggleMember = async (id: number, currentActive: boolean) => {
    try {
      await fetch("/api/admin/users", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, active: !currentActive }),
      });
      refetchMembers();
    } catch (err) {
      console.error("Failed to toggle member active status:", err);
    }
  };

  // Change PIN submit
  const handleChangePin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (newPin.length < 4) return;
    await setupLock(newPin);
    setPinSuccess(true);
    setTimeout(() => {
      setShowChangePin(false);
      setPinSuccess(false);
      setNewPin("");
    }, 1500);
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl md:text-3xl font-extrabold text-white font-['Outfit']">
          Vault Settings & Management
        </h1>
        <p className="text-xs md:text-sm text-muted-foreground mt-0.5">
          Manage Google Drive Bin, authorized members, per-device security, and sessions.
        </p>
      </div>

      {/* Helper / Restricted Toast */}
      {restrictedToast && (
        <div className="p-3.5 rounded-2xl bg-amber-500/15 border border-amber-500/30 text-amber-300 text-xs flex items-center justify-between gap-3 animate-fadeIn">
          <div className="flex items-center gap-2.5">
            <AlertTriangle className="w-4 h-4 text-amber-400 flex-shrink-0" />
            <span>{restrictedToast}</span>
          </div>
          <button
            onClick={() => setRestrictedToast(null)}
            className="text-amber-400 hover:text-white text-xs font-semibold px-1"
          >
            ✕
          </button>
        </div>
      )}

      {/* Tabs */}
      <div className="flex bg-white/5 border border-white/10 rounded-2xl p-1 text-xs">
        <button
          onClick={() => {
            if (!canDelete) {
              setRestrictedToast(DELETE_RESTRICTED_MESSAGE);
              setTimeout(() => setRestrictedToast(null), 3500);
              return;
            }
            setActiveSection("bin");
          }}
          aria-disabled={!canDelete}
          title={canDelete ? "Drive Bin" : DELETE_RESTRICTED_MESSAGE}
          className={`flex items-center justify-center gap-2 flex-1 py-2.5 rounded-xl font-medium transition-colors ${
            !canDelete
              ? "opacity-50 cursor-not-allowed text-muted-foreground/60 hover:text-muted-foreground"
              : activeSection === "bin"
              ? "bg-white/10 text-white shadow-sm"
              : "text-muted-foreground hover:text-white"
          }`}
        >
          <Trash2 className="w-4 h-4 text-amber-400" />
          <span>Drive Bin</span>
        </button>

        {user?.role === "admin" && (
          <button
            onClick={() => setActiveSection("members")}
            className={`flex items-center justify-center gap-2 flex-1 py-2.5 rounded-xl font-medium transition-colors ${
              activeSection === "members" ? "bg-white/10 text-white shadow-sm" : "text-muted-foreground hover:text-white"
            }`}
          >
            <Users className="w-4 h-4 text-sky-400" />
            <span>Members (Neon)</span>
          </button>
        )}

        {user?.role === "admin" && (
          <button
            onClick={() => setActiveSection("drive")}
            className={`flex items-center justify-center gap-2 flex-1 py-2.5 rounded-xl font-medium transition-colors ${
              activeSection === "drive" ? "bg-white/10 text-white shadow-sm" : "text-muted-foreground hover:text-white"
            }`}
          >
            <HardDrive className="w-4 h-4 text-emerald-400" />
            <span>Connect Drive</span>
          </button>
        )}

        <button
          onClick={() => setActiveSection("security")}
          className={`flex items-center justify-center gap-2 flex-1 py-2.5 rounded-xl font-medium transition-colors ${
            activeSection === "security" ? "bg-white/10 text-white shadow-sm" : "text-muted-foreground hover:text-white"
          }`}
        >
          <Shield className="w-4 h-4 text-indigo-400" />
          <span>Device Security</span>
        </button>
      </div>

      {/* SECTION 1: DRIVE BIN */}
      {activeSection === "bin" && (
        <section className="space-y-4 animate-fadeIn">
          <div className="flex items-center justify-between pb-2 border-b border-white/5">
            <div>
              <h2 className="text-base font-bold text-white">Google Drive Bin</h2>
              <p className="text-xs text-muted-foreground">
                Nothing is auto-deleted. Restoring puts items back into their original folder.
              </p>
            </div>
            <button
              onClick={() => refetchBin()}
              className="p-2 rounded-xl bg-white/5 hover:bg-white/10 text-muted-foreground hover:text-white"
            >
              <RefreshCw className="w-4 h-4" />
            </button>
          </div>

          {isBinLoading ? (
            <div className="space-y-3">
              {[1, 2, 3].map((i) => (
                <div key={i} className="h-16 rounded-2xl bg-white/5 animate-pulse" />
              ))}
            </div>
          ) : binItems.length === 0 ? (
            <div className="p-12 rounded-3xl border border-dashed border-white/10 text-center space-y-2">
              <Trash2 className="w-8 h-8 text-muted-foreground mx-auto" />
              <p className="text-xs text-muted-foreground">The bin is empty.</p>
            </div>
          ) : (
            <div className="space-y-2.5">
              {binItems.map((item: any) => (
                <div
                  key={item.id}
                  className="glass-card p-3.5 rounded-2xl flex items-center justify-between gap-4"
                >
                  <div className="flex items-center gap-3 overflow-hidden">
                    <div className="w-9 h-9 rounded-xl bg-amber-500/10 text-amber-400 flex items-center justify-center flex-shrink-0">
                      <Trash2 className="w-4 h-4" />
                    </div>
                    <div className="overflow-hidden">
                      <p className="text-xs font-semibold text-white truncate">{item.name}</p>
                      <p className="text-[11px] text-muted-foreground">
                        {item.size ? formatBytes(parseInt(item.size, 10)) : "Folder/Item"}
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center gap-2 flex-shrink-0">
                    <button
                      onClick={() => handleRestore(item)}
                      className="px-3 py-1.5 rounded-xl bg-sky-500/15 hover:bg-sky-500/25 text-sky-300 text-xs font-medium flex items-center gap-1.5"
                    >
                      <RefreshCw className="w-3.5 h-3.5" />
                      <span>Restore</span>
                    </button>

                    {user?.role === "admin" && (
                      <button
                        onClick={() => setDeleteConfirmItem(item)}
                        className="px-3 py-1.5 rounded-xl bg-rose-500/15 hover:bg-rose-500/25 text-rose-300 text-xs font-medium"
                      >
                        Delete Permanently
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      )}

      {/* SECTION 2: MEMBERS MANAGEMENT (Admin Only) */}
      {activeSection === "members" && user?.role === "admin" && (
        <section className="space-y-4 animate-fadeIn">
          <div className="flex items-center justify-between pb-2 border-b border-white/5">
            <div>
              <h2 className="text-base font-bold text-white">Authorized Vault Members</h2>
              <p className="text-xs text-muted-foreground">
                Managed in Neon Postgres. Only active members can sign in with Google.
              </p>
            </div>
            <button
              onClick={() => setShowAddMember(true)}
              className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-sky-500/20 hover:bg-sky-500/30 text-sky-300 text-xs font-semibold border border-sky-500/30"
            >
              <UserPlus className="w-4 h-4" />
              <span>Add Member</span>
            </button>
          </div>

          {isMembersLoading ? (
            <div className="space-y-3">
              {[1, 2, 3].map((i) => (
                <div key={i} className="h-16 rounded-2xl bg-white/5 animate-pulse" />
              ))}
            </div>
          ) : (
            <div className="space-y-2.5">
              {members.map((m: any) => (
                <div
                  key={m.id}
                  className="glass-card p-3.5 rounded-2xl flex items-center justify-between gap-4"
                >
                  <div className="flex items-center gap-3 overflow-hidden">
                    <UserAvatar
                      name={m.name}
                      email={m.email}
                      picture={m.picture}
                      size="md"
                    />
                    <div className="overflow-hidden">
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-semibold text-white truncate">{getUserFullName(m)}</span>
                        <span className="text-[10px] uppercase font-mono px-2 py-0.5 rounded-full bg-white/10 text-muted-foreground">
                          {m.role}
                        </span>
                      </div>
                      <p className="text-[11px] text-muted-foreground truncate">{m.email}</p>
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => handleToggleMember(m.id, m.active)}
                      disabled={m.id === user.id}
                      className={`text-xs px-3 py-1.5 rounded-xl font-medium transition-colors ${
                        m.active
                          ? "bg-emerald-500/15 text-emerald-400 hover:bg-emerald-500/25"
                          : "bg-rose-500/15 text-rose-400 hover:bg-rose-500/25"
                      } disabled:opacity-40`}
                    >
                      {m.active ? "Active" : "Deactivated"}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      )}

      {/* SECTION 3: DEVICE SECURITY (Local Lock & Biometrics) */}
      {activeSection === "security" && (
        <section className="space-y-6 animate-fadeIn">
          {/* Info callout */}
          <div className="p-4 rounded-2xl bg-sky-500/10 border border-sky-500/20 text-xs text-sky-200 space-y-1">
            <div className="flex items-center gap-2 font-semibold text-sky-300">
              <Shield className="w-4 h-4" />
              <span>Per-Device Security Guarantee</span>
            </div>
            <p className="text-sky-200/80 leading-relaxed">
              Your PIN and biometric keys are generated and stored exclusively in this browser&apos;s IndexedDB using PBKDF2 and WebAuthn. They are never transmitted over the network or saved in Neon.
            </p>
          </div>

          {/* Biometrics Toggle */}
          <div className="glass-card p-4 rounded-2xl space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-xl bg-sky-500/15 text-sky-400 flex items-center justify-center">
                  <Fingerprint className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-xs font-semibold text-white">Biometric Unlock</h3>
                  <p className="text-[11px] text-muted-foreground">
                    Touch ID, Face ID, or Windows Hello
                  </p>
                </div>
              </div>

              {isBiometricSupported ? (
                <button
                  onClick={enableBiometrics}
                  className={`px-3 py-1.5 rounded-xl text-xs font-semibold ${
                    isBiometricRegisteredState
                      ? "bg-emerald-500/20 text-emerald-300"
                      : "bg-sky-500/20 text-sky-300 hover:bg-sky-500/30"
                  }`}
                >
                  {isBiometricRegisteredState ? "Registered" : "Enable"}
                </button>
              ) : (
                <span className="text-[11px] text-muted-foreground">Not supported on this browser</span>
              )}
            </div>
          </div>

          {/* Auto-Lock Timer */}
          <div className="glass-card p-4 rounded-2xl space-y-3">
            <div className="flex items-center gap-3 mb-2">
              <div className="w-9 h-9 rounded-xl bg-indigo-500/15 text-indigo-400 flex items-center justify-center">
                <Clock className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-xs font-semibold text-white">Auto-Lock Inactivity Timer</h3>
                <p className="text-[11px] text-muted-foreground">
                  Lock vault automatically when idle on this device
                </p>
              </div>
            </div>

            <div className="grid grid-cols-4 gap-2">
              {[1, 5, 15, 30].map((mins) => (
                <button
                  key={mins}
                  onClick={() => updateAutoLockMinutes(mins)}
                  className={`py-2 rounded-xl text-xs font-medium border transition-colors ${
                    autoLockMinutes === mins
                      ? "bg-indigo-500/20 border-indigo-500/40 text-indigo-300 shadow-sm"
                      : "bg-white/5 border-white/5 text-muted-foreground hover:text-white"
                  }`}
                >
                  {mins} min{mins > 1 ? "s" : ""}
                </button>
              ))}
            </div>
          </div>

          {/* Change PIN */}
          <div className="glass-card p-4 rounded-2xl space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-xl bg-purple-500/15 text-purple-400 flex items-center justify-center">
                  <Lock className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-xs font-semibold text-white">Device App PIN</h3>
                  <p className="text-[11px] text-muted-foreground">
                    Update the local 4-6 digit passcode for this device
                  </p>
                </div>
              </div>
              <button
                onClick={() => setShowChangePin(!showChangePin)}
                className="px-3 py-1.5 rounded-xl bg-white/5 hover:bg-white/10 text-white text-xs font-medium"
              >
                {showChangePin ? "Cancel" : "Change PIN"}
              </button>
            </div>

            {showChangePin && (
              <form onSubmit={handleChangePin} className="pt-2 flex gap-2">
                <input
                  type="password"
                  inputMode="numeric"
                  maxLength={6}
                  value={newPin}
                  onChange={(e) => setNewPin(e.target.value.replace(/\D/g, ""))}
                  placeholder="New 4-6 digit PIN"
                  className="flex-1 px-3 py-2 bg-black/40 border border-white/10 rounded-xl text-xs text-white"
                  required
                />
                <button
                  type="submit"
                  className="px-4 py-2 rounded-xl bg-sky-500/20 text-sky-300 text-xs font-semibold hover:bg-sky-500/30"
                >
                  {pinSuccess ? "Saved!" : "Save PIN"}
                </button>
              </form>
            )}
          </div>

          {/* Wipe Offline Copies */}
          <div className="glass-card p-4 rounded-2xl flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-xl bg-rose-500/15 text-rose-400 flex items-center justify-center">
                <HardDrive className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-xs font-semibold text-white">Wipe Offline Storage</h3>
                <p className="text-[11px] text-muted-foreground">
                  Remove all decrypted/encrypted documents saved on this device
                </p>
              </div>
            </div>
            <button
              onClick={async () => {
                if (confirm("Wipe all offline copies from this device?")) {
                  await wipeOfflineStorage();
                  alert("Local offline vault wiped.");
                }
              }}
              className="px-3 py-1.5 rounded-xl bg-rose-500/15 hover:bg-rose-500/25 text-rose-300 text-xs font-medium"
            >
              Wipe Device Vault
            </button>
          </div>

          {/* Logout Button */}
          <div className="pt-4">
            <button
              onClick={logout}
              className="w-full flex items-center justify-center gap-2 py-3 rounded-2xl bg-white/5 hover:bg-rose-500/15 border border-white/10 hover:border-rose-500/20 text-rose-300 text-xs font-semibold transition-colors"
            >
              <LogOut className="w-4 h-4" />
              <span>Log Out of Aavora & Clear Session</span>
            </button>
          </div>
        </section>
      )}

      {/* SECTION 4: ADMIN DRIVE CONNECTION */}
      {activeSection === "drive" && user?.role === "admin" && (
        <section className="space-y-4 animate-fadeIn">
          {driveConnectedParam === "true" && (
            <div className="p-4 rounded-2xl bg-emerald-500/10 border border-emerald-500/30 text-emerald-300 text-xs flex items-center gap-3">
              <Shield className="w-5 h-5 text-emerald-400 flex-shrink-0" />
              <div>
                <p className="font-semibold">Google Drive Connected Successfully!</p>
                <p className="text-[11px] text-emerald-200/80">Admin refresh token is encrypted and stored in the database settings.</p>
              </div>
            </div>
          )}

          {errorParam && (
            <div className="p-4 rounded-2xl bg-rose-500/10 border border-rose-500/30 text-rose-300 text-xs flex items-center gap-3 animate-slideDown">
              <AlertTriangle className="w-5 h-5 text-rose-400 flex-shrink-0" />
              <div>
                <p className="font-semibold text-white">
                  {errorParam === "wrong_account"
                    ? "Wrong Google Account"
                    : errorParam === "missing_refresh_token"
                    ? "Refresh Token Missing"
                    : errorParam === "invalid_state"
                    ? "Session Expired"
                    : `Connection Error: ${errorParam}`}
                </p>
                <p className="text-[11px] text-rose-200/90 mt-0.5">
                  {msgParam || "Failed to complete Google Drive authentication."}
                </p>
              </div>
            </div>
          )}

          <div className="glass-card p-6 rounded-2xl space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-emerald-500/15 text-emerald-400 flex items-center justify-center">
                  <HardDrive className="w-5 h-5" />
                </div>
                <div>
                  <h2 className="text-base font-bold text-white">Admin Google Drive Connection</h2>
                  <p className="text-xs text-muted-foreground">
                    Connect the designated admin Google Drive account to store and sync family documents.
                  </p>
                </div>
              </div>

              <button
                onClick={() => refetchHealth()}
                className="p-2 rounded-xl bg-white/5 hover:bg-white/10 text-muted-foreground hover:text-white"
                title="Refresh Status"
              >
                <RefreshCw className="w-4 h-4" />
              </button>
            </div>

            <div className="p-4 rounded-xl bg-black/30 border border-white/5 space-y-3">
              <div className="flex items-center justify-between text-xs">
                <span className="text-muted-foreground">Connection Status</span>
                {isHealthLoading ? (
                  <span className="text-muted-foreground">Checking status...</span>
                ) : driveHealth?.adminDriveConnected ? (
                  <span className="px-2.5 py-0.5 rounded-full bg-emerald-500/15 text-emerald-400 font-semibold text-[11px] border border-emerald-500/30">
                    Connected
                  </span>
                ) : (
                  <span className="px-2.5 py-0.5 rounded-full bg-amber-500/15 text-amber-400 font-semibold text-[11px] border border-amber-500/30">
                    Not Connected
                  </span>
                )}
              </div>

              {driveHealth?.rootFolderName && (
                <div className="flex items-center justify-between text-xs">
                  <span className="text-muted-foreground">Vault Root Folder</span>
                  <span className="text-white font-medium">{driveHealth.rootFolderName}</span>
                </div>
              )}

              {typeof driveHealth?.itemCount === "number" && (
                <div className="flex items-center justify-between text-xs">
                  <span className="text-muted-foreground">Root Items Count</span>
                  <span className="text-white font-medium">{driveHealth.itemCount} items</span>
                </div>
              )}
            </div>

            <div className="pt-2 flex flex-col sm:flex-row items-center gap-3">
              <a
                href="/api/admin/drive/connect"
                className="w-full sm:w-auto inline-flex items-center justify-center gap-2 px-5 py-2.5 rounded-xl bg-sky-500 hover:bg-sky-400 text-white font-semibold text-xs shadow-lg shadow-sky-500/20 transition active:scale-95"
              >
                <HardDrive className="w-4 h-4" />
                <span>{driveHealth?.adminDriveConnected ? "Reconnect Google Drive" : "Connect Google Drive"}</span>
              </a>
              <p className="text-[11px] text-muted-foreground">
                Opens Google OAuth with <code>drive</code> scope. Only allowed for admin account.
              </p>
            </div>
          </div>
        </section>
      )}

      {/* Admin Permanent Delete Confirmation Modal */}
      {deleteConfirmItem && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md">
          <div className="relative w-full max-w-md bg-[#0d1322] border border-rose-500/30 rounded-2xl p-6 shadow-2xl space-y-4">
            <div className="flex items-center gap-3 text-rose-400">
              <AlertTriangle className="w-6 h-6 flex-shrink-0" />
              <h3 className="text-base font-bold text-white">Permanent Deletion</h3>
            </div>
            <p className="text-xs text-muted-foreground leading-relaxed">
              You are about to permanently delete <strong>{deleteConfirmItem.name}</strong> from Google Drive. This cannot be undone.
            </p>
            <div>
              <label className="block text-xs font-medium text-muted-foreground mb-1">
                Type <strong>DELETE</strong> to confirm:
              </label>
              <input
                type="text"
                value={deleteInputText}
                onChange={(e) => setDeleteInputText(e.target.value)}
                placeholder="DELETE"
                className="w-full px-3 py-2 bg-black/40 border border-white/10 rounded-xl text-xs text-white"
              />
            </div>
            <div className="flex gap-2 justify-end pt-2">
              <button
                onClick={() => setDeleteConfirmItem(null)}
                className="px-4 py-2 text-xs rounded-xl bg-white/5 hover:bg-white/10 text-muted-foreground"
              >
                Cancel
              </button>
              <button
                onClick={handlePermanentDelete}
                disabled={deleteInputText !== "DELETE" || isDeleting}
                className="px-4 py-2 rounded-xl bg-rose-500 text-white font-semibold text-xs disabled:opacity-40"
              >
                {isDeleting ? "Deleting..." : "Permanently Delete"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Admin Add Member Modal */}
      {showAddMember && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md">
          <div className="relative w-full max-w-sm bg-[#0d1322] border border-white/10 rounded-2xl p-6 shadow-2xl space-y-4">
            <h3 className="text-base font-bold text-white">Add Allowed Member</h3>
            <form onSubmit={handleAddMember} className="space-y-3">
              <div>
                <label className="block text-xs font-medium text-muted-foreground mb-1">
                  Gmail Address
                </label>
                <input
                  type="email"
                  value={newEmail}
                  onChange={(e) => setNewEmail(e.target.value)}
                  placeholder="family.member@gmail.com"
                  className="w-full px-3 py-2 bg-black/40 border border-white/10 rounded-xl text-xs text-white"
                  required
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-muted-foreground mb-1">
                  Member Name
                </label>
                <input
                  type="text"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  placeholder="e.g. John Doe"
                  className="w-full px-3 py-2 bg-black/40 border border-white/10 rounded-xl text-xs text-white"
                  required
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-muted-foreground mb-1">Role</label>
                <select
                  value={newRole}
                  onChange={(e) => setNewRole(e.target.value as any)}
                  className="w-full px-3 py-2 bg-[#090d16] border border-white/10 rounded-xl text-xs text-white"
                >
                  <option value="member">Member</option>
                  <option value="admin">Admin</option>
                </select>
              </div>
              <div className="flex gap-2 justify-end pt-2">
                <button
                  type="button"
                  onClick={() => setShowAddMember(false)}
                  className="px-4 py-2 text-xs rounded-xl bg-white/5 text-muted-foreground"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 text-xs font-semibold rounded-xl bg-sky-500 text-white"
                >
                  Add Member
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
