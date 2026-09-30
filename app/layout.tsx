import type { Metadata } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";
import { GeistMono } from "geist/font/mono";
import "./globals.css";

// Font roles, per the Figma wireframe: JetBrains Mono for the "ItEra
// Studio" wordmark (extrabold, 800) and the "Based on your search" label
// (regular, 400) -- both weights loaded here so either can be used via the
// same --font-jetbrains-mono variable. Geist Mono for secondary/nav text,
// Inter for the search bar and everything results-related (cards, filters,
// counts). Geist Mono isn't in next/font/google in this Next.js version,
// so it comes from Vercel's own "geist" package (the canonical source)
// instead.
const jetbrainsMono = JetBrains_Mono({
  subsets: ["latin"],
  weight: ["400", "800"],
  variable: "--font-jetbrains-mono"
});

const inter = Inter({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-inter"
});

export const metadata: Metadata = {
  title: "Itera Studio",
  description: "Find real references from real artists."
};

export default function RootLayout({
  children
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${jetbrainsMono.variable} ${GeistMono.variable} ${inter.variable}`}
    >
      <body>{children}</body>
    </html>
  );
}
