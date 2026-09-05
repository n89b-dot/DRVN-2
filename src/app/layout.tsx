import type { Metadata } from "next";
import { headers } from "next/headers";
import { IBM_Plex_Mono, IBM_Plex_Sans } from "next/font/google";

import { MotionPolicy } from "@/components/ui";
import { siteUrl } from "@/lib/site";
import "./globals.css";

// Runs before paint; a request nonce authorizes the theme bootstrap.
const THEME_INIT_SCRIPT = `(function(){try{var m=document.cookie.match(/(?:^|; )ls-theme=([^;]*)/);if(m&&decodeURIComponent(m[1])==="night"){document.documentElement.dataset.theme="dark";}}catch(e){}})();`;

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
  "DRVN is the marketplace for used and take-off parts from modified cars. Search by part, category or car, see the build each part came off, and sell the parts you pull off your own.";

export const metadata: Metadata = {
  // Without metadataBase every relative OpenGraph/Twitter URL resolves against
  // nothing, so shared links unfurled without artwork.
  metadataBase: new URL(siteUrl()),
  title: {
    default: "DRVN — Buy and sell parts off modified cars",
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
  const nonce = (await headers()).get("x-nonce") ?? undefined;
  return (
    <html
      lang="en"
      data-scroll-behavior="smooth"
      className={`${plexSans.variable} ${plexMono.variable} h-full antialiased`}
      suppressHydrationWarning
    >
      <head>
        <script nonce={nonce} dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
      </head>
      <body className="min-h-full">
        <MotionPolicy>{children}</MotionPolicy>
      </body>
    </html>
  );
}
