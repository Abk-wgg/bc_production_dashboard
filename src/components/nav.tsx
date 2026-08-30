"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const LINKS = [
  { href: "/", label: "Production orders", className: "to-orders" },
  { href: "/components", label: "Component list", className: "to-components" },
  { href: "/schedule", label: "Schedule", className: "to-schedule" },
  { href: "/vendors", label: "By vendor", className: "to-vendors" },
];

export default function Nav() {
  const pathname = usePathname();

  return (
    <nav className="nav">
      {LINKS.map((link) => (
        <Link
          key={link.href}
          href={link.href}
          className={link.className}
          // aria-current does double duty: it tells a screen reader which page
          // this is, and it is what the stylesheet highlights on.
          aria-current={pathname === link.href ? "page" : undefined}
        >
          {link.label}
        </Link>
      ))}
    </nav>
  );
}
