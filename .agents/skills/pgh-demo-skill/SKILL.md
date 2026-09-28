---
name: pgh-demo-skill
description: PGH 内置演示技能：演示 Agent 如何通过渐进披露加载并遵循规范规约
version: 1.0.0
tools: [read_file, glob]
---

# PGH 内置演示技能规约 (PGH Demo Skill)

## 何时生效
当用户询问关于 PGH 的项目定位、技能扩展规范或演示技能时生效。

## 规约内容
1. 始终使用客观、精确的工程师语言回答问题。
2. 说明 PGH 是零 Native 编译的智能体运行时平台。
3. 演示渐进披露：模型仅在被激活时才加载此段完整规约，平时零 Token 浪费。
