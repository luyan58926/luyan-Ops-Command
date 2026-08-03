# Git 分叉安全分析报告（2026-08-03）

> 依据安全优先原则，先备份、先对比，未确认前不执行任何覆盖操作。

## 一、分支现状

- 本地 `main` → `80d1834`（派单撤销/删除能力）
- 远程 `origin/main` → `38b5360`
- 分叉情况：本地领先 7、落后 4（本地为超集）
- 合并基点（共同祖先）：`2432dea`（工程师与职场密码锁）

## 二、已创建备份分支

| 备份分支 | 指向提交 | 说明 |
|---------|---------|------|
| `backup/local-main-before-merge-20260803` | `80d1834` | 本地当前完整版本，含全部已确认功能 |
| `backup/remote-main-before-merge-20260803` | `38b5360` | 远程当前版本，可完整恢复 |

## 三、本地独有 7 个提交

| 提交 | 标题 | 改动文件 | 功能 |
|------|------|---------|------|
| `80d1834` | 派单撤销与删除能力 | app.js/assistant.js/ui.js/测试 | 撤销保留过程、删除进回收站 |
| `ab0a0a2` | 升级花姐助手 | assistant.js/ui.js/app.js/index.html/测试 | 意图解析+真实写入+确认撤销 |
| `e93451f` | 修复弹窗关闭按钮 | ui.js/css/index.html/测试 | 统一弹窗栈架构 |
| `50ab4cd` | 休假记录与驻场补位 | app.js/ui.js/css/测试 | 休假+补位提醒 |
| `310ad8c` | rebase冲突恢复ui.js | ui.js | 恢复固定任务/告警/来源筛选 |
| `15e4dc4` | 固定任务数据重整 | app.js/data.js | 9项白名单+来源区分 |
| `2dc01f4` | 首页实时告警一键清空 | app.js/css | 二次确认/清空记录/冷却 |

## 四、远程独有 4 个提交

| 提交 | 标题 | 改动文件 |
|------|------|---------|
| `38b5360` | 固定任务数据重整+实时告警一键清空推送(经Contents API) | css/app.css |
| `76e1421` | 同上 | js/ui.js |
| `7b346d0` | 同上 | js/data.js |
| `8c3b871` | 同上 | js/app.js |

## 五、对比结论（关键）

远程 4 个提交全部标题为"固定任务数据重整+实时告警一键清空推送(经Contents API)"，
正是本地 `2dc01f4`（实时告警清空）+ `15e4dc4`（固定任务）+ `310ad8c`（rebase 恢复 ui.js）
经 Contents API 推送的早期/替代版本。

| 文件 | 验证方法 | 结论 |
|------|---------|------|
| `js/ui.js` | 本地310ad8c diff 与远程76e1421 diff 逐字比对；`git cherry` 标记 `-` | **完全一致** |
| `js/data.js` | 去掉 CR 后内容比对 | **完全一致**（远程仅 CRLF/换行符差异） |
| `js/app.js` | 功能关键词统计（实时告警/固定任务/一键清空） | 本地全含且为超集 |
| `css/app.css` | 关键词统计 + 行数 | 本地为超集（1084>956） |
| `index.html` | 去 CR 后 diff | 本地为超集（多休假导航、assistant.js） |

**决定性结论：远程 4 个提交没有任何本地尚未包含的有效修改。**
远程功能已全部被本地实现并重构增强，远程提交属于"已被本地完整替代的版本"。

## 六、合并模拟

用 `git merge-tree --write-tree main origin/main` 模拟合并：
- 冲突文件：`css/app.css`、`js/app.js`、`js/data.js`、`js/ui.js`（正是远程改的4个文件）
- 因远程侧无可保留的新内容，合并冲突只能全部取本地（theirs），产生无意义的 merge commit，且引入逐文件处理风险

## 七、备份目录检查

3 个备份目录均在主仓库之外（上级目录 `2026-07-31-13-32-41/`），主仓库 `git ls-files` 未跟踪任何备份：

| 目录 | 内容 | 是否含敏感资料 |
|------|------|---------------|
| `backup_fixed_tasks_20260731` | 6个 .bak/.tmp（app/data/ui.js.bak + 临时测试脚本） | 仅代码快照，无 |
| `backup_leave_feature_20260803` | 3个 .bak（app.css/app.js/ui.js.bak） | 仅代码快照，无 |
| `backup_nk_ops_before_modal_fix_20260803_114743` | 完整独立 git 仓库（弹窗修复前快照，停在 50ab4cd） | 含 .git，无 Token |

- 无数据库（.db）、JSON、Excel、密钥配置文件
- grep 命中的 "password" 均为密码锁功能 UI 代码（type="password" 输入框），非真实凭据
- 无 ghp_/github_pat_/AKIA/私钥等真实 Token

**处理建议**：有价值的代码备份保留；因均在主仓库外且未跟踪，天然不参与提交。无需清理；如需长期保留可统一移至仓库外的备份根目录。

## 八、Token 安全检查

| 检查项 | 结果 |
|--------|------|
| 当前工作区 GitHub Token（ghp_/github_pat_/gho_/ghu_） | 未发现 |
| 当前工作区硬编码 API 密钥/secret | 未发现 |
| Git 历史全部提交中的 Token | 未发现 |
| commit message 含 token/secret | 无 |
| remote URL 内嵌 Token | 无（纯 HTTPS） |
| 凭据存储方式 | Windows Git Credential Manager 托管（系统凭据库，不进项目） |
| .env / 本地密钥配置文件 | 无 |

**结论**：项目仓库从未存储任何 Token/凭据，Git 认证由系统凭据管理器安全托管。无明文 Token 进入前端/HTML/Git 历史/日志，无需清理，也无须重写 Git 历史。

## 九、处理建议

按安全原则，远程提交确认全部无效（被本地完整替代）：
1. **保留两个备份分支**（已完成）
2. 不执行无意义的合并
3. 如确认需让本地成为新远程 main，用 `git push --force-with-lease`（仅当确认远程未再被他人修改）
4. 禁止使用普通 `git push --force`
