#!/usr/bin/env node
// Sube la versión de A.V Music en los tres sitios donde vive (package.json,
// src-tauri/Cargo.toml y src-tauri/tauri.conf.json) para lanzar un release.
// Uso:  pnpm bump 0.2.0

import { readFileSync, writeFileSync } from "node:fs";

const next = process.argv[2];
if (!next || !/^\d+\.\d+\.\d+$/.test(next)) {
  console.error("Uso: pnpm bump <X.Y.Z>  (ej: pnpm bump 0.2.0)");
  process.exit(1);
}

// package.json
const pkgPath = "package.json";
const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
pkg.version = next;
writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + "\n");

// src-tauri/Cargo.toml — la primera línea `version = "…"` es la del paquete.
const cargoPath = "src-tauri/Cargo.toml";
const cargo = readFileSync(cargoPath, "utf8").replace(
  /^version = ".*"$/m,
  `version = "${next}"`,
);
writeFileSync(cargoPath, cargo);

// src-tauri/tauri.conf.json
const confPath = "src-tauri/tauri.conf.json";
const conf = JSON.parse(readFileSync(confPath, "utf8"));
conf.version = next;
writeFileSync(confPath, JSON.stringify(conf, null, 2) + "\n");

console.log(`Versión subida a ${next} en los 3 archivos.`);
console.log(`Siguiente paso:  git tag v${next} && git push origin v${next}`);
