import React, { useState } from "react";
import { getUserInitials, getUserFullName } from "../../lib/user-format";

export interface UserAvatarProps {
  name?: string | null;
  email?: string | null;
  picture?: string | null;
  className?: string;
  size?: "xs" | "sm" | "md" | "lg";
}

const sizeClasses = {
  xs: "w-6 h-6 text-[10px]",
  sm: "w-8 h-8 text-xs",
  md: "w-9 h-9 text-xs",
  lg: "w-12 h-12 text-sm",
};

export const UserAvatar: React.FC<UserAvatarProps> = ({
  name,
  email,
  picture,
  className = "",
  size = "sm",
}) => {
  const [imgError, setImgError] = useState(false);
  const fullName = getUserFullName({ name, email });
  const initials = getUserInitials(name, email);
  const baseSize = sizeClasses[size];

  if (picture && !imgError) {
    return (
      <img
        src={picture}
        alt={fullName}
        onError={() => setImgError(true)}
        className={`rounded-full object-cover border border-white/10 flex-shrink-0 ${baseSize} ${className}`}
        referrerPolicy="no-referrer"
      />
    );
  }

  return (
    <div
      className={`rounded-full bg-gradient-to-tr from-sky-500/20 to-indigo-500/20 border border-sky-400/30 text-sky-300 font-bold flex items-center justify-center flex-shrink-0 select-none shadow-sm ${baseSize} ${className}`}
      title={fullName}
      aria-label={fullName}
    >
      {initials}
    </div>
  );
};
