"use client";

import { useQueryClient } from "@tanstack/react-query";
import {
  Bot,
  Gauge,
  Inbox,
  LayoutDashboard,
  LogOut,
  MessagesSquare,
  Settings,
} from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useRef } from "react";
import { FluidHoverHighlight } from "@/components/fluid-hover-highlight";
import { useFluidHover, useRegisterFluidHoverItem } from "@/hooks/use-fluid-hover";
import { formatMinutes } from "@/components/app-ui";
import { Logo } from "@/components/logo";
import { Button } from "@/components/ui/button";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Separator } from "@/components/ui/separator";
import { WorkspaceProvider, useWorkspace } from "@/components/workspace";
import { authClient } from "@/lib/auth-client";
import { cn } from "@/lib/utils";

const NAV = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/agents", label: "Agents", icon: Bot },
  { href: "/conversations", label: "Conversations", icon: MessagesSquare },
  { href: "/captures", label: "Leads & Bookings", icon: Inbox },
  { href: "/usage", label: "Usage", icon: Gauge },
  { href: "/settings", label: "Settings", icon: Settings },
];

function NavItem({
  href,
  label,
  icon: Icon,
  active,
  index,
  registerItem,
}: (typeof NAV)[number] & {
  active: boolean;
  index: number;
  registerItem: (index: number, el: HTMLElement | null) => void;
}) {
  const ref = useRef<HTMLAnchorElement>(null);
  useRegisterFluidHoverItem(registerItem, index, ref);
  return (
    <Link
      ref={ref}
      href={href}
      aria-current={active ? "page" : undefined}
      className={cn(
        "relative flex items-center gap-2.5 rounded-md px-2.5 py-2 text-sm transition-[color,background-color] duration-150",
        active ? "bg-accent font-medium text-primary" : "text-foreground",
      )}
    >
      <Icon className="size-4" strokeWidth={1.5} /> {label}
    </Link>
  );
}

function Sidebar() {
  const navRef = useRef<HTMLElement>(null);
  const hover = useFluidHover(navRef, { axis: "y" });
  const pathname = usePathname();
  const router = useRouter();
  const queryClient = useQueryClient();
  const { workspace, workspaces, switchTo } = useWorkspace();
  const low = workspace.creditSeconds < 5 * 60;

  return (
    <aside className="sticky top-0 flex h-screen w-60 shrink-0 flex-col border-r bg-background-lighter px-3 py-4">
      <Link href="/dashboard" className="mb-5 px-2"><Logo /></Link>
      {workspaces.length > 1 ? (
        <NativeSelect
          className="mb-4 w-full"
          value={workspace.id}
          onChange={(e) => switchTo(e.target.value)}
        >
          {workspaces.map((w) => (
            <NativeSelectOption key={w.id} value={w.id}>{w.name}</NativeSelectOption>
          ))}
        </NativeSelect>
      ) : (
        <div className="mb-4 truncate px-2 text-sm text-muted-foreground">{workspace.name}</div>
      )}
      <nav ref={navRef} {...hover.handlers} className="relative flex-1">
        <FluidHoverHighlight hover={hover} className="rounded-md" />
        {NAV.map((item, i) => (
          <NavItem
            key={item.href}
            {...item}
            index={i}
            registerItem={hover.registerItem}
            active={pathname === item.href || pathname.startsWith(`${item.href}/`)}
          />
        ))}
      </nav>
      <Link
        href="/usage"
        className={cn(
          "mb-3 rounded-md border px-3 py-2 text-xs",
          low ? "border-warning/30 bg-warning/10 text-warning" : "text-muted-foreground",
        )}
      >
        <div className="font-mono font-medium">{formatMinutes(workspace.creditSeconds)} left</div>
        {low && <div>Running low: ask a workspace owner for more minutes</div>}
      </Link>
      <Separator className="mb-2" />
      <Button
        variant="ghost"
        className="justify-start text-muted-foreground"
        onClick={() =>
          void authClient.signOut().then(() => {
            queryClient.clear();
            router.push("/signin");
          })
        }
      >
        <LogOut /> Sign Out
      </Button>
    </aside>
  );
}

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  return (
    <WorkspaceProvider>
      <div className="flex">
        <Sidebar />
        <main className="min-w-0 flex-1 px-8 py-8">
          <div key={pathname} className="reveal-product mx-auto max-w-6xl">{children}</div>
        </main>
      </div>
    </WorkspaceProvider>
  );
}
