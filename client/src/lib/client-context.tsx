import { createContext, useContext, useState, ReactNode, useCallback, useEffect } from "react";
import { useAuth } from "./auth";

const STORAGE_KEY = "link_monitor_selected_client";

interface ClientContextType {
  selectedClientId: number | null;
  selectedClientName: string | null;
  setSelectedClient: (id: number | null, name: string | null) => void;
  clearSelectedClient: () => void;
  isViewingAsClient: boolean;
  isEditable: boolean;
}

const ClientContext = createContext<ClientContextType>({
  selectedClientId: null,
  selectedClientName: null,
  setSelectedClient: () => {},
  clearSelectedClient: () => {},
  isViewingAsClient: false,
  isEditable: false,
});

function getStoredClient(): { id: number | null; name: string | null } {
  try {
    const stored = sessionStorage.getItem(STORAGE_KEY);
    if (stored) {
      const parsed = JSON.parse(stored);
      return { id: parsed.id || null, name: parsed.name || null };
    }
  } catch (e) {
    // Ignore errors
  }
  return { id: null, name: null };
}

function storeClient(id: number | null, name: string | null) {
  try {
    if (id !== null) {
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify({ id, name }));
    } else {
      sessionStorage.removeItem(STORAGE_KEY);
    }
  } catch (e) {
    // Ignore errors
  }
}

export function ClientProvider({ children }: { children: ReactNode }) {
  const { user, isSuperAdmin } = useAuth();
  const [selectedClientId, setSelectedClientId] = useState<number | null>(() => {
    if (typeof window !== "undefined") {
      return getStoredClient().id;
    }
    return null;
  });
  const [selectedClientName, setSelectedClientName] = useState<string | null>(() => {
    if (typeof window !== "undefined") {
      return getStoredClient().name;
    }
    return null;
  });

  const setSelectedClient = useCallback((id: number | null, name: string | null) => {
    setSelectedClientId(id);
    setSelectedClientName(name);
    storeClient(id, name);
  }, []);

  const clearSelectedClient = useCallback(() => {
    setSelectedClientId(null);
    setSelectedClientName(null);
    storeClient(null, null);
  }, []);

  const effectiveClientId = isSuperAdmin ? selectedClientId : user?.clientId || null;
  const isViewingAsClient = isSuperAdmin && selectedClientId !== null;
  const isEditable = isSuperAdmin && selectedClientId !== null;

  return (
    <ClientContext.Provider value={{
      selectedClientId: effectiveClientId,
      selectedClientName: isSuperAdmin ? selectedClientName : user?.clientName || null,
      setSelectedClient,
      clearSelectedClient,
      isViewingAsClient,
      isEditable,
    }}>
      {children}
    </ClientContext.Provider>
  );
}

export function useClientContext() {
  return useContext(ClientContext);
}
