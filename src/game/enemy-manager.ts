// enemy-manager.ts - 敌人管理器
// 本文件实现了敌人的统一管理系统，采用对象池（Object Pool）设计模式。
// 对象池的核心思想：不在每次需要敌人时创建新对象，而是复用已标记为 inactive 的敌人实例，
// 避免频繁的内存分配和垃圾回收，提升运行时性能。
// 同时负责敌人生成、碰撞检测（与玩家和子弹）以及分数更新。

import { SpriteRenderer } from "../core/sprite-renderer";
import { BulletManager } from "./bullet-manager";
import type { Enemy } from "./enemy";
import { ExplosionManager } from "./explosion-manager";
import { HighScore } from "./high-score";
import { MeteorEnemy } from "./meteor-enemy";
import { Player } from "./player";

// 敌人生成间隔（毫秒）—— 每隔 1000ms（1 秒）尝试生成一个新敌人
const SPAWN_INTERVAL = 1000;

// EnemyManager 类 —— 敌人的生命周期管理和碰撞检测中心
export class EnemyManager 
{
    // 距离下次生成敌人的累计时间（毫秒）
    private timeToSpawn = 0;

    // 对象池：存储所有已创建的敌人实例（包括活跃和非活跃的）
    // 非活跃的敌人会被复用而非销毁，这就是对象池模式的核心
    private pool : Enemy[] = [];

    // 构造函数
    // player: 玩家引用，用于检测敌人与玩家的碰撞
    // explosionManager: 爆炸效果管理器，碰撞发生时创建爆炸动画
    // bulletManager: 子弹管理器，用于检测敌人与子弹的碰撞
    // gameWidth/gameHeight: 游戏画面尺寸，用于限制敌人生成位置和判断出界
    // highScore: 计分板引用，击毁敌人时增加分数
    constructor(
        private readonly player: Player,
        private readonly explosionManager: ExplosionManager,
        private readonly bulletManager: BulletManager,
        private gameWidth: number, private gameHeight: number,
        private highScore: HighScore) 
    {
    }

    // 尝试生成一个新敌人（或复用对象池中的非活跃敌人）
    public spawnEnemy() 
    {
        // 仅当累计时间超过生成间隔时才生成
        if(this.timeToSpawn > SPAWN_INTERVAL)
        {
            // 重置计时器
            this.timeToSpawn = 0;

            // 在对象池中查找一个非活跃的敌人进行复用
            let enemy = this.pool.find(e => !e.active);

            // 如果池中没有可复用的敌人，创建一个新的并加入池中
            if(!enemy)
            {
                enemy = new MeteorEnemy(this.gameWidth, this.gameHeight);
                this.pool.push(enemy);
            }

            // 激活敌人并设置随机初始位置
            enemy.active = true;
            // x 坐标在屏幕宽度内随机分布（留出敌人宽度的边距）
            enemy.drawRect.x = Math.random() * (this.gameWidth - enemy.drawRect.width);
            // y 坐标设为屏幕上方外侧，使敌人看起来是从屏幕外飞入
            enemy.drawRect.y = -enemy.drawRect.height;
        }
    }

    // 每帧更新所有敌人的状态并处理碰撞
    // dt: 距上一帧的时间间隔（毫秒）
    public update(dt: number)
    {
        // 累加生成计时器
        this.timeToSpawn += dt;
        // 尝试生成新敌人
        this.spawnEnemy();

        // 遍历对象池中的所有敌人
        for(const enemy of this.pool)
        {
            // 仅处理活跃的敌人
            if(enemy.active)
            {
                // 更新敌人的位置和状态
                enemy.update(dt);

                // 碰撞检测 1：敌人与玩家的碰撞
                // 使用圆形碰撞体进行相交测试
                if(enemy.collider.intersects(this.player.collider))
                {
                    // 碰撞后禁用敌人
                    enemy.active = false;
                    // 在碰撞位置创建爆炸动画效果
                    this.explosionManager.create(enemy.drawRect);
                }

                // 碰撞检测 2：敌人与子弹的碰撞
                // 委托给 BulletManager 检测是否有子弹击中了该敌人
                if(this.bulletManager.intersectsEnemy(enemy))
                {
                    // 被击中后禁用敌人
                    enemy.active = false;
                    // 创建爆炸动画效果
                    this.explosionManager.create(enemy.drawRect);
                    // 击毁敌人获得 10 分
                    this.highScore.currentScore += 10;
                }

                // 超出屏幕底部的敌人自动销毁（回收）
                // 敌人完全移出屏幕下方时标记为非活跃，等待下次复用
                if(enemy.drawRect.y > this.gameHeight)
                {
                    enemy.active = false;
                }
            }
        }
    }

    // 绘制所有活跃的敌人
    public draw(spriteRenderer: SpriteRenderer)
    {
        for(const enemy of this.pool)
        {
            if(enemy.active)
            {
                enemy.draw(spriteRenderer);
            }
        }
    }
}
