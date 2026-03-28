import { exec } from "node:child_process";
import { promisify } from "node:util";
import type { Logger } from "./types.js";

const execAsync = promisify(exec);

/**
 * Wrapper for the Obsidian CLI
 * Requires Obsidian 1.12.4+ with CLI enabled
 */
export class ObsidianClient {
  private vaultPath: string;
  private vaultName?: string;
  private logger: Logger;

  constructor(vaultPath: string, logger: Logger) {
    this.vaultPath = vaultPath;
    this.logger = logger;
  }

  /**
   * Execute an obsidian CLI command
   */
  private async exec(command: string, args: string = ""): Promise<string> {
    const vaultArg = this.vaultName ? `vault="${this.vaultName}"` : "";
    const fullCommand = `obsidian ${command} ${vaultArg} ${args}`.trim();

    this.logger.debug(`Executing: ${fullCommand}`);

    try {
      const { stdout, stderr } = await execAsync(fullCommand, {
        cwd: this.vaultPath,
        timeout: 30000,
      });

      if (stderr) {
        this.logger.debug(`stderr: ${stderr}`);
      }

      return stdout.trim();
    } catch (error) {
      const err = error as Error & { code?: string; stderr?: string };
      if (err.code === "ENOENT") {
        throw new Error(
          "Obsidian CLI not found. Make sure Obsidian 1.12.4+ is installed and CLI is enabled in Settings > General > Command line interface"
        );
      }
      throw new Error(`Obsidian CLI error: ${err.message}\n${err.stderr || ""}`);
    }
  }

  /**
   * Check if the Obsidian CLI is available and Obsidian is running
   */
  async checkConnection(): Promise<boolean> {
    try {
      const version = await this.exec("version");
      this.logger.verbose(`Obsidian CLI version: ${version}`);

      // Try to get vault info to confirm connection
      // The output format is tab-separated key-value pairs, one per line:
      // name	VaultName
      // path	/path/to/vault
      // files	123
      // ...
      const vaultInfo = await this.exec("vault");

      // Parse the name field from the output
      const lines = vaultInfo.split("\n");
      for (const line of lines) {
        const [key, value] = line.split("\t");
        if (key === "name" && value) {
          this.vaultName = value.trim();
          break;
        }
      }

      if (!this.vaultName) {
        this.logger.warn("Could not parse vault name from output");
        // Don't use vault parameter if we can't parse the name
      }

      this.logger.verbose(`Connected to vault: ${this.vaultName || "(default)"}`);

      return true;
    } catch {
      return false;
    }
  }

  /**
   * Get the CLI version
   */
  async getVersion(): Promise<string> {
    return this.exec("version");
  }

  /**
   * Read a file's raw content
   */
  async read(file: string): Promise<string> {
    // Remove .md extension if present for the file parameter
    const cleanPath = file.replace(/\.md$/, "");
    return this.exec("read", `file="${cleanPath}"`);
  }

  /**
   * List all files in the vault
   */
  async listFiles(folder?: string): Promise<string[]> {
    const args = folder ? `folder="${folder}" format=paths` : "format=paths";
    const output = await this.exec("files", args);
    return output
      .split("\n")
      .map((f) => f.trim())
      .filter((f) => f.length > 0 && f.endsWith(".md"));
  }

  /**
   * Get outgoing links from a file (from metadata cache)
   */
  async getLinks(file: string): Promise<string[]> {
    try {
      const cleanPath = file.replace(/\.md$/, "");
      const output = await this.exec("links", `file="${cleanPath}" format=paths`);
      return output
        .split("\n")
        .map((l) => l.trim())
        .filter((l) => l.length > 0);
    } catch {
      return [];
    }
  }

  /**
   * Execute JavaScript in Obsidian's runtime
   */
  async eval(code: string): Promise<string> {
    // Escape the code for shell - need to handle special characters
    const escapedCode = code
      .replace(/\\/g, "\\\\")
      .replace(/"/g, '\\"')
      .replace(/\$/g, "\\$")
      .replace(/`/g, "\\`")
      .replace(/\n/g, " ") // Replace newlines with spaces instead of \n
      .replace(/\s+/g, " "); // Collapse multiple spaces

    const result = await this.exec("eval", `code="${escapedCode}"`);

    // The output from obsidian eval is prefixed with "=> "
    // Strip this prefix if present
    if (result.startsWith("=> ")) {
      return result.slice(3);
    }
    return result;
  }

  /**
   * Check if a file exists in the vault
   */
  async fileExists(file: string): Promise<boolean> {
    try {
      const code = `
        const file = app.vault.getAbstractFileByPath('${file.replace(/'/g, "\\'")}');
        JSON.stringify({ exists: !!file });
      `;
      const result = await this.eval(code);
      const parsed = JSON.parse(result);
      return parsed.exists === true;
    } catch {
      return false;
    }
  }

  /**
   * Resolve a link path to its actual file path
   * Handles Obsidian's flexible linking (shortest path, etc.)
   */
  async resolveLinkPath(linkPath: string, sourcePath: string): Promise<string | null> {
    try {
      const code = `
        const dest = app.metadataCache.getFirstLinkpathDest('${linkPath.replace(/'/g, "\\'")}', '${sourcePath.replace(/'/g, "\\'")}');
        JSON.stringify({ path: dest ? dest.path : null });
      `;
      const result = await this.eval(code);
      const parsed = JSON.parse(result);
      return parsed.path;
    } catch {
      return null;
    }
  }

  /**
   * Open a file in Obsidian
   */
  async openFile(file: string): Promise<void> {
    const cleanPath = file.replace(/\.md$/, "");
    await this.exec("open", `file="${cleanPath}"`);
  }

  /**
   * Run an Obsidian command by ID
   */
  async runCommand(commandId: string): Promise<void> {
    await this.exec("command", `id="${commandId}"`);
  }

  /**
   * Get DOM element content using dev:dom
   * @param selector CSS selector
   * @param inner If true, return innerHTML; otherwise return outerHTML
   */
  async getDom(selector: string, inner: boolean = false): Promise<string> {
    const innerArg = inner ? "inner" : "";
    return this.exec("dev:dom", `selector="${selector}" ${innerArg}`);
  }

  /**
   * Get the configured attachments folder path
   */
  async getAttachmentsFolder(): Promise<string> {
    try {
      const code = `JSON.stringify({ path: app.vault.getConfig('attachmentFolderPath') || '' })`;
      const result = await this.eval(code);
      const parsed = JSON.parse(result);
      return parsed.path || "";
    } catch {
      return "";
    }
  }

  /**
   * Get the vault path
   */
  getVaultPath(): string {
    return this.vaultPath;
  }

  /**
   * Get the current view mode (source, preview, or none)
   */
  async getViewMode(): Promise<string> {
    try {
      const code = `(() => { const leaf = app.workspace.activeLeaf; if (!leaf || !leaf.view || !leaf.view.getState) return 'none'; const state = leaf.view.getState(); return state.mode || 'none'; })()`;
      const result = await this.eval(code);
      return result || "none";
    } catch {
      return "none";
    }
  }
}
