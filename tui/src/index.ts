import { resolveConfig } from "./cli.ts";
import { TuiController } from "./controller.ts";
import { TerminalTuiApp } from "./terminal-app.ts";
import { pathToFileURL } from "node:url";

export async function main(): Promise<void> {
  const config = resolveConfig();
  const controller = new TuiController({ config });
  const app = new TerminalTuiApp(controller);
  await app.run();
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    await main();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`${message}\n`);
    process.exitCode = 1;
  }
}
