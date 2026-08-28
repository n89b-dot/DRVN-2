import type { Preview } from "@storybook/nextjs-vite";

import "../src/app/globals.css";
import "./storybook.css";

const preview: Preview = {
  parameters: {
    layout: "padded",
    backgrounds: { disable: true },
    a11y: { test: "todo" },
  },
  globalTypes: {
    theme: {
      description: "Livesheet theme",
      toolbar: { title: "Theme", items: ["day", "night"], dynamicTitle: true },
    },
  },
  initialGlobals: { theme: "day" },
  decorators: [
    (Story, context) => {
      // The app stamps data-theme on <html>; mirror that here so night mode
      // renders exactly as shipped.
      if (context.globals.theme === "night") {
        document.documentElement.dataset.theme = "dark";
      } else {
        delete document.documentElement.dataset.theme;
      }
      document.body.style.background = "var(--paper)";
      return Story();
    },
  ],
};

export default preview;
