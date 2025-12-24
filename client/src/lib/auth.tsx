import { createContext, useContext, ReactNode, useState, useEffect, useCallback } from "react";

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
  login: (email: string, password: string) => Promise<{ success: boolean; error?: string }>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType>({
  user: null,
  isLoading: true,
  isSuperAdmin: false,
  isClientAdmin: false,
  clientId: null,
  login: async () => ({ success: false }),
  logout: async () => {},
});

const AUTH_STORAGE_KEY = "link_monitor_auth_user";
const AUTH_TOKEN_KEY = "link_monitor_auth_token";

export function getAuthToken(): string | null {
  return localStorage.getItem(AUTH_TOKEN_KEY);
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const storedUser = localStorage.getItem(AUTH_STORAGE_KEY);
    const storedToken = localStorage.getItem(AUTH_TOKEN_KEY);
    if (storedUser && storedToken) {
      try {
        setUser(JSON.parse(storedUser));
      } catch (e) {
        localStorage.removeItem(AUTH_STORAGE_KEY);
        localStorage.removeItem(AUTH_TOKEN_KEY);
      }
    }
    setIsLoading(false);
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      
      if (!res.ok) {
        const data = await res.json();
        return { success: false, error: data.error || "Erro ao fazer login" };
      }
      
      const data = await res.json();
      const loggedUser = data.user as AuthUser;
      const token = data.token as string;
      
      localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(loggedUser));
      localStorage.setItem(AUTH_TOKEN_KEY, token);
      setUser(loggedUser);
      
      return { success: true };
    } catch (error) {
      return { success: false, error: "Erro de conexão" };
    }
  }, []);

  const logout = useCallback(async () => {
    localStorage.removeItem(AUTH_STORAGE_KEY);
    localStorage.removeItem(AUTH_TOKEN_KEY);
    setUser(null);
    try {
      await fetch("/api/auth/logout", { method: "POST" });
    } catch (e) {
      // Ignore logout errors
    }
  }, []);

  const value: AuthContextType = {
    user,
    isLoading,
    isSuperAdmin: user?.isSuperAdmin || false,
    isClientAdmin: user?.role === "admin" && !user?.isSuperAdmin,
    clientId: user?.clientId || null,
    login,
    logout,
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
