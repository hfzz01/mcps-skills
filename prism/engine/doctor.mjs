/* ============================================================
 * 环境体检 / Doctor
 * ------------------------------------------------------------
 * 内网拿到代码后第一条命令。只读、不改文件、不联网、不调用模型。
 * 目的：告诉人「环境行不行、成品在哪、下一步敲什么」。
 * 输出刻意写短，弱模型也能照着念。
 * ============================================================ */

import fs from 'node:fs';
import path from 'node:path';

const NEED_FILES = [
  'foundry/charter.css', 'foundry/components.css', 'foundry/contracts.mjs', 'foundry/runtime.js',
  'engine/prism.mjs', 'engine/compiler.mjs', 'engine/linker.mjs', 'engine/expand.mjs',
  'blueprints/_portal.json', 'examples/batch-matrix.json', 'docs/04-蓝图规格说明.md',
  'examples/给codeagent的提示词.md', 'docs/00-内网落地手册.md',
];

function countJson(dir) {
  if (!fs.existsSync(dir)) return 0;
  let n = 0;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.isDirectory()) n += countJson(path.join(dir, e.name));
    else if (e.name.endsWith('.json') && !e.name.startsWith('_')) n++;
  }
  return n;
}

export function doctor(root) {
  const major = Number(process.versions.node.split('.')[0]);
  const L = [];
  let fatal = 0;
  const line = (s) => L.push(s);
  const mark = (ok) => ok ? '✓' : '✗';

  line('=== Prism 环境体检（只读，不改文件） ===');
  line('');
  const nodeOk = major >= 20;
  if (!nodeOk) fatal++;
  line(`Node      ${process.version}  ${mark(nodeOk)} ${major >= 22 ? '全部能力可用'
    : major >= 20 ? 'lint / expand / compile / charter(repo,image) / selftest 可用；extract-dom 与 verify-browser 需 22+'
      : '版本过低：请装 Node 20+（内网离线拷贝 node.exe 也行）'}`);

  const missing = NEED_FILES.filter(f => !fs.existsSync(path.join(root, f)));
  if (missing.length) fatal++;
  line(`目录      缺失 ${missing.length} 个文件  ${mark(!missing.length)} ${missing.length ? '→ ' + missing.join(', ') : '结构完整'}`);

  let deps = {};
  try { deps = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).dependencies || {}; } catch {}
  const depN = Object.keys(deps).length;
  line(`依赖      ${depN} 个 npm 包  ${mark(depN === 0)} ${depN === 0 ? '零依赖，不需要 npm install，不需要联网' : '异常：本方案不该有依赖'}`);

  const bp = countJson(path.join(root, 'blueprints'));
  line(`蓝图      ${bp} 份  ${mark(bp > 0)} ${bp > 0 ? '（当前是仓库自带示例，换成你的需求时替换掉）' : '没有蓝图，先让 codeagent 产出'}`);

  const dist = path.join(root, 'dist');
  const idx = path.join(dist, 'index.html');
  const pagesDir = path.join(dist, 'pages');
  const pages = fs.existsSync(pagesDir) ? fs.readdirSync(pagesDir).filter(f => f.endsWith('.html')).length : 0;
  const ready = fs.existsSync(idx) && pages > 0;
  line(`成品      ${ready ? `dist/ 已有 ${pages} 页，index.html 存在` : 'dist/ 未生成'}  ${mark(ready)}`);

  let writable = false;
  try { fs.accessSync(fs.existsSync(dist) ? dist : root, fs.constants.W_OK); writable = true; } catch {}
  if (!writable) fatal++;
  line(`写入      ${writable ? '可写' : '不可写'}  ${mark(writable)} ${writable ? '' : '→ 换一个可写目录再解压'}`);
  line('');

  if (fatal) {
    line(`体检未通过：${fatal} 项阻塞。先解决上面的 ✗，再执行 node engine/prism.mjs doctor 复查。`);
  } else {
    line('下一步（按顺序做，第一次只需做一遍）：');
    line('  1. 双击 dist/index.html          先看成品，点几下导航、状态按钮和弹窗');
    line('  2. 打开 docs/00-内网落地手册.md  按第 4 步把「提示词模板」整段发给内网 codeagent3.0');
    line('  3. codeagent 产出的 JSON 放进 blueprints/；不用的示例蓝图移出该目录');
    line('     （批量页别删 blueprints/batch/*.json，会被 run 重建；改 examples/batch-matrix.json）');
    line('  4. node engine/prism.mjs lint   必须看到 error 0');
    line('  5. node engine/prism.mjs run    展开 + 校验 + 铸造，一步出 dist/');
    line('');
    line('只想要成品、不想生成：把 dist/ 整个目录拷走即可，双击 index.html 就能用。');
    line('卡住时看 docs/00-内网落地手册.md 最后的「一页纸故障表」。');
  }
  line('');
  const out = L.join('\n');
  console.log(out);
  return { ok: fatal === 0, fatal, node: process.version, blueprints: bp, pages, out };
}
