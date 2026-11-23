import { defineConfig } from "tsup";

export default defineConfig({
  entry: { index: "src/index.ts", "reader/index": "src/reader/index.ts" },
  format: ["esm", "cjs"],
  outExtension({ format }) {
    return { js: format === "esm" ? ".mjs" : ".cjs" };
  },
  dts: true,
  sourcemap: false,
  splitting: false,
  clean: true,
  treeshake: true,
  target: "node18",
  platform: "node",
  external: ["nodemailer", "imapflow", "mailparser"],
});
