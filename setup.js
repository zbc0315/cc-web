#!/usr/bin/env node
/**
 * CC Web Setup Script
 * Run AFTER: npm run install:all
 * Usage: npm run setup
 */

const readline = require('readline');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

// Resolve bcryptjs from backend's node_modules
let bcrypt;
try {
  bcrypt = require(path.join(__dirname, 'backend', 'node_modules', 'bcryptjs'));
} catch {
  console.error(
    'Error: bcryptjs not found. Please run "npm run install:all" first, then re-run "npm run setup".'
  );
  process.exit(1);
}

const DATA_DIR = path.join(__dirname, 'data');
const CONVERSATIONS_DIR = path.join(DATA_DIR, 'conversations');
const CONFIG_FILE = path.join(DATA_DIR, 'config.json');
const PROJECTS_FILE = path.join(DATA_DIR, 'projects.json');

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

function question(prompt) {
  return new Promise((resolve) => {
    rl.question(prompt, resolve);
  });
}

function questionHidden(prompt) {
  return new Promise((resolve) => {
    process.stdout.write(prompt);

    const stdin = process.stdin;
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding('utf8');

    let password = '';

    stdin.on('data', function handler(ch) {
      ch = ch.toString('utf8');

      if (ch === '\n' || ch === '\r' || ch === '\u0004') {
        stdin.setRawMode(false);
        stdin.pause();
        stdin.removeListener('data', handler);
        process.stdout.write('\n');
        resolve(password);
      } else if (ch === '\u0003') {
        // Ctrl+C
        process.stdout.write('\n');
        process.exit(1);
      } else if (ch === '\u007f' || ch === '\b') {
        // Backspace
        if (password.length > 0) {
          password = password.slice(0, -1);
          process.stdout.write('\b \b');
        }
      } else {
        password += ch;
        process.stdout.write('*');
      }
    });
  });
}

async function main() {
  console.log('\n========================================');
  console.log('         CC Web — Initial Setup         ');
  console.log('========================================\n');

  // Check if config already exists
  if (fs.existsSync(CONFIG_FILE)) {
    const overwrite = await question(
      'A config already exists. Overwrite it? (y/N): '
    );
    if (overwrite.trim().toLowerCase() !== 'y') {
      console.log('Setup cancelled.');
      rl.close();
      return;
    }
  }

  const username = await question('Enter username: ');
  if (!username.trim()) {
    console.error('Username cannot be empty.');
    rl.close();
    process.exit(1);
  }

  const password = await questionHidden('Enter password: ');
  if (!password) {
    console.error('Password cannot be empty.');
    rl.close();
    process.exit(1);
  }

  const confirmPassword = await questionHidden('Confirm password: ');
  if (password !== confirmPassword) {
    console.error('Passwords do not match.');
    rl.close();
    process.exit(1);
  }

  rl.close();

  console.log('\nHashing password...');
  const passwordHash = await bcrypt.hash(password, 12);
  const jwtSecret = crypto.randomBytes(64).toString('hex');

  // Create directories
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    console.log('Created data/ directory');
  }
  if (!fs.existsSync(CONVERSATIONS_DIR)) {
    fs.mkdirSync(CONVERSATIONS_DIR, { recursive: true });
    console.log('Created data/conversations/ directory');
  }

  // Write config.json
  const config = {
    username: username.trim(),
    passwordHash,
    jwtSecret,
  };
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2), 'utf-8');
  console.log('Written data/config.json');

  // Write empty projects.json if it doesn't exist
  if (!fs.existsSync(PROJECTS_FILE)) {
    fs.writeFileSync(PROJECTS_FILE, JSON.stringify([], null, 2), 'utf-8');
    console.log('Created data/projects.json');
  }

  console.log('\n========================================');
  console.log('Setup complete!');
  console.log('\nTo start the app:');
  console.log('  Terminal 1: npm run dev:backend');
  console.log('  Terminal 2: npm run dev:frontend');
  console.log('\nOpen: http://localhost:5173');
  console.log('========================================\n');
}

main().catch((err) => {
  console.error('Setup failed:', err);
  process.exit(1);
});
