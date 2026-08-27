import type { Metadata, Viewport } from "next";
import { EmbedDocument } from "@/components/widget/embed-document";
import "./embed.css";

export const metadata: Metadata = {
  title: "Support chat",
  robots: {
    index: false,
    follow: false,
  },
};

export const viewport: Viewport = {
  colorScheme: "light",
  themeColor: "#00000000",
};

export default function EmbedLayout({ children }: LayoutProps<"/embed">) {
  return <EmbedDocument>{children}</EmbedDocument>;
}
