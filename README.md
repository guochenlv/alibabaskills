# Alibaba 半自动发品工具

产品图 -> 视觉分析 -> `product-draft.json` -> Edge 插件填表 -> 人工检查 -> 人工发布。

发布按钮永远不由脚本点击。

## 第一步：生成产品草稿（Codex Skill）

第一步已经封装为 Codex Skill：`alibaba-product-draft`。技能目录：

- 工作区源文件：`skills/alibaba-product-draft/`
- Codex 安装位置：`~/.codex/skills/alibaba-product-draft`（当前是指向工作区的 Junction）

技能流程：产品图 -> 图片预处理 -> 一次视觉分析 -> `vision.json` -> `listing.json` -> `product-draft.json`。最多只看 3 张图，看不清的字段写入 `missing`，不猜测。

在项目根目录执行：

```powershell
$skill = Join-Path $env:USERPROFILE '.codex\skills\alibaba-product-draft'
node "$skill\scripts\prepare-images.js" --root .
node "$skill\scripts\build-draft.js" --root .
node "$skill\scripts\validate-draft.js" --root .
```

本仓库也保留了 `node scripts\build-draft.js`，它会转调 Skill 里的通用构建器。

输入：

- `产品/*.avif`：原始产品图，`prepare-images.js` 会转换为 PNG 并限制最大宽度
- `images/*.png`：转换后的图片，也是插件上传用的文件
- `output/vision.json`：一次视觉分析结果，只记录图片可见事实
- `output/listing.json`：英文标题、关键词、描述 HTML、属性、默认值和缺失项
- `output/company-profile.template.json`：插件公司配置模板

输出：

- `output/product-draft.json`：供插件读取的结构化草稿
- `output/product-draft.md`：中文审阅版
- `output/description-preview.html`：描述渲染预览
- `output/description-preview.png`：预览截图
- `output/page-field-map.json`：发品页稳定选择器
- `output/image-manifest.json`：图片转换与尺寸记录

`output/description.html` 保留为当前产品的描述源文件；通用流程以 `output/listing.json` 为准。

## 字段来源

- `images`：图片中可见
- `engineering_drawing`：工程图尺寸
- `reference_listing`：参考现有商品的规格，发布前确认
- `default`：通用默认值
- `plugin_config`：插件中由用户填写

`{{company.*}}` 占位符由插件配置解析。未解析的占位符不会被填入页面。

## 公司配置

品牌、原产地、生产批次、公司名、工厂信息、证书、付款方式、发货港都在插件中配置，不写进模型生成的产品文案。

第一版默认值来自参考页，保存在 `output/plugin-config.json`：

- 品牌：`Worldpeak`
- 原产地：`China`
- 省份：`Jiangsu`
- 生产批次：`2026-Q4`
- 公司名：`Zhenjiang Worldpeak Communication Co., Ltd.`
- 公司介绍：1954 字符英文文案
- 公司 FAQ：4 条
- MOQ：`100 piece`
- 参考价格：`USD 2.5 - 3.2`

面板里可以直接修改，保存后写回 `output/plugin-config.json`。

## 插件面板

打开发品页后，右上角会出现「发品助手」面板：

- 从本地载入草稿：通过桥接读取 `output/product-draft.json`
- 导入 JSON：不依赖桥接，手动选择草稿文件
- 公司配置：修改公司名、公司介绍、公司 FAQ、品牌、原产地、批次、MOQ、价格、交期、包装
- 读取页面并对比：只读页面，生成字段差异，不修改页面
- 只填空白字段：默认开启；取消后可覆盖冲突字段
- 填充选中项：逐项写入并回读校验，失败会列出来
- 公司信息：填充 `#struct-companyDesc` 公司介绍，按需补齐并填写公司 FAQ
- 懒加载组件：公司介绍、FAQ、卖点编辑器会自动触发挂载，不需要先手动滚动到对应区域
- 复制描述：复制 HTML 或纯文本，富文本编辑器手动粘贴
- 商品图片：扫描页面已有图片，自动上传草稿中缺失的图片
- 公司图集：按 `output/plugin-config.json` 的 `company_images` 自动上传到公司介绍/公司优势/参展情况/包装运输图集

## 图片上传

面板会先读取主图区域的真实文件名（`.image-fileName` 的 `title`），按文件名主体与 `product-draft.json` 的 `images` 比对；缩略图 CDN 哈希只作为兜底：

- 已存在的图片跳过，不会重复上传
- 只上传 `images/` 目录中、草稿里列出的 `.png/.jpg/.jpeg`
- 通过扩展后台的真实鼠标移动打开“本地上传”菜单，再用 CDP 写入文件
- 每张图上传后等待主图数量增加，最多 6 张
- 上传失败或上传位已满时，会在面板中显示原因

图片上传完成后仍然不会点击「保存」或「发布」，需要人工检查。

面板不会点击「保存」或「发布」。填充完成后需要人工检查并手动提交。

## 浏览器桥

```powershell
node bridge-server.js
```

Edge 扩展目录：`edge-bridge`。扩展只连接 `127.0.0.1:8765`，复用当前已登录的 Edge 会话。

扩展支持离线模式：桥接未启动时，自动读取扩展内置的 `offline/product-draft.json` 和 `offline/plugin-config.json`，文字字段仍可填充，图片需手动上传。

打包扩展包：

```powershell
pwsh -NoProfile -File scripts\package-extension.ps1
```

输出 `dist/alibaba-local-bridge-v0.7.0.zip`，解压后在 `edge://extensions` 用开发者模式加载即可分发给他人。

图片上传计划接口：`GET /image-upload-plan?token=...`，只返回 `images/` 下草稿引用的图片绝对路径。

## 安全约束

- 不自动登录，不处理验证码
- 不自动保存或提交
- 填表前先读取页面，只填空白或经用户确认的字段
- 类目由人工选择
