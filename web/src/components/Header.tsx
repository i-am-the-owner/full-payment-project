"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { Container } from "./Container";
import { Logo } from "./Logo";
import { ButtonLink } from "./Button";
import { primaryNav, getStarted } from "@/lib/nav";

export function Header() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const closeMenu = () => setOpen(false);

  return (
    <header className="sticky top-0 z-50 border-b border-[var(--color-border)] bg-white/90 backdrop-blur">
      <Container>
        <div className="flex h-16 items-center justify-between gap-4">
          <Logo />

          <nav
            aria-label="Primary"
            className="hidden items-center gap-1 lg:flex"
          >
            {primaryNav.map((link) => {
              const active =
                link.href === "/"
                  ? pathname === "/"
                  : pathname.startsWith(link.href);
              return (
                <Link
                  key={link.href}
                  href={link.href}
                  aria-current={active ? "page" : undefined}
                  className={`rounded-[var(--radius-sm)] px-3 py-2 text-sm font-medium transition-colors ${
                    active
                      ? "text-brand-700"
                      : "hover:text-brand-700 text-[var(--color-ink-soft)]"
                  }`}
                >
                  {link.label}
                </Link>
              );
            })}
          </nav>

          <div className="hidden lg:block">
            <ButtonLink href={getStarted.href} size="md">
              {getStarted.label}
            </ButtonLink>
          </div>

          <button
            type="button"
            className="text-brand-800 inline-flex items-center justify-center rounded-[var(--radius-sm)] p-2 lg:hidden"
            aria-expanded={open}
            aria-controls="mobile-menu"
            onClick={() => setOpen((v) => !v)}
          >
            <span className="sr-only">{open ? "Close menu" : "Open menu"}</span>
            <svg
              width="24"
              height="24"
              viewBox="0 0 24 24"
              fill="none"
              aria-hidden="true"
            >
              {open ? (
                <path
                  d="M6 6l12 12M18 6L6 18"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                />
              ) : (
                <path
                  d="M4 7h16M4 12h16M4 17h16"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                />
              )}
            </svg>
          </button>
        </div>
      </Container>

      {open && (
        <div
          id="mobile-menu"
          className="border-t border-[var(--color-border)] bg-white lg:hidden"
        >
          <Container>
            <nav aria-label="Primary (mobile)" className="flex flex-col py-3">
              {primaryNav.map((link) => (
                <Link
                  key={link.href}
                  href={link.href}
                  onClick={closeMenu}
                  className="hover:bg-brand-50 rounded-[var(--radius-sm)] px-2 py-3 text-base font-medium text-[var(--color-ink)]"
                >
                  {link.label}
                </Link>
              ))}
              <ButtonLink
                href={getStarted.href}
                size="lg"
                className="mt-3 w-full"
                onClick={closeMenu}
              >
                {getStarted.label}
              </ButtonLink>
            </nav>
          </Container>
        </div>
      )}
    </header>
  );
}
