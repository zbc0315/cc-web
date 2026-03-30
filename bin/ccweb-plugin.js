#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const readline = require('readline');

const args = process.argv.slice(2);
const command = args[0];

if (!command || command === '--help' || command === '-h') {
  console.log(`
ccweb-plugin — CLI scaffold for ccweb plugins

Usage:
  ccweb-plugin create <name>    Create a new plugin project
  ccweb-plugin build            Build plugin into a zip
  ccweb-plugin --help           Show this help
`);
  process.exit(0);
}

// ── create ──────────────────────────────────────────────────────────────────

if (command === 'create') {
  const name = args[1];
  if (!name) {
    console.error('Usage: ccweb-plugin create <name>');
    process.exit(1);
  }

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const ask = (q) => new Promise((resolve) => rl.question(q, resolve));

  (async () => {
    const id = name.replace(/[^a-z0-9-]/gi, '-').toLowerCase();
    const displayName = await ask(`Plugin display name [${name}]: `) || name;
    const author = await ask('Author: ') || 'anonymous';
    const description = await ask('Description: ') || '';
    const hasBackend = (await ask('Include backend? (y/N): ')).toLowerCase() === 'y';

    const scopeInput = await ask('Scope (global/dashboard/project) [global]: ') || 'global';
    const scopes = scopeInput.split(',').map(s => s.trim()).filter(Boolean);

    const permInput = await ask('Permissions (comma-separated, e.g. system:info,project:list): ') || '';
    const permissions = permInput.split(',').map(s => s.trim()).filter(Boolean);

    const width = parseInt(await ask('Default width [320]: ') || '320', 10);
    const height = parseInt(await ask('Default height [240]: ') || '240', 10);

    rl.close();

    const dir = path.resolve(id);
    if (fs.existsSync(dir)) {
      console.error(`Directory "${id}" already exists`);
      process.exit(1);
    }

    // Create directory structure
    fs.mkdirSync(path.join(dir, 'frontend'), { recursive: true });
    if (hasBackend) fs.mkdirSync(path.join(dir, 'backend'), { recursive: true });

    // manifest.json
    const manifest = {
      id,
      name: displayName,
      version: '1.0.0',
      author,
      description,
      type: 'float',
      float: {
        defaultWidth: width,
        defaultHeight: height,
        minWidth: 200,
        minHeight: 150,
        resizable: true,
        scope: { allowed: scopes, default: scopes[0] || 'global' },
        clickable: { allowed: [true, false], default: true },
      },
      permissions,
      frontend: { entry: 'frontend/index.html' },
    };
    if (hasBackend) manifest.backend = { entry: 'backend/index.js' };
    fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify(manifest, null, 2));

    // frontend/index.html
    fs.writeFileSync(path.join(dir, 'frontend', 'index.html'), `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${displayName}</title>
  <script src="/plugin-sdk/ccweb-plugin-sdk.js"><\/script>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      background: #0a0a0a;
      color: #e4e4e7;
      padding: 12px;
      font-size: 13px;
    }
    h3 { font-size: 14px; margin-bottom: 8px; color: #a1a1aa; }
    .value { font-size: 20px; font-weight: 600; color: #fafafa; }
    .label { font-size: 11px; color: #71717a; margin-top: 2px; }
    .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
    .card {
      background: #18181b;
      border: 1px solid #27272a;
      border-radius: 8px;
      padding: 10px;
    }
  </style>
</head>
<body>
  <h3>${displayName}</h3>
  <div class="grid" id="content">
    <div class="card">
      <div class="value" id="main-value">--</div>
      <div class="label">Loading...</div>
    </div>
  </div>

  <script>
    // Example: fetch data and display
    async function update() {
      try {
        ${permissions.includes('system:info')
          ? `const info = await ccweb.getSystemInfo();
        document.getElementById('main-value').textContent = info.cpu.usage + '%';
        document.querySelector('.label').textContent = 'CPU Usage';`
          : `document.getElementById('main-value').textContent = 'Hello!';
        document.querySelector('.label').textContent = '${displayName} is running';`}
      } catch (err) {
        document.getElementById('main-value').textContent = 'Error';
        document.querySelector('.label').textContent = err.message;
      }
    }
    update();
    setInterval(update, 3000);
  <\/script>
</body>
</html>
`);

    // backend/index.js (optional)
    if (hasBackend) {
      fs.writeFileSync(path.join(dir, 'backend', 'index.js'), `'use strict';

const { Router } = require('express');
const router = Router();

// Plugin backend API routes
// These are mounted at /api/plugins/${id}/

router.get('/status', (_req, res) => {
  res.json({ status: 'ok', plugin: '${id}' });
});

// Optional lifecycle hooks
function onStart() {
  console.log('[${id}] Plugin backend started');
}

function onStop() {
  console.log('[${id}] Plugin backend stopped');
}

module.exports = { router, onStart, onStop };
`);
    }

    // package.json
    fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({
      name: `ccweb-plugin-${id}`,
      version: '1.0.0',
      description,
      private: true,
      scripts: {
        build: 'node build.js',
      },
    }, null, 2));

    // build.js
    fs.writeFileSync(path.join(dir, 'build.js'), `'use strict';
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const id = require('./manifest.json').id;
const version = require('./manifest.json').version;
const outFile = \`\${id}-\${version}.zip\`;

// Remove old zip if exists
if (fs.existsSync(outFile)) fs.unlinkSync(outFile);

// Create zip excluding node_modules and build artifacts
execSync(\`zip -r "\${outFile}" manifest.json frontend/ ${hasBackend ? 'backend/' : ''} -x "*.DS_Store"\`, { stdio: 'inherit' });

console.log(\`\\nBuilt: \${outFile} (\${(fs.statSync(outFile).size / 1024).toFixed(1)} KB)\`);
`);

    // README.md
    fs.writeFileSync(path.join(dir, 'README.md'), `# ${displayName}

${description}

## Development

1. Edit \`frontend/index.html\` — the plugin UI (runs in iframe)
${hasBackend ? '2. Edit `backend/index.js` — Express router (mounted at `/api/plugins/' + id + '/`)\n' : ''}
## Build

\`\`\`bash
npm run build
\`\`\`

This creates \`${id}-1.0.0.zip\` which can be uploaded to the ccweb Plugin Hub.

## SDK API

In your \`index.html\`, include the SDK:
\`\`\`html
<script src="/plugin-sdk/ccweb-plugin-sdk.js"></script>
\`\`\`

Available methods:
- \`ccweb.getSystemInfo()\` — CPU, memory, uptime (requires \`system:info\`)
- \`ccweb.getProjectList()\` — list all projects (requires \`project:list\`)
- \`ccweb.getProjectStatus(id)\` — project status (requires \`project:status\`)
- \`ccweb.sendTerminal(id, data)\` — send to terminal (requires \`terminal:send\`)
- \`ccweb.getSessionHistory(id)\` — chat history (requires \`session:read\`)
- \`ccweb.getStorage()\` / \`ccweb.setStorage(data)\` — private persistent data
- \`ccweb.backendApi(method, path, body)\` — call plugin's own backend
`);

    console.log(`\n✅ Plugin "${displayName}" created in ./${id}/`);
    console.log(`\nNext steps:`);
    console.log(`  cd ${id}`);
    console.log(`  # Edit frontend/index.html`);
    ${hasBackend ? "console.log(`  # Edit backend/index.js`);" : ''}
    console.log(`  npm run build     # Create zip for Hub upload`);
  })();
}

// ── build ───────────────────────────────────────────────────────────────────

if (command === 'build') {
  const manifestPath = path.resolve('manifest.json');
  if (!fs.existsSync(manifestPath)) {
    console.error('manifest.json not found. Run this command from a plugin directory.');
    process.exit(1);
  }
  // Delegate to build.js if it exists, else do inline build
  const buildScript = path.resolve('build.js');
  if (fs.existsSync(buildScript)) {
    require(buildScript);
  } else {
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
    const outFile = `${manifest.id}-${manifest.version}.zip`;
    const { execSync } = require('child_process');
    const parts = ['manifest.json', 'frontend/'];
    if (manifest.backend) parts.push('backend/');
    if (fs.existsSync('icon.svg')) parts.push('icon.svg');
    execSync(`zip -r "${outFile}" ${parts.join(' ')} -x "*.DS_Store"`, { stdio: 'inherit' });
    console.log(`\nBuilt: ${outFile} (${(fs.statSync(outFile).size / 1024).toFixed(1)} KB)`);
  }
}
