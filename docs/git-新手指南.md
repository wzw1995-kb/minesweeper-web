# Git 新手指南（本项目实操版）

> 面向第一次接触 Git 的人。所有例子都基于本仓库的真实状态，可直接照抄。
>
> 仓库：`E:\DEEPSEEK\task_1`　｜　远程：`https://github.com/wzw1995-kb/minesweeper-web`

---

## 0. 命令速查表（只记这张表也能活）

| 我想…… | 命令 |
| --- | --- |
| 看现在有什么改动 | `git status` |
| 看具体改了哪几行 | `git diff` |
| 把所有改动打包准备提交 | `git add -A` |
| 存一个存档点 | `git commit -m "说明"` |
| 上传到 GitHub | `git push` |
| 看历史列表 | `git log --oneline` |
| 看某次提交改了什么 | `git show <编号>` |
| 看旧版本里的某个文件 | `git show <编号>:<文件路径>` |
| 把某个文件恢复到旧版本 | `git restore --source=<编号> <文件路径>` |
| 临时回到旧版本看看 | `git switch --detach <编号>` → 看完 `git switch main` |
| 安全地撤销某次提交 | `git revert <编号>` |
| **出事了，救命** | `git reflog` |

> `<编号>` 就是 `git log --oneline` 里那串前 7 位字符，例如 `6493f49`。
> 也可以用 `HEAD`（当前版本）、`HEAD~1`（上一个版本）、`HEAD~2`（上上个）。

---

## 1. 先建立心智模型（比记命令重要）

代码会在 4 个地方之间流动：

```
   你的文件夹              暂存区            本地仓库            GitHub
 E:\DEEPSEEK\task_1      (待提交清单)     E:\...\.git       (远程备份)
        │                     │                 │                 │
        │   git add -A        │                 │                 │
        ├────────────────────▶│                 │                 │
        │                     │  git commit     │                 │
        │                     ├────────────────▶│                 │
        │                     │                 │    git push     │
        │                     │                 ├────────────────▶│
        │◀────────────────────┴─────────────────┴─────────────────┤
        │                      git pull（把 GitHub 上的拉回来）      │
```

| 命令 | 作用 | 通俗理解 |
| --- | --- | --- |
| `git add` | 把改动放进"待提交清单" | 把要保存的东西挑出来 |
| `git commit` | 在本机存一个**存档点** | 游戏里按了 F5 |
| `git push` | 把存档**上传到 GitHub** | 把存档传到云端 |

**最关键的一句话：只 commit 不 push = 只存在自己电脑上，硬盘坏了就没了。两个都要做。**

---

## 2. 日常备份：四步循环

先开一个终端（装 Git 之前就开着的终端需要重开），进入项目：

```powershell
cd E:\DEEPSEEK\task_1
```

改完代码后，按顺序执行：

```powershell
git status                      # ① 看看改了啥
git add -A                      # ② 全部挑进待提交清单
git commit -m "描述这次改了什么"  # ③ 存一个存档点
git push                        # ④ 上传到 GitHub
```

### 关于提交说明 `-m`

写清楚**改了什么、为什么**。三个月后的你会感谢现在的你。

```powershell
# ✗ 差
git commit -m "update"
git commit -m "改了一下"

# ✓ 好
git commit -m "修复计时器在撤销后不回退的问题"
git commit -m "新增深色主题，配色对比度均达到 4.5:1"
```

### 什么时候该提交？

**每完成一件小事就提交一次。** 比如"加了深色主题"提交一次，"修了个 bug"再提交一次。

**不要攒一星期才提交一次** —— 存档点越密，将来回退时越精确。

---

## 3. 查看历史

```powershell
git log --oneline                     # 简版历史
git log --oneline --graph --all       # 带分支图
git show <编号>                       # 那次提交的逐行改动
git show --stat <编号>                # 只列改了哪些文件、增删多少行
git diff                              # 还没 add 的改动
git diff --staged                     # 已 add 但还没 commit 的改动
```

输出示例：

```
6493f49 chore: 初始化仓库 —— 网页版扫雷（SDD 规格驱动开发）
```

`6493f49` 就是那次存档的编号，随时可以用它指代"那个版本"。

---

## 4. 使用旧版本代码（4 个场景，风险从低到高）

假设目标版本编号是 `6493f49`。

### 场景 1️⃣　只想**看看**旧版本里的某个文件（最安全）

```powershell
git show 6493f49:README.md
git show 6493f49:src/core/game.js
```

**不会改动任何文件**，只是打印出来给你看。新手最该先学会这个。

### 场景 2️⃣　把**某一个文件**恢复到旧版本

```powershell
git restore --source=6493f49 src/core/game.js
```

只动这一个文件，其他文件不受影响。
改完记得 `git add -A` + `git commit`，否则这次恢复只存在于你的文件夹里。

### 场景 3️⃣　想**临时穿越**回旧版本到处看看

```powershell
git switch --detach 6493f49      # 穿越过去
# ……随便看、随便试，不会影响 main……
git switch main                  # 回到最新版本
```

**这是最推荐的"探索旧版本"方式**：`main` 分支完全不受影响，随时切回来。

### 场景 4️⃣　把**整个项目**退回旧版本（谨慎！）

```powershell
# ✅ 安全做法：生成一个"反向提交"，旧历史完整保留
git revert 6493f49
```

```powershell
# ⚠️ 危险做法：直接删掉之后的提交，历史被抹掉
git reset --hard 6493f49
```

**为什么推荐 `revert`：** 它不删除任何历史，只是新增一次"把改动反着做一遍"的提交。
万一后悔了，再 `revert` 一次就回来了。

**`reset --hard` 会真的丢弃提交**，而且**连同你还没提交的改动一起清空** ——
新手丢代码十有八九是这个命令造成的。

---

## 5. 救命命令：`git reflog`

万一手滑把东西弄丢了，**先别慌，也别乱试命令**：

```powershell
git reflog
```

它会列出**所有** HEAD 移动过的记录（包括你以为丢了的提交）。找到目标编号后：

```powershell
git switch -c rescue <编号>      # 从那个提交新建一个分支救回来
```

Git 几乎不会真的"删掉"数据，`reflog` 默认保留 90 天。

---

## 6. 新手最容易踩的 5 个坑

| 坑 | 后果 | 避免方法 |
| --- | --- | --- |
| `git reset --hard` 随手用 | **未提交的改动永久丢失** | 想回退就用 `git revert` |
| 提交说明写 "update"、"改了一下" | 三个月后完全看不懂 | 写清楚改了什么、为什么 |
| 忘了 `git push` | 以为备份了，其实只在本地 | 养成 `add → commit → push` 的习惯 |
| 直接删 `.git` 目录 | 全部历史一次性消失 | 搬家时把整个项目目录一起拷 |
| 一次提交塞进几十个不相关改动 | 出问题时无法精确回退 | 一件事一次提交 |

**另外**：`.gitignore` 里列出的文件（如 `node_modules/`）不会进仓库，本项目已配好。

---

## 7. 练习步骤（都是安全操作）

```powershell
cd E:\DEEPSEEK\task_1

# 1. 随便改点什么，比如在 README 末尾加一行
Add-Content README.md "`n<!-- 练习 -->"

# 2. 走一遍备份流程
git status                       # 应看到 README.md 被修改
git add -A
git commit -m "练习：在 README 加一行注释"
git log --oneline                # 现在应该有 2 个提交了

# 3. 练"查看旧版本"
git show HEAD~1:README.md        # 上一个版本的 README（末尾没有那行）
git show HEAD:README.md          # 当前版本的 README

# 4. 练"安全回退"
git revert HEAD --no-edit        # 撤销刚才那次提交（会生成第 3 个提交）

# 5. 练"穿越"
git switch --detach HEAD~2       # 回到最早的版本看看
git switch main                  # 切回来

# 6. 满意了就上传
git push
```

---

## 8. 常见问题

**Q: 提示 `fatal: not a git repository`？**
A: 你不在项目目录里。先 `cd E:\DEEPSEEK\task_1`。

**Q: 提示 `git 不是内部或外部命令`？**
A: 这个终端是在装 Git 之前打开的。**重开一个终端窗口**即可。

**Q: `git push` 报连接失败 / `Connection was reset`？**
A: 网络问题（`github.com` 在国内访问不稳定）。**直接重跑同一条命令**，通常几次就能过。

**Q: 提交之后发现漏了一个文件？**
A: 把文件加进去，然后 `git commit --amend --no-edit` 合并到上一次提交里（**只能用于还没 push 的提交**）。

**Q: 想把某个已跟踪的文件从 Git 里移除，但保留本地文件？**
A: `git rm --cached <文件>`，然后把它加进 `.gitignore`。
