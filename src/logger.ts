import chalk from "chalk";
import type { Logger } from "./types.js";

/**
 * Create a logger with optional verbose mode
 */
export function createLogger(verbose: boolean): Logger {
  return {
    info(message: string): void {
      console.log(chalk.blue("info") + "  " + message);
    },

    success(message: string): void {
      console.log(chalk.green("done") + "  " + message);
    },

    warn(message: string): void {
      console.log(chalk.yellow("warn") + "  " + message);
    },

    error(message: string): void {
      console.log(chalk.red("error") + " " + message);
    },

    verbose(message: string): void {
      if (verbose) {
        console.log(chalk.gray("verb") + "  " + message);
      }
    },

    debug(message: string): void {
      if (verbose) {
        console.log(chalk.gray("debug") + " " + message);
      }
    },
  };
}
