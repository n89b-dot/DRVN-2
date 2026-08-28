import type { StorybookConfig } from "@storybook/nextjs-vite";

/**
 * Storybook beside Livesheet (brief §AC) — the isolated-state lab. The docs
 * site (/docs) stays the design-system narrative and registry inventory;
 * Storybook is where each component's states (loading, error, empty, long
 * content, mobile) render in isolation. Local/static builds only
 * (`npm run storybook` / `storybook:build`) — no hosted or paid services.
 * Stories live in src/stories, named for the registry entries they cover.
 */
const config: StorybookConfig = {
  stories: ["../src/stories/**/*.stories.@(ts|tsx)"],
  addons: ["@storybook/addon-a11y"],
  framework: { name: "@storybook/nextjs-vite", options: {} },
  staticDirs: ["../public"],
};

export default config;
