#!/usr/bin/env tsx
import path from "path";
import dotenv from "dotenv";
import { ingestKnowledgePackFile } from "../services/knowledge-warehouse";

dotenv.config({ path: path.resolve(__dirname, "../../../.env") });

function main() {
  const filePath = process.argv[2];
  if (!filePath) {
    console.error("Usage: tsx src/scripts/knowledge-load-pack.ts <pack-file-path> [jiraKey]");
    process.exit(1);
  }
  const jiraKey = process.argv[3] ? String(process.argv[3]) : undefined;

  const result = ingestKnowledgePackFile(filePath, {
    sourceType: "confluence",
    jiraKey,
  });

  console.log("Knowledge warehouse load complete");
  console.log(`- documents: ${result.documents}`);
  console.log(`- facts: ${result.facts}`);
  console.log(`- images: ${result.images}`);
  console.log(`- jira links: ${result.jiraLinks}`);
}

main();
