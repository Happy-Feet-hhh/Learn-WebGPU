// player.ts - 玩家飞船
// 本文件实现了玩家控制的飞船。
// 玩家通过键盘方向键控制飞船在屏幕上四方向移动。
// 移动向量会被归一化（normalize），确保对角线移动不会比单方向移动更快（即对角线速度一致）。
// 飞船位置被限制在游戏画面边界内（边界钳制）。

import { vec2 } from "wgpu-matrix";
import { Content } from "../engine/content";
import { Rect } from "../utils/rect";
import { SpriteRenderer } from "../core/sprite-renderer";
import { Texture } from "../core/texture";
import { InputManager } from "../engine/input-manager";
import { CircleCollider } from "../utils/circle-collider";

// 玩家移动速度（像素/毫秒）
const PLAYER_SPEED = 0.25;

// Player 类 —— 玩家飞船
export class Player 
{
    // 移动方向向量，每帧根据键盘输入重新计算
    // 值为 (-1, 0)、(1, 0)、(0, -1)、(0, 1) 或其组合（如对角线移动）
    private movementDirection = vec2.create();

    // 飞船在屏幕上的绘制矩形（位置和大小）
    public readonly drawRect: Rect;

    // 在纹理图集中的源矩形（裁剪区域）
    private sourceRect: Rect;

    // 飞船使用的纹理资源
    private texture: Texture; 

    // 圆形碰撞体，用于与敌人的碰撞检测
    public collider = new CircleCollider();

    // 构造函数
    // inputManager: 输入管理器，用于读取键盘按键状态
    // gameWidth/gameHeight: 游戏画面尺寸，用于边界钳制
    constructor(private inputManager: InputManager, 
        private gameWidth: number, 
        private gameHeight: number)
    {
        // 从 Content 中加载 "playerShip1_blue" 蓝色玩家飞船精灵
        const playerSprite = Content.sprites["playerShip1_blue"];
        this.texture = playerSprite.texture;
        this.sourceRect = playerSprite.sourceRect.copy();
        this.drawRect = playerSprite.drawRect.copy();
    }

    // 边界钳制 —— 将飞船位置限制在游戏画面范围内
    // 防止飞船移出屏幕左、右、上、下边界
    public clampToBounds() 
    {
        // 左边界：不能小于 0
        if(this.drawRect.x < 0)
        {
            this.drawRect.x = 0;
        }
        // 右边界：不能超出画面宽度
        else if(this.drawRect.x + this.drawRect.width > this.gameWidth)
        {
            this.drawRect.x = this.gameWidth - this.drawRect.width;
        }

        // 上边界：不能小于 0
        if(this.drawRect.y < 0)
        {
            this.drawRect.y = 0;
        }
        // 下边界：不能超出画面高度
        else if(this.drawRect.y + this.drawRect.height > this.gameHeight)
        {
            this.drawRect.y = this.gameHeight - this.drawRect.height;
        }
    }

    // 每帧更新玩家的位置和状态
    // dt: 距上一帧的时间间隔（毫秒）
    public update(dt: number )
    {
        // 重置移动方向向量为零向量
        this.movementDirection[0] = 0;
        this.movementDirection[1] = 0;

        // 根据键盘输入设置水平移动方向
        // x 方向（水平）
        if(this.inputManager.isKeyDown("ArrowLeft"))
        {
            this.movementDirection[0] = -1;
        }
        else if(this.inputManager.isKeyDown("ArrowRight"))
        {
            this.movementDirection[0] = 1;
        }

        // 根据键盘输入设置垂直移动方向
        // y 方向（垂直）
        if(this.inputManager.isKeyDown("ArrowUp"))
        {
            this.movementDirection[1] = -1;
        }
        else if(this.inputManager.isKeyDown("ArrowDown"))
        {
            this.movementDirection[1] = 1;
        }

        // 归一化移动方向向量
        // 这样对角线移动（如同时按上+右）的速度与单方向移动保持一致
        // 例如 (-1, 1) 归一化后约为 (-0.707, 0.707)，其模长为 1
        vec2.normalize(this.movementDirection, this.movementDirection);

        // 根据方向、速度和时间增量更新飞船位置
        this.drawRect.x += this.movementDirection[0] * PLAYER_SPEED * dt;
        this.drawRect.y += this.movementDirection[1] * PLAYER_SPEED * dt;
   
        // 将飞船位置限制在屏幕边界内
        this.clampToBounds();
        // 根据新的绘制矩形更新碰撞体位置
        this.collider.update(this.drawRect);
    }

    // 绘制玩家飞船精灵
    public draw(spriteRenderer: SpriteRenderer): void 
    {
        spriteRenderer.drawSpriteSource(this.texture, this.drawRect, this.sourceRect);
    }
}
