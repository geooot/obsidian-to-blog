import fs from "fs-extra";
import * as path from "node:path";
import * as cheerio from "cheerio";
import type { ExtractedContent, Logger } from "./types.js";

/**
 * Generates static HTML pages from extracted Obsidian content
 */
export class HtmlGenerator {
  private outputDir: string;
  private logger: Logger;

  /** Map of original file paths to output HTML paths */
  private pathMap: Map<string, string> = new Map();

  /** Set of image paths that need to be copied */
  private imagesToCopy: Set<string> = new Set();

  /** Configured attachments folder */
  private attachmentsFolder: string = "";

  constructor(outputDir: string, logger: Logger) {
    this.outputDir = outputDir;
    this.logger = logger;
  }

  /**
   * Convert a vault file path to an output HTML path
   */
  private toHtmlPath(filePath: string): string {
    // Remove .md extension and add .html
    let htmlPath = filePath.replace(/\.md$/, ".html");

    // Convert to lowercase and replace spaces with hyphens for URL-friendliness
    htmlPath = htmlPath
      .toLowerCase()
      .replace(/\s+/g, "-")
      .replace(/[^a-z0-9\-/.]/g, "");

    return htmlPath;
  }

  /**
   * Convert a vault file path to a relative URL for linking
   */
  private toRelativeUrl(targetPath: string, fromPath: string): string {
    const targetHtml = this.toHtmlPath(targetPath);
    const fromHtml = this.toHtmlPath(fromPath);
    const fromDir = path.dirname(fromHtml);

    // Calculate relative path
    const relative = path.relative(fromDir, targetHtml);

    // Ensure forward slashes for URLs
    return relative.replace(/\\/g, "/");
  }

  /**
   * Escape HTML special characters
   */
  private escapeHtml(text: string): string {
    return text
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  /**
   * Resolve link references to HTML paths, filtering to only include processed files
   * @param links Array of link references (can be href values or file paths)
   * @param processedFiles Set of all processed file paths
   * @param filePathsByBasename Map for resolving basenames to full paths
   * @returns Array of HTML paths for links that exist in processed files
   */
  private resolveLinksToHtmlPaths(
    links: string[],
    processedFiles: Set<string>,
    filePathsByBasename: Map<string, string>
  ): string[] {
    const resolvedLinks: string[] = [];

    for (const link of links) {
      // Clean the link - remove anchors and normalize
      const cleanLink = link.split("#")[0].replace(/\.md$/, "").toLowerCase();

      // Try to find matching file path
      let resolvedPath: string | undefined;

      // Try exact match first (for backlinks which are already full paths)
      const linkWithMd = link.endsWith(".md") ? link : `${link}.md`;
      if (processedFiles.has(link)) {
        resolvedPath = link;
      } else if (processedFiles.has(linkWithMd)) {
        resolvedPath = linkWithMd;
      } else {
        // Try by basename
        resolvedPath = filePathsByBasename.get(cleanLink);
      }

      if (resolvedPath) {
        resolvedLinks.push(this.toHtmlPath(resolvedPath));
      }
    }

    return [...new Set(resolvedLinks)]; // Remove duplicates
  }

  /**
   * Wrap extracted content in a minimal HTML document
   */
  private wrapHtml(
    title: string,
    content: string,
    frontmatter?: Record<string, unknown>,
    outgoingLinks?: string[],
    backlinks?: string[]
  ): string {
    // Build frontmatter script tag if we have properties
    let frontmatterScript = "";
    if (frontmatter && Object.keys(frontmatter).length > 0) {
      frontmatterScript = `\n  <script type="application/json" id="frontmatter">${JSON.stringify(frontmatter)}</script>`;
    }

    // Build outgoing links script tag
    let outgoingLinksScript = "";
    if (outgoingLinks && outgoingLinks.length > 0) {
      outgoingLinksScript = `\n  <script type="application/json" id="outgoing-links">${JSON.stringify(outgoingLinks)}</script>`;
    }

    // Build backlinks script tag
    let backlinksScript = "";
    if (backlinks && backlinks.length > 0) {
      backlinksScript = `\n  <script type="application/json" id="backlinks">${JSON.stringify(backlinks)}</script>`;
    }

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${this.escapeHtml(title)}</title>${frontmatterScript}${outgoingLinksScript}${backlinksScript}
</head>
<body>
${content}
</body>
</html>`;
  }

  /**
   * Process HTML content: rewrite links and collect images
   */
  private processHtml(content: ExtractedContent, allFiles: Map<string, ExtractedContent>): string {
    // Use cheerio without adding html/head/body wrapper
    const $ = cheerio.load(content.html, { xml: false }, false);

    // Build a lookup for link resolution
    const filePathsLower = new Map<string, string>();
    for (const filePath of allFiles.keys()) {
      // Map by basename (without extension) for flexible matching
      const basename = path.basename(filePath, ".md").toLowerCase();
      filePathsLower.set(basename, filePath);

      // Also map by full path
      filePathsLower.set(filePath.toLowerCase(), filePath);
    }

    // Rewrite internal links
    $("a.internal-link, a[data-href]").each((_, el) => {
      const $el = $(el);
      const href = $el.attr("data-href") || $el.attr("href") || "";

      if (href && !href.startsWith("http") && !href.startsWith("#")) {
        // Try to find the target file
        const hrefLower = href.toLowerCase().replace(/\.md$/, "");
        const targetPath = filePathsLower.get(hrefLower);

        if (targetPath) {
          // File exists in our crawled set
          const relativeUrl = this.toRelativeUrl(targetPath, content.filePath);
          $el.attr("href", relativeUrl);
        } else {
          // Link to uncrawled file - mark as broken or leave as-is
          $el.addClass("broken-link");
        }

        // Remove Obsidian-specific attributes
        $el.removeAttr("data-href");
      }
    });

    // Process images - both <img> tags and elements with src attribute (like spans)
    $("img, [src]").each((_, el) => {
      const $el = $(el);
      const src = $el.attr("src") || "";

      if (src && !src.startsWith("http") && !src.startsWith("data:")) {
        // Decode any URL-encoded characters
        const decodedSrc = decodeURIComponent(src);

        // Track this image for copying
        this.imagesToCopy.add(decodedSrc);

        // Rewrite to assets folder - clean the filename
        let imageName = path.basename(decodedSrc);
        imageName = imageName.split("?")[0]; // Remove query string
        const assetPath = `assets/${imageName}`;

        // Calculate relative path from current file to assets
        const fromDir = path.dirname(this.toHtmlPath(content.filePath));
        const relativePath = path.relative(fromDir, assetPath) || assetPath;

        $el.attr("src", relativePath.replace(/\\/g, "/"));
      }
    });

    // Remove Obsidian-specific classes that might cause issues
    $(".is-unresolved").removeClass("is-unresolved");

    // Remove all collapse/expand indicators (headers, lists, etc.)
    $(".collapse-indicator").remove();

    // Remove target="_blank" and rel="noopener nofollow" from internal links
    $("a.internal-link").each((_, el) => {
      const $el = $(el);
      $el.removeAttr("target");
      $el.removeAttr("rel");
    });

    // Extract frontmatter properties and remove the visual metadata section
    let frontmatter: Record<string, unknown> = {};

    // Handle metadata container (properties view)
    const metadataContainer = $(".metadata-container");
    if (metadataContainer.length > 0) {
      // Try to extract properties from the metadata container
      metadataContainer.find(".metadata-property").each((_, el) => {
        const $prop = $(el);
        const key = $prop.find(".metadata-property-key").text().trim();
        const value = $prop.find(".metadata-property-value").text().trim();
        if (key) {
          frontmatter[key] = value;
        }
      });
      // Remove the visual metadata section
      metadataContainer.remove();
    }

    // Handle frontmatter code block (when rendered as YAML)
    const frontmatterBlock = $(".mod-frontmatter, .frontmatter");
    if (frontmatterBlock.length > 0) {
      // Try to parse the YAML content
      const yamlText = frontmatterBlock.find("code").text() || frontmatterBlock.text();
      if (yamlText) {
        // Simple YAML parsing for common patterns
        const lines = yamlText.split("\n");
        let currentKey = "";
        let currentArray: string[] = [];
        let inArray = false;

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) continue;

          // Check for array item
          if (trimmed.startsWith("- ")) {
            if (inArray && currentKey) {
              currentArray.push(trimmed.slice(2).replace(/^["']|["']$/g, ""));
            }
            continue;
          }

          // If we were building an array, save it
          if (inArray && currentKey && currentArray.length > 0) {
            frontmatter[currentKey] = currentArray;
            currentArray = [];
            inArray = false;
          }

          // Check for key: value
          const colonIndex = trimmed.indexOf(":");
          if (colonIndex > 0) {
            currentKey = trimmed.slice(0, colonIndex).trim();
            const value = trimmed.slice(colonIndex + 1).trim();

            if (value === "") {
              // Could be start of array or nested object
              inArray = true;
              currentArray = [];
            } else {
              // Simple value - remove quotes if present
              const cleanValue = value.replace(/^["']|["']$/g, "");
              // Try to parse as number or boolean
              if (cleanValue === "true") {
                frontmatter[currentKey] = true;
              } else if (cleanValue === "false") {
                frontmatter[currentKey] = false;
              } else if (/^-?\d+(\.\d+)?$/.test(cleanValue)) {
                frontmatter[currentKey] = parseFloat(cleanValue);
              } else {
                frontmatter[currentKey] = cleanValue;
              }
              inArray = false;
            }
          }
        }

        // Save any remaining array
        if (inArray && currentKey && currentArray.length > 0) {
          frontmatter[currentKey] = currentArray;
        }
      }
      // Remove the frontmatter block
      frontmatterBlock.remove();
    }

    // Also remove the mod-header container if it's now empty or only has metadata
    $(".mod-header").each((_, el) => {
      const $header = $(el);
      // Remove if empty or only contains inline-title
      const children = $header.children().not(".inline-title");
      if (children.length === 0) {
        $header.remove();
      }
    });

    // Remove the embedded backlinks section (mod-footer with backlinks)
    $(".mod-footer").remove();
    $(".embedded-backlinks").remove();

    // Remove any empty wrapper divs
    $(".markdown-preview-pusher").remove();

    // Store frontmatter for later use
    (content as ExtractedContent & { frontmatter?: Record<string, unknown> }).frontmatter =
      frontmatter;

    return $.html();
  }

  /**
   * Generate all HTML pages from crawled content
   */
  async generate(
    contents: Map<string, ExtractedContent>,
    vaultPath: string,
    attachmentsFolder: string = ""
  ): Promise<void> {
    this.attachmentsFolder = attachmentsFolder;
    this.logger.info(`Generating ${contents.size} HTML pages...`);

    // Ensure output directory exists
    await fs.ensureDir(this.outputDir);

    // Clear any previous images set
    this.imagesToCopy.clear();

    // Build lookup maps for link resolution
    const processedFiles = new Set(contents.keys());
    const filePathsByBasename = new Map<string, string>();
    for (const filePath of processedFiles) {
      const basename = path.basename(filePath, ".md").toLowerCase();
      filePathsByBasename.set(basename, filePath);
      filePathsByBasename.set(filePath.toLowerCase(), filePath);
    }

    // Process each file
    for (const [filePath, content] of contents) {
      const htmlPath = this.toHtmlPath(filePath);
      const outputPath = path.join(this.outputDir, htmlPath);

      this.logger.verbose(`Generating: ${htmlPath}`);

      // Process HTML content (this also extracts frontmatter)
      const processedHtml = this.processHtml(content, contents);

      // Get frontmatter that was extracted during processing
      const contentWithFrontmatter = content as ExtractedContent & {
        frontmatter?: Record<string, unknown>;
      };

      // Resolve outgoing links to HTML paths (only for processed files)
      const outgoingLinks = this.resolveLinksToHtmlPaths(
        content.links,
        processedFiles,
        filePathsByBasename
      );

      // Filter backlinks to only include processed files and convert to HTML paths
      const backlinks = this.resolveLinksToHtmlPaths(
        content.backlinks,
        processedFiles,
        filePathsByBasename
      );

      // Wrap in full HTML document
      const fullHtml = this.wrapHtml(
        content.title,
        processedHtml,
        contentWithFrontmatter.frontmatter,
        outgoingLinks,
        backlinks
      );

      // Ensure directory exists
      await fs.ensureDir(path.dirname(outputPath));

      // Write file
      await fs.writeFile(outputPath, fullHtml, "utf-8");

      this.pathMap.set(filePath, htmlPath);
    }

    // Copy images
    await this.copyImages(vaultPath);

    this.logger.info(`Generated ${contents.size} pages in ${this.outputDir}`);
  }

  /**
   * Copy images to the output assets directory
   */
  private async copyImages(vaultPath: string): Promise<void> {
    if (this.imagesToCopy.size === 0) {
      return;
    }

    const assetsDir = path.join(this.outputDir, "assets");
    await fs.ensureDir(assetsDir);

    let copied = 0;
    let failed = 0;

    for (const imagePath of this.imagesToCopy) {
      try {
        // Handle app:// URLs from Obsidian - extract the actual path
        // Format: app://HASH/absolute/path/to/file.ext?timestamp
        let cleanPath = imagePath;
        if (imagePath.startsWith("app://")) {
          // Extract path after the hash portion
          const match = imagePath.match(/^app:\/\/[^/]+(\/.+?)(?:\?.*)?$/);
          if (match) {
            cleanPath = match[1];
          }
        }

        // Remove query strings
        cleanPath = cleanPath.split("?")[0];

        // Get just the filename for searching
        const filename = path.basename(cleanPath);

        // Try different possible source paths
        const possiblePaths = [
          cleanPath, // Absolute path extracted from app:// URL
          path.join(vaultPath, cleanPath),
          path.join(vaultPath, imagePath.split("?")[0]),
          path.join(vaultPath, decodeURIComponent(cleanPath)),
        ];

        // Add configured attachments folder if set
        if (this.attachmentsFolder) {
          possiblePaths.push(path.join(vaultPath, this.attachmentsFolder, filename));
        }

        // Common attachment locations as fallback
        possiblePaths.push(
          path.join(vaultPath, "attachments", filename),
          path.join(vaultPath, "Attachments", filename),
          path.join(vaultPath, "assets", filename),
          path.join(vaultPath, "Assets", filename),
          path.join(vaultPath, "images", filename),
          path.join(vaultPath, "Images", filename),
          // Root of vault
          path.join(vaultPath, filename)
        );

        let sourcePath: string | null = null;
        for (const p of possiblePaths) {
          if (await fs.pathExists(p)) {
            sourcePath = p;
            break;
          }
        }

        if (sourcePath) {
          // Clean the filename - remove query strings
          let cleanFilename = path.basename(sourcePath);
          cleanFilename = cleanFilename.split("?")[0];
          const destPath = path.join(assetsDir, cleanFilename);
          await fs.copy(sourcePath, destPath, { overwrite: true });
          copied++;
        } else {
          this.logger.warn(`Image not found: ${imagePath}`);
          failed++;
        }
      } catch (error) {
        const err = error as Error;
        this.logger.warn(`Failed to copy image ${imagePath}: ${err.message}`);
        failed++;
      }
    }

    if (copied > 0) {
      this.logger.verbose(`Copied ${copied} images to assets/`);
    }
    if (failed > 0) {
      this.logger.warn(`Failed to copy ${failed} images`);
    }
  }

  /**
   * Get the path map for reference
   */
  getPathMap(): Map<string, string> {
    return this.pathMap;
  }
}
