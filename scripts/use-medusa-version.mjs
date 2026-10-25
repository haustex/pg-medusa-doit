// Switches a project to another Medusa 2.x release for the CI version matrix:
// every @medusajs/* dependency pinned to an exact version is re-pinned to
// <version> in package.json and `npm install` re-resolves the tree.
//
// This EDITS package.json and package-lock.json, so it only runs with --write.
// CI uses it on a throwaway checkout; locally, undo with
//   git checkout package.json package-lock.json integration-tests/app && npm ci
//
// Usage: node scripts/use-medusa-version.mjs --write <2.x.y> [dir…]   (default dir: .)
// @medusajs/ui has its own 4.x versioning: it moves to the version the release's
// @medusajs/dashboard uses, because Medusa's own plugins (e.g. @medusajs/draft-order,
// loaded by default from the project root) pin it exactly as a peer; with an older
// ui pinned, npm nests them under @medusajs/medusa where Medusa cannot find them.
// The ESLint plugin is left alone.
import { spawnSync } from "node:child_process"
import fs from "node:fs"
import path from "node:path"

const args = process.argv.slice(2)
const write = args.includes("--write")
const [version, ...dirs] = args.filter((a) => a !== "--write")
if (!/^2\.\d+\.\d+$/.test(version ?? "") || !write) {
  console.error("Usage: node scripts/use-medusa-version.mjs --write <2.x.y> [dir…]  (edits package.json and the lock file)")
  process.exit(1)
}
const SKIP = new Set(["@medusajs/eslint-plugin"])

const view = spawnSync("npm", ["view", `@medusajs/dashboard@${version}`, "dependencies.@medusajs/ui"], { encoding: "utf8" })
const uiVersion = view.status === 0 ? view.stdout.trim() : ""
if (!/^\d+\.\d+\.\d+$/.test(uiVersion)) {
  console.error(`Could not find the @medusajs/ui version of Medusa ${version}`)
  process.exit(1)
}
const target = (name) => (name === "@medusajs/ui" ? uiVersion : version)

for (const dir of dirs.length ? dirs : ["."]) {
  const file = path.join(dir, "package.json")
  const pkg = JSON.parse(fs.readFileSync(file, "utf8"))
  const moved = []
  for (const field of ["dependencies", "devDependencies"]) {
    for (const [name, spec] of Object.entries(pkg[field] ?? {})) {
      if (name.startsWith("@medusajs/") && !SKIP.has(name) && /^\d+\.\d+\.\d+$/.test(spec) && spec !== target(name)) {
        pkg[field][name] = target(name)
        moved.push(name)
      }
    }
  }
  if (!moved.length) {
    console.log(`${dir}: already on ${version}`)
    continue
  }
  fs.writeFileSync(file, JSON.stringify(pkg, null, 2) + "\n")
  // Drop the locked @medusajs/* placements so they resolve fresh for the new
  // release; everything else stays locked. (Kept, npm leaves the old top-level
  // copies in place and nests the new ones under @medusajs/medusa.)
  const lockFile = path.join(dir, "package-lock.json")
  if (fs.existsSync(lockFile)) {
    const lock = JSON.parse(fs.readFileSync(lockFile, "utf8"))
    for (const key of Object.keys(lock.packages ?? {})) {
      if (/(^|\/)node_modules\/@medusajs\//.test(key)) delete lock.packages[key]
    }
    fs.writeFileSync(lockFile, JSON.stringify(lock, null, 2) + "\n")
  }
  console.log(`${dir}: ${moved.join(", ")} → ${version} (ui ${uiVersion}); npm install`)
  const res = spawnSync("npm", ["install", "--no-audit", "--no-fund"], { cwd: dir, stdio: "inherit" })
  if (res.status !== 0) process.exit(res.status ?? 1)
  for (const name of moved) {
    const installed = path.join(dir, "node_modules", name, "package.json")
    if (!fs.existsSync(installed) || JSON.parse(fs.readFileSync(installed, "utf8")).version !== target(name)) {
      console.error(`${dir}: ${name} did not end up on ${target(name)} at the top level`)
      process.exit(1)
    }
  }
  const nested = path.join(dir, "node_modules/@medusajs/medusa/node_modules/@medusajs")
  if (fs.existsSync(nested) && fs.readdirSync(nested).length) {
    console.error(`${dir}: still nested under @medusajs/medusa: ${fs.readdirSync(nested).join(", ")}`)
    process.exit(1)
  }
}
