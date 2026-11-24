import type { Metadata } from "next"
import type { ReactNode } from "react"
import { IBM_Plex_Mono, Noto_Sans_SC, Noto_Serif_SC } from "next/font/google"
import "./globals.css"

const sans = Noto_Sans_SC({
  subsets: ["latin"],
  weight: ["400", "500", "700"],
  variable: "--font-noto",
  display: "swap",
})

const serif = Noto_Serif_SC({
  subsets: ["latin"],
  weight: ["600", "700"],
  variable: "--font-serif-face",
  display: "swap",
})

const mono = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["400", "500"],
  variable: "--font-plex",
  display: "swap",
})

export const metadata: Metadata = {
  title: "着色器代码长什么样",
  description: "逐行阅读 GLSL ES。每一则都是能在 GPU 上跑起来的顶点着色器与片段着色器。",
}

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html
      lang="zh-Hans"
      className={`${sans.variable} ${serif.variable} ${mono.variable} dark h-full antialiased`}
    >
      <body className="min-h-full bg-background text-foreground">{children}</body>
    </html>
  )
}
