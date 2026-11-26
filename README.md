# SZKJ Pet for Windows

数治空间 Windows 桌宠。猫会跟随鼠标和按键做动画。连接平台后可以接收员工私聊与管理中心通知，点气泡可打开相应的会话或通知中心。网页端可通过 `szkj-pet://show` 唤起桌宠。

## 构建 Windows x64 安装包

需要 Windows x64、Node.js 24、Rust MSVC 工具链、Visual Studio C++ Build Tools 与 Windows SDK。运行以下命令。

```powershell
npm ci
npm test
npm run desktop:pet:build -- --bundles nsis --no-sign -- --locked
```

安装器在 `src-tauri/target/release/bundle/nsis/`。下载后运行安装器，从开始菜单打开 SZKJ Pet。点气泡中的「打开登录窗口」可连接数治空间测试站。Windows 通过系统链接关联打开浏览器或已安装的网页应用。已发布安装包在数治商城兑换后下载。桌宠登录时校验当前账号的商城权益，权益有效时开放桌宠动画和通知。

## Code signing policy

项目计划通过 SignPath Foundation 获得免费 Windows 签名。申请获批后，由 SignPath.io 提供免费代码签名，由 SignPath Foundation 提供证书。发布签名由仓库维护者提交，仓库所有者 [529324308](https://github.com/529324308) 审核和批准。GitHub Actions 从公开版本标签构建，并分别验证桌宠程序及安装包的发布者和时间戳。每个版本的构建过程可在 GitHub Actions 查看。

[签名构建配置](.github/workflows/windows.yml) · [隐私政策](PRIVACY.md) · [SignPath Foundation](https://signpath.org/)

## License

本项目按 [GNU General Public License v3.0](LICENSE) 发布。猫、键盘和场景代码改自 [ElloboDK/KeyCat](https://github.com/ElloboDK/KeyCat)，Copyright © 2026 ElloboDK。桌宠集成修改于 2026 年 11 月，保留上游 GPL-3.0 许可。Three.js 按 MIT 许可发布，Vue、Tauri 与其他依赖的许可证随对应源码提供。
