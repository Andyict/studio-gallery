import { Suspense } from "react";
import Admin from "@/components/Admin";

// The Manager is one client app; the layout keeps it mounted while the URL changes underneath.
export default function ManagerLayout({ children }: { children: React.ReactNode }) {
  return <Suspense>{children}<Admin /></Suspense>;
}
