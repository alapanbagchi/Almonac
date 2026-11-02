import type { Metadata } from "next";
import { Lora, Geist_Mono } from "next/font/google";
import localFont from "next/font/local";
import "./globals.css";

const sohne = localFont({
  src: [
    { path: "./fonts/sohne-buch.otf", weight: "400", style: "normal" },
    { path: "./fonts/sohne-buch-italic.otf", weight: "400", style: "italic" },
    { path: "./fonts/sohne-halbfett.otf", weight: "500", style: "normal" },
    { path: "./fonts/sohne-kraftig.otf", weight: "600", style: "normal" },
  ],
  variable: "--font-sohne",
  display: "swap",
});

const lora = Lora({
  variable: "--font-lora",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  style: ["normal", "italic"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Almonac",
  description: "Almonac",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${sohne.variable} ${lora.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
