'use strict';

const fs = require('fs');
const path = require('path');

const PROMPT_DIR = path.join(__dirname, 'src');

function loadPrompt(name) {
  return fs.readFileSync(path.join(PROMPT_DIR, `${name}.md`), 'utf-8');
}

function loadAndRender(name, vars = {}) {
  let text = loadPrompt(name);
  for (const [key, value] of Object.entries(vars)) {
    text = text.replaceAll(`\${${key}}`, value ?? '');
  }
  return text;
}

module.exports = { loadPrompt, loadAndRender };
