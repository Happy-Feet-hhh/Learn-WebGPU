// enemy.ts - 敌人接口定义
// 本文件定义了所有敌人类型的统一接口（Interface）。
// 使用接口而非抽象类的好处是：具体的敌人类（如 MeteorEnemy）可以实现该接口，
// 同时保留各自独立的构造函数签名，不受抽象类构造函数的限制。

import { CircleCollider } from "../utils/circle-collider";
import { Rect } from "../utils/rect";
import { SpriteRenderer } from "../core/sprite-renderer";

// Enemy 接口 —— 所有敌人类型的契约
// 任何实现此接口的类都必须提供以下属性和方法，
// 使得 EnemyManager 等外部系统可以用统一的方式管理不同类型的敌人。
export interface Enemy {
    // active 标记敌人是否处于活跃状态（存活、可见、可参与碰撞检测）
    // 为 false 时表示该敌人已被销毁或超出屏幕，可被对象池回收复用
    active: boolean;

    // drawRect 定义敌人在屏幕上的绘制位置和大小（世界坐标系）
    drawRect: Rect;

    // collider 圆形碰撞体，用于检测与其他对象（玩家、子弹）的碰撞
    collider: CircleCollider;

    // update 更新敌人的内部状态（位置移动、旋转动画等）
    // dt: 上一帧到当前帧的时间间隔（毫秒），用于基于时间的平滑运动
    update(dt: number): void;

    // draw 将敌人绘制到屏幕上
    // spriteRenderer: 精灵渲染器，负责将纹理绘制到 WebGPU 画布
    draw(spriteRenderer: SpriteRenderer): void;
}
