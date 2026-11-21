import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
// @ts-expect-error plain module
import { api } from "./server/api.mjs";

export default defineConfig({
  plugins: [react(), tailwindcss(), api()],
  server: { watch: { ignored: ["**/.workbench/**", "**/.rounds/**"] } },
});
