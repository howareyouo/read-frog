const fs = require("fs")

function extractJson(html) {
  const start = html.indexOf("const data = ") + "const data = ".length
  let depth = 0
  let inStr = false
  let esc = false
  for (let i = start; i < html.length; i++) {
    const ch = html[i]
    if (inStr) {
      if (esc) esc = false
      else if (ch === "\\") esc = true
      else if (ch === '"') inStr = false
      continue
    }
    if (ch === '"') inStr = true
    else if (ch === "{") depth++
    else if (ch === "}") {
      depth--
      if (depth === 0) return JSON.parse(html.slice(start, i + 1))
    }
  }
  throw new Error("unbalanced")
}

for (const f of process.argv.slice(2)) {
  const html = fs.readFileSync(f, "utf8")
  const data = extractJson(html)
  const metas = data.nodeMetas
  const parts = data.nodeParts
  const sizes = new Map()
  const walk = (node) => {
    if (node.uid !== undefined) {
      const meta = metas[parts[node.uid].metaUid]
      if (!meta || !meta.id) return
      let key = meta.id.split("\\").join("/")
      const nm = key.indexOf("node_modules/.pnpm/")
      if (nm >= 0) {
        key = "[dep] " + key.slice(nm + 19).split("/")[0]
      } else if (key.includes("read-frog")) {
        key = "[src] " + key.replace(/.*read-frog\//, "").split("/").slice(0, 3).join("/")
      }
      sizes.set(key, (sizes.get(key) || 0) + (parts[node.uid].renderedLength || 0))
      return
    }
    for (const c of node.children || []) walk(c)
  }
  walk(data.tree)
  const total = [...sizes.values()].reduce((a, b) => a + b, 0)
  console.log("=====", f, "total", Math.round(total / 1024), "kB")
  ;[...sizes.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 18)
    .forEach(([k, v]) => console.log(String(Math.round(v / 1024)).padStart(6) + " kB  " + k))
}
