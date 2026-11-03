import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

import { DEFAULT_ROLE, can as roleCan, isRole, type Permission, type Role } from "./roles";

const STORAGE_KEY = "gaia-role";

interface RoleContextValue {
  role: Role;
  setRole: (role: Role) => void;
  can: (permission: Permission) => boolean;
}

const RoleContext = createContext<RoleContextValue | null>(null);

export function RoleProvider({
  children,
  initialRole = DEFAULT_ROLE,
}: {
  children: ReactNode;
  initialRole?: Role;
}) {
  const [role, setRoleState] = useState<Role>(initialRole);

  // Restore the saved role after hydration so server and client render the same first frame.
  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(STORAGE_KEY);
      if (isRole(saved)) setRoleState(saved);
    } catch {
      /* storage unavailable: keep the default */
    }
  }, []);

  const setRole = useCallback((next: Role) => {
    setRoleState(next);
    try {
      window.localStorage.setItem(STORAGE_KEY, next);
    } catch {
      /* ignore */
    }
  }, []);

  const value = useMemo<RoleContextValue>(
    () => ({ role, setRole, can: (permission) => roleCan(role, permission) }),
    [role, setRole],
  );
  return <RoleContext.Provider value={value}>{children}</RoleContext.Provider>;
}

export function useRole(): RoleContextValue {
  const ctx = useContext(RoleContext);
  if (!ctx) throw new Error("useRole must be used inside <RoleProvider>");
  return ctx;
}
