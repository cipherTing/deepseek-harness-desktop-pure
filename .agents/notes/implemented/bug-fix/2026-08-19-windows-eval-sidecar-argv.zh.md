# Agent Note: Windows eval sidecar 保留主模块参数

Status: implemented

[English](2026-08-19-windows-eval-sidecar-argv.md) | 中文

## Problem

Windows 使用 `--input-type=module --eval` 启动内置 Node 运行时，避免 Node 按打包资源路径查找主脚本。Eval 模式没有主脚本；命令不提供位置参数时，`process.argv[1]` 为 `undefined`。Web profile 的 fallback HMR 会在启动时解析 `process.argv[1]`，导致 Desktop sidecar 在发出 `ready` 前失败。原有 sidecar smoke 直接启动 `sidecar.mjs`，打包测试则只检查 Rust 源码中存在 `--eval`；两者都没有执行 Windows 命令。

## Decision

Windows 命令固定为 `node --input-type=module --eval <import expression> -- <absolute sidecar path>`。Eval 表达式通过文件 URL 导入 sidecar，位置参数则让整个导入模块图得到与普通主脚本启动相同的 `process.argv[1]`。完整参数列表由单个 Rust helper 构造，分隔符、位置参数和 import 表达式不会分别维护。

Sidecar smoke 在每个受支持的 smoke 主机上同时执行原生主脚本启动和 Windows eval 启动。两种方式都必须收到真实 Web host 的 `ready` 消息，并完成现有协议与 HTTP 检查。这样 macOS 可以执行 Windows 的 Node 参数语义，但不冒充已验证 Windows 进程所有权或安装包布局。另一个 Rust 单元测试固定参数顺序以及带空格的路径。

## Alternatives considered

**在 Desktop 中禁用 fallback HMR。** 不采用。Desktop 承载标准 Web profile，不拥有第二套启动策略；删除 HMR 只是掩盖主模块参数缺失，同时改变共享 Harness 行为。

**在 eval 表达式中赋值 `process.argv[1]`。** 不采用。修改进程全局变量等于在应用代码中重建 Node 命令行语义；位置参数使用 Node 自身的 argv 处理，并对整个导入模块图可见。

**保留直接启动 smoke 和源码文本断言。** 不采用。这个组合已经放过了损坏的命令：它只证明各个片段存在，没有证明组合后能够启动。

## Consequences

Windows sidecar 启动会保留主模块路径，同时无需退回直接主脚本查找。完整 smoke 会多启动一代 sidecar，因此在受支持主机上增加数秒耗时。它仍不验证 NSIS 安装、WebView 启动、Windows Job Object 清理或安装后的资源路径；这些需要 Windows 产品级验收，不能继续用源码断言代替。
