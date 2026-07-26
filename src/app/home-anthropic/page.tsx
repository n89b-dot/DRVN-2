import type { Metadata } from "next";
import { JetBrains_Mono, Newsreader } from "next/font/google";

import { Clay } from "./Clay";

// Newsreader stands in for Anthropic's Copernicus/Tiempos editorial serif;
// JetBrains Mono provides the uppercase mono eyebrow/metadata voice.
const newsreader = Newsreader({
  variable: "--font-newsreader",
  subsets: ["latin"],
  style: ["normal", "italic"],
});

const jetbrainsMono = JetBrains_Mono({
  variable: "--font-jetbrains-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "DRVN · Clay — Anthropic-style home concept",
  description:
    "A DRVN home-page concept in Anthropic's design language: warm ivory canvas, clay accent, editorial serif headlines, and calm, restrained motion.",
};

/**
 * Server entry for the `/home-anthropic` "Clay" concept. The Anthropic-style
 * typefaces are loaded here and handed to the client `<Clay />` composition as
 * CSS-variable classes.
 */
export default function HomeAnthropicPage() {
  return <Clay fontClassName={`${newsreader.variable} ${jetbrainsMono.variable}`} />;
}
