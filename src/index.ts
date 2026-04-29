#!/usr/bin/env node
/**
 * kshana-ink CLI entry point — boots pi's interactive TUI with the
 * kshana tool surface registered as an extension. Replaces the legacy
 * React Ink TUI.
 */
import "dotenv/config";
import { bootKshanaTUI } from "./agent/pi/index.js";

bootKshanaTUI(process.argv.slice(2)).catch((err) => {
  console.error("kshana-ink failed to start:", err);
  process.exit(1);
});
