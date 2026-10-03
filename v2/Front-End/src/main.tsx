import React from "react";
import ReactDOM from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import App from "./App";
import "./index.css";
const client = new QueryClient({
  defaultOptions: {
    queries: {
      retry: (count, error) =>
        count < 1 &&
        !(error as { status?: number }).status?.toString().startsWith("4"),
      refetchOnWindowFocus: true,
    },
    mutations: { retry: false },
  },
});
ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <QueryClientProvider client={client}>
      <TooltipProvider>
        <App />
        <Toaster richColors position="bottom-right" />
      </TooltipProvider>
    </QueryClientProvider>
  </React.StrictMode>,
);
