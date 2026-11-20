import type { Metadata, Viewport } from "next";
import { Figtree, Literata } from "next/font/google";
import "./globals.css";

const figtree = Figtree({ variable: "--font-figtree", subsets: ["latin"], display: "swap" });
const literata = Literata({
  variable: "--font-literata",
  subsets: ["latin"],
  style: ["normal", "italic"],
  display: "swap",
});

export const metadata: Metadata = {
  title: { default: "MyHomeLibrary", template: "%s · MyHomeLibrary" },
  description: "Catalog and share your home library.",
  openGraph: {
    type: "website",
    siteName: "MyHomeLibrary",
    title: "MyHomeLibrary",
    description: "Catalog and share your home library.",
  },
  appleWebApp: { capable: true, title: "MyHomeLibrary", statusBarStyle: "default" },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f6f0e4" },
    { media: "(prefers-color-scheme: dark)", color: "#16120e" },
  ],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${figtree.variable} ${literata.variable} h-full antialiased`}>
      <body className="min-h-full overflow-x-hidden">{children}</body>
    </html>
  );
}
