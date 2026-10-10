/** Primary navigation — used by the header and the footer. */
export interface NavLink {
  href: string;
  label: string;
}

export const primaryNav: NavLink[] = [
  { href: "/", label: "Home" },
  { href: "/how-it-works", label: "How It Works" },
  { href: "/countries", label: "Countries" },
  { href: "/fees", label: "Fees" },
  { href: "/security", label: "Security" },
  { href: "/about", label: "About" },
  { href: "/faq", label: "FAQ" },
  { href: "/contact", label: "Contact" },
];

export const legalNav: NavLink[] = [
  { href: "/privacy", label: "Privacy Policy" },
  { href: "/terms", label: "Terms & Conditions" },
  { href: "/cookies", label: "Cookie Policy" },
];

/** The single call-to-action shown in the header and hero. */
export const getStarted: NavLink = {
  href: "/how-it-works",
  label: "Get Started",
};
