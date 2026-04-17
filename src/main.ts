// main.ts - 游戏入口文件
// 负责初始化引擎、创建游戏对象、设置更新和绘制回调
// 游戏架构：Engine 负责渲染管线和游戏循环，各游戏对象负责自身逻辑
//
// 整体渲染流程（Bloom 后处理）：
//   1. 将场景渲染到离屏纹理（sceneTexture）+ 亮度纹理（brightnessTexture）
//   2. Bloom 效果对亮度纹理进行多次高斯模糊
//   3. 将模糊后的亮度纹理与原始场景纹理混合，输出到屏幕

import { Content } from "./engine/content";
import { Engine } from "./engine/engine";
import { Background } from "./game/background";
import { BulletManager } from "./game/bullet-manager";
import { EnemyManager } from "./game/enemy-manager";
import { ExplosionManager } from "./game/explosion-manager";
import { Player } from "./game/player";
import { Color } from "./utils/color";
import { HighScore } from "./game/high-score";

// 创建游戏引擎实例
const engine = new Engine();

// 初始化引擎（异步：等待 WebGPU 设备创建和资源加载完成）
// .then() 在初始化成功后执行游戏对象的创建和回调注册
engine.initialize().then(async () => {

    // 创建玩家对象，传入输入管理器和游戏区域边界
    const player = new Player(engine.inputManager,
        engine.gameBounds[0], engine.gameBounds[1]);

    // 创建背景对象（滚动星空背景）
    const background = new Background(engine.gameBounds[0], engine.gameBounds[1]);

    // 爆炸管理器：使用对象池模式管理爆炸特效的创建和回收
    // 对象池避免频繁创建/销毁对象，减少垃圾回收压力
    const explosionManager = new ExplosionManager();

    // 子弹管理器：管理所有子弹的创建、移动和生命周期
    // 与玩家关联是因为子弹由玩家发射
    const bulletManager = new BulletManager(player);

    // 最高分管理器
    const highScore = new HighScore();

    // 敌人管理器：管理敌人的生成、移动和碰撞检测
    // 需要引用 player（追踪/碰撞）、explosionManager（死亡特效）、
    // bulletManager（子弹碰撞检测）和游戏边界
    const enemyManager = new EnemyManager(player,
        explosionManager,
        bulletManager,
        engine.gameBounds[0], engine.gameBounds[1],
        highScore);

    // 创建 Bloom（泛光）后处理效果
    // Bloom 效果原理：
    //   1. 从场景中提取高亮区域（亮度阈值过滤）
    //   2. 对高亮区域进行多次高斯模糊（水平+垂直方向）
    //   3. 将模糊后的光晕叠加到原始场景上
    const postProcessEffect = await engine.effectsFactory.createBloomEffect();

    // 注册每帧更新回调
    // Update 阶段：所有游戏对象更新逻辑状态（移动、碰撞、AI 等）
    // dt 参数为帧间隔时间（毫秒），用于帧率无关的运动计算
    engine.onUpdate = (dt: number) => {
        player.update(dt);               // 更新玩家位置和状态
        background.update(dt);           // 更新背景滚动
        enemyManager.update(dt);         // 更新敌人（生成、移动、碰撞）
        explosionManager.update(dt);     // 更新爆炸动画
        bulletManager.update(dt);        // 更新子弹位置和碰撞
    };

    // 注册每帧绘制回调
    // Draw 阶段：所有游戏对象提交绘制命令到精灵渲染器
    engine.onDraw = () => {

        // 将渲染目标重定向到 Bloom 效果的离屏纹理
        // sceneTexture：存储完整的场景颜色（第一个渲染目标）
        // brightnessTexture：存储场景中的高亮部分（第二个渲染目标，MRT）
        engine.setDestinationTexture(postProcessEffect.sceneTexture.texture);
        engine.setDestinationTexture2(postProcessEffect.brightnessTexture.texture);
        
        // 绘制顺序决定 Z 轴层次（先绘制的在底层）：
        // 背景 → 玩家/敌人 → 子弹 → 爆炸特效 → UI
        background.draw(engine.spriteRenderer);
        player.draw(engine.spriteRenderer);
        enemyManager.draw(engine.spriteRenderer);
        bulletManager.draw(engine.spriteRenderer);
        explosionManager.draw(engine.spriteRenderer);

        // 绘制 UI（最高分显示）
        highScore.draw(engine.spriteRenderer);

        // 执行 Bloom 后处理：
        // 读取离屏的场景纹理和亮度纹理，应用模糊算法，
        // 最终将结果输出到 Canvas 纹理（即屏幕）
        postProcessEffect.draw(engine.getCanvasTexture().createView());
  
    };



    // 启动游戏主循环（开始第一帧的渲染）
    engine.draw()
});
