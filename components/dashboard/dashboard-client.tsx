"use client";

import { usePreloadedAuthQuery } from "@convex-dev/better-auth/nextjs/client";
import type { Preloaded } from "convex/react";
import { InboxIcon, LogOutIcon, MessageSquareTextIcon } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState, type ReactNode } from "react";
import { LogoMark } from "@/components/logo";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Separator } from "@/components/ui/separator";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarRail,
  SidebarTrigger,
} from "@/components/ui/sidebar";
import { Spinner } from "@/components/ui/spinner";
import { TooltipProvider } from "@/components/ui/tooltip";
import type { api } from "@/convex/_generated/api";
import { authClient } from "@/lib/auth-client";
import { cn } from "@/lib/utils";

const navItems = [
  {
    title: "Widget",
    href: "/dashboard/widget",
    icon: MessageSquareTextIcon,
  },
  {
    title: "Inbox",
    href: "/dashboard/inbox",
    icon: InboxIcon,
  },
] as const;

function initials(name?: string | null, email?: string | null) {
  const label = name?.trim() || email?.trim() || "MarshalDesk";
  return label
    .split(/\s+|@/)
    .filter(Boolean)
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

function DashboardSidebar() {
  const pathname = usePathname();

  return (
    <Sidebar collapsible="icon" variant="floating">
      <SidebarHeader className="px-1.5 py-1.5">
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton
              render={<Link href="/dashboard/widget" />}
              size="lg"
              tooltip="MarshalDesk"
              className="h-11 gap-2.5 group-data-[collapsible=icon]:justify-center"
            >
              <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground shadow-sm group-data-[collapsible=icon]:size-8">
                <LogoMark className="size-5" />
              </span>
              <span className="flex min-w-0 flex-col gap-0.5 leading-none group-data-[collapsible=icon]:sr-only">
                <span className="font-medium tracking-tight">MarshalDesk</span>
                <span className="text-xs font-normal text-sidebar-foreground/60">
                  Support workspace
                </span>
              </span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>Workspace</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {navItems.map((item) => {
                const active =
                  pathname === item.href || pathname.startsWith(`${item.href}/`);

                return (
                  <SidebarMenuItem key={item.href}>
                    <SidebarMenuButton
                      isActive={active}
                      render={<Link href={item.href} />}
                      size="lg"
                      tooltip={item.title}
                      className="h-11 gap-3 group-data-[collapsible=icon]:justify-center"
                    >
                      <item.icon />
                      {/* sr-only rather than hidden: collapsed, the icon is the
                          button's only content and would leave it unnamed. */}
                      <span className="min-w-0 truncate group-data-[collapsible=icon]:sr-only">
                        {item.title}
                      </span>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                );
              })}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
      <SidebarRail />
    </Sidebar>
  );
}

function DashboardHeader({
  user,
}: {
  user: { name?: string | null; email?: string | null } | null;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const [isSigningOut, setIsSigningOut] = useState(false);
  const [signOutError, setSignOutError] = useState<string | null>(null);
  const page = navItems.find(
    (item) => pathname === item.href || pathname.startsWith(`${item.href}/`),
  );

  async function handleSignOut() {
    if (isSigningOut) return;

    setIsSigningOut(true);
    setSignOutError(null);

    try {
      const result = await authClient.signOut();
      if (result.error) {
        setSignOutError(result.error.message ?? "We could not sign you out.");
        return;
      }

      router.replace("/");
      router.refresh();
    } catch (error) {
      setSignOutError(
        error instanceof Error ? error.message : "We could not sign you out.",
      );
    } finally {
      setIsSigningOut(false);
    }
  }

  const displayName = user?.name?.trim() || user?.email || "Workspace owner";

  return (
    <header className="relative mb-4 flex min-h-11 shrink-0 items-center justify-between gap-3 px-1 md:mb-6 md:px-0">
      <div className="flex min-w-0 items-center gap-3">
        <SidebarTrigger className="size-10 md:size-8" />
        <Separator orientation="vertical" className="h-5" />
        <div className="flex min-w-0 items-center gap-2 text-sm">
          <span className="truncate font-medium">{page?.title ?? "Dashboard"}</span>
        </div>
      </div>

      <div className="flex shrink-0 items-center gap-2 sm:gap-3">
        {signOutError ? (
          <p className="hidden max-w-56 truncate text-xs text-destructive sm:block" role="alert">
            {signOutError}
          </p>
        ) : null}
        <div className="hidden items-center gap-2 rounded-full border border-border bg-card/70 px-3 py-1.5 text-xs text-muted-foreground lg:flex">
          <span className="size-1.5 rounded-full bg-[var(--status-open)]" aria-hidden />
          All systems normal
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <Button
                variant="ghost"
                size="icon-lg"
                aria-label="Open account menu"
                className="size-10 md:size-9"
              />
            }
          >
            <Avatar>
              <AvatarFallback>{initials(user?.name, user?.email)}</AvatarFallback>
            </Avatar>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-64">
            <DropdownMenuGroup>
              <DropdownMenuLabel>
                <span className="block truncate font-medium text-foreground">
                  {displayName}
                </span>
                {user?.email ? (
                  <span className="block truncate font-normal">{user.email}</span>
                ) : null}
              </DropdownMenuLabel>
            </DropdownMenuGroup>
            <DropdownMenuSeparator />
            <DropdownMenuGroup>
              <DropdownMenuItem
                disabled={isSigningOut}
                onClick={() => void handleSignOut()}
                variant="destructive"
              >
                {isSigningOut ? <Spinner /> : <LogOutIcon />}
                {isSigningOut ? "Signing out…" : "Sign out"}
              </DropdownMenuItem>
            </DropdownMenuGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  );
}

export function DashboardClient({
  preloadedUser,
  children,
}: {
  preloadedUser: Preloaded<typeof api.auth.getCurrentUser>;
  children: ReactNode;
}) {
  const pathname = usePathname();
  const user = usePreloadedAuthQuery(preloadedUser);
  const isInbox = pathname === "/dashboard/inbox";

  return (
    <div className="bg-background text-foreground">
      <TooltipProvider delay={450}>
        <SidebarProvider
          className={cn(
            "relative bg-background",
            isInbox ? "h-svh overflow-hidden" : "min-h-svh",
          )}
        >
          <DashboardSidebar />
          <SidebarInset
            className={cn(
              "relative overflow-hidden bg-background p-4 md:p-6",
              isInbox ? "h-svh max-h-svh min-h-0" : "min-h-svh",
            )}
          >
            <div
              aria-hidden="true"
              className="bg-noise pointer-events-none absolute inset-0 opacity-[0.025]"
            />
            <DashboardHeader user={user} />
            <div
              className={cn(
                "relative flex min-h-0 flex-1 flex-col",
                isInbox ? "overflow-hidden" : "gap-4",
              )}
            >
              {children}
            </div>
          </SidebarInset>
        </SidebarProvider>
      </TooltipProvider>
    </div>
  );
}
