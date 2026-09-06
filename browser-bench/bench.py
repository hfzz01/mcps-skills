import json
import os
import subprocess
import tempfile
import time
import glob

ROOT = os.path.dirname(os.path.abspath(__file__))
# playwright-cli（Playwright MCP）会封禁 file:// 协议，因此统一走本地 HTTP，
# 同时也更贴近内网系统的真实访问方式。
PAGE = os.environ.get("BENCH_URL", "http://127.0.0.1:8099/fixtures/app.html")
AB = os.path.join(ROOT, "node_modules", ".bin", "agent-browser")
PC = os.path.join(ROOT, "node_modules", ".bin", "playwright-cli")

KWS = ["恒信", "SO-2026", "锦程"]
LOGDIR = os.path.join(ROOT, "logs")
LOG_SEQ = [0]


def sh(cmd, timeout=120):
    """两个 CLI 都会拉起常驻进程（daemon / MCP server），它们会继承 stdout
    管道导致 subprocess 永远等不到 EOF。因此统一重定向到临时文件再读回。"""
    t0 = time.time()
    os.makedirs(LOGDIR, exist_ok=True)
    LOG_SEQ[0] += 1
    path = os.path.join(LOGDIR, "cmd-{:04d}.log".format(LOG_SEQ[0]))
    try:
        with open(path, "w", encoding="utf-8", errors="replace") as f:
            p = subprocess.run(
                cmd, shell=True, stdin=subprocess.DEVNULL,
                stdout=f, stderr=subprocess.STDOUT, timeout=timeout, cwd=ROOT
            )
        rc, err = p.returncode, ""
    except subprocess.TimeoutExpired:
        rc, err = -1, "TIMEOUT"
    with open(path, "r", encoding="utf-8", errors="replace") as f:
        out = f.read()
    ms = round((time.time() - t0) * 1000)
    return {"cmd": cmd, "ms": ms, "rc": rc, "out": out, "err": err, "chars": len(out)}


def est_tokens(s):
    """粗略估算 token：中日韩字符按 1 字 1 token，其余按 4 字符 1 token。"""
    t = 0
    for ch in s:
        t += 1 if ord(ch) > 0x2E80 else 0.25
    return int(t)


def latest_snapshot():
    files = glob.glob(os.path.join(ROOT, ".playwright-cli", "page-*.yml"))
    if not files:
        return ""
    f = max(files, key=os.path.getmtime)
    with open(f, "r", encoding="utf-8", errors="replace") as fh:
        return fh.read()


def read_pw_snap(cmd, timeout=120):
    """playwright-cli 的 snapshot 落盘不进 stdout，需要额外读取文件。"""
    before = set(glob.glob(os.path.join(ROOT, ".playwright-cli", "page-*.yml")))
    r = sh(cmd, timeout)
    time.sleep(0.3)
    after = set(glob.glob(os.path.join(ROOT, ".playwright-cli", "page-*.yml")))
    new = after - before
    if new:
        f = max(new, key=os.path.getmtime)
        with open(f, "r", encoding="utf-8", errors="replace") as fh:
            r["out"] = fh.read()
            r["chars"] = len(r["out"])
            r["cmd"] = cmd + "  [+ cat " + os.path.basename(f) + "]"
    return r


def section(title):
    print("\n" + "=" * 66)
    print(title)
    print("=" * 66)


def show(r, clip=420):
    flag = "OK " if r["rc"] == 0 else "FAIL"
    print("  [{}] {:>6} ms  {:>6} chars  ~{:>5} tok  {}".format(
        flag, r["ms"], r["chars"], est_tokens(r["out"]), r["cmd"][:78]))
    if r["rc"] != 0 and r["err"]:
        print("        err: " + r["err"].strip()[:200])
    if clip and r["out"]:
        print("        " + "-" * 58)
        for line in r["out"].strip().splitlines()[:14]:
            print("        | " + line[:110])
        if len(r["out"].strip().splitlines()) > 14:
            print("        | ... ({} 行，已截断)".format(len(r["out"].strip().splitlines())))


results = {}

# ---------------------------------------------------------------- agent-browser
section("A. agent-browser  (Rust CLI + 自带 Chrome，无 Playwright 依赖)")
sh("{} close --all".format(AB), timeout=30)

r_open = sh('{} open "{}"'.format(AB, PAGE))
show(r_open, clip=False)

r_snap = sh("{} snapshot -i".format(AB))
show(r_snap)

r_snapfull = sh("{} snapshot".format(AB))
print("  [{}] {:>6} ms  {:>6} chars  ~{:>5} tok  {} (全量树，对照组)".format(
    "OK " if r_snapfull["rc"] == 0 else "FAIL", r_snapfull["ms"],
    r_snapfull["chars"], est_tokens(r_snapfull["out"]), "snapshot"))

inter = []
for kw in KWS:
    inter.append(sh('{} fill "#kw" "{}"'.format(AB, kw)))
inter.append(sh('{} select "#status" "wait"'.format(AB)))
inter.append(sh('{} click "#btnSearch"'.format(AB)))
r_res = sh('{} get text "#result"'.format(AB))
inter.append(r_res)
for r in inter:
    show(r, clip=False)
print("  >>> 查询结果: " + r_res["out"].strip()[:100])

r_shot = sh("{} screenshot shots/ab.png".format(AB))
show(r_shot, clip=False)

results["agent-browser"] = {
    "open": r_open, "snapshot_i": r_snap, "snapshot_full": r_snapfull,
    "interactions": inter, "screenshot": r_shot,
}

# ---------------------------------------------------------------- playwright-cli
section("B. playwright-cli  (Playwright MCP 命令行版)")
sh("{} close".format(PC), timeout=30)

p_open = sh('{} open "{}"'.format(PC, PAGE))
show(p_open, clip=False)

p_snap = read_pw_snap("{} snapshot".format(PC))
show(p_snap)

pinter = []
for kw in KWS:
    pinter.append(sh('{} fill "#kw" "{}"'.format(PC, kw)))
pinter.append(sh('{} select "#status" "wait"'.format(PC)))
pinter.append(sh('{} click "#btnSearch"'.format(PC)))
p_eval = sh(
    '''{} eval "document.getElementById('result').textContent"'''.format(PC))
pinter.append(p_eval)
for r in pinter:
    show(r, clip=False)
print("  >>> 查询结果: " + p_eval["out"].strip()[:100])

p_shot = sh("{} screenshot --filename=shots/pw.png".format(PC))
show(p_shot, clip=False)

results["playwright-cli"] = {
    "open": p_open, "snapshot": p_snap,
    "interactions": pinter, "screenshot": p_shot,
}

sh("{} close".format(PC), timeout=30)
sh("{} close --all".format(AB), timeout=30)

with open(os.path.join(ROOT, "bench-result.json"), "w", encoding="utf-8") as f:
    json.dump(results, f, ensure_ascii=False, indent=2)
print("\n结果已写入 bench-result.json")
