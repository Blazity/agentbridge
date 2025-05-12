import type { Options } from "tsup";

export const tsup: Options = {
  entry: ["src/index.ts"],
  format: "esm",
  clean: true,
  outDir: "dist",
  banner: {
    js: "#!/usr/bin/env node",
  },
};
