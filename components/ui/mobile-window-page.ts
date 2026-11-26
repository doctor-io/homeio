"use client";

import { createContext, useContext, useLayoutEffect, type Dispatch, type SetStateAction } from "react";

export type MobileWindowPage = { title: string; onBack: () => void };

export const MobileWindowPageContext = createContext<Dispatch<SetStateAction<MobileWindowPage | null>> | null>(null);

export function useMobileWindowPage(title: string | null, onBack: () => void) {
  const setPage = useContext(MobileWindowPageContext);
  useLayoutEffect(() => {
    if (!setPage || title === null) return;
    setPage({ title, onBack });
    return () => setPage(null);
  }, [onBack, setPage, title]);

  return setPage !== null && title !== null;
}
