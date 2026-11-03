import { createContext, useContext, type ReactNode } from "react";

import { useSimulation, type SimApi } from "./useSimulation";

const SimContext = createContext<SimApi | null>(null);

/**
 * One shared simulation for the whole app, so playback, reset and live state stay
 * identical on every page (see ARCHITECTURE.md).
 */
export function SimProvider({
  children,
  seed = 7,
  autostart = true,
}: {
  children: ReactNode;
  seed?: number;
  autostart?: boolean;
}) {
  const sim = useSimulation(seed, { autostart });
  return <SimContext.Provider value={sim}>{children}</SimContext.Provider>;
}

export function useSim(): SimApi {
  const ctx = useContext(SimContext);
  if (!ctx) throw new Error("useSim must be used inside <SimProvider>");
  return ctx;
}
