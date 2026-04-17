// bullet-manager.ts - 子弹管理器
// 本文件实现了子弹的统一管理系统，同样采用对象池（Object Pool）设计模式。
// 负责子弹的自动发射（定时生成）、与敌人的碰撞检测、以及生命周期管理。
// BulletManager 由 EnemyManager 调用来检测子弹是否命中敌人。

import { SpriteRenderer } from "../core/sprite-renderer";
import { Bullet } from "./bullet";
import type { Enemy } from "./enemy";
import { Player } from "./player";

// 子弹自动发射间隔（毫秒）—— 每 250ms 自动发射一颗子弹
const SPAWN_TIME = 250;

// BulletManager 类 —— 子弹的生命周期管理和碰撞检测
export class BulletManager 
{
    // 对象池：存储所有已创建的子弹实例（活跃和非活跃的）
    // 非活跃的子弹会被复用，避免频繁创建/销毁对象
    private pool : Bullet[] = [];

    // 距离下次自动发射的累计时间（毫秒）
    private timeToSpawn = 0;

    // 构造函数
    // player: 玩家引用，子弹发射时需要知道玩家的当前位置
    constructor(private readonly player: Player)
    {
    }

    // 创建（发射）一颗子弹
    // 优先从对象池中复用非活跃的子弹；若池中无可用子弹，则新建一个
    public create() 
    {
        // 在对象池中查找非活跃的子弹进行复用
        let bullet = this.pool.find(e => !e.active);
        // 如果池中没有可复用的子弹，创建一颗新子弹并加入池中
        if(!bullet)
        {
            bullet = new Bullet();
            this.pool.push(bullet);
        }

        // 将子弹放置在玩家当前位置并激活
        bullet.spawn(this.player);
    }

    // 检测是否有子弹击中了指定敌人
    // enemy: 要检测碰撞的敌人
    // 返回值: 如果有子弹命中敌人则返回 true，同时命中的子弹会被标记为非活跃
    public intersectsEnemy(enemy: Enemy) : boolean
    {
        // 遍历对象池中所有子弹
        for(const bullet of this.pool)
        {
            // 仅检测活跃子弹与敌人的碰撞
            if(bullet.active && bullet.collider.intersects(enemy.collider))
            {
                // 命中后子弹也标记为非活跃（子弹消失）
                bullet.active = false;
                return true;
            }
        }

        // 没有子弹命中该敌人
        return false;
    }

    // 每帧更新：自动发射子弹并更新所有活跃子弹的位置
    // dt: 距上一帧的时间间隔（毫秒）
    public update(dt: number)
    {
        // 累加自动发射计时器
        this.timeToSpawn += dt;

        // 计时器超过发射间隔时自动发射子弹
        if(this.timeToSpawn > SPAWN_TIME)
        {
            this.timeToSpawn = 0;
            this.create();
        }

        // 更新所有活跃子弹的位置和碰撞体
        for(const bullet of this.pool)
        {
            if(bullet.active)
            {
                bullet.update(dt);
            }
        }
    }

    // 绘制所有活跃的子弹
    public draw(spriteRenderer: SpriteRenderer)
    {
        for(const bullet of this.pool)
        {
            if(bullet.active)
            {
                bullet.draw(spriteRenderer);
            }
        }
    }

}
