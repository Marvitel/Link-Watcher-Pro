import { createContext, useContext, useState, ReactNode, useCallback } from "react";
import { useAuth } from "./auth";

interface ClientContextType {
  selectedClientId: number | null;
  selectedClientName: string | null;
  setSelectedClient: (id: number | null, name: string | null) => void;
  clearSelectedClient: () => void;
  isViewingAsClient: boolean;
}

const ClientContext = createContext<ClientContextType>({
  selectedClientId: null,
  selectedClientName: null,
  setSelectedClient: () => {},
  clearSelectedClient: () => {},
  isViewingAsClient: false,
});

export function ClientProvider({ children }: { children: ReactNode }) {
  const { user, isSuperAdmin } = useAuth();
  const [selectedClientId, setSelectedClientId] = useState<number | null>(null);
  const [selectedClientName, setSelectedClientName] = useState<string | null>(null);

  const setSelectedClient = useCallback((id: number | null, name: string | null) => {
    setSelectedClientId(id);
    setSelectedClientName(name);
  }, []);

  const clearSelectedClient = useCallback(() => {
    setSelectedClientId(null);
    setSelectedClientName(null);
  }, []);

  const effectiveClientId = isSuperAdmin ? selectedClientId : user?.clientId || null;
  const isViewingAsClient = isSuperAdmin && selectedClientId !== null;

  return (
    <ClientContext.Provider value={{
      selectedClientId: effectiveClientId,
      selectedClientName: isSuperAdmin ? selectedClientName : user?.clientName || null,
      setSelectedClient,
      clearSelectedClient,
      isViewingAsClient,
    }}>
      {children}
    </ClientContext.Provider>
  );
}

export function useClientContext() {
  return useContext(ClientContext);
}
