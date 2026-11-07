import type { Metadata } from "next";
import { Nanum_Gothic_Coding, Noto_Sans_KR } from "next/font/google";
import { SiteFooter } from "@/components/site/site-footer";
import { SiteHeader } from "@/components/site/site-header";
import "./globals.css";

// Both are SIL OFL 1.1: see docs/PROJECT.md before changing fonts.
const notoSans = Noto_Sans_KR({
  variable: "--font-noto",
  subsets: ["latin"],
  preload: false,
});

const nanumCoding = Nanum_Gothic_Coding({
  variable: "--font-nanum-coding",
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
    <html lang="ko" className={`${notoSans.variable} ${nanumCoding.variable} h-full antialiased`}>
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
