// Setup Google Drive OAuth for CCWeb
// Launches a headed browser for the user to log in,
// then navigates through Google Cloud Console to create OAuth credentials.

import { chromium } from 'playwright';
import * as readline from 'readline';

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const ask = (q) => new Promise((resolve) => rl.question(q, resolve));

async function main() {
  const browser = await chromium.launch({ headless: false, args: ['--start-maximized'] });
  const context = await browser.newContext({ viewport: null });
  const page = await context.newPage();

  // Step 1: Go to Google Cloud Console
  console.log('\n=== 第 1 步：登录 Google 账号 ===');
  await page.goto('https://console.cloud.google.com/');
  await ask('请在浏览器中登录你的 Google 账号，登录完成后按回车继续...');

  // Step 2: Create new project
  console.log('\n=== 第 2 步：创建项目 ===');
  await page.goto('https://console.cloud.google.com/projectcreate');
  await page.waitForLoadState('networkidle');

  // Try to fill project name
  try {
    const nameInput = page.locator('input[formcontrolname="projectName"], input[aria-label*="Project name"], input[id*="project-name"]').first();
    await nameInput.waitFor({ timeout: 10000 });
    await nameInput.clear();
    await nameInput.fill('CCWeb');
    console.log('已填入项目名称 "CCWeb"');
  } catch {
    console.log('请手动填入项目名称 "CCWeb"');
  }

  await ask('请点击 "创建" 按钮，等项目创建完成后按回车继续...');

  // Step 3: Enable Google Drive API
  console.log('\n=== 第 3 步：启用 Google Drive API ===');
  await page.goto('https://console.cloud.google.com/apis/library/drive.googleapis.com');
  await page.waitForLoadState('networkidle');

  // Make sure we're on the right project
  await ask('确认顶部项目选择器显示的是 "CCWeb"，然后点击 "启用" 按钮，完成后按回车继续...');

  // Step 4: Configure OAuth consent screen
  console.log('\n=== 第 4 步：配置 OAuth 同意屏幕 ===');
  await page.goto('https://console.cloud.google.com/auth/overview');
  await page.waitForLoadState('networkidle');
  await ask('请点击 "开始" 或 "Get Started" 按钮进入 OAuth 配置，完成后按回车继续...');

  // Fill in app info
  console.log('请填写以下信息：');
  console.log('  - App name: CCWeb');
  console.log('  - User support email: 选择你的邮箱');
  console.log('  - Audience: External');
  console.log('  - Contact Information: 填你的邮箱');
  console.log('  - 一路点 "继续"/"Save" 直到完成');
  await ask('全部填完并保存后按回车继续...');

  // Step 5: Create OAuth Client ID
  console.log('\n=== 第 5 步：创建 OAuth 凭据 ===');
  await page.goto('https://console.cloud.google.com/apis/credentials/oauthclient');
  await page.waitForLoadState('networkidle');

  console.log('请选择：');
  console.log('  - Application type: Desktop app（桌面应用）');
  console.log('  - Name: CCWeb');
  console.log('  - 然后点击 "创建"');
  await ask('创建完成后，页面会显示 Client ID 和 Client Secret，按回车继续...');

  // Step 6: Navigate to credentials page to get the values
  console.log('\n=== 第 6 步：获取凭据 ===');
  await page.goto('https://console.cloud.google.com/apis/credentials');
  await page.waitForLoadState('networkidle');

  console.log('请在凭据页面找到刚创建的 OAuth 2.0 客户端 ID，点击它查看详情。');
  await ask('然后把 Client ID 粘贴到这里: ');
  const clientId = (await ask('Client ID: ')).trim();
  const clientSecret = (await ask('Client Secret: ')).trim();

  if (clientId && clientSecret) {
    console.log('\n✅ 获取到凭据！');
    console.log(`Client ID: ${clientId}`);
    console.log(`Client Secret: ${clientSecret.slice(0, 6)}...`);

    // Write to a temp file for the parent process to read
    const fs = await import('fs');
    fs.writeFileSync('/tmp/ccweb-google-oauth.json', JSON.stringify({ clientId, clientSecret }, null, 2));
    console.log('\n凭据已保存到 /tmp/ccweb-google-oauth.json');
  }

  await ask('\n按回车关闭浏览器...');
  await browser.close();
  rl.close();
}

main().catch((err) => {
  console.error('Error:', err);
  process.exit(1);
});
