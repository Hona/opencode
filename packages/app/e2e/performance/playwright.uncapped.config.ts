import config from "../../playwright.config"

export default {
  ...config,
  testDir: "..",
  outputDir: "../test-results-uncapped",
  use: {
    ...config.use,
    launchOptions: {
      args: ["--disable-frame-rate-limit", "--disable-gpu-vsync"],
    },
  },
}
