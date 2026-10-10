import type { MetadataRoute } from "next";
import { site } from "@/lib/site";

export default function robots(): MetadataRoute.Robots {
  const base = site.url.replace(/\/$/, "");
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      // Legal drafts and the API route are not useful in search results.
      disallow: ["/api/", "/privacy", "/terms", "/cookies"],
    },
    sitemap: `${base}/sitemap.xml`,
    host: base,
  };
}
