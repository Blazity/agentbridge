import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
  weight: "variable",
});

export const metadata: Metadata = {
  title: "AgentBridge | Connecting APIs with AI Agents",
  description:
    "A framework for transforming complex API specifications into semantically enhanced formats optimized for AI consumption.",
  keywords: [
    "API",
    "AI agents",
    "LLM",
    "integration",
    "framework",
    "semantic API",
  ],
  openGraph: {
    title: "AgentBridge",
    description:
      "Bridging the gap between complex API specifications and AI agent capabilities",
    url: "https://agentbridge.org",
    siteName: "AgentBridge",
    locale: "en_US",
    type: "website",
  },
  twitter: {
    card: "summary",
    title: "AgentBridge",
    description:
      "Bridging the gap between complex API specifications and AI agent capabilities",
    creator: "@blazity",
  },
  robots: {
    index: true,
    follow: true,
  },
  authors: [{ name: "Blazity" }],
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className={`${inter.variable} antialiased`}>{children}</body>
    </html>
  );
}
