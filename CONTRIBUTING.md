# 协作约定（3–5 人 / 几天冲刺版）

> 目标：5 个人同时改一个纯静态前端项目，**不互相踩脚**。

## 一、第一次进来（每人做一次）

```powershell
git clone git@github.com:SX-Elementary/campus-route-ai.git
cd campus-route-ai
```

本地跑起来（不需要任何依赖）：

```powershell
# 方式 A：直接看（大模型功能关闭）
start app\index.html

# 方式 B：带大模型（需要密钥，见 docs/API接入说明.md）
cd app\route
python llm_proxy.py      # http://127.0.0.1:4181/
```

配好身份（只影响提交记录）：

```powershell
git config user.name  "你的名字"
git config user.email "你的邮箱"
```

## 二、分支约定

| 前缀 | 用途 | 例 |
|---|---|---|
| `feat/` | 新功能 | `feat/efficiency-panel` |
| `fix/` | 修 bug | `fix/shower-slot` |
| `docs/` | 文档 | `docs/readme-limits` |
| `data/` | 数据/问卷/日志整理 | `data/survey-r1` |

**永远不直接在 `main` 上开发**（除非只改一个错别字）。

```powershell
git switch -c feat/xxx
# ...改...
git add -A
git commit -m "feat(route): 增加效率面板"
git push -u origin feat/xxx
```

推送后 GitHub 会给出 "Compare & pull request" 链接，点它开 PR。

## 三、提交信息格式

```
<类型>(<范围>): <一句话>

类型：feat | fix | docs | data | refactor | test | chore
范围：route | planner | view | pipeline | docs | all
```

例：`feat(planner): 洗澡候选改为相对时段`

## 四、合并规则（建议）

- `main` 保持**随时可以打开演示**的状态；
- PR 至少 1 人 review（队长或该模块负责人）；
- 合并方式统一用 **Squash and merge**，历史干净；
- 冲突了不要硬推，先在本地 `git pull --rebase origin main`。

## 五、分工建议（按文件边界，减少冲突）

| 模块 | 文件 | 负责人 |
|---|---|---|
| 地图与路网 | `app/route/data.js`、`pipeline/*.py` | 谁来校准路网 |
| 排程引擎 | `app/route/planner.js`、`schedule.js` | 谁来定规则 |
| 界面与交互 | `app/route/view.js`、`app/route/route.css` | 谁做 UI |
| 数据与图表 | `docs/`、`figures/`、问卷日志 | 谁做实验 |
| 材料与答辩 | `docs/申报表*`、演示脚本 | 谁写材料 |

> 经验：两人同时改 `view.js` 是最容易冲突的，建议按"区块"分工（时间轴 / 地图 / 右侧面板）。

## 六、绝对不要提交

- `.secrets/`、`*.env`、任何以 `sk-` 开头的字符串（`.gitignore` 已覆盖）
- `node_modules/`、`__pycache__/`
- 别人的课表、姓名、学号、手机号（脱敏后再提交）

**提交前自检**：

```powershell
git diff --cached | findstr /C:"sk-"     # 应该没有输出
```

## 七、发布与演示

- 打标签标记可演示版本：`git tag -f v0.2-demo && git push -f origin v0.2-demo`
- 如果需要在线演示链接：仓库 Settings → Pages → Source 选 `Deploy from a branch` → 分支 `main` → 目录 `/ (root)`，之后访问
  `https://sx-elementary.github.io/campus-route-ai/app/`
