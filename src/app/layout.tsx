import type { Metadata } from "next";
import { Fredoka, Geist } from "next/font/google";
import { AppHeader } from "@/components/AppHeader";
import { GlassCursor } from "@/components/GlassCursor";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const fredoka = Fredoka({
  variable: "--font-fredoka",
  subsets: ["latin"],
  weight: "600",
});

export const metadata: Metadata = {
  title: "quack",
  description: "Teach a duck out loud and find out what you actually understand.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${fredoka.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <AppHeader />
        {children}
        <GlassCursor />
      </body>
    </html>
  );
}
