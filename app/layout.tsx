import type { Metadata } from "next";
import "./globals.css";
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
    <html lang="en">
      <body>{children}
      </body>
    </html>
  );
}
