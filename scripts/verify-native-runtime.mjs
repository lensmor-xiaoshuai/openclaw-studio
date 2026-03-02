import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

const mode = process.argv.includes("--repair") ? "repair" : "check";
const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";

const log = (message) => {
  console.info(`[native-runtime] ${message}`);
};

const getErrorCode = (error) => {
  if (!error || typeof error !== "object" || Array.isArray(error)) return "";
  const code = error.code;
  if (typeof code !== "string") return "";
  return code.trim().toUpperCase();
};

const getErrorMessage = (error) =>
  error instanceof Error ? error.message : String(error ?? "unknown_error");

const isNativeMismatchError = (error, message) => {
  const code = getErrorCode(error);
  const normalized = message.toLowerCase();
  const hasModuleVersionSignal =
    normalized.includes("node_module_version") ||
    normalized.includes("compiled against a different node.js version");
  const hasBetterSqliteSignal =
    normalized.includes("better_sqlite3.node") || normalized.includes("better-sqlite3");
  if (!hasModuleVersionSignal || !hasBetterSqliteSignal) return false;
  return code.length === 0 || code === "ERR_DLOPEN_FAILED";
};

const isMissingBetterSqliteModule = (error, message) => {
  const code = getErrorCode(error);
  const normalized = message.toLowerCase();
  if (!normalized.includes("better-sqlite3")) return false;
  if (code === "MODULE_NOT_FOUND") return true;
  return normalized.includes("cannot find module");
};

const printRemediation = () => {
  console.error("[native-runtime] remediation: npm rebuild better-sqlite3");
  console.error("[native-runtime] remediation: npm install");
};

const verifyLoad = () => {
  try {
    require("better-sqlite3");
    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      error,
      message: getErrorMessage(error),
    };
  }
};

const rebuildBetterSqlite = () => {
  const result = spawnSync(npmCommand, ["rebuild", "better-sqlite3"], {
    stdio: "inherit",
    env: process.env,
  });
  return result.status === 0;
};

log(`mode=${mode}`);
log(`node=${process.version} abi=${process.versions.modules}`);

const firstPass = verifyLoad();
if (firstPass.ok) {
  log("better-sqlite3 load: ok");
  process.exit(0);
}

if (!isNativeMismatchError(firstPass.error, firstPass.message)) {
  if (isMissingBetterSqliteModule(firstPass.error, firstPass.message)) {
    console.error(`[native-runtime] better-sqlite3 module is missing: ${firstPass.message}`);
    printRemediation();
    process.exit(1);
  }
  console.error(`[native-runtime] better-sqlite3 load failed: ${firstPass.message}`);
  printRemediation();
  process.exit(1);
}

console.error(`[native-runtime] detected native ABI mismatch: ${firstPass.message}`);

if (mode !== "repair") {
  printRemediation();
  process.exit(1);
}

log("attempting rebuild: npm rebuild better-sqlite3");
if (!rebuildBetterSqlite()) {
  console.error("[native-runtime] rebuild failed");
  printRemediation();
  process.exit(1);
}

const secondPass = verifyLoad();
if (!secondPass.ok) {
  console.error(`[native-runtime] better-sqlite3 still failing after rebuild: ${secondPass.message}`);
  printRemediation();
  process.exit(1);
}

log("better-sqlite3 load: ok (after rebuild)");
