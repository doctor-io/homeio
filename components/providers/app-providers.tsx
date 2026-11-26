"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState } from "react";
import { ThemeProvider } from "@/components/theme-provider";
import { Toaster } from "@/components/ui/sonner";

export function AppProviders({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 5_000,
            gcTime: 5 * 60_000,
            refetchOnWindowFocus: false,
            retry: 1,
          },
        },
      }),
  );

  return (
    <ThemeProvider attribute="class" defaultTheme="dark" enableSystem>
      <QueryClientProvider client={queryClient}>
        {children}
        <Toaster
          position="bottom-center"
          offset="max(5.75rem, calc(var(--mobile-nav-height) + env(safe-area-inset-bottom) + 0.75rem))"
          mobileOffset={{
            bottom: "calc(var(--mobile-nav-height) + env(safe-area-inset-bottom) + 0.75rem)",
            left: "max(1rem, env(safe-area-inset-left))",
            right: "max(1rem, env(safe-area-inset-right))",
          }}
        />
      </QueryClientProvider>
    </ThemeProvider>
  );
}
