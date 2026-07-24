#!/usr/bin/env node

import { validateRunFilename } from "../public/run-identity.js";

const filenames = process.argv.slice(2);

if (filenames.length === 0) {
  console.error("Usage: npm run validate:run-name -- <filename> [filename...]");
  process.exitCode = 2;
} else {
  for (const filename of filenames) {
    const result = validateRunFilename(filename);
    if (result.valid) {
      console.log(`valid run filename: ${filename}`);
      continue;
    }
    process.exitCode = 1;
    console.error(`invalid run filename: ${filename}`);
    for (const error of result.errors) {
      console.error(`- ${error}`);
    }
  }
}

