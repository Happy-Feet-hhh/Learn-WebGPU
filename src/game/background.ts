// background.ts - 滚动背景
// 本文件实现了无限滚动的太空背景效果。
// 核心技巧：使用两张相同的背景图片上下拼接，当第一张完全滚出屏幕时，
// 将两张图片交换位置，从而实现无缝循环滚动的视觉效果。
// 这是一种经典的 2D 游戏背景滚动实现方式（双图交替滚动）。

import { Content } from "../engine/content";
import { Rect } from "../utils/rect";
import { SpriteRenderer } from "../core/sprite-renderer";

// 背景滚动速度（像素/毫秒），与陨石最大速度一致
const BACKGROUND_SCROLL_SPEED = 0.25;

// Background 类 —— 无限循环滚动背景
export class Background 
{
    // 第一张背景的绘制矩形
    private drawRect: Rect;

    // 第二张背景的绘制矩形（紧跟第一张上方）
    private drawRect2: Rect;

    // 构造函数
    // gameWidth/gameHeight: 游戏画面尺寸，背景大小与画面一致
    constructor(private gameWidth: number, private gameHeight: number) {
        // 第一张背景：从屏幕左上角 (0, 0) 开始
        this.drawRect = new Rect(0, 0, gameWidth, gameHeight);
        // 第二张背景：位于第一张正上方（y 坐标为负的游戏高度）
        this.drawRect2 = new Rect(0, -gameHeight, gameWidth, gameHeight);
    }

    // 每帧更新背景滚动位置
    // dt: 距上一帧的时间间隔（毫秒）
    update(dt: number)
    {
        // 第一张背景向下移动（模拟太空向下滚动的效果）
        this.drawRect.y += BACKGROUND_SCROLL_SPEED * dt;
        // 第二张背景始终紧跟第一张上方（保持紧密拼接）
        this.drawRect2.y = this.drawRect.y - this.gameHeight;

        // 当第一张背景完全滚出屏幕底部时，交换两张背景的位置
        // 此时原来的第二张变成了新的第一张（在屏幕内），原来的第一张变成了新的第二张（在上方等待）
        // 这样就形成了无限循环滚动的效果
        if(this.drawRect.y > this.gameHeight)
        {
            const temp = this.drawRect;
            this.drawRect = this.drawRect2;
            this.drawRect2 = temp;
        }
    }

    // 绘制两张背景图片（上下拼接形成连续滚动效果）
    draw(spriteRenderer: SpriteRenderer)
    {
        spriteRenderer.drawSprite(Content.backgroundTexture, this.drawRect);
        spriteRenderer.drawSprite(Content.backgroundTexture, this.drawRect2);

    }
}
