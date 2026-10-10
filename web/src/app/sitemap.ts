import type { MetadataRoute } from "next";
import { site } from "@/lib/site";
import { destinationCodes } from "@/lib/countries";

export default function sitemap(): MetadataRoute.Sitemap {
  const base = site.url.replace(/\/$/, "");
  const now = new Date();

  const staticPaths = [
    { path: "/", priority: 1 },
    { path: "/how-it-works", priority: 0.9 },
    { path: "/countries", priority: 0.9 },
    { path: "/fees", priority: 0.8 },
    { path: "/security", priority: 0.7 },
    { path: "/about", priority: 0.6 },
    { path: "/faq", priority: 0.7 },
    { path: "/contact", priority: 0.6 },
    { path: "/privacy", priority: 0.3 },
    { path: "/terms", priority: 0.3 },
    { path: "/cookies", priority: 0.3 },
  ];

  const countryPaths = destinationCodes().map((code) => ({
    path: `/countries/${code}`,
    priority: 0.6,
  }));

  return [...staticPaths, ...countryPaths].map(({ path, priority }) => ({
    url: `${base}${path}`,
    lastModified: now,
    changeFrequency: "monthly" as const,
    priority,
  }));
}
