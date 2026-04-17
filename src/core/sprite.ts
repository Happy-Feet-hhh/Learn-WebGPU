/**
 * 精灵模块 (Sprite Module)
 *
 * 本文件定义了 Sprite（精灵）类，用于表示 2D 游戏中的一个可绘制图像单元。
 * 精灵是 2D 渲染的基础概念，它将纹理（Texture）的子区域（sourceRect）映射到
 * 屏幕上的一个矩形区域（drawRect）。
 *
 * 在 WebGPU 渲染管线中，精灵的绘制通常通过以下步骤实现：
 * 1. 构建一个四边形（Quad），其顶点位置由 drawRect 决定（屏幕空间坐标）
 * 2. 设置顶点的纹理坐标（UV 坐标），由 sourceRect 在纹理中的相对位置计算得出
 * 3. 在片段着色器中使用采样器（GPUSampler）从纹理中读取对应颜色
 *
 * 纹理图集（Texture Atlas / Sprite Sheet）优化：
 * 将多个精灵打包到同一张纹理中，可以减少 GPU 的纹理绑定次数（texture bind），
 * 从而降低渲染管线的状态切换开销，提升批量渲染（Batch Rendering）的效率。
 */

import { Rect } from "../utils/rect";
import { Texture } from "./texture";

/**
 * Sprite 类 - 表示 2D 精灵
 *
 * 精灵是 2D 渲染中最基本的可视元素。每个精灵关联一个纹理，并定义了两个矩形区域：
 * 一个指定在屏幕上的绘制位置和大小，另一个指定在纹理图集中的源区域。
 * 这种设计支持纹理图集（Texture Atlas）的高效使用，允许从同一张纹理中裁剪出不同的图像区域。
 */
export class Sprite 
{
    /**
     * 构造函数 - 创建精灵实例
     *
     * @param texture    - 纹理对象，包含 GPUTexture 和 GPUSampler。
     *                     当使用纹理图集时，多个精灵可以共享同一个纹理对象。
     * @param drawRect   - 绘制矩形（屏幕空间），定义精灵在屏幕上的渲染位置和大小。
     *                     坐标系通常为：原点在左上角，X 轴向右，Y 轴向下。
     *                     drawRect.x / drawRect.y：精灵左上角在屏幕上的坐标（像素）
     *                     drawRect.width / drawRect.height：精灵在屏幕上的显示尺寸。
     *                     可以与 sourceRect 的尺寸不同，此时会产生缩放效果。
     * @param sourceRect - 源矩形（纹理空间），定义精灵在纹理图集中的子区域。
     *                     坐标以纹素（texel）为单位，原点在纹理的左上角。
     *                     sourceRect.x / sourceRect.y：子区域在纹理中的起始坐标
     *                     sourceRect.width / sourceRect.height：子区域的尺寸。
     *                     通过在着色器中将这些纹素坐标归一化为 UV 坐标（除以纹理总尺寸），
     *                     可以精确地从纹理图集中采样出所需的图像区域。
     */
    constructor(public texture: Texture, 
        public drawRect: Rect, 
        public sourceRect: Rect) 
    {
    }
}
