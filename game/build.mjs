// Builds the server (dist/server.js) and the client (dist/client.js) with esbuild.
import { build } from "esbuild";

const common = { bundle: true, format: "esm", logLevel: "warning", sourcemap: true };
await Promise.all([
  build({ ...common, entryPoints: ["src/server/main.ts"], outfile: "dist/server.js", platform: "node", packages: "external" }),
  build({ ...common, entryPoints: ["tools/map-preview.ts"], outfile: "dist/map-preview.js", platform: "node", packages: "external" }),
  build({ ...common, entryPoints: ["src/client/main.ts"], outfile: "dist/client.js", platform: "browser", target: "es2022" }),
]);
console.log("Built dist/server.js and dist/client.js");
