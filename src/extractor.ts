import * as cheerio from "cheerio";
import type { ObsidianClient } from "./obsidian.js";
import type { ExtractedContent, Logger } from "./types.js";

/**
 * Extracts rendered HTML content from Obsidian notes.
 * Uses a multi-step approach to avoid async race conditions in the CLI:
 * 1. Open the file with `obsidian open`
 * 2. Switch to preview mode with `obsidian command`
 * 3. Wait for plugins to render (sleep in Node.js, not in Obsidian)
 * 4. Extract HTML with `obsidian dev:dom`
 */
export class HtmlExtractor {
  private client: ObsidianClient;
  private waitTime: number;
  private logger: Logger;

  constructor(client: ObsidianClient, waitTime: number, logger: Logger) {
    this.client = client;
    this.waitTime = waitTime;
    this.logger = logger;
  }

  /**
   * Sleep for a given number of milliseconds
   */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Extract rendered HTML content from a note
   */
  async extract(filePath: string): Promise<ExtractedContent> {
    this.logger.verbose(`Extracting HTML from: ${filePath}`);

    // Step 1: Open the file
    await this.client.openFile(filePath);

    // Step 2: Switch to preview/reading mode
    await this.client.runCommand("markdown:toggle-preview");

    // Step 3: Wait for plugins to render
    await this.sleep(this.waitTime);

    // Step 4: Extract the HTML from the preview container
    const html = await this.client.getDom(".markdown-preview-view", true);

    if (!html || html.trim().length === 0) {
      throw new Error(`No HTML content extracted from ${filePath}`);
    }

    // Parse HTML to extract links and images
    const $ = cheerio.load(html);

    // Extract internal links
    const links: string[] = [];
    $("a.internal-link, a[data-href]").each((_, el) => {
      const href = $(el).attr("data-href") || $(el).attr("href");
      if (href && !href.startsWith("http") && !href.startsWith("#")) {
        links.push(href);
      }
    });

    // Extract images
    const images: string[] = [];
    $("img").each((_, el) => {
      const src = $(el).attr("src");
      if (src) {
        images.push(src);
      }
    });

    // Get title from the file path
    const title = filePath.replace(/\.md$/, "").split("/").pop() || "Untitled";

    return {
      html,
      title,
      links: [...new Set(links)],
      images: [...new Set(images)],
      filePath,
    };
  }

  /**
   * Parse wikilinks and markdown links from raw markdown content
   * This is used as a first pass before HTML extraction
   */
  parseMarkdownLinks(content: string): string[] {
    const links: Set<string> = new Set();

    // Match [[wikilinks]] and [[wikilinks|alias]]
    const wikiLinkRegex = /\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|[^\]]+)?\]\]/g;
    let match;
    while ((match = wikiLinkRegex.exec(content)) !== null) {
      links.add(match[1].trim());
    }

    // Match [text](path) markdown links (excluding http/https)
    const mdLinkRegex = /\[([^\]]*)\]\(([^)#]+)(?:#[^)]*)?\)/g;
    while ((match = mdLinkRegex.exec(content)) !== null) {
      const path = match[2].trim();
      if (!path.startsWith("http://") && !path.startsWith("https://")) {
        links.add(path);
      }
    }

    return Array.from(links);
  }

  /**
   * Parse image references from raw markdown content
   */
  parseMarkdownImages(content: string): string[] {
    const images: Set<string> = new Set();

    // Match ![[image]] wikilinks
    const wikiImageRegex = /!\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/g;
    let match;
    while ((match = wikiImageRegex.exec(content)) !== null) {
      images.add(match[1].trim());
    }

    // Match ![alt](path) markdown images
    const mdImageRegex = /!\[([^\]]*)\]\(([^)]+)\)/g;
    while ((match = mdImageRegex.exec(content)) !== null) {
      const path = match[2].trim();
      if (!path.startsWith("http://") && !path.startsWith("https://")) {
        images.add(path);
      }
    }

    return Array.from(images);
  }
}
