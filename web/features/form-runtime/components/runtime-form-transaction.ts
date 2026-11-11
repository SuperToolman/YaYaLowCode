"use client";
import { createContext } from "react";

/** Allows composite controls to publish one complete selection/fill operation. */
export const RuntimeTransactionContext = createContext<(action: () => void) => void>((action) => action());
