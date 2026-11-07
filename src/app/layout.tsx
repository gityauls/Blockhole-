import type { Metadata } from "next";
import { Inter, Manrope } from "next/font/google";
import { SiteFooter } from "@/components/site/site-footer";
import { SiteHeader } from "@/components/site/site-header";
import "./fonts/pretendard/pretendardvariable-dynamic-subset.css";
import "./globals.css";

// Inter, Manrope and Pretendard are SIL OFL 1.1: see docs/PROJECT.md before changing fonts.
const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
  // The metric-adjusted fallback would sit between Inter and Pretendard for Korean text.
  adjustFontFallback: false,
});

const manrope = Manrope({
  variable: "--font-manrope",
  weight: "700",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "File-BlackHole",
  description: "파일을 드롭하면 원하는 형식으로 바꿔 주는 웹 도구",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ko" className={`${inter.variable} ${manrope.variable} h-full antialiased`}>
      <body className="flex min-h-full flex-col">
        <a href="#main" className="skip-link">
          본문 바로가기
        </a>
        <SiteHeader />
        {children}
        <SiteFooter />
      </body>
    </html>
  );
}
