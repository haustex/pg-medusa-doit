#!/usr/bin/env node
// E2E runner: packs the built plugin into the host app, then for every suite
// recreates the E2E database, migrates, creates the admin user and runs it.
//
//   DATABASE_URL=postgres://postgres:spike@127.0.0.1:55432/doit_e2e \
//   REDIS_URL=redis://127.0.0.1:56379 npm run test:e2e [-- 02 04]
//
// Refuses to run unless both URLs point at the spike containers, the database
// name starts with doit_e2e, and ports 9300/9301/9399 are free.
import { execFileSync, spawnSync } from "node:child_process"
import fs from "node:fs"
import { createRequire } from "node:module"
import path from "node:path"
import { ADMIN, APP_DIR, PORTS, ROOT } from "./lib/harness.mjs"
import { assertPortFree, assertSpikeEnv } from "./lib/guard.mjs"

const REPO = path.resolve(ROOT, "..")
const args = process.argv.slice(2)
// --sandbox: the suites against the real doit.id sandbox (need DOIT_TEST_API_KEY)
const SUITES_DIR = path.join(ROOT, args.includes("--sandbox") ? "sandbox" : "suites")
const filters = args.filter((a) => !a.startsWith("--"))
const suites = fs
  .readdirSync(SUITES_DIR)
  .filter((f) => f.endsWith(".mjs"))
  .sort()
  .filter((f) => !filters.length || filters.some((x) => f.startsWith(x) || f.includes(x)))

function step(msg) {
  console.log(`\n== ${msg}`)
}

function run(cmd, args, { cwd = APP_DIR, quiet = false } = {}) {
  const res = spawnSync(cmd, args, { cwd, stdio: quiet ? "pipe" : "inherit", env: process.env, encoding: "utf8" })
  if (res.status !== 0) {
    if (quiet) process.stderr.write(`${res.stdout ?? ""}${res.stderr ?? ""}`)
    throw new Error(`${cmd} ${args.join(" ")} exited with ${res.status}`)
  }
  return res.stdout
}

async function main() {
  const { db, dbName } = assertSpikeEnv()
  for (const port of Object.values(PORTS)) await assertPortFree(port)
  if (!suites.length) throw new Error(`no suite matches ${filters.join(" ")}`)

  step("Plugin package")
  if (!fs.existsSync(path.join(REPO, ".medusa/server/src/providers/doit/index.js"))) {
    throw new Error("Plugin is not built. Run `npm run build` first (npm run test:e2e does).")
  }
  if (!fs.existsSync(path.join(APP_DIR, "node_modules/@medusajs/medusa"))) {
    run("npm", ["ci", "--no-audit", "--no-fund"])
  }
  const packDir = path.join(APP_DIR, ".pack")
  fs.rmSync(packDir, { recursive: true, force: true })
  fs.mkdirSync(packDir)
  const tarball = JSON.parse(run("npm", ["pack", "--json", "--pack-destination", packDir], { cwd: REPO, quiet: true }))[0].filename
  // The plugin has no runtime dependencies (only peers), so unpacking is a full install.
  const target = path.join(APP_DIR, "node_modules/medusa-payment-doit")
  fs.rmSync(target, { recursive: true, force: true })
  fs.mkdirSync(target, { recursive: true })
  execFileSync("tar", ["-xzf", path.join(packDir, path.basename(tarball)), "-C", target, "--strip-components=1"])
  console.log(`installed ${path.basename(tarball)} into the host app`)

  const { Client } = createRequire(path.join(APP_DIR, "package.json"))("pg")
  const adminUrl = new URL(db)
  adminUrl.pathname = "/postgres"
  const results = []
  for (const suite of suites) {
    step(`${suite}: reset ${dbName}, migrate`)
    const client = new Client({ connectionString: adminUrl.toString() })
    await client.connect()
    await client.query(`drop database if exists "${dbName}" with (force)`)
    await client.query(`create database "${dbName}"`)
    await client.end()
    const guard = path.join(REPO, "scripts/require-spike-db.mjs")
    run("node", [guard, "npx", "medusa", "db:migrate"], { quiet: true })
    run("node", [guard, "npx", "medusa", "user", "-e", ADMIN.email, "-p", ADMIN.password], { quiet: true })

    step(suite)
    const started = Date.now()
    const res = spawnSync("node", [path.join(SUITES_DIR, suite)], { stdio: "inherit", env: process.env })
    results.push({ suite, ok: res.status === 0, seconds: Math.round((Date.now() - started) / 1000) })
  }

  step("Summary")
  for (const r of results) console.log(`${r.ok ? "PASS" : "FAIL"}  ${r.suite} (${r.seconds} s)`)
  process.exit(results.every((r) => r.ok) ? 0 : 1)
}

main().catch((e) => {
  console.error(`E2E aborted: ${e.message}`)
  process.exit(1)
})
