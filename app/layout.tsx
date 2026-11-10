import type { Metadata } from "next";
import { JetBrains_Mono } from "next/font/google";
import { GeistMono } from "geist/font/mono";
import "./globals.css";

// Two monospace fonts, nothing else: JetBrains Mono for the "Itera Studio"
// wordmark, headings and controls (filter chips, tags), Geist Mono for
// everything you read (search bar, cards, captions). Geist Mono isn't in
// next/font/google in this Next.js version, so it comes from Vercel's own
// "geist" package (the canonical source) instead.
const jetbrainsMono = JetBrains_Mono({
  subsets: ["latin"],
  weight: ["400", "500", "600", "800"],
  variable: "--font-jetbrains-mono"
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
      className={`${jetbrainsMono.variable} ${GeistMono.variable}`}
    >
      <body>{children}</body>
    </html>
  );
}
