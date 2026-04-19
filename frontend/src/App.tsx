import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import "@xyflow/react/dist/style.css";
import { Workbench } from "./workbench/Workbench";

const queryClient = new QueryClient();

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <Workbench />
    </QueryClientProvider>
  );
}
