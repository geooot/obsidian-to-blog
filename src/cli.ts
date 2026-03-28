import { Command } from "commander";
import * as path from "node:path";
import type { CliOptions } from "./types.js";

/**
 * Parse command line arguments and return options
 */
export function parseArgs(): CliOptions {
  const program = new Command();

  program
    .name("obsidian-to-blog")
    .description(
      "Generate static HTML sites from Obsidian vaults using the Obsidian CLI",
    )
    .version("1.0.0")
    .requiredOption(
      "-e, --entrypoint <file>",
      "Starting markdown file (relative to vault)",
    )
    .option("-o, --output <dir>", "Output directory", "./output")
    .option("-v, --vault <path>", "Path to Obsidian vault", process.cwd())
    .option(
      "-w, --wait-for-plugins <ms>",
      "Milliseconds to wait for plugins to render",
      "500",
    )
    .option("--verbose", "Enable verbose logging", false)
    .parse();

  const opts = program.opts();

  return {
    entrypoint: opts.entrypoint,
    output: path.resolve(opts.output),
    vault: path.resolve(opts.vault),
    waitForPlugins: parseInt(opts.waitForPlugins, 10),
    verbose: opts.verbose,
  };
}

/**
 * Display help text
 */
export function showHelp(): void {
  console.log(`
obsidian-to-blog - Generate static HTML from Obsidian vaults

USAGE:
  obsidian-to-blog -e <entrypoint> [options]

EXAMPLES:
  obsidian-to-blog -e "Home.md"
  obsidian-to-blog -e "Blog/Index.md" -o ./public
  obsidian-to-blog -e "Home.md" -v ~/Documents/MyVault --verbose

REQUIREMENTS:
  - Obsidian 1.12.4 or later
  - CLI enabled in Settings > General > Command line interface
  - Obsidian must be running

For more information, see: https://github.com/geooot/obsidian-to-blog
  `);
}
