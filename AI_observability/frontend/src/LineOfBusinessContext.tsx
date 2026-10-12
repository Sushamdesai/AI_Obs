import { createContext, useContext, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { useSearchParams } from "react-router-dom";

interface LineOfBusinessContextValue {
  lineOfBusiness: string;
  setLineOfBusiness: (lineOfBusiness: string) => void;
}

const LineOfBusinessContext = createContext<LineOfBusinessContextValue | null>(null);

export function LineOfBusinessProvider({ children }: { children: ReactNode }) {
  const [searchParams, setSearchParams] = useSearchParams();
  const requestedLine = searchParams.get("line_of_business");
  const [lineOfBusiness, setLineOfBusinessState] = useState(requestedLine ?? "motor");

  useEffect(() => {
    if (requestedLine && requestedLine !== lineOfBusiness) {
      setLineOfBusinessState(requestedLine);
    }
  }, [lineOfBusiness, requestedLine]);

  const value = useMemo<LineOfBusinessContextValue>(() => ({
    lineOfBusiness,
    setLineOfBusiness: (nextLine) => {
      setLineOfBusinessState(nextLine);
      if (searchParams.get("line_of_business") !== nextLine) {
        const nextParams = new URLSearchParams(searchParams);
        nextParams.set("line_of_business", nextLine);
        setSearchParams(nextParams, { replace: true });
      }
    },
  }), [lineOfBusiness, searchParams, setSearchParams]);

  return <LineOfBusinessContext.Provider value={value}>{children}</LineOfBusinessContext.Provider>;
}

export function useLineOfBusiness() {
  const context = useContext(LineOfBusinessContext);
  if (!context) {
    throw new Error("useLineOfBusiness must be used within LineOfBusinessProvider.");
  }
  return context;
}
