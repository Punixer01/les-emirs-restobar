/* The dashboard's JavaScript lives inline in the HTML, so `node --check` never
   sees it: compile every <script> block instead (compile only, nothing runs). */
import fs from "node:fs";
import vm from "node:vm";
let bad = 0;
for (const file of process.argv.slice(2)) {
  const html = fs.readFileSync(file, "utf8");
  const blocks = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)];
  blocks.forEach((b, i) => {
    try { new vm.Script(b[1], { filename: file }); }
    catch (e) { bad++; console.error("SYNTAX ERROR in " + file + " script#" + (i + 1) + ": " + e.message); }
  });
}
process.exit(bad ? 1 : 0);
