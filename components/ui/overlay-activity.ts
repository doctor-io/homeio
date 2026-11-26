"use client";

import { createContext } from "react";

// Portaled content follows its owning screen even when the window stays mounted.
export const OverlayActivityContext = createContext(true);
