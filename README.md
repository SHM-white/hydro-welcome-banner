# @hucoj/welcome-banner

**HydroOJ** 的可视化封面横幅（Banner）管理插件 — 在后台控制面板中可视化上传、预览、排序、配置首页轮播横幅，无需手写 JSON 配置。

> 入口：登录管理员账号后，进入控制面板，右侧属性栏 **封面横幅管理** 标签（`/manage/banner`）

## 功能展示

<img width="920" alt="banner management" src="docs/screenshot-manage.png" />

## 功能特性

- **可视化横幅管理** — 每张横幅缩略图预览，内联编辑链接 / 标题 / 替代文本，单张启用停用，拖拽排序，删除。
- **图片作为用户附件上传** — 选文件即通过 HydroOJ 存储 API 存入你的用户附件，自动使用返回的 `/file/<uid>/<name>` 链接作为横幅图片；也支持直接填外链。
- **拖拽排序** — 抓住左侧手柄拖动即可重排，AJAX 保存、整页不刷新。
- **轮播配置** — 自动播放开关、间隔、淡入淡出 / 滑动切换、圆点指示器、左右箭头。
- **外观配置** — 宽度、高度、圆角、图片填充方式（contain / cover）、模糊背景填充。
- **悬停放大效果** — 开关 hover 放大并可调放大倍数。
- **一键接入主页** — 缺少 `banner` 区块时，一个按钮自动写入首页配置。
- **主页总开关** — 一键在首页启用 / 停用整个横幅。
- **向后兼容** — 自动迁移旧版 `welcomeBanner.banners` 系统设置。

## 环境要求

- HydroOJ v5.x

## 部署

### 方式 A：从 Release 一行安装（推荐）

以运行 HydroOJ 的用户身份执行：

```bash
hydrooj install https://github.com/DotRacel/hydro-welcome-banner/releases/download/v2.0.0/hucoj-welcome-banner-2.0.0.tgz
pm2 restart hydrooj      # 或以你的方式重启 hydrooj 进程
```

> 最新版本号见 [Releases](https://github.com/DotRacel/hydro-welcome-banner/releases)。

### 方式 B：git clone + 一键脚本

```bash
git clone https://github.com/DotRacel/hydro-welcome-banner.git ~/.hydro/addons/welcome-banner
cd ~/.hydro/addons/welcome-banner
./deploy.sh          # 自动 hydrooj addon add + pm2 restart hydrooj
```

更新：

```bash
cd ~/.hydro/addons/welcome-banner && git pull && pm2 restart hydrooj
```

### 方式 C：手动注册

```bash
hydrooj addon add /path/to/hydro-welcome-banner
pm2 restart hydrooj
```

## 主页配置

横幅会在首页配置 `hydrooj.homepage` 中出现 `banner` 区块的位置渲染。打开 **封面横幅管理** 点击「一键将 `banner` 加入主页」，或在系统设置中手动加入：

```yaml
- width: 12
  banner: true
  ...
```

## 图片存储说明

上传的图片走 HydroOJ 常规的用户文件存储（`storage.put('user/<uid>/<filename>')`）并登记进你的用户文件列表，因此会计入文件配额、也会出现在文件管理里。横幅仅引用 `/file/<uid>/<filename>`。删除横幅时可选择一并删除底层附件。

## 卸载

```bash
hydrooj addon remove ~/.hydro/addons/welcome-banner
pm2 restart hydrooj
```

## License

MIT
