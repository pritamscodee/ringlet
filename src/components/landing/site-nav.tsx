"use client";

import Link from "next/link";
import { useRef } from "react";
import { FluidHoverHighlight } from "@/components/fluid-hover-highlight";
import { Logo } from "@/components/logo";
import { Button } from "@/components/ui/button";
import { useFluidHover, useRegisterFluidHoverItem } from "@/hooks/use-fluid-hover";

const LINKS = [
  { href: "#use-cases", label: "Use Cases" },
  { href: "#how-it-works", label: "How It Works" },
  { href: "#pricing", label: "Pricing" },
];

function NavLink({
  href,
  label,
  index,
  registerItem,
}: {
  href: string;
  label: string;
  index: number;
  registerItem: (index: number, el: HTMLElement | null) => void;
}) {
  const ref = useRef<HTMLAnchorElement>(null);
  useRegisterFluidHoverItem(registerItem, index, ref);
  return (
    <a ref={ref} href={href} className="relative rounded-md px-3 py-1.5 text-sm text-foreground">
      {label}
    </a>
  );
}

export function SiteNav() {
  const strip = useRef<HTMLDivElement>(null);
  const hover = useFluidHover(strip, { axis: "x" });

  return (
    <header className="sticky top-0 z-30 border-b bg-background/85 backdrop-blur-md">
      <div className="mx-auto flex h-16 max-w-[1200px] items-center justify-between px-6">
        <Link href="/" aria-label="Ringlet home"><Logo /></Link>
        <nav aria-label="Main" ref={strip} {...hover.handlers} className="relative hidden items-center md:flex">
          <FluidHoverHighlight hover={hover} className="rounded-md" />
          {LINKS.map((l, i) => (
            <NavLink key={l.href} index={i} registerItem={hover.registerItem} {...l} />
          ))}
        </nav>
        <div className="flex items-center gap-2">
          <Button variant="ghost" className="h-10 px-4" asChild>
            <Link href="/signin">Sign In</Link>
          </Button>
          <Button className="h-10 px-4" asChild>
            <Link href="/signin">Build an Agent</Link>
          </Button>
        </div>
      </div>
    </header>
  );
}
