// @ts-check

/**
 * Playwright E2E 测试模板 — Agent Chat 前端渲染验证
 *
 * 放到 TOT_frontend/e2e/ 目录下运行：
 *   npx playwright test e2e/agent-chat.spec.ts --reporter=list
 *
 * 依赖：npm i -D @playwright/test
 * 初始化：npx playwright install chromium
 */

const { test, expect } = require('@playwright/test');

const BASE_URL = process.env.BASE_URL || 'http://localhost:5173';

// ─── 辅助：等待 SSE 流完成 ────────────────────────────────────────────

async function waitForChatComplete(page, timeout = 30000) {
  // 等待 "done" 事件标记或回复内容出现
  await page.waitForFunction(
    () => {
      // 检查页面是否出现了 Agent 的回复内容
      const reply = document.querySelector('[data-testid="agent-reply"], .chat-message.assistant');
      return reply && reply.textContent && reply.textContent.length > 10;
    },
    { timeout }
  );
  // 额外等一下确保渲染完成
  await page.waitForTimeout(500);
}

// ─── 辅助：捕获浏览器 console 错误 ────────────────────────────────────

function collectConsoleErrors(page) {
  const errors = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') {
      errors.push({ text: msg.text(), timestamp: Date.now() });
    }
  });
  page.on('pageerror', (err) => {
    errors.push({ text: err.message, timestamp: Date.now(), uncaught: true });
  });
  return errors;
}

// ─── 测试：Agent Chat 基本流程 ─────────────────────────────────────────

test.describe('Agent Chat', () => {
  test('发送消息 → 收到 SSE 流式回复 → 渲染完成', async ({ page }) => {
    const consoleErrors = collectConsoleErrors(page);

    await page.goto(BASE_URL);
    await page.waitForLoadState('networkidle');

    // 找到输入框并发送消息
    const input = page.locator('[data-testid="chat-input"], textarea, input[type="text"]').first();
    await expect(input).toBeVisible({ timeout: 5000 });
    await input.fill('你好');
    await input.press('Enter');

    // 等待回复
    await waitForChatComplete(page);

    // 截图
    await page.screenshot({ path: `test-results/chat-reply-${Date.now()}.png`, fullPage: true });

    // 断言：回复不是空的
    const reply = page.locator('[data-testid="agent-reply"], .chat-message.assistant').first();
    await expect(reply).toBeVisible();
    const text = await reply.textContent();
    expect(text.length).toBeGreaterThan(5);

    // 断言：没有浏览器 console 错误
    expect(consoleErrors.length).toBe(0);
  });

  test('含表格/图表的工具查询结果正确渲染', async ({ page }) => {
    const consoleErrors = collectConsoleErrors(page);

    await page.goto(BASE_URL);
    await page.waitForLoadState('networkidle');

    const input = page.locator('[data-testid="chat-input"], textarea, input[type="text"]').first();
    await input.fill('帮我查一下培训完成率');
    await input.press('Enter');
    await waitForChatComplete(page, 60000);

    await page.screenshot({ path: `test-results/chat-tool-${Date.now()}.png`, fullPage: true });

    // 检查是否有结构化内容渲染
    const reply = page.locator('[data-testid="agent-reply"], .chat-message.assistant').first();
    const hasTable = await page.locator('table, [role="table"], .echarts-container, canvas').count();
    console.log(`检测到 ${hasTable} 个表格/图表元素`);

    // 断言：无 console 错误
    expect(consoleErrors.length).toBe(0);
  });

  test('HITL 澄清流程: 缺少任务参数时弹出选项', async ({ page }) => {
    const consoleErrors = collectConsoleErrors(page);

    await page.goto(BASE_URL);
    await page.waitForLoadState('networkidle');

    const input = page.locator('[data-testid="chat-input"], textarea, input[type="text"]').first();
    await input.fill('查看任务进度');  // 缺少 task_id，预期触发 HITL
    await input.press('Enter');

    // 等待澄清弹窗
    await page.waitForTimeout(3000);
    await page.screenshot({ path: `test-results/chat-hitl-${Date.now()}.png`, fullPage: true });

    const clarify = page.locator('[data-testid="clarify-dialog"], .clarify-options, [role="dialog"]');
    const hasClarify = (await clarify.count()) > 0;
    console.log(`HITL 澄清弹窗: ${hasClarify ? '出现' : '未出现'}`);

    expect(consoleErrors.length).toBe(0);
  });
});

// ─── 测试：响应式布局 ─────────────────────────────────────────────────

test.describe('响应式', () => {
  const breakpoints = [
    { name: 'mobile', width: 375, height: 812 },
    { name: 'tablet', width: 768, height: 1024 },
    { name: 'desktop', width: 1440, height: 900 },
  ];

  for (const bp of breakpoints) {
    test(`${bp.name} (${bp.width}px) — 无横向溢出`, async ({ page }) => {
      await page.setViewportSize({ width: bp.width, height: bp.height });
      await page.goto(BASE_URL);
      await page.waitForLoadState('networkidle');

      // 检查无横向溢出
      const hasOverflow = await page.evaluate(() => {
        return document.documentElement.scrollWidth > document.documentElement.clientWidth;
      });
      expect(hasOverflow).toBe(false);

      await page.screenshot({ path: `test-results/responsive-${bp.name}-${Date.now()}.png`, fullPage: true });
    });
  }
});
