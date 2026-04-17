// explosion-manager.ts - 爆炸效果管理器
// 本文件实现了爆炸动画的对象池管理系统。
// 当敌人被摧毁时（无论被子弹击中还是与玩家碰撞），都会调用此管理器创建爆炸动画。
// 采用对象池模式复用已播放完毕的 Explosion 实例，避免频繁创建新对象。

import { Rect } from "../utils/rect";
import { SpriteRenderer } from "../core/sprite-renderer";
import { Explosion } from "./explosion";

// ExplosionManager 类 —— 管理所有爆炸动画实例的生命周期
export class ExplosionManager {
    // 对象池：存储所有爆炸动画实例
    // playing 为 false 的实例可被复用
    private pool: Explosion[] = [];

    // 创建（触发）一个爆炸动画
    // drawRect: 爆炸效果在屏幕上的位置和大小
    public create(drawRect: Rect) {
        // 在对象池中查找一个未在播放的爆炸实例进行复用
        let explosion = this.pool.find(e => !e.playing);

        // 如果池中没有可复用的实例，创建一个新的并加入池中
        if (!explosion) {
            explosion = new Explosion();
            this.pool.push(explosion);
        }

        // 在指定位置开始播放爆炸动画
        explosion.play(drawRect);
    }

    // 每帧更新所有正在播放的爆炸动画
    // dt: 距上一帧的时间间隔（毫秒）
    public update(dt: number) {
        for (const explosion of this.pool) {
            if (explosion.playing) {
                explosion.update(dt);
            }
        }
    }

    // 绘制所有正在播放的爆炸动画
    public draw(spriteRenderer: SpriteRenderer) {
        for (const explosion of this.pool) {
            if (explosion.playing) {
                explosion.draw(spriteRenderer);
            }
        }
    }
}
