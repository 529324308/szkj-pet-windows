# Windows 发布与签名

首个公开版本由 GitHub Actions 的 Windows x64 工作流构建。公开版本注明数治商城的安装包下载入口和签名状态，并在发布正文链接 [Code signing policy](README.md#code-signing-policy) 与 [隐私政策](PRIVACY.md)。

向 [SignPath Foundation](https://signpath.org/apply) 申请时提供公开仓库、发布页、从源码得到安装器的工作流、维护者和审批人资料。申请通过后，在 SignPath 安装 GitHub Connector 并为同一个项目配置两个输入产物。GitHub 上传结果是 ZIP，配置中分别匹配归档根目录下的 `szkj-pet.exe` 和 `*-setup.exe`，对各自的 PE 文件应用签名。两项产物都按 SignPath 的文件元数据规则校验产品名和版本。团队成员在 GitHub 和 SignPath 启用多因素认证。将 SignPath API 令牌存到 GitHub Actions Secret `SIGNPATH_API_TOKEN`。

在仓库 Actions Variables 配置组织 ID `SIGNPATH_ORGANIZATION_ID`、项目 slug `SIGNPATH_PROJECT_SLUG`、策略 slug `SIGNPATH_SIGNING_POLICY_SLUG` 及两项产物 slug `SIGNPATH_APPLICATION_ARTIFACT_SLUG`、`SIGNPATH_INSTALLER_ARTIFACT_SLUG`。连接器和审批策略就绪后设置 `SIGNPATH_ENABLED=true`。仓库所有者批准版本标签的签名请求。

先签内部程序，再将该程序打入 NSIS 安装器并签安装器。工作流验证两份签名和时间戳并输出安装器及 SHA-256。投放前在启用 Smart App Control 的 Windows 11 上下载并安装产物，再核对已安装程序的 Authenticode 状态及网页唤起。
