import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Itera Studio v0",
  description: "Search real, credited art references."
};

export default function RootLayout({
  children
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
