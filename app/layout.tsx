import type { Metadata, Viewport } from "next";
import { Geist_Mono, Inter } from "next/font/google";
import { AppProviders } from "@/components/providers/app-providers";
import "./globals.css";

const _inter = Inter({ subsets: ["latin"], variable: "--font-inter" });
const _geistMono = Geist_Mono({
  subsets: ["latin"],
  variable: "--font-geist-mono",
});

export const metadata: Metadata = {
  title: "Homeio",
  description:
    "Your home server dashboard - manage all your self-hosted services in one place.",
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    title: "Homeio",
    statusBarStyle: "black-translucent",
  },
  icons: {
    icon: [
      {
        url: "/icon.png",
        type: "image/png",
        sizes: "512x512",
      },
    ],
    apple: "/apple-touch-icon.png",
  },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f4efe8" },
    { media: "(prefers-color-scheme: dark)", color: "#171615" },
  ],
  viewportFit: "cover",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="dark" suppressHydrationWarning={true}>
      <body
        className={`${_inter.variable} ${_geistMono.variable} font-sans antialiased`}
      >
        <script dangerouslySetInnerHTML={{ __html: `(function(){try{if(!localStorage.getItem('theme')&&matchMedia('(width < 48rem), (pointer: coarse) and (hover: none)').matches)localStorage.setItem('theme','system')}catch(e){}})()` }} />
        <AppProviders>{children}</AppProviders>
      </body>
    </html>
  );
}
