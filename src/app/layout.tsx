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

/**
 * The root description is the product, not one door (F-2). DRVN is
 * car-centred with two ways in, so the site-wide wording leads with the car
 * and names both; marketplace routes override it with marketplace wording,
 * which is what a parts search engine should find.
 */
const description =
  "DRVN is the home for your car and its build. Document what you've done, follow what others are building, and buy or sell the parts that come off — with the car behind every part.";

export const metadata: Metadata = {
  // Without metadataBase every relative OpenGraph/Twitter URL resolves against
  // nothing, so shared links unfurled without artwork.
  metadataBase: new URL(siteUrl()),
  title: {
    default: "DRVN — The home for your car and its build",
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
        {/* Browsers hide a nonce from the DOM once the script has run, so the
            client always sees "" — expected, not a mismatch worth a warning
            on every page load (it buried real hydration errors). */}
        <script nonce={nonce} suppressHydrationWarning dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
      </head>
      <body className="min-h-full">
        <MotionPolicy>{children}</MotionPolicy>
      </body>
    </html>
  );
}
