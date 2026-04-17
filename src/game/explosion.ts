// explosion.ts - 爆炸动画
// 本文件实现了基于精灵图集（Sprite Sheet）的帧动画爆炸效果。
// 爆炸纹理是一个 4x4 的网格，包含 16 帧动画画面。
// 动画按照"先列后行"的顺序逐帧播放：先从左到右遍历第一行的 4 列，
// 然后跳到第二行继续，直到所有 16 帧播放完毕后动画结束。

import { Content } from "../engine/content";
import { Rect } from "../utils/rect";
import { SpriteRenderer } from "../core/sprite-renderer";

// 每帧动画的持续时间（毫秒）
// 1000 / 30 ≈ 33.3ms，即约 30 FPS 的动画播放速率
const TIME_TO_NEXT_FRAME = 1000 / 30;

// Explosion 类 —— 单个爆炸动画实例
export class Explosion {
    // 是否正在播放爆炸动画
    public playing = false;

    // 距离下一帧切换的累计时间（毫秒）
    private timeToNextFrame = 0;

    // 在纹理图集中的源矩形（当前帧的裁剪区域）
    private sourceRect: Rect;

    // 在屏幕上的绘制矩形（爆炸动画的显示位置和大小）
    private drawRect: Rect;

    // 当前播放到精灵图集的第几列（0 起始）
    private curretCol = 0;

    // 当前播放到精灵图集的第几行（0 起始）
    private currentRow = 0;

    // 精灵图集的总列数
    private readonly cols = 4;

    // 精灵图集的总行数
    // 4x4 = 16 帧动画
    private readonly rows = 4;

    // 构造函数 —— 初始化源矩形和绘制矩形，每帧大小为 32x32 像素
    constructor() {
        this.sourceRect = new Rect(0, 0, 32, 32);
        this.drawRect = new Rect(0, 0, 32, 32);
    }

    // 开始播放爆炸动画
    // drawRect: 爆炸在屏幕上显示的位置和大小（通常与被销毁对象的位置一致）
    public play(drawRect: Rect) {
        this.playing = true;
        this.timeToNextFrame = 0;
        // 重置动画到第一帧（第 0 行第 0 列）
        this.curretCol = 0;
        this.currentRow = 0;
        // 复制传入的绘制矩形作为爆炸显示区域
        this.drawRect = drawRect.copy();
    }

    // 每帧更新动画播放进度
    // dt: 距上一帧的时间间隔（毫秒）
    public update(dt: number) {
        if (this.playing) {
            // 累加帧切换计时器
            this.timeToNextFrame += dt;

            // 计时器超过帧间隔时切换到下一帧
            if (this.timeToNextFrame > TIME_TO_NEXT_FRAME) {
                this.timeToNextFrame = 0;
                // 列索引递增（向右移动一帧）
                this.curretCol++;

                // 当前列索引超出总列数时，换到下一行
                if (this.curretCol >= this.cols) {
                    this.curretCol = 0;
                    this.currentRow++;

                    // 当行索引超出总行数时，所有帧播放完毕
                    if (this.currentRow >= this.rows) {
                        // 重置到第一帧并停止播放
                        this.currentRow = 0;
                        this.playing = false;
                    }
                }
            }
        }
    }

    // 绘制当前帧的爆炸动画
    // 根据当前列和行计算精灵图集中的源矩形位置
    public draw(spriteRenderer: SpriteRenderer) {
        // 计算当前帧在精灵图集中的 x 偏移（列号 × 帧宽度）
        this.sourceRect.x = this.curretCol * this.sourceRect.width;
        // 计算当前帧在精灵图集中的 y 偏移（行号 × 帧高度）
        this.sourceRect.y = this.currentRow * this.sourceRect.height;

        // 使用精灵渲染器绘制当前帧
        spriteRenderer.drawSpriteSource(Content.explosionTexture,
            this.drawRect,
            this.sourceRect);
    }
}
