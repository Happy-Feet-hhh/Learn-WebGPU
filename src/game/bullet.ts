// bullet.ts - 子弹
// 本文件实现了玩家发射的子弹。
// 子弹从玩家飞船顶部发出，以固定速度向上飞行。
// 当飞出屏幕顶部时自动标记为非活跃状态，可被对象池回收复用。

import { CircleCollider } from "../utils/circle-collider";
import { Content } from "../engine/content";
import { Rect } from "../utils/rect";
import { SpriteRenderer } from "../core/sprite-renderer";
import { Texture } from "../core/texture";
import { Player } from "./player";

// 子弹飞行速度（像素/毫秒），向上飞行，数值大于敌人下落速度
const BULLET_SPEED = 0.75;

// Bullet 类 —— 玩家子弹
export class Bullet {
    // 子弹在屏幕上的绘制矩形（位置和大小）
    public readonly drawRect: Rect;

    // 在纹理图集中的源矩形（裁剪区域）
    private sourceRect: Rect;

    // 子弹使用的纹理资源
    private texture: Texture;

    // 是否处于活跃状态（在屏幕上可见且可碰撞）
    public active = true;

    // 圆形碰撞体，用于与敌人的碰撞检测
    public collider = new CircleCollider();

    // 构造函数 —— 从 Content 资源中加载 "laserBlue01" 蓝色激光子弹精灵
    constructor() {
        const sprite = Content.sprites["laserBlue01"];
        this.texture = sprite.texture;
        this.sourceRect = sprite.sourceRect.copy();
        this.drawRect = sprite.drawRect.copy();
    }

    // 生成（发射）子弹
    // 将子弹放置在玩家飞船的正上方中央位置
    // player: 玩家引用，用于确定子弹的初始位置
    public spawn(player: Player)
    {
        // 激活子弹
        this.active = true;
        // x 坐标：玩家中心对齐（玩家中心 x - 子弹宽度一半）
        this.drawRect.x = player.drawRect.x + player.drawRect.width / 2 - this.drawRect.width / 2;
        // y 坐标：玩家飞船顶部上方（紧贴飞船上边缘）
        this.drawRect.y = player.drawRect.y - this.drawRect.height;
    }

    // 每帧更新子弹状态
    // dt: 距上一帧的时间间隔（毫秒）
    public update(dt: number) {
        // 子弹向上移动（y 轴负方向为屏幕上方）
        this.drawRect.y -= BULLET_SPEED * dt;
        // 根据当前位置更新碰撞体
        this.collider.update(this.drawRect);

        // 当子弹完全飞出屏幕顶部时，标记为非活跃以便对象池回收
        if(this.drawRect.y  + this.drawRect.height < 0)
        {
            this.active = false;
        }
    }

    // 绘制子弹精灵
    public draw(spriteRenderer: SpriteRenderer) {
        spriteRenderer.drawSpriteSource(this.texture, this.drawRect, this.sourceRect);
    }
}
