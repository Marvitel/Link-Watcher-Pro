import { createContext, useContext, ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { getQueryFn } from "./queryClient";

interface AuthUser {
  id: number;
  email: string;
  name: string;
  role: string;
  clientId: number | null;
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
  const { data, isLoading } = useQuery<{ user: AuthUser } | null>({
    queryKey: ["/api/auth/me"],
    queryFn: getQueryFn({ on401: "returnNull" }),
    retry: false,
    staleTime: 0,
    refetchOnWindowFocus: true,
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
