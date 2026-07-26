import type { Metadata } from "next";
import { IBM_Plex_Mono, IBM_Plex_Sans } from "next/font/google";
import { cookies } from "next/headers";

import { siteUrl } from "@/lib/site";
import "./globals.css";

const plexSans = IBM_Plex_Sans({
  variable: "--font-plex-sans",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
});

const plexMono = IBM_Plex_Mono({
  variable: "--font-plex-mono",
  subsets: ["latin"],
  weight: ["400", "500"],
});

const description =
  "DRVN is a marketplace for parts pulled off modified cars. Every car is a live sheet — list a part and it goes to market annotated with what it came off, when it was fitted, and who's watching it right now.";

export const metadata: Metadata = {
  // Without metadataBase every relative OpenGraph/Twitter URL resolves against
  // nothing, so shared links unfurled without artwork.
  metadataBase: new URL(siteUrl()),
  title: {
    default: "DRVN — The parts market where every listing comes off a drawing",
    template: "%s",
  },
  description,
  applicationName: "DRVN",
  openGraph: {
    siteName: "DRVN",
    type: "website",
    locale: "en",
    description,
  },
  twitter: { card: "summary_large_image", description },
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  // Server-rendered theme: the cookie is authoritative so the correct
  // data-theme is on <html> in the initial HTML — no DAY flash on navigation.
  const cookieStore = await cookies();
  const theme = cookieStore.get("ls-theme")?.value === "night" ? "dark" : undefined;

  return (
    <html
      lang="en"
      data-theme={theme}
      data-scroll-behavior="smooth"
      className={`${plexSans.variable} ${plexMono.variable} h-full antialiased`}
    >
      <body className="min-h-full">{children}</body>
    </html>
  );
}
