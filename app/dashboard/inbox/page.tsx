import type { Metadata } from "next";
import { Inbox } from "@/components/dashboard/inbox/inbox";

export const metadata: Metadata = {
  title: "Inbox — MarshalDesk",
  description: "Read and reply to your visitor conversations.",
};

export default function InboxPage() {
  return <Inbox />;
}
