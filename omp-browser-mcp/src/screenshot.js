import fs from "node:fs";
import path from "node:path";
import { CONFIG } from "./config.js";

/**
 * 截图：按 omp 的像素预算反推——1568px 边长上限 + 500KB 目标体积。
 * 1568 是视觉模型官方推荐的单图边长，这套数值是按真实模型预算定的，不是拍脑袋。
 *
 * 零外部依赖实现（上游 omp 用 sharp）：
 *   尺寸 —— CDP 的 deviceScaleFactor 缩放，截完立刻还原，不影响后续操作。
 *   体积 —— webp 优先、jpeg 兜底，质量档位递减直到压进预算。
 * 去掉 sharp 的理由：它要拉 19MB 的平台二进制，是内网分发里最重的一块，
 * 而这里的压缩需求用浏览器原生能力已经够用。
 */

const QUALITY_LADDER = [82, 68, 55, 42, 30];

async function shoot(page, fullPage, type, quality) {
  return Buffer.from(
    await page.screenshot({ fullPage: !!fullPage, type, quality })
  );
}

export async function takeScreenshot(page, { fullPage = false, maxEdge, saveAs } = {}) {
  const edge = maxEdge || CONFIG.maxImageEdge;
  const session = await page.createCDPSession();
  let originalViewport = null;

  try {
    // 1) 探测内容尺寸，算出需要的缩放比
    let contentWidth = 1280;
    let contentHeight = 720;
    try {
      const metrics = await session.send("Page.getLayoutMetrics");
      contentWidth = metrics?.contentSize?.width || contentWidth;
      contentHeight = metrics?.contentSize?.height || contentHeight;
    } catch {
      // 拿不到就按默认视口走，不阻断
    }

    const longest = Math.max(contentWidth, contentHeight);
    const scale = longest > edge ? Math.max(0.1, edge / longest) : 1;

    if (scale < 1) {
      const vp = page.viewport() || { width: 1280, height: 720 };
      originalViewport = { ...vp, deviceScaleFactor: vp.deviceScaleFactor || 1 };
      await page.setViewport({
        width: vp.width,
        height: vp.height,
        deviceScaleFactor: originalViewport.deviceScaleFactor * scale,
      });
    }

    const width = Math.round(contentWidth * scale);
    const height = Math.round(contentHeight * scale);

    // 2) 体积预算：webp 优先，不支持或压不下去再退回 jpeg
    let buffer = null;
    let mimeType = "image/webp";
    let quality = QUALITY_LADDER[0];

    for (const format of ["webp", "jpeg"]) {
      let ok = false;
      for (const q of QUALITY_LADDER) {
        try {
          buffer = await shoot(page, fullPage, format, q);
        } catch {
          ok = false; // 该格式不被浏览器支持，换下一种
          break;
        }
        mimeType = format === "webp" ? "image/webp" : "image/jpeg";
        quality = q;
        if (buffer.length <= CONFIG.maxImageBytes) {
          ok = true;
          break;
        }
      }
      if (ok || (buffer && buffer.length > 0 && format === "jpeg")) break;
    }

    // 3) 落盘（可选）
    let savedPath = "";
    if (CONFIG.screenshotDir || saveAs) {
      try {
        const dir = CONFIG.screenshotDir || process.cwd();
        fs.mkdirSync(dir, { recursive: true });
        const ext = mimeType === "image/jpeg" ? "jpg" : "webp";
        const file = saveAs || `omp-shot-${Date.now()}.${ext}`;
        savedPath = path.join(dir, file);
        fs.writeFileSync(savedPath, buffer);
      } catch (error) {
        savedPath = "";
        process.stderr.write(`[omp-browser] 截图落盘失败：${error.message}\n`);
      }
    }

    return {
      buffer,
      mimeType,
      width,
      height,
      quality,
      bytes: buffer.length,
      savedPath,
    };
  } finally {
    if (originalViewport) {
      try {
        await page.setViewport(originalViewport);
      } catch {
        // 还原失败不阻断，后续动作会重新设视口
      }
    }
    await session.detach().catch(() => {});
  }
}
