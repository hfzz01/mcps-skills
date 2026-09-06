/**
 * 测试用的极简静态服务：serve test/fixtures/ 目录。
 *
 * 目的是让测试完全自包含——不用再手动起 `python -m http.server`，
 * 内网机器上没装 python 也能直接 `node test/smoke.mjs`。
 * 端口用 0 交给系统分配，避免和本机已有服务抢端口。
 */
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DIR = path.join(HERE, "fixtures");

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
};

export function startFixtureServer() {
  return new Promise((resolve, reject) => {
    if (!fs.existsSync(DIR)) {
      reject(new Error(`测试页面目录不存在：${DIR}`));
      return;
    }
    const server = http.createServer((req, res) => {
      const requested = decodeURIComponent((req.url || "/").split("?")[0]);
      const name = path.basename(requested) || "app.html";
      const file = path.join(DIR, name);
      // 防目录穿越：解析后必须仍在 fixtures 目录内
      if (path.dirname(file) !== DIR || !fs.existsSync(file)) {
        res.writeHead(404, { "content-type": "text/plain; charset=utf-8" }).end("not found");
        return;
      }
      res.writeHead(200, { "content-type": MIME[path.extname(file)] || "application/octet-stream" });
      fs.createReadStream(file).pipe(res);
    });
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      resolve({
        port,
        url: `http://127.0.0.1:${port}/app.html`,
        close: () => new Promise((done) => server.close(done)),
      });
    });
  });
}
