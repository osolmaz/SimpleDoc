import process from "node:process";
import { cancel } from "@clack/prompts";

export function abort(message = "Aborted."): void {
  cancel(message);
  process.exitCode = 1;
}

export function getErrorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}

export function hasInteractiveTty(): boolean {
  return Boolean(process.stdin.isTTY && process.stdout.isTTY);
}
