import ora from "ora";
import { parseArgs } from "./cli.js";
import { createLogger } from "./logger.js";
import { ObsidianClient } from "./obsidian.js";
import { HtmlExtractor } from "./extractor.js";
import { LinkCrawler } from "./crawler.js";
import { HtmlGenerator } from "./generator.js";

async function main(): Promise<void> {
  // Parse command line arguments
  const options = parseArgs();
  const logger = createLogger(options.verbose);

  logger.info(`obsidian-to-blog v1.0.0`);
  logger.verbose(`Options: ${JSON.stringify(options, null, 2)}`);

  // Check Obsidian CLI connection
  const spinner = ora("Connecting to Obsidian...").start();

  const client = new ObsidianClient(options.vault, logger);
  const connected = await client.checkConnection();

  if (!connected) {
    spinner.fail("Could not connect to Obsidian");
    logger.error("");
    logger.error("Make sure:");
    logger.error("  1. Obsidian 1.12.4 or later is installed");
    logger.error("  2. Obsidian is currently running");
    logger.error("  3. CLI is enabled in Settings > General > Command line interface");
    logger.error("");
    logger.error("For setup instructions, see: https://obsidian.md/help/cli");
    process.exit(1);
  }

  spinner.succeed("Connected to Obsidian");

  // Create components
  const extractor = new HtmlExtractor(client, options.waitForPlugins, logger);
  const crawler = new LinkCrawler(client, extractor, logger);
  const generator = new HtmlGenerator(options.output, logger);

  // Start crawling
  spinner.start(`Crawling from ${options.entrypoint}...`);

  let contents;
  try {
    contents = await crawler.crawl(options.entrypoint);
  } catch (error) {
    const err = error as Error;
    spinner.fail(`Crawl failed: ${err.message}`);
    process.exit(1);
  }

  if (contents.size === 0) {
    spinner.fail("No files were crawled");
    logger.error("The entrypoint file may not exist or has no links.");
    process.exit(1);
  }

  spinner.succeed(`Crawled ${contents.size} files`);

  // Get attachments folder configuration
  const attachmentsFolder = await client.getAttachmentsFolder();
  if (attachmentsFolder) {
    logger.verbose(`Attachments folder: ${attachmentsFolder}`);
  }

  // Generate HTML
  spinner.start("Generating HTML pages...");

  try {
    await generator.generate(contents, options.vault, attachmentsFolder);
  } catch (error) {
    const err = error as Error;
    spinner.fail(`Generation failed: ${err.message}`);
    process.exit(1);
  }

  spinner.succeed(`Generated ${contents.size} HTML pages`);

  // Summary
  logger.info("");
  logger.success(`Site generated successfully!`);
  logger.info(`Output: ${options.output}`);
  logger.info("");

  // List generated files in verbose mode
  if (options.verbose) {
    const pathMap = generator.getPathMap();
    logger.verbose("Generated files:");
    for (const [source, dest] of pathMap) {
      logger.verbose(`  ${source} -> ${dest}`);
    }
  }
}

// Run
main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
