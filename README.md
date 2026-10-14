# dsh-live2d-pet

DSH（DeepSeek Harness）界面右下角的 **Live2D 桌面宠物**：用游戏《冷たい目をした黒瀬さん》里提取的
Live2D 模型（kouzhaomei，含 2 张图集），做成可拖拽挂件，点击显示 DeepSeek 账户余额。

## 安装

```bash
# 从 GitHub 装（插件市场收录后同名一条）
dsh plugin --profile web add github:qqmqq/dsh-live2d-pet
# 本地开发用链接
dsh plugin --profile web add "link:C:\Users\bai\projects\dsh-live2d-pet"
# 装完必须重启 dsh web 才会加载（插件在宿主启动时挂载）
```

卸载：`dsh plugin --profile web remove dsh-live2d-pet`

## 用法

- 出现在右下角（默认 300×380，用**游戏相机取景**裁切，等于游戏里的构图）
- **拖动**移动；松手自动**吸附到最近的左右边缘**；位置/大小/透明度写盘，重启后保持
- **滚轮**缩放（0.5×–2.0×）
- **单击**查看余额（读 `/dsh-live2d-pet/balance.json`；余额来自 `https://api.deepseek.com/user/balance`，
  key 从 DSH 凭据的 `DEEPSEEK_API_KEY` 或同名环境变量取）
- 悬停右上角 **⚙** 菜单：余额 / 大小 ± / 透明度 / 归位 / 隐藏
- 隐藏后右下角留一个 **🐾** 浮标可以叫回来
- 待机动画：呼吸（`ParamBreath`）、眨眼（`ParamEyeLOpen/ROpen`）、轻微摆头（`ParamAngleX/Z`）—— 全部是模型自带参数
- 每 3 分钟自动刷一次余额；接口失败时显示最近一次成功值并标「旧数据」

## 结构

```
package.json          dsh.bundle.patch 声明
cordis.patch.yml      挂载声明(insert id/name)
lib/index.js          宿主插件: 11 条路由 + tapIndex 注入 + 余额缓存/重试/回退
assets/widget.js      页面挂件(原生 JS, 无构建, IIFE 幂等)
assets/lib/           pixi.min.js / live2d.js(Core) / live2dcubismcore.js(框架) / live2d-display.min.js
assets/model/         kouzhaomei.moc3 (4.12 MB) + model3.json + texture_00/01.png
tools/smoke.mjs       独立冒烟测试(假 ctx 起本地 http, 逐条验证路由)
```

## 自测

```bash
node tools/smoke.mjs
# 期望: 11 条路由全 200; state.json PUT/GET 往返一致; tapIndex 注入幂等
```

## 模型来源

从游戏 `Kurose-san_Data\sharedassets*.assets` 的 `CubismMoc` MonoBehaviour 里按字节数组长度切出，
贴图对应关系用运行时 `CubismRenderer.MainTexture` 验证；取景矩形来自运行时相机参数
（canvas 3520×5706 / 可见 2770×3520）。详见 `L2D_Extract/README.txt`。
