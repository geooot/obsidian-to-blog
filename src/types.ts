/**
 * CLI options parsed from command line arguments
 */
export interface CliOptions {
  /** Starting markdown file (relative to vault) */
  entrypoint: string;
  /** Output directory for generated HTML */
  output: string;
  /** Path to Obsidian vault */
  vault: string;
  /** Milliseconds to wait for plugins to render */
  waitForPlugins: number;
  /** Enable verbose logging */
  verbose: boolean;
}

/**
 * Content extracted from a rendered Obsidian note
 */
export interface ExtractedContent {
  /** The rendered HTML content */
  html: string;
  /** File title (basename without extension) */
  title: string;
  /** Internal links found in rendered HTML (outgoing) */
  links: string[];
  /** Backlinks - files that link to this file (incoming) */
  backlinks: string[];
  /** Image references found in rendered HTML */
  images: string[];
  /** Original file path in vault */
  filePath: string;
}

/**
 * Result from obsidian eval command
 */
export interface EvalResult {
  html?: string;
  title?: string;
  links?: string[];
  images?: string[];
  error?: string;
}

/**
 * A node in the link graph
 */
export interface GraphNode {
  /** File path relative to vault */
  path: string;
  /** Extracted content (populated after extraction) */
  content?: ExtractedContent;
  /** Outgoing links to other files */
  outLinks: string[];
  /** Whether this file has been processed */
  processed: boolean;
}

/**
 * Image asset to be copied
 */
export interface ImageAsset {
  /** Original path/reference in the vault */
  sourcePath: string;
  /** Destination path in output directory */
  destPath: string;
  /** New src value for HTML */
  htmlSrc: string;
}

/**
 * Logger interface for consistent output
 */
export interface Logger {
  info(message: string): void;
  success(message: string): void;
  warn(message: string): void;
  error(message: string): void;
  verbose(message: string): void;
  debug(message: string): void;
}
