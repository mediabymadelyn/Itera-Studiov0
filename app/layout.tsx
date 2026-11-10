import type { Metadata } from "next";
import { Gloock, JetBrains_Mono } from "next/font/google";
import { GeistMono } from "geist/font/mono";
import "./globals.css";

// Gloock, a high-contrast serif, for the "Itera Studio" wordmark (hero and
// navbar) and the About page's headings. Two monospace fonts for the rest:
// JetBrains Mono for headings and controls (filter chips, tags), Geist Mono
// for everything you read (search bar, cards, captions). Geist Mono isn't in
// next/font/google in this Next.js version, so it comes from Vercel's own
// "geist" package (the canonical source) instead.
const jetbrainsMono = JetBrains_Mono({
  subsets: ["latin"],
  weight: ["400", "500", "600", "800"],
  variable: "--font-jetbrains-mono"
});

const gloock = Gloock({
  subsets: ["latin"],
  weight: "400",
  variable: "--font-gloock"
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
      className={`${gloock.variable} ${jetbrainsMono.variable} ${GeistMono.variable}`}
    >
      <body>{children}</body>
    </html>
  );
}
