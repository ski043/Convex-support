"use client";

import { useLayoutEffect, type ReactNode } from "react";

function lockEmbedDocument() {
  const root = document.documentElement;
  root.classList.remove("dark");
  root.classList.add("light");
  root.style.setProperty("color-scheme", "light", "important");
  root.style.setProperty("background", "transparent", "important");
  document.body.style.setProperty("background", "transparent", "important");
  document.body.style.setProperty("background-color", "transparent", "important");
}

export function EmbedDocument({ children }: { children: ReactNode }) {
  useLayoutEffect(() => {
    lockEmbedDocument();

    const observer = new MutationObserver(() => {
      if (document.documentElement.classList.contains("dark")) {
        lockEmbedDocument();
      }
    });
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class"],
    });

    return () => observer.disconnect();
  }, []);

  return <div id="marshaldesk-embed-root">{children}</div>;
}
