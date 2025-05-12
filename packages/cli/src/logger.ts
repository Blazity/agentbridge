// eslint-disable-next-line no-restricted-imports
import { log, spinner } from "@clack/prompts";

class Logger {
  private activeSpinner: ReturnType<typeof spinner> | null = null;
  private spinnerMessage = "";
  private verboseEnabled = false;

  setVerboseMode(enabled: boolean): void {
    this.verboseEnabled = enabled;
  }

  isVerbose(): boolean {
    return this.verboseEnabled;
  }

  info(message: string): void {
    log.info(message);
  }

  debug(message: string): void {
    if (!this.isVerbose()) return;
    log.info(`[DEBUG] ${message}`);
  }

  warn(message: string): void {
    log.warn(message);
  }

  error(message: string): void {
    log.error(message);
  }

  step(title: string): void {
    log.step(title);
  }

  startSpinner(message: string): void {
    if (this.activeSpinner) {
      this.activeSpinner.stop(this.spinnerMessage);
    }

    this.spinnerMessage = message;
    this.activeSpinner = spinner();
    this.activeSpinner.start(message);
  }

  updateSpinner(message: string): void {
    if (this.activeSpinner) {
      this.activeSpinner.message(message);
    } else {
      this.startSpinner(message);
    }
  }

  stopSpinner(message?: string): void {
    if (this.activeSpinner) {
      this.activeSpinner.stop(message || this.spinnerMessage);
      this.activeSpinner = null;
    }
  }
}

export const logger = new Logger();
