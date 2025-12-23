import { createContext, useContext, useState, useEffect, ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";

interface AuthUser {
  id: number;
  email: string;
  name: string;
  role: string;
  clientId: number;
  isSuperAdmin: boolean;
  clientName?: string;
}

interface AuthContextType {
  user: AuthUser | null;
  isLoading: boolean;
  isSuperAdmin: boolean;
  isClientAdmin: boolean;
  clientId: number | null;
}

const AuthContext = createContext<AuthContextType>({
  user: null,
  isLoading: true,
  isSuperAdmin: false,
  isClientAdmin: false,
  clientId: null,
});

export function AuthProvider({ children }: { children: ReactNode }) {
  const { data, isLoading } = useQuery<{ user: AuthUser }>({
    queryKey: ["/api/auth/me"],
    retry: false,
    staleTime: 5 * 60 * 1000,
  });

  const user = data?.user || null;

  const value: AuthContextType = {
    user,
    isLoading,
    isSuperAdmin: user?.isSuperAdmin || false,
    isClientAdmin: user?.role === "admin" && !user?.isSuperAdmin,
    clientId: user?.clientId || null,
  };

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
