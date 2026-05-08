import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Civik Dashboard",
  description: "Road events reported by Civik drivers."
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
