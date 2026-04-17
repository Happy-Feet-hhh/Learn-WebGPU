// meteor-enemy.ts - 陨石敌人
// 本文件实现了 Enemy 接口的具体敌人类型：陨石（Meteor）。
// 陨石从屏幕顶部落下，具有随机的外观、速度和旋转效果。
// 从精灵图集（Sprite Atlas）中随机选取一种陨石纹理进行绘制。

import { vec2 } from "wgpu-matrix";
import { Content } from "../engine/content";
import { Rect } from "../utils/rect";
import { SpriteRenderer } from "../core/sprite-renderer";
import { Texture } from "../core/texture";
import type { Enemy } from "./enemy";
import { CircleCollider } from "../utils/circle-collider";

// 可用的陨石精灵名称列表
// 包含棕色大/中陨石和灰色大/中陨石共 12 种不同的外观变体
// 每个名称对应 Content.sprites 中预加载的一个精灵资源
const METEOR_KEYS = [
    "meteorBrown_big1",
    "meteorBrown_big2",
    "meteorBrown_big3",
    "meteorBrown_big4",
    "meteorBrown_med1",
    "meteorBrown_med3",
    "meteorGrey_big1",
    "meteorGrey_big2",
    "meteorGrey_big3",
    "meteorGrey_big4",
    "meteorGrey_med1",
    "meteorGrey_med2",
]

// 陨石下落的最小速度（像素/毫秒）
const METEOR_MIN_SPEED = 0.05;
// 陨石下落的最大速度（像素/毫秒）
const METEOR_MAX_SPEED = 0.25;

// MeteorEnemy 类 —— 陨石敌人的具体实现
// 实现了 Enemy 接口，可以被 EnemyManager 统一管理
export class MeteorEnemy implements Enemy {
    // 是否处于活跃状态（可见且可碰撞）
    public active: boolean = true;

    // 在屏幕上的绘制矩形（位置和大小）
    public drawRect: Rect;

    // 陨石使用的纹理资源
    private texture: Texture;

    // 在纹理图集中的源矩形（裁剪区域）
    private sourceRect: Rect;

    // 下落速度（像素/毫秒），构造时随机生成
    private speed = 0;

    // 当前旋转角度（弧度制）
    private rotation = 0;

    // 旋转速度（弧度/毫秒），构造时随机生成，正负值代表顺/逆时针
    private rotationSpeed = 0;

    // 旋转锚点，(0.5, 0.5) 表示以精灵中心为旋转原点
    // 取值范围为 [0, 1] 的归一化坐标，(0,0) 为左上角，(1,1) 为右下角
    private rotationOrigin = vec2.fromValues(0.5, 0.5);

    // 圆形碰撞体，用于碰撞检测
    public readonly collider: CircleCollider = new CircleCollider();

    // 构造函数
    // gameWidth: 游戏画面宽度，用于限制陨石的随机生成位置
    // gameHeight: 游戏画面高度，用于判断陨石是否飞出屏幕底部
    constructor(private gameWidth: number, private gameHeight: number) {
        // 从陨石精灵列表中随机选取一个
        const key = METEOR_KEYS[Math.floor(Math.random() * METEOR_KEYS.length)];

        // 从 Content 资源管理器中获取对应的精灵数据
        const meteorSprite = Content.sprites[key];
        // 提取纹理、源矩形和绘制矩形
        this.texture = meteorSprite.texture;
        this.sourceRect = meteorSprite.sourceRect.copy();
        this.drawRect = meteorSprite.drawRect.copy();

        // 在 [METEOR_MIN_SPEED, METEOR_MAX_SPEED] 范围内随机生成下落速度
        this.speed = Math.random() * (METEOR_MAX_SPEED - METEOR_MIN_SPEED) + METEOR_MIN_SPEED;
        // 随机生成旋转速度，(Math.random() - 0.5) 使值域为 [-0.0025, 0.0025]
        this.rotationSpeed = (Math.random() - 0.5) * 0.005;
    }

    // 每帧更新陨石状态
    // dt: 距上一帧的时间间隔（毫秒）
    public update(dt: number) {
        // 陨石向下移动（y 轴正方向为屏幕下方）
        this.drawRect.y += this.speed * dt;
        // 更新旋转角度
        this.rotation += this.rotationSpeed * dt;
        // 根据当前绘制矩形更新碰撞体的位置
        this.collider.update(this.drawRect);
    }

    // 绘制陨石精灵
    // 使用 drawSpriteSource 方法绘制纹理的一部分（源矩形），并应用旋转
    public draw(spriteRenderer: SpriteRenderer) {
        spriteRenderer.drawSpriteSource(this.texture, this.drawRect, 
            this.sourceRect, undefined, this.rotation, this.rotationOrigin);
    }
}
